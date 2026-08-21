import assert from "node:assert/strict";
import test from "node:test";
import { clampPercentage, calculateTotals } from "../dist-test/core/calculator.js";

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
 * 測試 calculateTotals 散戶與大戶持股比例加總
 * - 散戶：級距 <= 9 (包含級距 1: 10% + 級距 9: 15.5% = 25.5%)
 * - 大戶：級距 >= 12 (包含級距 12: 30.25% + 級距 15: 20% = 50.25%)
 */
test("calculateTotals should sum retail and whale by selected level", () => {
    const data = [
        { level: 1, percent: 10 },
        { level: 9, percent: 15.5 },
        { level: 12, percent: 30.25 },
        { level: 15, percent: 20 },
    ];

    const result = calculateTotals(data, 9, 12);

    assert.equal(result.retailTotal, 25.5);
    assert.equal(result.whaleTotal, 50.25);
});
