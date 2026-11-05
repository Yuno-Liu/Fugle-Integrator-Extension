/**
 * ============================================================================
 * 🧭 富果站內導覽（SPA）
 * ============================================================================
 *
 * 富果使用 Ember（history location）。以 pushState 更新網址再觸發 popstate，
 * 路由器就會載入新的個股頁，不需重新整理整個頁面。
 *
 * 📌 備援：合成的 popstate 偶爾會被路由器忽略，畫面停在原個股；
 *    富果隨後還會把網址改回原個股（實測約 0.2 秒後以 replaceState 寫回 ?p= 參數），
 *    所以以「畫面上顯示的代碼」判斷導覽是否生效，畫面一直沒切換時改用一般頁面載入：
 *    - 網址被改回原個股（路由器沒有處理）：NAV_FALLBACK_MS 後
 *    - 網址仍是目標（路由器可能還在載入，例如網路較慢）：NAV_FALLBACK_SLOW_MS 後
 *    使用者改看其他頁面或按上一頁 / 下一頁時取消，不會把使用者拉回目標個股。
 */

import { STOCK_ID_PATTERN, stockPath } from "../shared/constants";
import { log } from "../utils/log";
import { readStockContext } from "./page";

/** 路由器明顯沒有處理導覽（網址被改回原個股）時，改用一般頁面載入前的等待時間 */
export const NAV_FALLBACK_MS = 4000;
/** 網址仍是目標、畫面尚未切換（可能仍在載入）時的等待時間 */
export const NAV_FALLBACK_SLOW_MS = 8000;
/** 檢查畫面是否已切換的間隔 */
export const NAV_POLL_MS = 200;

export interface NavigateOptions {
    /** 讀取畫面上目前顯示的股票代碼（預設讀取 win 的文件） */
    readSymbol?: () => string | null;
    /** 一般頁面載入（預設 win.location.assign） */
    assign?: (url: string) => void;
}

/** 等待畫面切換中的導覽（同一時間只追蹤最後一次） */
let pending: { id: string; stop: () => void } | null = null;

/** 停止追蹤，取消尚未執行的備援頁面載入 */
export function cancelNavigationFallback(): void {
    pending?.stop();
    pending = null;
}

/** 前往指定個股頁 */
export function navigateToStock(code: string, win: Window = window, options: NavigateOptions = {}): boolean {
    const id = code.trim().toUpperCase();
    if (!STOCK_ID_PATTERN.test(id)) return false;
    const path = stockPath(id);
    const readSymbol = options.readSymbol ?? (() => readStockContext(win.document)?.stockId ?? null);
    const shown = readSymbol();
    const fromPath = win.location.pathname;

    if (fromPath === path) {
        // 已在該個股頁
        if (shown === id) return true;
        // 網址已是目標、畫面卻還沒切換（上一次導覽進行中或被忽略）：再通知路由器一次
    } else {
        win.history.pushState({}, "", path);
    }
    // 📌 與舊版相同：不帶 state 觸發 popstate（已驗證可驅動富果的 Ember 路由）
    win.dispatchEvent(new PopStateEvent("popstate"));

    // 同一檔已在等待中（例如畫面沒反應時重複點擊）：沿用原本的時限，不往後延
    if (pending?.id !== id) {
        const assign = options.assign ?? ((url: string) => win.location.assign(url));
        watch(id, path, shown, fromPath, win, readSymbol, assign);
    }
    return true;
}

/** 追蹤導覽結果；畫面一直沒切換時改用一般頁面載入 */
function watch(id: string, path: string, fromId: string | null, fromPath: string, win: Window, readSymbol: () => string | null, assign: (url: string) => void): void {
    cancelNavigationFallback();
    let elapsed = 0;
    // 路由器沒有處理導覽時，會把網址寫回「畫面上這檔」的路徑（可能與 fromPath 不同，例如連續快速點擊）
    const shownPath = fromId ? stockPath(fromId) : null;
    // 瀏覽器觸發的 popstate（使用者按上一頁 / 下一頁）才是 isTrusted；本模組自己觸發的不是
    const onTraversal = (event: PopStateEvent): void => {
        if (event.isTrusted) cancelNavigationFallback();
    };
    const timer = setInterval(() => {
        elapsed += NAV_POLL_MS;
        const shown = readSymbol();
        const pathname = win.location.pathname;
        const leftPage = pathname !== path && pathname !== fromPath && pathname !== shownPath;
        // 導覽已生效，或使用者已改看其他個股 / 前往其他頁面：不再介入
        if (shown === id || (shown !== null && shown !== fromId) || leftPage) {
            cancelNavigationFallback();
            return;
        }
        if (elapsed < (pathname === path ? NAV_FALLBACK_SLOW_MS : NAV_FALLBACK_MS)) return;
        cancelNavigationFallback();
        log.warn(`站內導覽沒有生效，改為一般頁面載入 ${path}`);
        assign(path);
    }, NAV_POLL_MS);
    win.addEventListener("popstate", onTraversal);
    pending = {
        id,
        stop: () => {
            clearInterval(timer);
            win.removeEventListener("popstate", onTraversal);
        },
    };
}

/**
 * 是否要攔截連結點擊改走 SPA 導覽。
 * Ctrl / ⌘ / Shift / 中鍵等「開新分頁」操作交給瀏覽器處理。
 */
export function shouldInterceptClick(event: MouseEvent): boolean {
    return !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}
