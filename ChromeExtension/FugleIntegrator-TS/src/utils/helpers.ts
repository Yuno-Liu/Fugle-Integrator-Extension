/**
 * ============================================================================
 * 🔧 工具函式模組 - TypeScript 版本
 * ============================================================================
 *
 * 本模組提供富果整合器所需的各種通用工具函式。
 *
 * 📌 功能分類：
 * 1. 效能優化函式 - debounce, throttle
 * 2. 數值處理函式 - cleanNum, formatCurrency, findVal
 * 3. 日期處理函式 - normalizeDateFormat, compareDates
 * 4. Token 管理函式 - getVolumeApiToken, setVolumeApiToken
 * 5. 網路請求函式 - fetchViaBackground, fetchV2, fetchResult 等
 * 6. 計算函式 - calculateMajorRatio
 *
 * 📌 設計原則：
 * - 純函式優先：無副作用，方便測試
 * - 類型安全：完整的 TypeScript 類型定義
 * - 錯誤處理：所有網路請求都有超時和例外處理
 *
 * 📌 依賴關係：
 * - types/index.ts: 類型定義
 * - config/constants.ts: 常量定義
 * - background.ts: 透過 Chrome Runtime 發送請求
 */

import type { FetchRequestMessage, FetchResponseMessage, ResultItem, RelationItem, EsunResultSet, ETFHoldingItem, TradingVolumeItem, MajorBuySellItem, MajorRatioResult } from "../types/index";
import { FETCH_TIMEOUT, VOLUME_API_TOKEN_KEY, DEFAULT_VOLUME_TOKEN } from "../config/constants";

// ============================================================================
// ⏱️ 效能優化函式
// ============================================================================

/**
 * debounce - 防抖動函式
 *
 * 延遲執行函式，直到停止觸發後的指定時間才執行。
 * 適用於輸入框搜尋、視窗調整等頻繁觸發的事件。
 *
 * @template T - 原函式類型
 * @param fn - 要防抖動的函式
 * @param delay - 延遲時間（毫秒）
 * @returns 防抖動後的函式
 *
 * 📌 使用範例：
 * ```typescript
 * const debouncedSearch = debounce(searchFunc, 300);
 * input.addEventListener('input', debouncedSearch);
 * ```
 */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(fn: T, delay: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer); // 清除前一個計時器
        timer = setTimeout(() => fn(...args), delay); // 設定新的計時器
    };
}

/**
 * throttle - 節流函式
 *
 * 限制函式在指定時間內只能執行一次。
 * 適用於滾動事件、按鈕連點等需要限制頻率的場景。
 *
 * @template T - 原函式類型
 * @param fn - 要節流的函式
 * @param delay - 節流間隔（毫秒）
 * @returns 節流後的函式
 *
 * 📌 與 debounce 的差異：
 * - debounce: 停止觸發後才執行
 * - throttle: 固定間隔執行一次
 */
export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(fn: T, delay: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timer) return; // 計時器存在時忽略
        timer = setTimeout(() => {
            fn(...args);
            timer = null; // 執行後清除計時器
        }, delay);
    };
}

// ============================================================================
// 🔢 數值處理函式
// ============================================================================

/**
 * cleanNum - 數值清理與格式化
 *
 * 將字串或數值轉換為純數字，移除千分位逗號。
 * 處理 null/undefined 等邊界情況。
 *
 * @param val - 要清理的值
 * @returns 清理後的數字，無效時返回 0
 *
 * 📌 處理範例：
 * - "1,234.56" => 1234.56
 * - null => 0
 * - undefined => 0
 */
export function cleanNum(val: string | number | undefined | null): number {
    if (val === undefined || val === null) return 0;
    return parseFloat(String(val).replace(/,/g, "")) || 0;
}

/**
 * formatCurrency - 格式化金額為「億」或「兆」
 *
 * 將以億為單位的數值轉換為易讀格式。
 *
 * @param val100M - 以億為單位的數值
 * @returns 格式化後的字串（例如 "1,234.56 億" 或 "1.23 兆"）
 *
 * 📌 轉換邏輯：
 * - >= 10000 億 => 顯示「兆」
 * - < 10000 億 => 顯示「億」
 */
export function formatCurrency(val100M: number): string {
    const fmt = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return val100M >= 10000 ? fmt.format(val100M / 10000) + " 兆" : fmt.format(val100M) + " 億";
}

/**
 * findVal - 從全市場清單中找出當前個股的數值
 *
 * 在市場範圍的指標清單中搜尋特定股票的數值。
 * 用於本益比、殖利率等全市場排名指標。
 *
 * @param list - 市場指標清單（V1=股票代碼, V2=數值）
 * @param targetSymbol - 目標股票代碼（例如 "AS2330"）
 * @returns 找到的數值，或 null
 *
 * 📌 V1 格式：
 * - 玉山 API 使用 "AS" 前綴 + 股票代碼
 * - 例如 "AS2330" 表示台積電
 */
export function findVal(list: ResultItem[], targetSymbol: string): number | null {
    const item = list.find((i) => i.V1 === targetSymbol);
    return item ? parseFloat(item.V2.replace(/,/g, "")) : null;
}

// ============================================================================
// 📅 日期處理函式
// ============================================================================

/**
 * normalizeDateFormat - 日期格式轉換
 *
 * 將日期字串中的斜線 (/) 轉換為連字號 (-)。
 * 統一日期格式以便比較。
 *
 * @param dateStr - 日期字串（例如 "2024/01/15"）
 * @returns 轉換後的日期字串（例如 "2024-01-15"），或 null
 */
export function normalizeDateFormat(dateStr: string | undefined | null): string | null {
    if (!dateStr) return null;
    return String(dateStr).replace(/\//g, "-");
}

/**
 * compareDates - 日期比較輔助函式
 *
 * 比較兩個日期字串，判斷 date1 是否小於等於 date2。
 * 用於篩選特定日期範圍的資料。
 *
 * @param date1 - 第一個日期字串
 * @param date2 - 第二個日期字串
 * @returns date1 <= date2 時返回 true
 */
export function compareDates(date1: string, date2: string): boolean {
    const normalized1 = normalizeDateFormat(date1);
    const normalized2 = normalizeDateFormat(date2);
    if (!normalized1 || !normalized2) return false;
    return normalized1 <= normalized2;
}

// ============================================================================
// 🔑 Token 管理函式
// ============================================================================

/**
 * getVolumeApiToken - 獲取成交量 API Token
 *
 * 從 localStorage 讀取用戶設定的 Token。
 * 若未設定則返回預設 Token。
 *
 * @returns finmindtrade API Token
 */
export function getVolumeApiToken(): string {
    return localStorage.getItem(VOLUME_API_TOKEN_KEY) || DEFAULT_VOLUME_TOKEN;
}

/**
 * setVolumeApiToken - 設置成交量 API Token
 *
 * 將用戶輸入的 Token 儲存到 localStorage。
 *
 * @param token - 要儲存的 Token
 */
export function setVolumeApiToken(token: string): void {
    localStorage.setItem(VOLUME_API_TOKEN_KEY, token);
}

// ============================================================================
// 🌐 網路請求函式
// ============================================================================

/**
 * fetchViaBackground - 透過 Background Script 發送 fetch 請求
 *
 * 因 CORS 限制，Content Script 無法直接請求外部 API。
 * 本函式將請求委託給 Background Script（Service Worker）處理。
 *
 * @param url - 目標 API URL
 * @returns API 回應的純文字，或 null（若失敗/超時）
 *
 * 📌 流程：
 * 1. 發送訊息給 Background Script
 * 2. Background 執行 fetch()
 * 3. 返回純文字回應
 *
 * 📌 超時處理：
 * - 預設 FETCH_TIMEOUT 毫秒後超時
 * - 超時時返回 null
 */
export function fetchViaBackground(url: string): Promise<string | null> {
    return new Promise((resolve) => {
        // 設定超時計時器
        const timeoutId = setTimeout(() => {
            console.warn("Fetch timeout for:", url);
            resolve(null);
        }, FETCH_TIMEOUT);

        try {
            const message: FetchRequestMessage = { action: "fetch", url };
            chrome.runtime.sendMessage(message, (response: FetchResponseMessage) => {
                clearTimeout(timeoutId);
                if (chrome.runtime.lastError) {
                    console.error("Runtime error:", chrome.runtime.lastError);
                    resolve(null);
                    return;
                }
                if (response?.success) {
                    resolve(response.data ?? null);
                } else {
                    console.error("Fetch failed for:", url, response?.error);
                    resolve(null);
                }
            });
        } catch (e) {
            clearTimeout(timeoutId);
            console.error("Fetch exception:", e);
            resolve(null);
        }
    });
}

/**
 * fetchV2 - 取得 V2 欄位清單
 *
 * 專門用於擷取玉山 API 回應中的 V2 欄位值列表。
 * 用於取得分類名稱、指標數值等。
 *
 * @param url - API URL
 * @returns V2 欄位值的陣列
 */
export async function fetchV2(url: string): Promise<string[]> {
    const text = await fetchViaBackground(url);
    if (!text) return [];
    try {
        const data = JSON.parse(text) as EsunResultSet<ResultItem>;
        return data.ResultSet.Result.map((i) => i.V2);
    } catch {
        return [];
    }
}

/**
 * fetchResult - 取得完整結果集
 *
 * 解析玉山 API 回應，返回 Result 陣列。
 * 支援泛型以指定返回類型。
 *
 * @template T - 結果項目類型，預設為 ResultItem
 * @param url - API URL
 * @returns 結果項目陣列
 */
export async function fetchResult<T = ResultItem>(url: string): Promise<T[]> {
    const text = await fetchViaBackground(url);
    if (!text) return [];
    try {
        const data = JSON.parse(text) as EsunResultSet<T>;
        return data.ResultSet?.Result || [];
    } catch (e) {
        console.error("🔴 fetchResult parse error:", e, "URL:", url);
        return [];
    }
}

/**
 * fetchStockRelation - 取得關係企業數據
 *
 * 從關係企業 API 擷取並去重。
 * 返回唯一的關係企業列表。
 *
 * @param url - 關係企業 API URL
 * @returns 關係企業陣列（去重後）
 *
 * 📌 去重邏輯：
 * - 以 V6（股票代碼）作為唯一鍵
 * - V7 為公司名稱
 */
export async function fetchStockRelation(url: string): Promise<RelationItem[]> {
    const text = await fetchViaBackground(url);
    if (!text) return [];
    try {
        const raw = (JSON.parse(text) as EsunResultSet<ResultItem>).ResultSet.Result;
        const unique: RelationItem[] = [];
        const seen = new Set<string>();
        raw.forEach((item) => {
            if (item.V6 && !seen.has(item.V6)) {
                seen.add(item.V6);
                unique.push({ id: item.V6, name: item.V7 || "" });
            }
        });
        return unique;
    } catch {
        return [];
    }
}

/**
 * fetchETFHolding - 取得 ETF 持股數據
 *
 * 從 findbillion API 取得持有該股票的 ETF 列表。
 *
 * @param url - ETF 持股 API URL
 * @returns ETF 持股項目陣列
 *
 * 📌 回應格式：
 * - 直接返回陣列（非 ResultSet 包裝）
 */
export async function fetchETFHolding(url: string): Promise<ETFHoldingItem[]> {
    const text = await fetchViaBackground(url);
    if (!text) return [];
    try {
        const data = JSON.parse(text);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

/**
 * fetchTradingVolume - 取得成交量數據
 *
 * 從 finmindtrade API 取得歷史成交量。
 * 需要使用 API Token 進行認證。
 *
 * @param url - 成交量 API URL
 * @returns 成交量項目陣列
 *
 * 📌 認證方式：
 * - Bearer Token（放在 Authorization header）
 *
 * 📌 回應格式：
 * - { data: TradingVolumeItem[] }
 */
export function fetchTradingVolume(url: string): Promise<TradingVolumeItem[]> {
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            console.warn("🔴 成交量 API 超時:", url);
            resolve([]);
        }, FETCH_TIMEOUT);

        try {
            console.log("📡 正在請求成交量 API:", url);
            const token = getVolumeApiToken();

            // 帶有認證標頭的請求
            const message: FetchRequestMessage = {
                action: "fetch",
                url,
                headers: {
                    Authorization: `Bearer ${token}`,
                    accept: "application/json",
                },
            };

            chrome.runtime.sendMessage(message, (response: FetchResponseMessage) => {
                clearTimeout(timeoutId);
                if (chrome.runtime.lastError) {
                    console.error("🔴 Runtime error:", chrome.runtime.lastError);
                    resolve([]);
                    return;
                }
                if (response?.success) {
                    try {
                        const data = JSON.parse(response.data || "{}") as {
                            data?: TradingVolumeItem[];
                        };
                        console.log("✅ 成交量 API 回應:", data);
                        if (data.data && Array.isArray(data.data)) {
                            console.log(`✅ 成交量數據: ${data.data.length} 筆記錄`);
                            resolve(data.data);
                        } else {
                            console.warn("⚠️ 成交量 API 無有效數據:", data);
                            resolve([]);
                        }
                    } catch (e) {
                        console.error("🔴 JSON parse error:", e);
                        resolve([]);
                    }
                } else {
                    console.error("🔴 成交量 API 請求失敗:", response?.error || "Unknown error");
                    resolve([]);
                }
            });
        } catch (e) {
            clearTimeout(timeoutId);
            console.error("🔴 Exception:", e);
            resolve([]);
        }
    });
}

/**
 * fetchMajorBuySell - 取得主力買賣超數據
 *
 * 從玉山 API 取得主力買賣超資訊。
 *
 * @param url - 主力買賣超 API URL
 * @returns 完整的 ResultSet 結構，或 null
 */
export function fetchMajorBuySell(url: string): Promise<EsunResultSet<MajorBuySellItem> | null> {
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            console.warn("🔴 主力買賣超 Timeout:", url);
            resolve(null);
        }, FETCH_TIMEOUT);

        try {
            const message: FetchRequestMessage = { action: "fetch", url };
            chrome.runtime.sendMessage(message, (response: FetchResponseMessage) => {
                clearTimeout(timeoutId);
                if (chrome.runtime.lastError) {
                    console.error("🔴 Runtime error:", chrome.runtime.lastError);
                    resolve(null);
                    return;
                }
                if (response?.success) {
                    try {
                        const data = JSON.parse(response.data || "{}") as EsunResultSet<MajorBuySellItem>;
                        console.log("✅ 主力買賣超 API 回應:", data);
                        resolve(data);
                    } catch (e) {
                        console.error("🔴 JSON parse error:", e);
                        resolve(null);
                    }
                } else {
                    console.error("🔴 Fetch failed for:", url, response?.error);
                    resolve(null);
                }
            });
        } catch (e) {
            clearTimeout(timeoutId);
            console.error("🔴 Exception:", e);
            resolve(null);
        }
    });
}

// ============================================================================
// 📊 計算函式
// ============================================================================

/**
 * calculateMajorRatio - 計算主力買賣占比
 *
 * 計算主力買賣超佔總成交量的比率。
 * 正值表示買超，負值表示賣超。
 *
 * @param majorBuySellData - 主力買賣超數據（支援多種格式）
 * @param tradingVolumeData - 成交量數據
 * @param days - 計算天數，預設 1 天
 * @returns 計算結果，或 null（若資料不足）
 *
 * 📌 計算公式：
 * majorRatio = (總買超 - 總賣超) / 區間成交量 × 100
 *
 * 📌 支援的資料格式：
 * 1. 陣列形式：[買超ResultSet, 賣超ResultSet]
 * 2. 單個 ResultSet 物件
 * 3. 直接的項目陣列
 */
export function calculateMajorRatio(majorBuySellData: EsunResultSet<MajorBuySellItem> | MajorBuySellItem[] | null, tradingVolumeData: TradingVolumeItem[], days: number = 1): MajorRatioResult | null {
    if (!majorBuySellData) {
        console.warn("⚠️ majorBuySellData is null or undefined");
        return null;
    }

    let buyResultList: MajorBuySellItem[] | null = null;
    let sellResultList: MajorBuySellItem[] | null = null;

    // === 解析不同格式的主力買賣數據 ===

    // 結構1: 陣列形式 [買超ResultSet, 賣超ResultSet]
    if (Array.isArray(majorBuySellData) && majorBuySellData.length >= 2) {
        const arr = majorBuySellData as unknown as EsunResultSet<MajorBuySellItem>[];
        buyResultList = arr[0]?.ResultSet?.Result ?? null;
        sellResultList = arr[1]?.ResultSet?.Result ?? null;
    }
    // 結構2: 單個 ResultSet 物件
    else if ("ResultSet" in majorBuySellData) {
        buyResultList = majorBuySellData.ResultSet.Result;
    }
    // 結構3: 直接是項目陣列
    else if (Array.isArray(majorBuySellData)) {
        buyResultList = majorBuySellData;
    }

    if (!buyResultList || buyResultList.length === 0) {
        console.warn("⚠️ buyResultList is empty or invalid");
        return null;
    }

    let totalBuyStocks = 0;
    let totalSellStocks = 0;

    // === 計算買超總量 ===
    buyResultList.forEach((item) => {
        const buy = parseFloat(item.V4) || 0; // 買進張數
        const sell = parseFloat(item.V5) || 0; // 賣出張數
        totalBuyStocks += buy - sell; // 淨買超
    });

    // === 計算賣超總量（若有） ===
    if (sellResultList) {
        sellResultList.forEach((item) => {
            const buy = parseFloat(item.V4) || 0;
            const sell = parseFloat(item.V5) || 0;
            totalSellStocks += buy - sell;
        });
    }

    // === 取得主力 API 的最新日期 ===
    const majorLatestDate = buyResultList[0]?.V1 ?? null;

    // === 計算區間成交量 ===
    let totalVolume = 0;
    if (tradingVolumeData.length > 0) {
        let filteredVolumeData = tradingVolumeData;

        // 若有主力日期，則篩選對應日期的成交量
        if (majorLatestDate) {
            filteredVolumeData = tradingVolumeData.filter((item) => {
                // 處理多種日期欄位格式
                const volumeDate = item.TradeDate || item.Date || item.V1 || item.date || item.tradeDate;
                return volumeDate ? compareDates(volumeDate, majorLatestDate) : false;
            });
        }

        // 加總指定天數的成交量
        const daysToSum = Math.min(days, filteredVolumeData.length);
        for (let i = 0; i < daysToSum; i++) {
            const volume = filteredVolumeData[filteredVolumeData.length - 1 - i]?.Trading_Volume || 0;
            totalVolume += volume;
        }
    }

    if (totalVolume === 0) {
        console.warn("⚠️ totalVolume is 0, cannot calculate ratio");
        return null;
    }

    // === 計算主力買賣占比 ===
    const majorRatio = parseFloat((((totalBuyStocks - Math.abs(totalSellStocks)) / totalVolume) * 100).toFixed(2));

    return {
        majorRatio,
        totalBuyStocks,
        totalSellStocks,
        totalVolume,
    };
}
