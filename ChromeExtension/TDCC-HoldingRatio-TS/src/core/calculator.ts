import type { StockLevelData, Totals } from "../types/index.js";

/**
 * 將數值限制在 0 到 100 的百分比範圍內
 * 常用於安全設定 CSS 進度條寬度，避免無效值或超出邊界
 * 
 * @param value - 待限制的數值
 * @returns 限制在 [0, 100] 區間內的數值；若傳入非有限數字（NaN/Infinity）則回傳 0
 */
export function clampPercentage(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(Math.max(value, 0), 100);
}

/**
 * 將人數格式化為帶有千分位逗號的顯示字串
 * 
 * @param value - 人數數值
 * @returns 格式化後的字串（例如: "12,345 人"），若非有效非負數則回傳 "-- 人"
 */
export function formatHolders(value: number): string {
    if (!Number.isFinite(value) || value < 0) {
        return "-- 人";
    }

    return `${Math.round(value).toLocaleString("en-US")} 人`;
}

/**
 * 依據指定的散戶門檻與大戶門檻，計算各自分類的持股比例與人數總和
 * 
 * - 散戶合計：所有 level <= retailLevel 的持股比例與人數總和
 * - 大戶合計：所有 level >= whaleLevel 的持股比例與人數總和
 * - 總股東人數：所有級距的人數總和
 * 
 * @param data - TDCC 級距資料陣列
 * @param retailLevel - 散戶判定上限級距 (含)
 * @param whaleLevel - 大戶判定下限級距 (含)
 * @returns 包含散戶與大戶合計比例、人數及總人數的計算結果
 */
export function calculateTotals(data: StockLevelData[], retailLevel: number, whaleLevel: number): Totals {
    let retailTotal = 0;
    let whaleTotal = 0;
    let retailHolders = 0;
    let whaleHolders = 0;
    let totalHolders = 0;

    data.forEach((item) => {
        const holders = Number.isFinite(item.holders) ? item.holders : 0;
        totalHolders += holders;

        // 判定為散戶：級距編號小於等於指定散戶門檻
        if (item.level <= retailLevel) {
            retailTotal += item.percent;
            retailHolders += holders;
        }

        // 判定為大戶：級距編號大於等於指定大戶門檻
        if (item.level >= whaleLevel) {
            whaleTotal += item.percent;
            whaleHolders += holders;
        }
    });

    return {
        retailTotal,
        whaleTotal,
        retailHolders,
        whaleHolders,
        totalHolders,
    };
}
