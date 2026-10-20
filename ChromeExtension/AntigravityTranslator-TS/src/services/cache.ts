/**
 * ============================================================================
 * 💾 Antigravity Translator - 本地與記憶體快取服務 (Cache Service)
 * ============================================================================
 *
 * 本模組負責管理雙層翻譯快取架構：
 * 1. 記憶體快取 (In-Memory Map)：提供毫秒級極速存取與 LRU (Least Recently Used) 淘汰機制。
 * 2. Chrome 本地儲存 (chrome.storage.local)：持久化快取資料，確保瀏覽器重啟後無需重複翻譯。
 * 3. 相容性設計：自動適配瀏覽器擴充環境與 Node.js 測試執行環境。
 */

import { STORAGE_KEYS } from "../config/constants.js";
import type { CacheStats } from "../types/index.js";

/**
 * 記憶體快取容器 (維持讀取與寫入順序以實現 LRU)
 */
const memoryCache = new Map<string, string>();

/**
 * 快取初始化狀態標記
 */
let isInitialized = false;

/**
 * 初始化翻譯快取
 *
 * 從 `chrome.storage.local` 讀取先前儲存的快取字典並注入至記憶體快取中。
 * 若處於非 Chrome 擴充環境 (如 Node.js 單元測試)，則靜默略過儲存讀取。
 *
 * @returns Promise<void>
 */
export async function initCache(): Promise<void> {
    if (isInitialized) {
        return;
    }

    try {
        if (
            typeof chrome !== "undefined" &&
            chrome.storage &&
            chrome.storage.local
        ) {
            const result = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
            const savedCache = result[STORAGE_KEYS.CACHE] as Record<string, string> | undefined;

            if (savedCache && typeof savedCache === "object") {
                memoryCache.clear();
                for (const [key, value] of Object.entries(savedCache)) {
                    if (typeof value === "string") {
                        memoryCache.set(key, value);
                    }
                }
            }
        }
    } catch (err) {
        console.warn("[Antigravity Cache] 初始化快取讀取失敗，使用空白記憶體快取:", err);
    } finally {
        isInitialized = true;
    }
}

/**
 * 查詢快取中特定 Key 的翻譯結果 (支援 LRU 熱度更新)
 *
 * 若快取命中，會自動將該鍵重新移至 Map 尾端（標記為最近使用）。
 *
 * @param key - 唯一的快取金鑰 (由 computeCacheKey 產生)
 * @returns 譯文字串，若未命中則回傳 undefined
 */
export function getCachedTranslation(key: string): string | undefined {
    if (!memoryCache.has(key)) {
        return undefined;
    }

    const value = memoryCache.get(key)!;
    // LRU 熱度更新：刪除後重新插入以移至 Map 迭代順序尾端
    memoryCache.delete(key);
    memoryCache.set(key, value);
    return value;
}

/**
 * 批次寫入快取翻譯結果並持久化至儲存層
 *
 * 當快取容量超過 `maxEntries` 時，自動依循 LRU 原則淘汰最久未存取的舊項目。
 *
 * @param entries - 鍵值對翻譯字典 (Record<cacheKey, translatedText>)
 * @param maxEntries - 快取允許保存的最大項目筆數 (預設至少為 100)
 * @returns Promise<void>
 */
export async function setCachedTranslations(
    entries: Record<string, string>,
    maxEntries: number
): Promise<void> {
    const keys = Object.keys(entries);
    if (keys.length === 0) {
        return;
    }

    // 1. 寫入記憶體快取並更新順序
    for (const key of keys) {
        const val = entries[key];
        if (typeof val === "string") {
            if (memoryCache.has(key)) {
                memoryCache.delete(key);
            }
            memoryCache.set(key, val);
        }
    }

    // 2. LRU 淘汰檢查：若超過上限，從開頭 (最舊) 依序剔除
    const effectiveLimit = Math.max(100, maxEntries);
    while (memoryCache.size > effectiveLimit) {
        const oldestKey = memoryCache.keys().next().value;
        if (oldestKey !== undefined) {
            memoryCache.delete(oldestKey);
        } else {
            break;
        }
    }

    // 3. 非同步持久化至 chrome.storage.local
    if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.local
    ) {
        try {
            const cacheSnapshot: Record<string, string> = {};
            for (const [k, v] of memoryCache.entries()) {
                cacheSnapshot[k] = v;
            }
            await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: cacheSnapshot });
        } catch (err) {
            console.warn("[Antigravity Cache] 持久化快取至 chrome.storage 失敗:", err);
        }
    }
}

/**
 * 清空所有記憶體快取與本地儲存快取
 *
 * @returns Promise<void>
 */
export async function clearTranslationCache(): Promise<void> {
    memoryCache.clear();

    if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.local
    ) {
        try {
            await chrome.storage.local.remove(STORAGE_KEYS.CACHE);
        } catch (err) {
            console.warn("[Antigravity Cache] 清除儲存快取失敗:", err);
        }
    }
}

/**
 * 取得當前快取容量與佔用狀態統計
 *
 * @param maxEntries - 當前設定之最大快取筆數
 * @returns Promise<CacheStats> - 快取統計資料物件
 */
export async function getCacheStats(maxEntries: number): Promise<CacheStats> {
    if (!isInitialized) {
        await initCache();
    }

    const count = memoryCache.size;
    let estimatedBytes = 0;

    // 預估記憶體字串大小 (UTF-16 每個字元約佔 2 bytes + 額外指標負擔)
    for (const [k, v] of memoryCache.entries()) {
        estimatedBytes += (k.length + v.length) * 2;
    }

    return {
        count,
        maxEntries: Math.max(100, maxEntries),
        estimatedBytes
    };
}
