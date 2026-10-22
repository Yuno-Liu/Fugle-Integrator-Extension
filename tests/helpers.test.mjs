import test from "node:test";
import assert from "node:assert/strict";

// Mock chrome API for Node test environment before importing helpers
globalThis.chrome = {
    runtime: {
        sendMessage: () => {},
        onMessage: { addListener: () => {} }
    },
    storage: {
        local: {
            get: () => Promise.resolve({}),
            set: () => Promise.resolve({})
        }
    }
};

import {
    cleanNum,
    formatCurrency,
    normalizeDateFormat,
    compareDates,
    findVal,
    findStockInList,
    calculateMajorRatio
} from "../dist-test/utils/helpers.js";

test("Helpers - cleanNum", async (t) => {
    await t.test("應正確去除千分位逗號並轉為浮點數", () => {
        assert.equal(cleanNum("1,234,567.89"), 1234567.89);
        assert.equal(cleanNum("500"), 500);
    });

    await t.test("null 或 undefined 應回傳 0", () => {
        assert.equal(cleanNum(null), 0);
        assert.equal(cleanNum(undefined), 0);
        assert.equal(cleanNum(""), 0);
    });
});

test("Helpers - formatCurrency", async (t) => {
    await t.test("小於 10000 億顯示為 億", () => {
        const res = formatCurrency(1234.56);
        assert.ok(res.includes("億"));
        assert.equal(res, "1,234.56 億");
    });

    await t.test("大於等於 10000 億自動換算為 兆", () => {
        const res = formatCurrency(25000);
        assert.ok(res.includes("兆"));
        assert.equal(res, "2.50 兆");
    });
});

test("Helpers - Date functions", async (t) => {
    await t.test("normalizeDateFormat 將斜線轉為連字號", () => {
        assert.equal(normalizeDateFormat("2026/10/23"), "2026-10-23");
        assert.equal(normalizeDateFormat(null), null);
    });

    await t.test("compareDates 正確比較日期字串順序", () => {
        assert.equal(compareDates("2026-10-20", "2026-10-23"), true);
        assert.equal(compareDates("2026-10-23", "2026-10-20"), false);
        assert.equal(compareDates("2026-10-20", "2026-10-20"), true);
    });
});

test("Helpers - findVal & findStockInList", async (t) => {
    const list = [
        { V1: "AS2330", V2: "1,050.00" },
        { V1: "AS2454", V2: "1,200.00" }
    ];

    await t.test("findVal 從清單搜尋特定個股指標數值", () => {
        assert.equal(findVal(list, "AS2330"), 1050);
        assert.equal(findVal(list, "AS9999"), null);
    });

    await t.test("findStockInList 從清單匹配 V2 個股代號項目", () => {
        const stockList = [
            { V1: "台積電", V2: "2330" },
            { V1: "聯發科", V2: "2454" }
        ];
        const item = findStockInList(stockList, "2330");
        assert.ok(item !== null);
        assert.equal(item.V1, "台積電");
    });
});

test("Helpers - calculateMajorRatio", async (t) => {
    await t.test("資料不足時安全返回 null", () => {
        assert.equal(calculateMajorRatio(null, []), null);
        assert.equal(calculateMajorRatio([], []), null);
    });

    await t.test("正常買賣超與成交量時計算買賣佔比", () => {
        const majorBuySell = [
            {
                ResultSet: {
                    Result: [
                        { V1: "2026-10-23", V4: "5000", V5: "0" }
                    ]
                }
            },
            {
                ResultSet: {
                    Result: [
                        { V1: "2026-10-23", V4: "0", V5: "3000" }
                    ]
                }
            }
        ];
        const volumeData = [
            { date: "2026-10-23", Trading_Volume: 20000 }
        ];

        const result = calculateMajorRatio(majorBuySell, volumeData, 1);
        assert.ok(result !== null);
        // (5000 - |-3000|) / 20000 * 100 = 2000 / 20000 * 100 = 10%
        assert.equal(result.majorRatio, 10);
        assert.equal(result.totalBuyStocks, 5000);
        assert.equal(result.totalSellStocks, -3000);
        assert.equal(result.totalVolume, 20000);
    });
});
