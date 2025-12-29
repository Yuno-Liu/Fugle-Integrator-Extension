/**
 * 📚 股票資料庫模組 - TypeScript 版本
 */

import type { StockDatabase, CategoryType, RelatedStock } from "../types/index";

/** 本地 JSON 資料庫 */
let stockDatabase: StockDatabase | null = null;
let dbLoadPromise: Promise<StockDatabase | null> | null = null;

/**
 * 📚 加載本地 JSON 資料庫
 */
export function loadStockDatabase(): Promise<StockDatabase | null> {
    if (!dbLoadPromise) {
        dbLoadPromise = new Promise((resolve) => {
            const dbPath = chrome.runtime.getURL("stock-data.json");
            fetch(dbPath)
                .then((res) => res.json())
                .then((data: StockDatabase) => {
                    stockDatabase = data;
                    console.log("✅ Stock database loaded:", data.basicInfo.length, "stocks,", data.categories.length, "categories");
                    resolve(data);
                })
                .catch((e) => {
                    console.error("Failed to load stock database:", e);
                    resolve(null);
                });
        });
    }
    return dbLoadPromise;
}

/**
 * 取得股票資料庫
 */
export function getStockDatabase(): StockDatabase | null {
    return stockDatabase;
}

/**
 * 🔍 查詢該股票所屬的概念股/產業/集團
 */
export function getStockCategories(stockId: string, categoryType: CategoryType): string[] {
    if (!stockDatabase) return [];

    const categories = stockDatabase.categories || [];
    const matching = categories.filter((cat) => cat.股票代碼 === stockId && cat.分類類型 === categoryType);

    return matching.map((cat) => cat.分類名稱).filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * 🔍 查詢同分類的相關股票
 */
export function getRelatedStocks(categoryName: string, categoryType: CategoryType, limit: number | null = null): RelatedStock[] {
    if (!stockDatabase) return [];

    const categories = stockDatabase.categories || [];
    const basicInfo = stockDatabase.basicInfo || [];

    const stockIds = categories.filter((cat) => cat.分類類型 === categoryType && cat.分類名稱 === categoryName).map((cat) => cat.股票代碼);

    const unique = [...new Set(stockIds)];

    let stocks = unique
        .map((id) => {
            const info = basicInfo.find((b) => b.股票代碼 === id);
            return {
                code: id,
                name: info?.股票名稱 || "未知",
                capital: info?.["股本_億元"] || 0,
            };
        })
        .filter((v) => v.name !== "未知");

    stocks.sort((a, b) => b.capital - a.capital);

    if (limit) stocks = stocks.slice(0, limit);

    return stocks;
}
