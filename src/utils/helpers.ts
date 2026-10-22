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

import type { FetchRequestMessage, FetchResponseMessage, ResultItem, RelationItem, EsunResultSet, ETFHoldingItem, TradingVolumeItem, MajorBuySellItem, MajorRatioResult } from "../types/index.js";
import { FETCH_TIMEOUT, VOLUME_API_TOKEN_KEY, DEFAULT_VOLUME_TOKEN } from "../config/constants.js";

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
    return Number.parseFloat(String(val).replaceAll(",", "")) || 0;
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
 * findStockInList - 從清單中找出當前個股的完整資料
 *
 * @param list - 資料清單
 * @param targetSymbol - 目標股票代碼（例如 "AS2330"）
 * @returns 找到的項目，或 null
 */
export function findStockInList(list: ResultItem[], targetSymbol: string): ResultItem | null {
    return list.find((i) => i.V2 === targetSymbol) || null;
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
    return item ? Number.parseFloat(item.V2.replaceAll(",", "")) : null;
}

// ============================================================================
// 📅 日期處理函式
// ============================================================================

/**
 * getFormattedDate - 取得格式化日期 (yyyy/MM/dd)
 *
 * @returns 格式化後的日期字串
 */
export function getFormattedDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
}

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
    return String(dateStr).replaceAll("/", "-");
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

            // 診斷 Token 狀態
            if (token) {
                console.log(`✅ 使用成交量 API Token: ${token.substring(0, 10)}...`);
            } else {
                console.error("🔴 成交量 API Token 未設置！");
                console.error("   解決方案: 點擊 🔑 Token 按鈕，在彈出窗口中輸入 finmindtrade API Token");
                console.error("   免費申請: https://finmindtrade.com/");
            }

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

                        if (data.data && Array.isArray(data.data)) {
                            console.log(`✅ 成交量 API 回應成功: ${data.data.length} 筆記錄`);
                            if (data.data.length > 0) {
                                const firstItem = data.data[0];
                                console.log(`   📅 最新日期: ${firstItem.date || firstItem.Date || firstItem.TradeDate || firstItem.tradeDate || firstItem.V1}`);
                                console.log(`   📊 成交量: ${firstItem.Trading_Volume}`);
                            }
                            resolve(data.data);
                        } else {
                            console.error("🔴 成交量 API 返回空數據或格式錯誤:", data);
                            console.error("   可能原因: Token 無效、API 伺服器問題或響應格式改變");
                            resolve([]);
                        }
                    } catch (e) {
                        console.error("🔴 JSON parse error:", e);
                        resolve([]);
                    }
                } else {
                    console.error("🔴 成交量 API 請求失敗:", response?.error || "Unknown error");
                    console.error("   詳細信息:", response);
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
 * 本函式會在 Console 輸出詳細的日期信息，幫助診斷數據可用性。
 *
 * @param url - 主力買賣超 API URL
 * @returns API 返回的陣列結構：[買超ResultSet, 賣超ResultSet]，或 null
 *
 * 📌 API 回應格式：
 * ```json
 * [
 *   {
 *     "ResultSet": {
 *       "Result": [
 *         { "V1": "日期", "V2": "券商代碼", "V3": "券商名稱", "V4": "買超", "V5": "賣超", "V6": "LotSize", "V7": "總股數" },
 *         ...
 *       ]
 *     }
 *   },
 *   {
 *     "ResultSet": {
 *       "Result": [...]
 *     }
 *   }
 * ]
 * ```
 *
 * 📌 診斷信息：
 * - 如果 API 返回數據，會顯示最新的 10 筆交易日期
 * - 幫助您判斷當前時間點是否有可用的主力數據
 */
export function fetchMajorBuySell(url: string): Promise<EsunResultSet<MajorBuySellItem>[] | null> {
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
                        const data = JSON.parse(response.data || "[]") as EsunResultSet<MajorBuySellItem>[];

                        // === 診斷信息：顯示最新的數據日期 ===
                        if (Array.isArray(data) && data.length > 0) {
                            // 取第一個 ResultSet（買超數據）進行診斷
                            const buyData = data[0]?.ResultSet?.Result;
                            if (buyData && buyData.length > 0) {
                                const latestResults = buyData.slice(0, 10);
                                const dates = latestResults.map((r) => r.V1).join(", ");
                                console.log(`✅ 主力買賣超 API 回應成功，最新 10 筆日期: ${dates}`);
                                console.log(`   💾 買超資料筆數: ${buyData.length}`);
                                console.log(`   📅 最新日期: ${buyData[0]?.V1}`);
                            } else {
                                console.warn("⚠️ 主力買賣超 API 返回空結果");
                            }
                        } else {
                            console.warn("⚠️ 主力買賣超 API 返回空陣列");
                        }

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
 * 📌 智能日期回退機制：
 * - 首先嘗試使用最新日期的數據
 * - 如果該日期沒有成交量數據，自動回退到前一筆有數據的日期
 * - 支援跨多日期計算（例如 5 日買賣占比）
 *
 * @param majorBuySellData - 主力買賣超數據，支援以下格式：
 *                          1. 陣列形式：[買超ResultSet, 賣超ResultSet]（API 原始格式）
 *                          2. 單個 ResultSet 物件
 *                          3. 直接的項目陣列
 * @param tradingVolumeData - 成交量數據
 * @param days - 計算天數，預設 1 天
 * @returns 計算結果，或 null（若資料不足）
 *
 * 📌 計算公式：
 * majorRatio = (總買超 - 總賣超) / 區間成交量 × 100
 *
 * 📌 支援的資料格式範例：
 * ```typescript
 * // 格式 1: API 原始陣列形式
 * const data = [
 *   { ResultSet: { Result: [買超列表] } },
 *   { ResultSet: { Result: [賣超列表] } }
 * ];
 *
 * // 格式 2: 單個 ResultSet
 * const data = { ResultSet: { Result: [買超列表] } };
 *
 * // 格式 3: 直接陣列
 * const data = [買超項目1, 買超項目2, ...];
 * ```
 */
export function calculateMajorRatio(majorBuySellData: EsunResultSet<MajorBuySellItem>[] | EsunResultSet<MajorBuySellItem> | MajorBuySellItem[] | null, tradingVolumeData: TradingVolumeItem[], days: number = 1): MajorRatioResult | null {
    if (!majorBuySellData) {
        console.warn("⚠️ majorBuySellData is null or undefined");
        return null;
    }
    let buyResultList: MajorBuySellItem[] | null = null;
    let sellResultList: MajorBuySellItem[] | null = null;

    // === 解析不同格式的主力買賣數據 ===

    // 結構1: 陣列形式 [買超ResultSet, 賣超ResultSet]（API 原始格式）
    if (Array.isArray(majorBuySellData) && majorBuySellData.length >= 2 && "ResultSet" in majorBuySellData[0]) {
        const arr = majorBuySellData as EsunResultSet<MajorBuySellItem>[];
        buyResultList = arr[0]?.ResultSet?.Result ?? null;
        sellResultList = arr[1]?.ResultSet?.Result ?? null;
        console.log(`📊 解析 API 原始陣列格式：買超 ${buyResultList?.length ?? 0} 筆、賣超 ${sellResultList?.length ?? 0} 筆`);
    }

    if (!buyResultList || buyResultList.length === 0) {
        console.warn("⚠️ buyResultList is empty or invalid");
        return null;
    }

    // ========================================
    // 🔍 智能日期檢查與回退機制
    // ========================================
    // 📌 如果現在時間點沒有主力數據，自動回退到前一筆有數據的日期

    let validMajorDate: string | null = null;
    let selectedBuyList: MajorBuySellItem[] = [];

    // 診斷：顯示成交量數據的詳細信息
    console.log(`📊 成交量數據總筆數: ${tradingVolumeData.length}`);
    if (tradingVolumeData.length > 0) {
        const sampleItem = tradingVolumeData[0];
        console.log(`📊 成交量數據樣本:`, {
            date: sampleItem.date,
            Date: sampleItem.Date,
            TradeDate: sampleItem.TradeDate,
            tradeDate: sampleItem.tradeDate,
            V1: sampleItem.V1,
            Trading_Volume: sampleItem.Trading_Volume,
        });
        console.log(
            `📊 最新的 5 個成交量日期:`,
            tradingVolumeData.slice(0, 5).map((item) => item.date || item.Date || item.TradeDate || item.tradeDate || item.V1)
        );
    } else {
        console.warn("⚠️ 成交量數據為空！可能原因：API Token 無效、API 請求失敗或無可用數據");
    }

    /**
     * 在給定的成交量數據中搜尋特定日期的成交量
     * 支援多種日期格式
     * @param date - 要搜尋的日期
     * @returns 該日期的成交量，如果不存在則返回 0
     */
    const findVolumeByDate = (date: string): number => {
        const normalized = normalizeDateFormat(date);
        console.log(`  🔎 搜尋日期: ${date} (正規化: ${normalized})`);

        // 逐一嘗試多種日期欄位格式
        // 將 tradingVolumeData 日期排序大至小，優先匹配最新日期
        const sortedVolumeData = [...tradingVolumeData].sort((a, b) => {
            const dateA = normalizeDateFormat(a.date || a.Date || a.TradeDate || a.tradeDate || a.V1) || "";
            const dateB = normalizeDateFormat(b.date || b.Date || b.TradeDate || b.tradeDate || b.V1) || "";
            return dateB.localeCompare(dateA);
        });
        for (const item of sortedVolumeData) {
            const dateFields = [item.date, item.Date, item.TradeDate, item.tradeDate, item.V1];
            for (const dateField of dateFields) {
                if (dateField) {
                    const normalizedField = normalizeDateFormat(dateField);
                    if (normalizedField === normalized) {
                        console.log(`    ✅ 找到匹配: ${dateField} → 成交量 ${item.Trading_Volume}`);
                        return item.Trading_Volume || 0;
                    }
                }
            }
        }
        console.log(`    ❌ 未找到匹配的日期`);
        return 0;
    };

    /**
     * 檢查是否為有效交易日（有成交量記錄）
     * @param date - 要檢查的日期
     * @returns true 如果該日期有成交量
     */
    const isValidTradingDay = (date: string): boolean => {
        return findVolumeByDate(date) > 0;
    };

    // 診斷：顯示成交量數據是否為空
    if (tradingVolumeData.length === 0) {
        console.error("🔴 致命錯誤: 成交量數據為空，無法進行日期匹配");
        console.error("   可能原因:");
        console.error("   1️⃣ Token 未設置或無效 - 點擊 🔑 Token 按鈕設置");
        console.error("   2️⃣ API 請求失敗 - 檢查網路連接");
        console.error("   3️⃣ 非交易時段 - 周末或假日無成交量");
        return null;
    }

    // 從最新日期開始，逐個回退檢查
    for (let i = 0; i < Math.min(buyResultList.length, 30); i++) {
        const date = buyResultList[i]?.V1 ?? null;
        if (!date) continue;

        console.log(`🔍 檢查主力數據日期: ${date}, 是否為有效交易日:`);
        const isValid = isValidTradingDay(date);
        console.log(`   結果: ${isValid ? "✅ 有效" : "❌ 無效"}`);

        // 檢查該日期是否有成交量數據
        if (isValid) {
            validMajorDate = date;
            selectedBuyList = buyResultList;
            console.log(`✅ 找到有效日期: ${validMajorDate}, 對應的買超列表長度: ${selectedBuyList.length}`);
            break;
        }
    }

    if (!validMajorDate) {
        console.error("🔴 未找到有效的主力交易日期，所有查詢的日期都沒有成交量數據");
        console.error("   檢查清單:");
        console.error(
            "   1️⃣ 主力 API 返回的日期:",
            buyResultList.slice(0, 5).map((r) => r.V1)
        );
        console.error("   2️⃣ 成交量數據的日期範圍:", {
            最新: tradingVolumeData[0]?.date || tradingVolumeData[0]?.Date || tradingVolumeData[0]?.TradeDate,
            最舊: tradingVolumeData[tradingVolumeData.length - 1]?.date || tradingVolumeData[tradingVolumeData.length - 1]?.Date,
        });
        console.error("   3️⃣ 日期格式是否匹配？主力: YYYY/MM/DD, 成交量: ?");
        return null;
    }

    // ========================================
    // 計算買賣超總量
    // ========================================

    let totalBuyStocks = 0;
    let totalSellStocks = 0;

    // === 計算買超總量 ===
    selectedBuyList.forEach((item) => {
        const buy = Number.parseFloat(item.V4) || 0; // 買進股數
        const sell = Number.parseFloat(item.V5) || 0; // 賣出股數
        totalBuyStocks += buy - sell; // 淨買超
    });

    // === 計算賣超總量（若有） ===
    if (sellResultList && sellResultList.length > 0) {
        const selectedSellList = sellResultList;
        selectedSellList.forEach((item) => {
            const buy = Number.parseFloat(item.V4) || 0;
            const sell = Number.parseFloat(item.V5) || 0;
            totalSellStocks += buy - sell;
        });
    }

    // ========================================
    // 計算區間成交量
    // ========================================
    let totalVolume = 0;
    if (tradingVolumeData.length > 0) {
        // 加總指定天數的成交量
        // 從最新的有效日期開始往回計數
        const maxDays = Math.min(days, tradingVolumeData.length);

        // 先找出最新有效日期在成交量清單中的位置
        const volumeStartIndex = tradingVolumeData.findIndex((item) => {
            const volumeDate = item.TradeDate || item.Date || item.V1 || item.date || item.tradeDate;
            return volumeDate && normalizeDateFormat(volumeDate) === normalizeDateFormat(validMajorDate);
        });

        if (volumeStartIndex >= 0) {
            // 從該位置往回計算指定天數的成交量
            for (let i = 0; i < maxDays && volumeStartIndex - i >= 0; i++) {
                const volume = tradingVolumeData[volumeStartIndex - i]?.Trading_Volume || 0;
                totalVolume += volume;
                console.log(`  📊 第 ${i + 1} 天成交量: ${volume}`);
            }
        }
    }

    if (totalVolume === 0) {
        console.warn("⚠️ totalVolume 為 0，無法計算買賣占比");
        return null;
    }

    // === 計算主力買賣占比 ===
    const majorRatio = Number.parseFloat((((totalBuyStocks - Math.abs(totalSellStocks)) / totalVolume) * 100).toFixed(2));

    console.log(`📈 主力買賣占比計算完成: ${majorRatio}% (買超: ${totalBuyStocks}, 賣超: ${totalSellStocks}, 成交量: ${totalVolume})`);

    return {
        date: validMajorDate,
        majorRatio,
        totalBuyStocks,
        totalSellStocks,
        totalVolume,
    };
}

