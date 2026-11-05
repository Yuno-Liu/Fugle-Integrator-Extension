/**
 * ============================================================================
 * 📡 content script / options ↔ background 訊息協定
 * ============================================================================
 *
 * content script 只能指定「要哪一份資料、哪一檔股票」，
 * 實際網址、快取策略與 Token 一律由 background 決定，
 * background 因此不會成為任意網址的代理，Token 也不會進入網頁環境。
 */

import type { BasicInfo, CapacityItem, CategoryType, EtfHolding, MajorSummary, MarketSnapshot, RatingItem, RelatedGroups, RelatedStock, Relations, SearchResults } from "./types";
import { STOCK_ID_PATTERN } from "./constants";

/** 各資料集的回傳型別 */
export interface DatasetMap {
    basic: BasicInfo | null;
    industry: string[];
    concept: string[];
    group: string[];
    relations: Relations;
    ratings: RatingItem[];
    etf: EtfHolding[];
    capacity: CapacityItem[];
    major: MajorSummary;
    market: MarketSnapshot;
}

export type DatasetName = keyof DatasetMap;

export const DATASET_NAMES: readonly DatasetName[] = ["basic", "industry", "concept", "group", "relations", "ratings", "etf", "capacity", "major", "market"];

export type Request =
    | { type: "dataset"; name: DatasetName; stockId: string; force?: boolean }
    | { type: "related"; stockId: string; extra: Partial<Record<CategoryType, string[]>>; limit: number }
    | { type: "category"; categoryType: CategoryType; name: string; exclude?: string }
    | { type: "search"; query: string }
    | { type: "clearCache" }
    | { type: "openOptions" }
    | { type: "ping" };

/** 資料附帶的快取資訊 */
export interface Meta {
    /** 資料取得時間（epoch ms） */
    fetchedAt: number;
    /** 是否因網路失敗而回傳過期快取 */
    stale: boolean;
}

export interface ResponseMap {
    dataset: { data: unknown; meta: Meta };
    related: RelatedGroups;
    category: RelatedStock[];
    search: SearchResults;
    clearCache: { cleared: true };
    openOptions: { opened: true };
    ping: { version: string };
}

/**
 * 回應格式。失敗時 code 為機器可判讀的錯誤類型：
 * http-<狀態碼>、timeout、payload、network、invalid、unknown
 */
export type Response<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

const CATEGORY_SET = new Set<string>(["概念", "產業", "集團"]);

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 500 && v.every((s) => typeof s === "string" && s.length <= 100);

/**
 * 驗證收到的訊息格式（background 端使用）。
 * 不合法時回傳 null。
 */
export function parseRequest(value: unknown): Request | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const stockOk = (s: unknown): s is string => typeof s === "string" && STOCK_ID_PATTERN.test(s);

    switch (v.type) {
        case "dataset":
            if (!stockOk(v.stockId) || typeof v.name !== "string" || !(DATASET_NAMES as readonly string[]).includes(v.name)) return null;
            return { type: "dataset", name: v.name as DatasetName, stockId: v.stockId, force: v.force === true };
        case "related": {
            if (!stockOk(v.stockId) || typeof v.limit !== "number" || !Number.isFinite(v.limit) || v.limit < 1 || v.limit > 500) return null;
            const extraIn = (typeof v.extra === "object" && v.extra !== null ? v.extra : {}) as Record<string, unknown>;
            const extra: Partial<Record<CategoryType, string[]>> = {};
            for (const [k, list] of Object.entries(extraIn)) {
                if (CATEGORY_SET.has(k) && isStringArray(list)) extra[k as CategoryType] = list;
            }
            return { type: "related", stockId: v.stockId, extra, limit: Math.floor(v.limit) };
        }
        case "category":
            if (typeof v.categoryType !== "string" || !CATEGORY_SET.has(v.categoryType) || typeof v.name !== "string" || v.name.length > 100) return null;
            return { type: "category", categoryType: v.categoryType as CategoryType, name: v.name, exclude: stockOk(v.exclude) ? v.exclude : undefined };
        case "search":
            if (typeof v.query !== "string" || v.query.length > 100) return null;
            return { type: "search", query: v.query };
        case "clearCache":
        case "openOptions":
        case "ping":
            return { type: v.type };
        default:
            return null;
    }
}
