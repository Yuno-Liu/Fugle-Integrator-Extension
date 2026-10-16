import assert from "node:assert/strict";
import test from "node:test";
import { clampPercentage, calculateTotals, formatHolders } from "../dist-test/core/calculator.js";

/**
 * 測試 clampPercentage 邊界值限制
 * - 負數應限制為 0
 * - 正常範圍值應保持不變
 * - 大於 100 應限制為 100
 */
test("clampPercentage should clamp value between 0 and 100", () => {
    assert.equal(clampPercentage(-5), 0);
    assert.equal(clampPercentage(42.5), 42.5);
    assert.equal(clampPercentage(120), 100);
});

/**
 * 測試 formatHolders 人數格式化
 * - 有效非負數應格式化為千分位加「人」
 * - 負數或 NaN 應回傳 "-- 人"
 */
test("formatHolders should format valid holder counts with thousand separators", () => {
    assert.equal(formatHolders(0), "0 人");
    assert.equal(formatHolders(12345), "12,345 人");
    assert.equal(formatHolders(-1), "-- 人");
    assert.equal(formatHolders(Number.NaN), "-- 人");
});

/**
 * 測試 calculateTotals 散戶與大戶持股比例及人數加總
 * - 散戶：級距 <= 9 (包含級距 1: 10%, 1000人 + 級距 9: 15.5%, 500人 = 25.5%, 1500人)
 * - 大戶：級距 >= 12 (包含級距 12: 30.25%, 20人 + 級距 15: 20%, 5人 = 50.25%, 25人)
 * - 總人數：1000 + 500 + 20 + 5 = 1525人
 */
test("calculateTotals should sum retail and whale percentages and holders by selected level", () => {
    const data = [
        { level: 1, holders: 1000, percent: 10 },
        { level: 9, holders: 500, percent: 15.5 },
        { level: 12, holders: 20, percent: 30.25 },
        { level: 15, holders: 5, percent: 20 },
    ];

    const result = calculateTotals(data, 9, 12);

    assert.equal(result.retailTotal, 25.5);
    assert.equal(result.whaleTotal, 50.25);
    assert.equal(result.retailHolders, 1500);
    assert.equal(result.whaleHolders, 25);
    assert.equal(result.totalHolders, 1525);
});
