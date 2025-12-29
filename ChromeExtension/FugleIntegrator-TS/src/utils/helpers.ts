/**
 * 🔧 工具函式 - TypeScript 版本
 */

import type { FetchRequestMessage, FetchResponseMessage, ResultItem, RelationItem, EsunResultSet, ETFHoldingItem, TradingVolumeItem, MajorBuySellItem, MajorRatioResult } from "../types/index";
import { FETCH_TIMEOUT, VOLUME_API_TOKEN_KEY, DEFAULT_VOLUME_TOKEN } from "../config/constants";

/**
 * 🔧 防抖動函式
 */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(fn: T, delay: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/**
 * 🔧 節流函式
 */
export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(fn: T, delay: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timer) return;
        timer = setTimeout(() => {
            fn(...args);
            timer = null;
        }, delay);
    };
}

/**
 * 🔧 數值清理與格式化
 */
export function cleanNum(val: string | number | undefined | null): number {
    if (val === undefined || val === null) return 0;
    return parseFloat(String(val).replace(/,/g, "")) || 0;
}

/**
 * 🔧 格式化金額為「億」或「兆」
 */
export function formatCurrency(val100M: number): string {
    const fmt = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return val100M >= 10000 ? fmt.format(val100M / 10000) + " 兆" : fmt.format(val100M) + " 億";
}

/**
 * 🔧 從全市場清單中找出當前個股的數值
 */
export function findVal(list: ResultItem[], targetSymbol: string): number | null {
    const item = list.find((i) => i.V1 === targetSymbol);
    return item ? parseFloat(item.V2.replace(/,/g, "")) : null;
}

/**
 * 🔧 日期格式轉換輔助函式
 */
export function normalizeDateFormat(dateStr: string | undefined | null): string | null {
    if (!dateStr) return null;
    return String(dateStr).replace(/\//g, "-");
}

/**
 * 🔧 日期比較輔助函式
 */
export function compareDates(date1: string, date2: string): boolean {
    const normalized1 = normalizeDateFormat(date1);
    const normalized2 = normalizeDateFormat(date2);
    if (!normalized1 || !normalized2) return false;
    return normalized1 <= normalized2;
}

/**
 * 🔑 獲取成交量 API Token
 */
export function getVolumeApiToken(): string {
    return localStorage.getItem(VOLUME_API_TOKEN_KEY) || DEFAULT_VOLUME_TOKEN;
}

/**
 * 🔐 設置成交量 API Token
 */
export function setVolumeApiToken(token: string): void {
    localStorage.setItem(VOLUME_API_TOKEN_KEY, token);
}

// ==================== 網路請求函式 ====================

/**
 * 🌐 透過 Background Script 發送 fetch 請求
 */
export function fetchViaBackground(url: string): Promise<string | null> {
    return new Promise((resolve) => {
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
 * 🌐 取得 V2 欄位清單
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
 * 📊 取得完整結果集
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
 * 🤝 取得關係企業數據
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
 * 📦 取得 ETF 持股數據
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
 * 📊 取得成交量數據
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
 * 🌐 取得主力買賣超數據
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

/**
 * 📊 計算主力買賣占比
 */
export function calculateMajorRatio(majorBuySellData: EsunResultSet<MajorBuySellItem> | MajorBuySellItem[] | null, tradingVolumeData: TradingVolumeItem[], days: number = 1): MajorRatioResult | null {
    if (!majorBuySellData) {
        console.warn("⚠️ majorBuySellData is null or undefined");
        return null;
    }

    let buyResultList: MajorBuySellItem[] | null = null;
    let sellResultList: MajorBuySellItem[] | null = null;

    // 結構1: 陣列形式
    if (Array.isArray(majorBuySellData) && majorBuySellData.length >= 2) {
        const arr = majorBuySellData as unknown as EsunResultSet<MajorBuySellItem>[];
        buyResultList = arr[0]?.ResultSet?.Result ?? null;
        sellResultList = arr[1]?.ResultSet?.Result ?? null;
    }
    // 結構2: 單個 ResultSet 物件
    else if ("ResultSet" in majorBuySellData) {
        buyResultList = majorBuySellData.ResultSet.Result;
    }
    // 結構3: 直接是陣列
    else if (Array.isArray(majorBuySellData)) {
        buyResultList = majorBuySellData;
    }

    if (!buyResultList || buyResultList.length === 0) {
        console.warn("⚠️ buyResultList is empty or invalid");
        return null;
    }

    let totalBuyStocks = 0;
    let totalSellStocks = 0;

    // 計算買超
    buyResultList.forEach((item) => {
        const buy = parseFloat(item.V4) || 0;
        const sell = parseFloat(item.V5) || 0;
        totalBuyStocks += buy - sell;
    });

    // 計算賣超
    if (sellResultList) {
        sellResultList.forEach((item) => {
            const buy = parseFloat(item.V4) || 0;
            const sell = parseFloat(item.V5) || 0;
            totalSellStocks += buy - sell;
        });
    }

    // 獲取主力 API 的最新日期
    const majorLatestDate = buyResultList[0]?.V1 ?? null;

    // 計算成交量
    let totalVolume = 0;
    if (tradingVolumeData.length > 0) {
        let filteredVolumeData = tradingVolumeData;
        if (majorLatestDate) {
            filteredVolumeData = tradingVolumeData.filter((item) => {
                const volumeDate = item.TradeDate || item.Date || item.V1 || item.date || item.tradeDate;
                return volumeDate ? compareDates(volumeDate, majorLatestDate) : false;
            });
        }

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

    const majorRatio = parseFloat((((totalBuyStocks - Math.abs(totalSellStocks)) / totalVolume) * 100).toFixed(2));

    return {
        majorRatio,
        totalBuyStocks,
        totalSellStocks,
        totalVolume,
    };
}
