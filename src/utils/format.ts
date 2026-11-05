/**
 * ============================================================================
 * 🔢 數值解析與格式化
 * ============================================================================
 *
 * 規則：
 * - 任何無法解析的值一律顯示為「—」，不會出現 undefined / NaN
 * - 數字使用千分位（en-US 格式，與台股網站慣例一致）
 */

export const EMPTY = "—";

/** 補零為兩位數 */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 時間 HH:MM:SS（本機時區） */
export function fmtClock(date: Date): string {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * 將 API 字串或數字轉為有限數值。
 * - "1,234.5" → 1234.5
 * - ""、"-"、"N/A"、null、NaN → null
 */
export function toNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const cleaned = value.replaceAll(",", "").replace(/[%\s]/g, "");
    if (cleaned === "" || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

const formatters = new Map<number, Intl.NumberFormat>();

function numberFormat(digits: number): Intl.NumberFormat {
    let fmt = formatters.get(digits);
    if (!fmt) {
        fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
        formatters.set(digits, fmt);
    }
    return fmt;
}

/** 四捨五入到整數，0.5 一律遠離 0（與 Intl.NumberFormat 的 halfExpand 一致，正負對稱） */
export function roundHalfAway(value: number): number {
    const rounded = Math.sign(value) * Math.round(Math.abs(value));
    return rounded === 0 ? 0 : rounded;
}

/** 千分位格式；null 顯示「—」 */
export function fmtNumber(value: number | null | undefined, digits = 0): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
    // 四捨五入後為 0 的負數（例如 -0.004）避免顯示成 "-0.00"；toFixed 與 Intl 同樣採 half away from zero
    const normalized = Number(value.toFixed(digits)) === 0 ? 0 : value;
    return numberFormat(digits).format(normalized);
}

/** 帶正負號的千分位格式（正數加 "+"） */
export function fmtSigned(value: number | null | undefined, digits = 0): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
    const text = fmtNumber(value, digits);
    return value > 0 && text !== fmtNumber(0, digits) ? `+${text}` : text;
}

/** 百分比；signed = true 時正數加 "+" */
export function fmtPercent(value: number | null | undefined, digits = 2, signed = false): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
    return `${signed ? fmtSigned(value, digits) : fmtNumber(value, digits)}%`;
}

/** 股數轉為張數（1 張 = 1000 股），四捨五入並加千分位 */
export function fmtLots(shares: number | null | undefined): string {
    if (shares === null || shares === undefined || !Number.isFinite(shares)) return EMPTY;
    return fmtNumber(roundHalfAway(shares / 1000));
}

/** ETF 持股張數顯示：≥ 1 萬張以「萬張」表示 */
export function fmtSharesAsLots(shares: number | null | undefined): string {
    if (shares === null || shares === undefined || !Number.isFinite(shares) || shares <= 0) return EMPTY;
    const lots = shares / 1000;
    if (lots >= 10_000) return `${fmtNumber(lots / 10_000, 2)} 萬張`;
    if (lots >= 1) return `${fmtNumber(Math.round(lots))} 張`;
    return "< 1 張";
}

/**
 * 以「億」為單位的金額轉為易讀字串：≥ 1 萬億顯示「兆」。
 * @example fmtHundredMillion(25000) → "2.50 兆"
 */
export function fmtHundredMillion(value100M: number | null | undefined): string {
    if (value100M === null || value100M === undefined || !Number.isFinite(value100M)) return EMPTY;
    // 以「四捨五入後」的數值判斷單位，避免 9999.999 億顯示成「10,000.00 億」
    return Math.round(Math.abs(value100M) * 100) / 100 >= 10_000 ? `${fmtNumber(value100M / 10_000, 2)} 兆` : `${fmtNumber(value100M, 2)} 億`;
}

/**
 * 千元金額轉為易讀字串（億 / 萬 / 元）。
 * @example fmtThousandTwd(8432521) → "84.33 億"
 */
export function fmtThousandTwd(thousand: number | null | undefined): string {
    if (thousand === null || thousand === undefined || !Number.isFinite(thousand)) return EMPTY;
    const twd = thousand * 1000;
    const abs = Math.abs(twd);
    // 以「四捨五入後」的數值判斷單位，避免出現「10,000.0 萬」
    if (Math.round(abs / 1e3) / 10 >= 10_000) return `${fmtNumber(twd / 1e8, 2)} 億`;
    if (Math.round(abs) >= 1e4) return `${fmtNumber(twd / 1e4, 1)} 萬`;
    return `${fmtNumber(twd)} 元`;
}

/** 依正負決定漲跌方向（台股慣例：紅漲綠跌） */
export function trendOf(value: number | null | undefined): "up" | "down" | "flat" {
    if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "flat";
    return value > 0 ? "up" : "down";
}
