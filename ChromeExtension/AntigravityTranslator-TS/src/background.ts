/**
 * ============================================================================
 * ⚙️ Antigravity Translator - 背景服務工作線程 (Background Service Worker)
 * ============================================================================
 *
 * 本模組為 Manifest V3 Background Service Worker：
 * 1. 初始化本機翻譯快取並維護右鍵上下文選單 (Context Menus)
 * 2. 實作非同步微批次併發佇列 (Concurrency Queue)，依據設定動態調配並發數
 * 3. 處理來自 Content Script 與 Popup 的 Runtime 訊息派發
 * 4. 動態更新瀏覽器 Action 圖示之狀態 Badge (翻譯中 "..." / 完成 "ON" / 還原清空)
 */

import { getConfig } from "./config/constants.js";
import {
    checkBridgeHealth,
    translateBatchViaCli,
    translateSingleTextViaCli
} from "./services/agyBridge.js";
import {
    clearTranslationCache,
    getCacheStats,
    initCache
} from "./services/cache.js";
import type {
    RuntimeMessage,
    TranslationItem
} from "./types/index.js";

/**
 * 非同步並發任務佇列管理器 (Concurrency Queue)
 */
class ConcurrencyQueue {
    private concurrency: number;
    private running = 0;
    private queue: Array<() => Promise<void>> = [];

    constructor(initialConcurrency = 3) {
        this.concurrency = Math.max(1, initialConcurrency);
    }

    /**
     * 更新並發上限
     */
    public setConcurrency(limit: number): void {
        this.concurrency = Math.max(1, limit);
        this.processNext();
    }

    /**
     * 加入任務至佇列並回傳 Promise 結果
     */
    public async enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });
            this.processNext();
        });
    }

    /**
     * 處理佇列中的下一筆任務
     */
    private processNext(): void {
        while (this.running < this.concurrency && this.queue.length > 0) {
            const nextTask = this.queue.shift();
            if (nextTask) {
                this.running++;
                nextTask().finally(() => {
                    this.running--;
                    this.processNext();
                });
            }
        }
    }
}

/**
 * 全域批次翻譯執行佇列
 */
const batchQueue = new ConcurrencyQueue(4);

/**
 * 建立擴充套件右鍵上下文選單
 */
function setupContextMenus(): void {
    if (typeof chrome === "undefined" || !chrome.contextMenus) {
        return;
    }

    chrome.contextMenus.removeAll(() => {
        // 1. 全頁翻譯選單
        chrome.contextMenus.create({
            id: "agy-translate-page",
            title: "使用 Antigravity CLI 翻譯此網頁 (gemini-3.8-flash low)",
            contexts: ["page", "action"]
        });

        // 2. 選取文字翻譯選單
        chrome.contextMenus.create({
            id: "agy-translate-selection",
            title: "使用 Antigravity CLI 翻譯選取文字",
            contexts: ["selection"]
        });
    });
}

/**
 * 更新指定分頁之擴充套件 Badge 標籤
 *
 * @param tabId - 目標分頁識別 ID
 * @param status - 當前翻譯狀態
 */
function updateTabBadge(
    tabId: number | undefined,
    status: "translating" | "completed" | "idle" | "error"
): void {
    if (typeof chrome === "undefined" || !chrome.action || tabId === undefined) {
        return;
    }

    switch (status) {
        case "translating":
            chrome.action.setBadgeText({ tabId, text: "..." });
            chrome.action.setBadgeBackgroundColor({ tabId, color: "#6366f1" });
            break;
        case "completed":
            chrome.action.setBadgeText({ tabId, text: "ON" });
            chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });
            break;
        case "error":
            chrome.action.setBadgeText({ tabId, text: "!" });
            chrome.action.setBadgeBackgroundColor({ tabId, color: "#ef4444" });
            break;
        case "idle":
        default:
            chrome.action.setBadgeText({ tabId, text: "" });
            break;
    }
}

// ============================================================================
// 擴充套件生命週期監聽
// ============================================================================

chrome.runtime.onInstalled.addListener(async () => {
    await initCache();
    setupContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
    await initCache();
    setupContextMenus();
});

// ============================================================================
// 右鍵選單點擊處理
// ============================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) {
        return;
    }

    if (info.menuItemId === "agy-translate-page") {
        chrome.tabs.sendMessage(tab.id, {
            action: "TOGGLE_PAGE_TRANSLATION"
        });
    } else if (info.menuItemId === "agy-translate-selection") {
        chrome.tabs.sendMessage(tab.id, {
            action: "TRANSLATE_SELECTION_FROM_MENU",
            payload: { text: info.selectionText || "" }
        });
    }
});

// ============================================================================
// Runtime 內部訊息通訊監聽
// ============================================================================

chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage<unknown>, sender, sendResponse) => {
        const tabId = sender.tab?.id;

        switch (message.action) {
            case "TRANSLATE_BATCH": {
                const items = message.payload as TranslationItem[];
                (async () => {
                    try {
                        const config = await getConfig();
                        batchQueue.setConcurrency(config.concurrency || 4);
                        updateTabBadge(tabId, "translating");

                        const result = await batchQueue.enqueue(() =>
                            translateBatchViaCli(items, config)
                        );

                        if (result.success) {
                            updateTabBadge(tabId, "completed");
                        } else {
                            updateTabBadge(tabId, "error");
                        }

                        sendResponse(result);
                    } catch (err: unknown) {
                        updateTabBadge(tabId, "error");
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        sendResponse({
                            success: false,
                            translations: {},
                            modelUsed: "gemini-3.8-flash",
                            effortUsed: "low",
                            durationMs: 0,
                            error: errorMsg
                        });
                    }
                })();
                return true; // 維持非同步通道開啟
            }

            case "TRANSLATE_SINGLE": {
                const payload = message.payload as { text: string } | string;
                const text = typeof payload === "string" ? payload : payload.text;

                (async () => {
                    try {
                        const config = await getConfig();
                        const result = await translateSingleTextViaCli(text, config);
                        sendResponse(result);
                    } catch (err: unknown) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        sendResponse({
                            success: false,
                            translation: "",
                            modelUsed: "gemini-3.8-flash",
                            effortUsed: "low",
                            durationMs: 0,
                            error: errorMsg
                        });
                    }
                })();
                return true;
            }

            case "CHECK_BRIDGE_HEALTH": {
                (async () => {
                    try {
                        const config = await getConfig();
                        const health = await checkBridgeHealth(config);
                        sendResponse(health);
                    } catch (err: unknown) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        sendResponse({
                            ok: false,
                            status: "error",
                            cliPath: "agy",
                            defaultModel: "gemini-3.8-flash",
                            defaultEffort: "low",
                            error: errorMsg
                        });
                    }
                })();
                return true;
            }

            case "CLEAR_CACHE": {
                (async () => {
                    try {
                        await clearTranslationCache();
                        sendResponse({ success: true });
                    } catch (err: unknown) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        sendResponse({ success: false, error: errorMsg });
                    }
                })();
                return true;
            }

            case "GET_CACHE_STATS": {
                (async () => {
                    try {
                        const config = await getConfig();
                        const stats = await getCacheStats(config.maxCacheEntries || 5000);
                        sendResponse(stats);
                    } catch (err: unknown) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        sendResponse({
                            count: 0,
                            maxEntries: 5000,
                            estimatedBytes: 0,
                            error: errorMsg
                        });
                    }
                })();
                return true;
            }

            case "RESTORE_PAGE": {
                updateTabBadge(tabId, "idle");
                sendResponse({ success: true });
                return false;
            }

            default:
                return false;
        }
    }
);
