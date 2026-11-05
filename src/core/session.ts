/**
 * ============================================================================
 * 🕐 台北時間與交易時段
 * ============================================================================
 *
 * 台股相關計算一律以 Asia/Taipei 時區為準，避免使用者人在海外或電腦時區
 * 設定不同時，產生錯誤的日期參數或預估量。
 */

import { VOLUME_MULTIPLIERS } from "../shared/constants";
import { pad2 } from "../utils/format";

export interface TaipeiParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    /** 0 = 週日 … 6 = 週六 */
    weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let formatter: Intl.DateTimeFormat | null = null;

function taipeiFormatter(): Intl.DateTimeFormat {
    formatter ??= new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Taipei",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
    });
    return formatter;
}

/** 取得指定時間在台北時區的各個欄位 */
export function taipeiParts(date: Date = new Date()): TaipeiParts {
    const parts: Record<string, string> = {};
    for (const p of taipeiFormatter().formatToParts(date)) parts[p.type] = p.value;
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        second: Number(parts.second),
        weekday: WEEKDAY_INDEX[parts.weekday ?? ""] ?? 0,
    };
}

/** 台北日期字串，例如 "2026/11/05"（sep 可改為 "-"） */
export function taipeiDate(date: Date = new Date(), sep = "/"): string {
    const p = taipeiParts(date);
    return `${p.year}${sep}${pad2(p.month)}${sep}${pad2(p.day)}`;
}

/** 平日 09:00 ~ 13:30（台北時間）為盤中 */
export function isTradingSession(p: TaipeiParts): boolean {
    if (p.weekday === 0 || p.weekday === 6) return false;
    const minutes = p.hour * 60 + p.minute;
    return minutes >= 9 * 60 && minutes < 13 * 60 + 30;
}

/**
 * 盤中預估量乘數（全日預估量 = 目前成交量 × 乘數）。
 * 非盤中時段回傳 1。
 */
export function volumeMultiplier(p: TaipeiParts): number {
    if (!isTradingSession(p)) return 1;
    for (const [hour, upper, value] of VOLUME_MULTIPLIERS) {
        if (hour === p.hour && p.minute < upper) return value;
    }
    return 1;
}

/** 將 "YYYY/MM/DD" 或 "YYYY-MM-DD" 正規化為 "YYYY-MM-DD"；格式不符回傳 null */
export function normalizeDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(value.trim());
    if (!m) return null;
    return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
}

/** 由 "YYYY/MM/DD" 字串建立 UTC 午夜時間戳（用於區間比較） */
export function dateToEpochDay(value: string | null | undefined): number | null {
    const normalized = normalizeDate(value);
    if (!normalized) return null;
    const [y, m, d] = normalized.split("-").map(Number) as [number, number, number];
    const ts = Date.UTC(y, m - 1, d);
    return Number.isNaN(ts) ? null : ts / 86_400_000;
}

/** 回傳台北日期往前 months 個月的 epoch day（月底自動夾到該月最後一天） */
export function epochDayMonthsAgo(p: TaipeiParts, months: number): number {
    const targetMonthIndex = p.year * 12 + (p.month - 1) - months;
    const y = Math.floor(targetMonthIndex / 12);
    const m = targetMonthIndex % 12;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(p.day, lastDay)) / 86_400_000;
}
