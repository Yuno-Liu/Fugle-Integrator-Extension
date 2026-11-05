/**
 * ============================================================================
 * 💼 主力買賣超計算
 * ============================================================================
 *
 * 玉山 stock-chip0002-4 回應為 [買超前 15 大分點, 賣超前 15 大分點]，
 * 每列欄位：V1 日期、V4 買進股數、V5 賣出股數、V7 區間成交總股數。
 *
 * 主力買賣超占比 = (買超分點淨買超 − |賣超分點淨賣超|) ÷ 區間成交量 × 100
 *
 * 📌 分母優先使用同一份資料的 V7（日期與區間必然一致，免 Token），
 *    只有 V7 缺漏時才以 FinMind 每日成交量加總作為備援。
 */

import type { MajorPeriod } from "../shared/types";
import { roundHalfAway, toNumber } from "../utils/format";
import { esunRowSets, PayloadError } from "./esun";
import { normalizeDate } from "./session";

/** 單一區間的原始彙總（尚未計算比率） */
export interface MajorRaw {
    date: string;
    netBuy: number;
    netSell: number;
    /** V7 區間成交量；缺漏時為 null */
    volume: number | null;
}

/** 彙總主力買賣 API 回應；沒有資料時回傳 null */
export function summarizeMajor(json: unknown): MajorRaw | null {
    const sets = esunRowSets(json);
    const buyRows = sets[0] ?? [];
    const sellRows = sets[1] ?? [];
    if (buyRows.length === 0 && sellRows.length === 0) return null;

    const net = (rows: typeof buyRows): number => rows.reduce((sum, r) => sum + ((toNumber(r.V4) ?? 0) - (toNumber(r.V5) ?? 0)), 0);
    const first = buyRows[0] ?? sellRows[0];
    const date = (first?.V1 ?? "").trim();
    if (!date) throw new PayloadError("主力資料缺少日期");

    const volumes = [...buyRows, ...sellRows].map((r) => toNumber(r.V7)).filter((v): v is number => v !== null && v > 0);
    return {
        date,
        netBuy: net(buyRows),
        netSell: net(sellRows),
        volume: volumes.length > 0 ? Math.max(...volumes) : null,
    };
}

/** FinMind 每日成交量（日期遞增排序） */
export interface DailyVolume {
    date: string; // YYYY-MM-DD
    volume: number;
}

/** 解析 FinMind TaiwanStockPrice 回應 */
export function parseFinmindVolumes(json: unknown): DailyVolume[] {
    if (typeof json !== "object" || json === null || !Array.isArray((json as { data?: unknown }).data)) {
        throw new PayloadError("FinMind 回應缺少 data 陣列");
    }
    const rows = (json as { data: unknown[] }).data;
    const out: DailyVolume[] = [];
    for (const row of rows) {
        if (typeof row !== "object" || row === null) continue;
        const r = row as Record<string, unknown>;
        const date = normalizeDate(typeof r.date === "string" ? r.date : null);
        const volume = toNumber(r.Trading_Volume);
        if (date && volume !== null && volume > 0) out.push({ date, volume });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 計算以 endDate 為最後一天、往前 days 個交易日的成交量總和。
 * endDate 不在序列中（例如 FinMind 尚未更新當日）或天數不足時回傳 null。
 */
export function volumeForPeriod(series: readonly DailyVolume[], endDate: string, days: number): number | null {
    const target = normalizeDate(endDate);
    if (!target || days <= 0) return null;
    const endIndex = series.findIndex((v) => v.date === target);
    if (endIndex < 0 || endIndex - days + 1 < 0) return null;
    let total = 0;
    for (let i = endIndex - days + 1; i <= endIndex; i++) total += series[i]?.volume ?? 0;
    return total > 0 ? total : null;
}

/** 由彙總資料計算比率；分母不可用時回傳 null */
export function toMajorPeriod(raw: MajorRaw, days: number, fallbackVolume: number | null = null): MajorPeriod | null {
    const useEsun = raw.volume !== null && raw.volume > 0;
    const volume = useEsun ? raw.volume : fallbackVolume;
    if (volume === null || volume <= 0) return null;
    // 0.005 一律遠離 0 捨入，正負對稱（例如 -21.735% → -21.74%）
    const ratio = roundHalfAway(((raw.netBuy - Math.abs(raw.netSell)) / volume) * 100 * 100) / 100;
    return {
        days,
        date: raw.date,
        netBuy: raw.netBuy,
        netSell: raw.netSell,
        volume,
        ratio: Object.is(ratio, -0) ? 0 : ratio,
        volumeSource: useEsun ? "esun" : "finmind",
    };
}
