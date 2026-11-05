/**
 * ============================================================================
 * 🏦 外部 API 回應解析（玉山證券 / FindBillion）
 * ============================================================================
 *
 * 所有解析函式皆為純函式：輸入 JSON（unknown），輸出正規化資料。
 * 結構不符時拋出錯誤（讓快取層不要儲存壞資料），
 * 結構正確但沒有資料時回傳空陣列 / null。
 */

import type { BasicInfo, CapacityItem, EsunRow, EtfHolding, RatingItem, RelationItem } from "../shared/types";
import { toNumber } from "../utils/format";
import { safeHttpUrl } from "../utils/html";

/** 資料格式錯誤（不應被快取） */
export class PayloadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PayloadError";
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 取出玉山標準回應的 Result 陣列；結構錯誤時拋出 PayloadError */
export function esunRows(json: unknown): EsunRow[] {
    if (!isRecord(json) || !isRecord(json.ResultSet)) throw new PayloadError("缺少 ResultSet");
    const result = json.ResultSet.Result;
    if (result === undefined || result === null) return [];
    if (!Array.isArray(result)) throw new PayloadError("Result 不是陣列");
    return result.filter(isRecord) as EsunRow[];
}

/** 取出「多個 ResultSet 組成的陣列」（主力買賣 API） */
export function esunRowSets(json: unknown): EsunRow[][] {
    if (!Array.isArray(json)) throw new PayloadError("預期為 ResultSet 陣列");
    return json.map((item) => (isRecord(item) && isRecord(item.ResultSet) ? esunRows(item) : []));
}

const text = (value: string | undefined): string => (value ?? "").trim();

/** 個股基本資料 */
export function parseBasic(json: unknown): BasicInfo | null {
    const row = esunRows(json)[0];
    if (!row) return null;
    return {
        fullName: text(row.V1),
        shortName: text(row.V17),
        capitalThousand: toNumber(row.V2),
        sharesThousand: toNumber(row.V3),
        parValue: toNumber(row.V4),
        marketCode: text(row.V18),
        revenueMix: text(row.V5),
        chairman: text(row.V6),
        president: text(row.V7),
        foundedDate: text(row.V15),
        listedDate: text(row.V16),
        website: safeHttpUrl(row.V12) ?? "",
    };
}

/** 產業 / 概念 / 集團名稱清單（V2），去除空白與重複 */
export function parseNames(json: unknown): string[] {
    const names = esunRows(json)
        .map((r) => text(r.V2))
        .filter(Boolean);
    return [...new Set(names)];
}

const TAIWAN_EXCHANGES = new Set(["TW", "TE", "TT"]);

/** 公司互動關係：以 V6（代號.交易所）去重 */
export function parseRelations(json: unknown): RelationItem[] {
    const seen = new Set<string>();
    const items: RelationItem[] = [];
    for (const row of esunRows(json)) {
        const rawId = text(row.V6);
        if (!rawId || seen.has(rawId)) continue;
        seen.add(rawId);
        const m = /^(.+?)\.([A-Z]{1,3})$/.exec(rawId);
        const code = m ? (m[1] ?? rawId) : rawId;
        const exchange = m ? (m[2] ?? "") : "";
        items.push({ code, name: text(row.V7) || code, exchange, isTaiwan: TAIWAN_EXCHANGES.has(exchange) });
    }
    return items;
}

/** 機構評等（依日期新到舊排序） */
export function parseRatings(json: unknown): RatingItem[] {
    return esunRows(json)
        .map((r) => ({
            date: text(r.V1),
            broker: text(r.V2),
            rating: text(r.V3),
            target: toNumber(r.V4),
            previous: text(r.V5),
        }))
        .filter((r) => r.date !== "")
        .sort((a, b) => b.date.localeCompare(a.date));
}

/** 產能資料 */
export function parseCapacity(json: unknown): CapacityItem[] {
    return esunRows(json)
        .map((r) => ({ location: text(r.V1), spec: text(r.V2), quantity: text(r.V3), unit: text(r.V4) }))
        .filter((r) => r.location || r.spec || r.quantity);
}

/** FindBillion ETF 持股（依持股股數由大到小） */
export function parseEtfHoldings(json: unknown): EtfHolding[] {
    if (!Array.isArray(json)) throw new PayloadError("ETF 持股回應不是陣列");
    const items: EtfHolding[] = [];
    for (const item of json) {
        if (!isRecord(item)) continue;
        const symbol = typeof item.symbol === "string" ? item.symbol.trim() : "";
        if (!symbol) continue;
        items.push({
            symbol,
            name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : symbol,
            ratio: toNumber(item.stock_holding_ratio) ?? 0,
            shares: toNumber(item.stock_holding_stocknum) ?? 0,
        });
    }
    return items.sort((a, b) => b.shares - a.shares);
}
