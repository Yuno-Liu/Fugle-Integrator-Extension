/**
 * ============================================================================
 * 📦 資料集服務
 * ============================================================================
 *
 * 每個資料集 = 網址 + 快取策略 + 解析器。
 * 同一資料集內的多個請求（例如 6 種關係、5 個主力區間、14 份全市場清單）一律並行，
 * 部分失敗時回傳可用的部分並記錄失敗數，全部失敗才拋出錯誤。
 */

import type { DatasetMap, DatasetName, Meta } from "../shared/messages";
import type { MajorPeriod, Relations } from "../shared/types";
import { API, MAJOR_PERIODS, MARKET_LISTS, RELATION_TYPES, STALE_IF_ERROR_MS, TTL } from "../shared/constants";
import type { MarketListId, RelationKey } from "../shared/constants";
import { parseBasic, parseCapacity, parseEtfHoldings, parseNames, parseRatings, parseRelations } from "../core/esun";
import { parseFinmindVolumes, summarizeMajor, toMajorPeriod, volumeForPeriod } from "../core/major";
import type { DailyVolume, MajorRaw } from "../core/major";
import { buildMarketSnapshot, indexMarketList } from "../core/market";
import type { MarketIndex } from "../core/market";
import { taipeiDate } from "../core/session";
import type { CacheResult, FetchPolicy, JsonCache } from "./cache";

export interface DatasetDeps {
    cache: JsonCache;
    now: () => number;
    /** 讀取使用者設定的 FinMind Token（可為空字串） */
    getFinmindToken: () => Promise<string>;
}

export interface DatasetResult<T> {
    data: T;
    meta: Meta;
}

/** 合併多個結果的 meta：取最舊的取得時間，任一過期即標記 stale */
function mergeMeta(results: ReadonlyArray<CacheResult<unknown>>, now: number): Meta {
    if (results.length === 0) return { fetchedAt: now, stale: false };
    return {
        fetchedAt: Math.min(...results.map((r) => r.fetchedAt)),
        stale: results.some((r) => r.stale),
    };
}

function fulfilled<T>(settled: ReadonlyArray<PromiseSettledResult<T>>): T[] {
    return settled.filter((s): s is PromiseFulfilledResult<T> => s.status === "fulfilled").map((s) => s.value);
}

function firstError(settled: ReadonlyArray<PromiseSettledResult<unknown>>): unknown {
    return settled.find((s): s is PromiseRejectedResult => s.status === "rejected")?.reason ?? new Error("載入失敗");
}

export function createDatasetService(deps: DatasetDeps) {
    const { cache } = deps;

    const policy = (ttlMs: number, force: boolean, extra: Partial<FetchPolicy> = {}): FetchPolicy => ({
        ttlMs,
        force,
        staleIfErrorMs: STALE_IF_ERROR_MS,
        ...extra,
    });

    const single = async <T>(url: string, ttl: number, force: boolean, parse: (json: unknown) => T, extra?: Partial<FetchPolicy>): Promise<DatasetResult<T>> => {
        const r = await cache.get(url, policy(ttl, force, extra), parse);
        return { data: r.value, meta: { fetchedAt: r.fetchedAt, stale: r.stale } };
    };

    async function relations(stockId: string, force: boolean): Promise<DatasetResult<Relations>> {
        const keys = Object.keys(RELATION_TYPES) as RelationKey[];
        const settled = await Promise.allSettled(keys.map((k) => cache.get(API.relation(stockId, RELATION_TYPES[k]), policy(TTL.profile, force), parseRelations)));
        const ok = fulfilled(settled);
        if (ok.length === 0) throw firstError(settled);
        const data: Relations = { suppliers: [], customers: [], rivals: [], alliances: [], investOuts: [], investIns: [], failed: keys.length - ok.length };
        keys.forEach((k, i) => {
            const s = settled[i];
            if (s?.status === "fulfilled") data[k] = s.value.value;
        });
        return { data, meta: mergeMeta(ok, deps.now()) };
    }

    async function finmindSeries(stockId: string, force: boolean): Promise<DailyVolume[]> {
        const now = new Date(deps.now());
        const start = taipeiDate(new Date(now.getTime() - 60 * 86_400_000), "-");
        const end = taipeiDate(now, "-");
        const token = (await deps.getFinmindToken()).trim();
        const headers: Record<string, string> = { accept: "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const r = await cache.get(API.finmindVolume(stockId, start, end), policy(TTL.finmind, force, { headers }), parseFinmindVolumes);
        return r.value;
    }

    async function major(stockId: string, force: boolean): Promise<DatasetResult<DatasetMap["major"]>> {
        const settled = await Promise.allSettled(MAJOR_PERIODS.map((d) => cache.get(API.major(stockId, d), policy(TTL.chip, force), summarizeMajor)));
        const ok = fulfilled(settled);
        if (ok.length === 0) throw firstError(settled);

        const raws: Array<MajorRaw | null> = settled.map((s) => (s.status === "fulfilled" ? s.value.value : null));
        const periods: Array<MajorPeriod | null> = raws.map((raw, i) => (raw ? toMajorPeriod(raw, MAJOR_PERIODS[i] ?? 1) : null));

        // 玉山資料缺少區間成交量（V7）時，才以 FinMind 每日成交量作為備援
        const needFallback = raws.some((raw, i) => raw !== null && periods[i] === null);
        if (needFallback) {
            try {
                const series = await finmindSeries(stockId, force);
                raws.forEach((raw, i) => {
                    if (!raw || periods[i]) return;
                    const days = MAJOR_PERIODS[i] ?? 1;
                    periods[i] = toMajorPeriod(raw, days, volumeForPeriod(series, raw.date, days));
                });
            } catch {
                // 備援失敗：該區間維持無資料
            }
        }
        return { data: { periods }, meta: mergeMeta(ok, deps.now()) };
    }

    async function market(stockId: string, force: boolean): Promise<DatasetResult<DatasetMap["market"]>> {
        const date = taipeiDate(new Date(deps.now()));
        const ids = Object.keys(MARKET_LISTS) as MarketListId[];
        const settled = await Promise.allSettled(
            ids.map((id) => {
                const def = MARKET_LISTS[id];
                // 帶日期的清單以固定的快取鍵儲存：跨日後網路失敗仍可回退到最近一次成功的資料
                return cache.get(def.url(date), policy(def.ttl, force, { cacheKey: def.url("latest") }), (json) => indexMarketList(json, def.keyField));
            })
        );
        const ok = fulfilled(settled);
        if (ok.length === 0) throw firstError(settled);
        const indexes = {} as Record<MarketListId, MarketIndex | undefined>;
        ids.forEach((id, i) => {
            const s = settled[i];
            indexes[id] = s?.status === "fulfilled" ? s.value.value : undefined;
        });
        return { data: buildMarketSnapshot(stockId, indexes), meta: mergeMeta(ok, deps.now()) };
    }

    const handlers: { [K in DatasetName]: (stockId: string, force: boolean) => Promise<DatasetResult<DatasetMap[K]>> } = {
        basic: (s, f) => single(API.basic(s), TTL.profile, f, parseBasic),
        industry: (s, f) => single(API.industry(s), TTL.profile, f, parseNames),
        concept: (s, f) => single(API.concept(s), TTL.profile, f, parseNames),
        group: (s, f) => single(API.group(s), TTL.profile, f, parseNames),
        relations,
        ratings: (s, f) => single(API.ratings(s), TTL.ratings, f, parseRatings),
        // 不附帶使用者在 FindBillion 的 Cookie（隱私）；被 Cloudflare 擋下時由畫面提供前往原站的連結
        etf: (s, f) => single(API.etfHolding(s), TTL.etf, f, parseEtfHoldings),
        capacity: (s, f) => single(API.capacity(s), TTL.profile, f, parseCapacity),
        major,
        market,
    };

    return {
        get<K extends DatasetName>(name: K, stockId: string, force = false): Promise<DatasetResult<DatasetMap[K]>> {
            return handlers[name](stockId, force);
        },
    };
}

export type DatasetService = ReturnType<typeof createDatasetService>;
