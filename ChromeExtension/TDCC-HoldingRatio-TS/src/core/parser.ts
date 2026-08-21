import { CONFIG } from "../config/constants.js";
import type { StockLevelData } from "../types/index.js";

/**
 * 將包含百分比符號與千分位逗號的字串解析為浮點數
 * 
 * @param rawText - 原始文字（例如: " 15.35 % " 或 "1,234.56%"）
 * @returns 解析後的百分比數值，若解析失敗則為 NaN
 */
function parsePercentage(rawText: string): number {
    const normalizedText = rawText.replace(/%/g, "").replace(/,/g, "").trim();
    return Number.parseFloat(normalizedText);
}

/**
 * 從 TDCC 網頁中的股權分散表格解析各級距資料
 * 
 * 表格欄位結構預期：
 * - 欄位 0 (td 1): 持股分級編號 (1 ~ 15)
 * - 欄位 1 (td 2): 持股分級說明 (如 1-999)
 * - 欄位 2 (td 3): 人數
 * - 欄位 3 (td 4): 股數
 * - 欄位 4 (td 5): 佔集保庫存的比例 (%)
 * 
 * @param doc - DOM Document 物件 (預設為全域 document，便於單元測試注入 Mock DOM)
 * @returns 解析出的各級距資料陣列，若找不到表格或無有效資料則回傳空陣列
 */
export function getStockData(doc: Document = document): StockLevelData[] {
    // 尋找 TDCC 表格元素
    const table = doc.querySelector<HTMLTableElement>(CONFIG.tableSelector);

    if (!table) {
        return [];
    }

    // 取得所有資料列 (tbody 內的 tr)
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    const data: StockLevelData[] = [];

    rows.forEach((row) => {
        const columns = row.querySelectorAll<HTMLTableCellElement>("td");

        // 確保欄位數量足夠（至少需有 5 欄包含分級與比例）
        if (columns.length < 5) {
            return;
        }

        // 解析分級 (第 1 欄) 與比例 (第 5 欄)
        const level = Number.parseInt(columns[0]?.textContent?.trim() ?? "", 10);
        const percent = parsePercentage(columns[4]?.textContent ?? "");

        // 驗證級距範圍是否落在 1 ~ 15 之間
        if (Number.isNaN(level) || level < CONFIG.minLevel || level > CONFIG.maxLevel) {
            return;
        }

        // 驗證百分比是否為有效數值
        if (Number.isNaN(percent)) {
            return;
        }

        data.push({ level, percent });
    });

    return data;
}
