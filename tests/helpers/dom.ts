/**
 * jsdom 測試環境：建立 DOM 並把常用的瀏覽器全域物件掛到 globalThis。
 * 使用完務必呼叫 cleanup()，避免影響其他測試。
 */
import { JSDOM } from "jsdom";
import { fixtureText } from "./fixtures";

const GLOBAL_KEYS = [
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "screen",
    "localStorage",
    "sessionStorage",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "Node",
    "Text",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLStyleElement",
    "DocumentFragment",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "FocusEvent",
    "PopStateEvent",
    "MutationObserver",
] as const;

export interface DomEnv {
    dom: JSDOM;
    window: Window & typeof globalThis;
    document: Document;
    cleanup(): void;
}

/** 建立 DOM 環境；html 省略時使用空白頁 */
export function setupDom(html = "<!doctype html><html><head></head><body></body></html>", url = "https://www.fugle.tw/ai/2330"): DomEnv {
    const dom = new JSDOM(html, { url, pretendToBeVisual: true });
    const win = dom.window as unknown as Window & typeof globalThis;
    const saved = new Map<string, PropertyDescriptor | undefined>();

    for (const key of GLOBAL_KEYS) {
        saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        const value = key === "window" ? win : (win as any)[key];
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    // jsdom 沒有實作的 API
    (win as any).scrollTo ??= () => undefined;
    (win.HTMLElement.prototype as any).scrollIntoView ??= function () {};
    (win.HTMLElement.prototype as any).scrollTo ??= function () {};
    win.open = (() => null) as any;

    return {
        dom,
        window: win,
        document: win.document,
        cleanup() {
            for (const [key, descriptor] of saved) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else delete (globalThis as any)[key];
            }
            dom.window.close();
        },
    };
}

/** 以擷取自富果的真實個股頁頁首建立 DOM（2330 台積電） */
export function setupFuglePage(url = "https://www.fugle.tw/ai/2330"): DomEnv {
    return setupDom(fixtureText("fugle-stock-page.html"), url);
}

/** 修改頁面上的股票代碼 / 名稱（模擬富果 SPA 切換股票） */
export function setStockOnPage(doc: Document, stockId: string, name: string, market = "上市"): void {
    const symbol = doc.querySelector(".card-group-header__info__symbol");
    const stockName = doc.querySelector(".stock-name");
    const marketEl = doc.querySelector(".card-group-header__info__market");
    if (symbol) symbol.textContent = `\n    ${stockId}\n  `;
    if (stockName) stockName.textContent = name;
    if (marketEl) marketEl.textContent = market;
}

/** 等待條件成立（輪詢） */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 5): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, intervalMs));
    }
}

/** 讓所有已排程的 microtask / 0ms timer 執行完 */
export function flush(ms = 0): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
