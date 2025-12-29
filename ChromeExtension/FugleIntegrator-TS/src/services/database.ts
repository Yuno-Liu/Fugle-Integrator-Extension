/**
 * ============================================================================
 * 📚 股票資料庫模組 - TypeScript 版本
 * ============================================================================
 *
 * 本模組負責管理本地股票資料庫，提供以下功能：
 * - 載入並快取 JSON 格式的股票資料
 * - 查詢股票所屬的分類（概念、產業、集團）
 * - 查詢同分類的相關股票
 *
 * 📌 資料來源：
 * 本地 JSON 檔案 (stock-data.json)，包含：
 * - basicInfo: 股票基本資料（代碼、名稱、股本）
 * - categories: 股票分類資料（概念股、產業、集團）
 *
 * 📌 快取策略：
 * - 使用模組層級變數儲存載入後的資料
 * - 使用 Promise 確保只載入一次，後續呼叫共享同一 Promise
 *
 * 📌 使用場景：
 * - 補充 API 未提供的分類資訊
 * - 查詢同概念/產業/集團的相關股票
 * - 搜尋功能的資料來源
 */

import type { StockDatabase, CategoryType, RelatedStock } from "../types/index";

// ============================================================================
// 📦 模組層級狀態
// ============================================================================

/** 本地 JSON 資料庫的快取，載入後存於此變數 */
let stockDatabase: StockDatabase | null = null;

/**
 * 資料庫載入 Promise
 * 📌 確保多次呼叫 loadStockDatabase() 只觸發一次載入
 * 📌 後續呼叫會返回同一個 Promise，共享載入結果
 */
let dbLoadPromise: Promise<StockDatabase | null> | null = null;

// ============================================================================
// 📂 資料庫載入函式
// ============================================================================

/**
 * loadStockDatabase - 載入本地 JSON 資料庫
 *
 * 從擴充功能目錄載入 stock-data.json 檔案。
 * 使用 Promise 快取機制確保只載入一次。
 *
 * @returns Promise<StockDatabase | null> - 資料庫物件或 null（載入失敗時）
 *
 * 📌 載入流程：
 * 1. 檢查是否已有進行中的載入 Promise
 * 2. 若無，建立新的 Promise 並開始載入
 * 3. 使用 chrome.runtime.getURL() 取得檔案路徑
 * 4. Fetch 並解析 JSON
 * 5. 儲存至模組層級快取
 *
 * @example
 * ```typescript
 * await loadStockDatabase();
 * const categories = getStockCategories("2330", "概念");
 * ```
 */
export function loadStockDatabase(): Promise<StockDatabase | null> {
    // 如果已有載入中或已完成的 Promise，直接返回
    if (!dbLoadPromise) {
        dbLoadPromise = new Promise((resolve) => {
            // 使用 Chrome 擴充功能 API 取得本地檔案路徑
            const dbPath = chrome.runtime.getURL("stock-data.json");

            fetch(dbPath)
                .then((res) => res.json())
                .then((data: StockDatabase) => {
                    // 儲存至模組快取
                    stockDatabase = data;
                    console.log("✅ Stock database loaded:", data.basicInfo.length, "stocks,", data.categories.length, "categories");
                    resolve(data);
                })
                .catch((e) => {
                    // 載入失敗時記錄錯誤但不拋出，返回 null
                    console.error("Failed to load stock database:", e);
                    resolve(null);
                });
        });
    }
    return dbLoadPromise;
}

/**
 * getStockDatabase - 取得已載入的股票資料庫
 *
 * 同步取得快取的資料庫物件。
 * 注意：必須先呼叫 loadStockDatabase() 完成載入。
 *
 * @returns StockDatabase | null - 資料庫物件或 null（尚未載入時）
 */
export function getStockDatabase(): StockDatabase | null {
    return stockDatabase;
}

// ============================================================================
// 🔍 資料查詢函式
// ============================================================================

/**
 * getStockCategories - 查詢股票所屬的分類
 *
 * 從資料庫中查詢指定股票屬於哪些分類。
 *
 * @param stockId - 股票代碼（例如 "2330"）
 * @param categoryType - 分類類型："概念" | "產業" | "集團"
 * @returns string[] - 分類名稱陣列
 *
 * @example
 * ```typescript
 * const concepts = getStockCategories("2330", "概念");
 * // 返回: ["AI", "半導體", "蘋概股", ...]
 * ```
 */
export function getStockCategories(stockId: string, categoryType: CategoryType): string[] {
    // 資料庫尚未載入
    if (!stockDatabase) return [];

    const categories = stockDatabase.categories || [];

    // 篩選符合條件的分類記錄
    const matching = categories.filter((cat) => cat.股票代碼 === stockId && cat.分類類型 === categoryType);

    // 提取分類名稱並去除重複
    return matching.map((cat) => cat.分類名稱).filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * getRelatedStocks - 查詢同分類的相關股票
 *
 * 根據分類名稱和類型，查詢所有屬於該分類的股票。
 * 結果按股本降序排列（大型股優先）。
 *
 * @param categoryName - 分類名稱（例如 "AI"）
 * @param categoryType - 分類類型："概念" | "產業" | "集團"
 * @param limit - 可選，限制返回數量（null 表示不限制）
 * @returns RelatedStock[] - 相關股票陣列，包含代碼、名稱、股本
 *
 * 📌 排序邏輯：
 * 按股本（億元）降序排列，讓使用者優先看到市值較大的股票
 *
 * @example
 * ```typescript
 * const aiStocks = getRelatedStocks("AI", "概念", 10);
 * // 返回: [{ code: "2330", name: "台積電", capital: 2593.04 }, ...]
 * ```
 */
export function getRelatedStocks(categoryName: string, categoryType: CategoryType, limit: number | null = null): RelatedStock[] {
    // 資料庫尚未載入
    if (!stockDatabase) return [];

    const categories = stockDatabase.categories || [];
    const basicInfo = stockDatabase.basicInfo || [];

    // 從分類表中找出所有屬於該分類的股票代碼
    const stockIds = categories.filter((cat) => cat.分類類型 === categoryType && cat.分類名稱 === categoryName).map((cat) => cat.股票代碼);

    // 去除重複的股票代碼
    const unique = [...new Set(stockIds)];

    // 為每個股票代碼查詢基本資料
    let stocks = unique
        .map((id) => {
            const info = basicInfo.find((b) => b.股票代碼 === id);
            return {
                code: id,
                name: info?.股票名稱 || "未知",
                capital: info?.["股本_億元"] || 0,
            };
        })
        // 過濾掉找不到名稱的股票（可能是已下市或資料不完整）
        .filter((v) => v.name !== "未知");

    // 按股本降序排列
    stocks.sort((a, b) => b.capital - a.capital);

    // 如果指定了數量限制，截取前 N 筆
    if (limit) stocks = stocks.slice(0, limit);

    return stocks;
}
