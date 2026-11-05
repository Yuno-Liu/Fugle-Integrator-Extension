/**
 * ============================================================================
 * 🧭 富果頁面轉接層
 * ============================================================================
 *
 * 所有對富果 DOM 結構的假設集中在這裡；富果改版時只需調整此檔與 FUGLE 選擇器。
 */

import { FUGLE, STOCK_ID_PATTERN } from "../shared/constants";
import { toNumber } from "../utils/format";

export interface StockContext {
    stockId: string;
    /** 富果顯示的股票名稱（可能暫時為空） */
    name: string;
    /** 市場別（上市 / 上櫃 / 興櫃…） */
    market: string;
}

const textOf = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** 讀取目前個股；不在個股頁或資料尚未渲染時回傳 null */
export function readStockContext(doc: Document = document): StockContext | null {
    const stockId = textOf(doc.querySelector(FUGLE.symbol)).toUpperCase();
    if (!STOCK_ID_PATTERN.test(stockId)) return null;
    return {
        stockId,
        name: textOf(doc.querySelector(FUGLE.name)),
        market: textOf(doc.querySelector(FUGLE.market)),
    };
}

/** 目前股價 */
export function readPrice(doc: Document = document): number | null {
    const value = toNumber(textOf(doc.querySelector(FUGLE.price)));
    return value !== null && value > 0 ? value : null;
}

/** 目前總成交量（張） */
export function readVolumeLots(doc: Document = document): number | null {
    const text = textOf(doc.querySelector(FUGLE.volume)).replace(/張/g, "");
    return toNumber(text);
}

/** 富果的更新時間顯示「收盤」時代表今日已收盤（含休市日） */
export function readMarketClosed(doc: Document = document): boolean {
    return /收盤|休市/.test(textOf(doc.querySelector(FUGLE.time)));
}

/** 頁首的股票搜尋框 */
export function findSearchInput(doc: Document = document): HTMLInputElement | HTMLTextAreaElement | null {
    const view = doc.defaultView;
    for (const selector of FUGLE.searchInputs) {
        const el = doc.querySelector(selector);
        if (view && (el instanceof view.HTMLInputElement || el instanceof view.HTMLTextAreaElement)) return el;
    }
    return null;
}

/**
 * 富果是否為深色模式。
 * 1. 明確標記：.body.dark-theme（舊版樣式）、.tw-dark-theme（Tailwind）、[data-theme=dark]
 * 2. 後備：以頁面背景亮度判斷
 */
export function isFugleDark(doc: Document = document): boolean {
    return hasDarkMarker(doc) || isDarkBackground(doc);
}

/** 是否有富果的深色模式標記（便宜：只是一個選擇器查詢） */
export function hasDarkMarker(doc: Document = document): boolean {
    return doc.querySelector(FUGLE.darkMarkers) !== null;
}

/** 以頁面背景亮度判斷是否為深色（需要 getComputedStyle，呼叫端應降低頻率） */
export function isDarkBackground(doc: Document = document): boolean {
    const view = doc.defaultView;
    if (!view || !doc.body) return false;
    for (const el of [doc.querySelector(".body"), doc.body, doc.documentElement]) {
        if (!el) continue;
        const rgb = parseRgb(view.getComputedStyle(el).backgroundColor);
        if (rgb && rgb[3] > 0.5) return luminance(rgb) < 0.4;
    }
    return false;
}

function parseRgb(value: string): [number, number, number, number] | null {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

function luminance([r, g, b]: [number, number, number, number]): number {
    const lin = (c: number): number => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
