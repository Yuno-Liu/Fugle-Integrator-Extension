/**
 * ============================================================================
 * 📊 全市場清單索引與個股快照
 * ============================================================================
 *
 * 全市場清單（每股淨值、本益比、投信連買…）每份 2,000 筆以上、最大約 360KB。
 * background 解析後建立 Map 索引並快取，content script 只會收到單一個股的快照，
 * 避免每次切換股票都透過訊息傳送 1.6MB 資料。
 */

import type { MarketListId } from "../shared/constants";
import type { ContinuousItem, EsunRow, MarketSnapshot, MetricValue } from "../shared/types";
import { toNumber } from "../utils/format";
import { esunRows } from "./esun";

export type MarketIndex = Map<string, EsunRow>;

/** 依指定欄位（"V1" 或 "V2"）建立股票識別 → 資料列的索引 */
export function indexMarketList(json: unknown, keyField: "V1" | "V2"): MarketIndex {
    const index: MarketIndex = new Map();
    for (const row of esunRows(json)) {
        const key = row[keyField]?.trim();
        if (key && !index.has(key)) index.set(key, row);
    }
    return index;
}

/** 玉山全市場清單中的股票識別格式 */
export const marketSymbol = (stockId: string): string => `AS${stockId}`;

/**
 * 解析連續買賣超資料列。
 * V10 為目前連續天數（買正賣負），V11 為前一日連續天數；兩者異號即為轉向。
 */
export function parseContinuous(row: EsunRow | undefined): ContinuousItem | null {
    if (!row) return null;
    const current = toNumber(row.V10);
    if (current === null || current === 0) return null;
    const previous = toNumber(row.V11) ?? 0;
    const turned = previous !== 0 && Math.sign(previous) !== Math.sign(current);
    return {
        date: (row.V1 ?? "").trim(),
        direction: current > 0 ? "buy" : "sell",
        days: Math.abs(current),
        turned,
        previousDays: turned ? Math.abs(previous) : 0,
        lots: toNumber(row.V6) ?? 0,
        amountThousand: toNumber(row.V9) ?? 0,
    };
}

/**
 * 由各清單索引組出個股快照。
 * @param indexes 每個清單的索引；載入失敗者為 undefined
 */
export function buildMarketSnapshot(stockId: string, indexes: Record<MarketListId, MarketIndex | undefined>): MarketSnapshot {
    const symbol = marketSymbol(stockId);
    const row = (id: MarketListId): EsunRow | undefined => indexes[id]?.get(symbol);
    const metric = (id: MarketListId): MetricValue => {
        const r = row(id);
        return { value: toNumber(r?.V2), date: r?.V3?.trim() || null };
    };
    const unavailable = (Object.keys(indexes) as MarketListId[]).filter((id) => indexes[id] === undefined);

    // 同一法人只會在買或賣其中一份清單出現；兩份都有時以天數較新的方向（買）為準
    const trust = parseContinuous(row("trustBuy")) ?? parseContinuous(row("trustSell"));
    const foreign = parseContinuous(row("foreignBuy")) ?? parseContinuous(row("foreignSell"));

    return {
        nav: metric("nav"),
        pb: metric("pb"),
        eps: metric("eps"),
        pe: metric("pe"),
        dividendYield: metric("dividendYield"),
        grossMargin: metric("grossMargin"),
        roe: metric("roe"),
        roa: metric("roa"),
        trust,
        foreign,
        trustHoldPct: toNumber(row("trustHold")?.V8),
        foreignHoldPct: toNumber(row("foreignHold")?.V8),
        failed: unavailable.length,
        unavailable,
    };
}

/** "2026/06/01" → "2026Q2"；無法判斷時回傳原字串 */
export function quarterLabel(date: string | null): string | null {
    if (!date) return null;
    const m = /^(\d{4})[/-](\d{1,2})/.exec(date);
    if (!m) return date;
    const month = Number(m[2]);
    if (month < 1 || month > 12) return date;
    return `${m[1]}Q${Math.ceil(month / 3)}`;
}
