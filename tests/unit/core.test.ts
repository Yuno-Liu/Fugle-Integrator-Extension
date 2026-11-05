/**
 * src/core 純函式測試：台北時間 / 交易時段、玉山與 FindBillion 回應解析、
 * 主力買賣超計算、全市場清單索引與個股快照。
 *
 * 使用 tests/fixtures 中 2026-11-05 擷取的真實 API 回應（已裁剪）。
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fixture, fixtureText } from "../helpers/fixtures";
import {
    dateToEpochDay,
    epochDayMonthsAgo,
    isTradingSession,
    normalizeDate,
    taipeiDate,
    taipeiParts,
    volumeMultiplier,
    type TaipeiParts,
} from "../../src/core/session";
import {
    esunRows,
    esunRowSets,
    parseBasic,
    parseCapacity,
    parseEtfHoldings,
    parseNames,
    parseRatings,
    parseRelations,
    PayloadError,
} from "../../src/core/esun";
import { parseFinmindVolumes, summarizeMajor, toMajorPeriod, volumeForPeriod, type DailyVolume, type MajorRaw } from "../../src/core/major";
import { buildMarketSnapshot, indexMarketList, marketSymbol, parseContinuous, quarterLabel, type MarketIndex } from "../../src/core/market";
import { MARKET_LISTS, type MarketListId } from "../../src/shared/constants";
import type { EsunRow } from "../../src/shared/types";

// ============================================================================
// 共用小工具
// ============================================================================

/** 以台北當地時間建立 Date（+08:00） */
const taipei = (local: string): Date => new Date(`${local}+08:00`);

/** 直接建構 TaipeiParts（weekday: 0=週日） */
function parts(weekday: number, hour: number, minute: number, ymd: [number, number, number] = [2026, 11, 5]): TaipeiParts {
    return { year: ymd[0], month: ymd[1], day: ymd[2], hour, minute, second: 0, weekday };
}

const resultSet = (rows: unknown[]): unknown => ({ ResultSet: { Result: rows } });

const isPayloadError = (err: unknown): boolean => err instanceof PayloadError && err.name === "PayloadError";

// ============================================================================
// 🕐 session.ts
// ============================================================================

describe("session: taipeiParts / taipeiDate", () => {
    const cases: Array<{ iso: string; date: string; hour: number; minute: number; weekday: number; note: string }> = [
        { iso: "2026-11-04T16:30:00Z", date: "2026/11/05", hour: 0, minute: 30, weekday: 4, note: "UTC 前一天 16:30 → 台北隔天 00:30（週四）" },
        { iso: "2026-11-04T15:59:59Z", date: "2026/11/04", hour: 23, minute: 59, weekday: 3, note: "台北午夜前一秒仍是 11/04（週三）" },
        { iso: "2026-11-04T16:00:00Z", date: "2026/11/05", hour: 0, minute: 0, weekday: 4, note: "台北午夜整點跨日，hour 為 0 而非 24" },
        { iso: "2026-11-05T01:00:00Z", date: "2026/11/05", hour: 9, minute: 0, weekday: 4, note: "UTC 01:00 = 台北開盤 09:00" },
        { iso: "2026-12-31T16:00:00Z", date: "2027/01/01", hour: 0, minute: 0, weekday: 5, note: "跨年" },
        { iso: "2026-11-07T15:59:00Z", date: "2026/11/07", hour: 23, minute: 59, weekday: 6, note: "週六深夜" },
    ];
    for (const c of cases) {
        test(c.note, () => {
            const d = new Date(c.iso);
            const p = taipeiParts(d);
            assert.equal(taipeiDate(d), c.date);
            assert.equal(p.hour, c.hour);
            assert.equal(p.minute, c.minute);
            assert.equal(p.weekday, c.weekday);
            const [y, m, day] = c.date.split("/").map(Number);
            assert.deepEqual([p.year, p.month, p.day], [y, m, day]);
        });
    }

    test("taipeiDate 可自訂分隔符號並補零", () => {
        assert.equal(taipeiDate(new Date("2026-01-02T03:04:05Z"), "-"), "2026-01-02");
        assert.equal(taipeiDate(new Date("2026-01-02T03:04:05Z")), "2026/01/02");
    });

    test("taipeiParts 秒數正確", () => {
        assert.equal(taipeiParts(new Date("2026-11-05T01:02:03Z")).second, 3);
    });
});

describe("session: isTradingSession", () => {
    const cases: Array<[string, TaipeiParts, boolean]> = [
        ["週四 08:59 盤前", parts(4, 8, 59), false],
        ["週四 09:00 開盤", parts(4, 9, 0), true],
        ["週四 12:00 盤中", parts(4, 12, 0), true],
        ["週四 13:29 收盤前", parts(4, 13, 29), true],
        ["週四 13:30 收盤（不含）", parts(4, 13, 30), false],
        ["週一 09:00", parts(1, 9, 0), true],
        ["週五 13:29", parts(5, 13, 29), true],
        ["週六 10:00", parts(6, 10, 0), false],
        ["週日 10:00", parts(0, 10, 0), false],
        ["深夜 00:30", parts(4, 0, 30), false],
    ];
    for (const [name, p, expected] of cases) {
        test(name, () => assert.equal(isTradingSession(p), expected));
    }

    test("由真實時間戳判斷：UTC 01:00 週四 = 台北 09:00 盤中；UTC 05:30 = 13:30 已收盤", () => {
        assert.equal(isTradingSession(taipeiParts(new Date("2026-11-05T01:00:00Z"))), true);
        assert.equal(isTradingSession(taipeiParts(new Date("2026-11-05T05:30:00Z"))), false);
        assert.equal(isTradingSession(taipeiParts(taipei("2026-11-07T10:00:00"))), false, "週六");
    });
});

describe("session: volumeMultiplier", () => {
    const cases: Array<[string, TaipeiParts, number]> = [
        ["09:00 → 8", parts(4, 9, 0), 8],
        ["09:14 → 8", parts(4, 9, 14), 8],
        ["09:15 → 7.5", parts(4, 9, 15), 7.5],
        ["09:59 → 3.5", parts(4, 9, 59), 3.5],
        ["10:00 → 3", parts(4, 10, 0), 3],
        ["11:00 → 1.8", parts(4, 11, 0), 1.8],
        ["12:59 → 1.2", parts(4, 12, 59), 1.2],
        ["13:00 → 1.18", parts(4, 13, 0), 1.18],
        ["13:29 → 1.1", parts(4, 13, 29), 1.1],
        ["13:30 收盤 → 1", parts(4, 13, 30), 1],
        ["08:59 盤前 → 1", parts(4, 8, 59), 1],
        ["週六 09:14 → 1", parts(6, 9, 14), 1],
        ["週日 10:00 → 1", parts(0, 10, 0), 1],
    ];
    for (const [name, p, expected] of cases) {
        test(name, () => assert.equal(volumeMultiplier(p), expected));
    }

    test("盤中每分鐘乘數皆 > 1 且隨時間不遞增", () => {
        let prev = Infinity;
        for (let m = 9 * 60; m < 13 * 60 + 30; m++) {
            const v = volumeMultiplier(parts(3, Math.floor(m / 60), m % 60));
            assert.ok(v > 1, `${Math.floor(m / 60)}:${m % 60} 乘數應 > 1，得到 ${v}`);
            assert.ok(v <= prev, `${Math.floor(m / 60)}:${m % 60} 乘數 ${v} 不應大於前一分鐘 ${prev}`);
            prev = v;
        }
    });
});

describe("session: normalizeDate / dateToEpochDay", () => {
    const cases: Array<[string | null | undefined, string | null]> = [
        ["2026/11/05", "2026-11-05"],
        ["2026-11-05", "2026-11-05"],
        ["2026/1/5", "2026-01-05"],
        ["  2026/11/05  ", "2026-11-05"],
        ["2026-11-05T00:00:00", "2026-11-05"],
        ["20261105", null],
        ["11/05/2026", null],
        ["", null],
        [null, null],
        [undefined, null],
    ];
    for (const [input, expected] of cases) {
        test(`normalizeDate(${JSON.stringify(input)}) → ${expected}`, () => assert.equal(normalizeDate(input), expected));
    }

    test("dateToEpochDay 以 UTC 午夜計算整數天數，兩種格式一致", () => {
        assert.equal(dateToEpochDay("1970/01/01"), 0);
        assert.equal(dateToEpochDay("1970-01-02"), 1);
        const a = dateToEpochDay("2026/11/05");
        assert.equal(a, Date.UTC(2026, 10, 5) / 86_400_000);
        assert.equal(dateToEpochDay("2026-11-05"), a);
        assert.equal(dateToEpochDay("2026/11/04"), (a ?? 0) - 1);
        assert.ok(Number.isInteger(a));
    });

    test("dateToEpochDay 格式不符回傳 null", () => {
        assert.equal(dateToEpochDay("not a date"), null);
        assert.equal(dateToEpochDay(null), null);
        assert.equal(dateToEpochDay(""), null);
    });
});

describe("session: epochDayMonthsAgo", () => {
    const cases: Array<[string, [number, number, number], number, string]> = [
        ["2026-08-31 往前 6 個月夾到 2/28", [2026, 8, 31], 6, "2026/02/28"],
        ["2024-08-31 往前 6 個月夾到閏年 2/29", [2024, 8, 31], 6, "2024/02/29"],
        ["2026-11-05 往前 1 個月", [2026, 11, 5], 1, "2026/10/05"],
        ["2026-03-31 往前 1 個月夾到 2/28", [2026, 3, 31], 1, "2026/02/28"],
        ["2026-05-31 往前 1 個月夾到 4/30", [2026, 5, 31], 1, "2026/04/30"],
        ["2026-01-15 往前 1 個月跨年", [2026, 1, 15], 1, "2025/12/15"],
        ["2026-02-10 往前 14 個月", [2026, 2, 10], 14, "2024/12/10"],
        ["往前 12 個月", [2026, 11, 5], 12, "2025/11/05"],
        ["往前 0 個月為當天", [2026, 11, 5], 0, "2026/11/05"],
    ];
    for (const [name, ymd, months, expected] of cases) {
        test(name, () => {
            assert.equal(epochDayMonthsAgo(parts(4, 10, 0, ymd), months), dateToEpochDay(expected));
        });
    }
});

// ============================================================================
// 🏦 esun.ts
// ============================================================================

describe("esun: esunRows / esunRowSets", () => {
    test("Cloudflare 挑戰頁（被當成字串）拋出 PayloadError", () => {
        const html = fixtureText("etf-cloudflare-challenge.html");
        assert.throws(() => esunRows(html), isPayloadError);
    });

    const invalid: Array<[string, unknown]> = [
        ["陣列", []],
        ["null", null],
        ["數字", 42],
        ["缺少 ResultSet", { foo: 1 }],
        ["ResultSet 為陣列", { ResultSet: [] }],
        ["ResultSet 為字串", { ResultSet: "x" }],
        ["Result 為物件", { ResultSet: { Result: { V1: "a" } } }],
        ["Result 為字串", { ResultSet: { Result: "<html>" } }],
    ];
    for (const [name, json] of invalid) {
        test(`結構錯誤（${name}）拋出 PayloadError`, () => assert.throws(() => esunRows(json), isPayloadError));
    }

    test("Result 為空陣列 / 缺漏 / null 時回傳 []", () => {
        assert.deepEqual(esunRows(fixture("relation-empty.json")), []);
        assert.deepEqual(esunRows({ ResultSet: {} }), []);
        assert.deepEqual(esunRows({ ResultSet: { Result: null } }), []);
    });

    test("非物件的資料列被略過", () => {
        assert.deepEqual(esunRows(resultSet([{ V1: "a" }, null, "x", [1], 3, { V1: "b" }])), [{ V1: "a" }, { V1: "b" }]);
    });

    test("esunRowSets：主力 API 的兩組 ResultSet", () => {
        const sets = esunRowSets(fixture("major1-2330.json"));
        assert.equal(sets.length, 2);
        assert.equal(sets[0]?.length, 15);
        assert.equal(sets[1]?.length, 15);
    });

    test("esunRowSets：非陣列拋錯，缺 ResultSet 的項目視為空", () => {
        assert.throws(() => esunRowSets({ ResultSet: { Result: [] } }), isPayloadError);
        assert.deepEqual(esunRowSets([null, { foo: 1 }, resultSet([{ V1: "x" }])]), [[], [], [{ V1: "x" }]]);
    });
});

describe("esun: parseBasic", () => {
    test("台積電（上市）欄位對應", () => {
        const info = parseBasic(fixture("basic-2330.json"));
        assert.ok(info);
        assert.equal(info.fullName, "台灣積體電路製造股份有限公司");
        assert.equal(info.shortName, "台積電");
        assert.equal(info.capitalThousand, 259_323_701);
        assert.equal(((info.capitalThousand ?? 0) / 100_000).toFixed(2), "2593.24", "股本 2,593.24 億");
        assert.equal(info.sharesThousand, 25_932_370);
        assert.equal(info.parValue, 10);
        assert.equal(info.marketCode, "TSE");
        assert.equal(info.chairman, "魏哲家");
        assert.equal(info.president, "魏哲家");
        assert.equal(info.foundedDate, "1987/02/21");
        assert.equal(info.listedDate, "1994/09/05");
        assert.equal(info.website, "https://www.tsmc.com/");
        assert.match(info.revenueMix, /^晶圓-5奈米30\.98%/);
    });

    test("有益（上櫃 OTC）欄位對應與 http 網址", () => {
        const info = parseBasic(fixture("basic-9962.json"));
        assert.ok(info);
        assert.equal(info.shortName, "有益");
        assert.equal(info.marketCode, "OTC");
        assert.equal(info.capitalThousand, 902_203);
        assert.equal(info.sharesThousand, 90_220);
        assert.equal(info.chairman, "劉憲同");
        assert.equal(info.president, "張睿芯");
        assert.equal(info.website, "http://www.yeouyih.com.tw/");
    });

    const websites: Array<[string | undefined, string]> = [
        ["javascript:alert(1)", ""],
        ["data:text/html,<script>alert(1)</script>", ""],
        ["ftp://example.com", ""],
        ["www.example.com.tw", "https://www.example.com.tw/"],
        ["  https://example.com/a?b=1  ", "https://example.com/a?b=1"],
        ["", ""],
        [undefined, ""],
    ];
    for (const [v12, expected] of websites) {
        test(`網站安全過濾：${JSON.stringify(v12)} → ${JSON.stringify(expected)}`, () => {
            const info = parseBasic(resultSet([{ V1: "X", V12: v12 }]));
            assert.equal(info?.website, expected);
        });
    }

    test("欄位缺漏時字串為空、數值為 null，並去除空白", () => {
        const info = parseBasic(resultSet([{ V1: "  某公司  ", V2: "", V3: "-" }]));
        assert.deepEqual(info, {
            fullName: "某公司",
            shortName: "",
            capitalThousand: null,
            sharesThousand: null,
            parValue: null,
            marketCode: "",
            revenueMix: "",
            chairman: "",
            president: "",
            foundedDate: "",
            listedDate: "",
            website: "",
        });
    });

    test("沒有資料時回傳 null；結構錯誤時拋錯", () => {
        assert.equal(parseBasic(fixture("relation-empty.json")), null);
        assert.throws(() => parseBasic("<html>"), isPayloadError);
    });
});

describe("esun: parseNames", () => {
    test("產業 / 集團（真實資料）", () => {
        assert.deepEqual(parseNames(fixture("industry-2330.json")), ["IC生產", "IC製造", "晶圓代工"]);
        assert.deepEqual(parseNames(fixture("group-2330.json")), ["台積電集團"]);
    });

    test("概念股 42 筆依原順序保留", () => {
        const names = parseNames(fixture("concept-2330.json"));
        assert.equal(names.length, 42);
        assert.equal(names[0], "AMD概念股");
        assert.ok(names.includes("CoWoS概念股"));
    });

    test("去除空白、空值與重複（保留首次出現順序）", () => {
        const json = resultSet([{ V2: " AI " }, { V2: "" }, { V1: "x" }, { V2: "AI" }, { V2: "IC" }, { V2: "   " }, { V2: "AI" }]);
        assert.deepEqual(parseNames(json), ["AI", "IC"]);
    });
});

describe("esun: parseRelations", () => {
    test("供應商：依 V6 去重、.TE 上櫃視為台股", () => {
        const raw = esunRows(fixture("relation-suppliers-2330.json"));
        assert.equal(raw.length, 12);
        const items = parseRelations(fixture("relation-suppliers-2330.json"));
        assert.equal(items.length, 11, "重複的 1560.TW 只保留一次");
        assert.deepEqual(items[0], { code: "1560", name: "中砂", exchange: "TW", isTaiwan: true });
        assert.equal(items.filter((i) => i.code === "1560").length, 1);
        const te = items.find((i) => i.code === "4537");
        assert.deepEqual(te, { code: "4537", name: "旭東", exchange: "TE", isTaiwan: true });
        assert.ok(items.every((i) => i.isTaiwan));
    });

    test("客戶：美股非台股，台股 .TW 為台股", () => {
        const items = parseRelations(fixture("relation-customers-2330.json"));
        assert.equal(items.length, 10);
        assert.deepEqual(items[0], { code: "AAPL", name: "Apple", exchange: "US", isTaiwan: false });
        assert.deepEqual(
            items.find((i) => i.code === "2454"),
            { code: "2454", name: "聯發科", exchange: "TW", isTaiwan: true }
        );
        assert.equal(items.filter((i) => i.isTaiwan).length, 4);
    });

    const ids: Array<[string, string, string, boolean]> = [
        ["2330.TW", "2330", "TW", true],
        ["6488.TE", "6488", "TE", true],
        ["8299.TT", "8299", "TT", true],
        ["600519.SH", "600519", "SH", false],
        ["0700.HK", "0700", "HK", false],
        ["7203.JP", "7203", "JP", false],
        ["NVDA.US", "NVDA", "US", false],
        ["BRK.B.US", "BRK.B", "US", false],
        ["SAMSUNG", "SAMSUNG", "", false],
        ["12345", "12345", "", false],
    ];
    for (const [rawId, code, exchange, isTaiwan] of ids) {
        test(`代號拆解 ${rawId} → ${code} / ${exchange || "(無)"} / ${isTaiwan ? "台股" : "非台股"}`, () => {
            const [item] = parseRelations(resultSet([{ V6: rawId, V7: "名稱" }]));
            assert.deepEqual(item, { code, name: "名稱", exchange, isTaiwan });
        });
    }

    test("名稱缺漏時以代號代替；V6 空白的列被略過；V6 前後空白也能去重", () => {
        const items = parseRelations(resultSet([{ V6: "", V7: "無代號" }, { V6: "AMD.US", V7: "" }, { V6: " AMD.US ", V7: "AMD" }, { V7: "缺欄位" }]));
        assert.deepEqual(items, [{ code: "AMD", name: "AMD", exchange: "US", isTaiwan: false }]);
    });

    test("空結果回傳 []", () => {
        assert.deepEqual(parseRelations(fixture("relation-empty.json")), []);
    });
});

describe("esun: parseRatings", () => {
    test("真實資料：8 筆、目標價解析、同日期保留原順序", () => {
        const items = parseRatings(fixture("ratings-2330.json"));
        assert.equal(items.length, 8);
        assert.deepEqual(items[0], { date: "2026/10/16", broker: "康和投顧", rating: "買進", target: 3560, previous: "買進" });
        assert.deepEqual(
            items.map((i) => i.target),
            [3560, 3500, 3358, 3320, 3300, 3300, 3260, 3250]
        );
        assert.equal(items[7]?.previous, "區間操作");
    });

    test("依日期新到舊排序、目標價無法解析為 null、無日期的列被略過", () => {
        const items = parseRatings(
            resultSet([
                { V1: "2026/09/01", V2: "A", V3: "買進", V4: "1,200.5", V5: "" },
                { V1: "2026/10/16", V2: "B", V3: "中立", V4: "N/A", V5: "買進" },
                { V1: "", V2: "C", V3: "賣出", V4: "1" },
                { V1: "2025/12/31", V2: "D", V3: "加碼", V4: "" },
            ])
        );
        assert.deepEqual(
            items.map((i) => [i.date, i.broker, i.target]),
            [
                ["2026/10/16", "B", null],
                ["2026/09/01", "A", 1200.5],
                ["2025/12/31", "D", null],
            ]
        );
    });
});

describe("esun: parseCapacity", () => {
    test("真實資料：13 座廠", () => {
        const items = parseCapacity(fixture("capacity-2330.json"));
        assert.equal(items.length, 13);
        assert.deepEqual(items[0], { location: "上海松江廠(Fab 10)", spec: "8吋廠", quantity: "120", unit: "千片/月" });
        assert.deepEqual(items.find((i) => i.location === "台灣台南(Fab 14)"), {
            location: "台灣台南(Fab 14)",
            spec: "12吋廠",
            quantity: "420",
            unit: "千片/月",
        });
    });

    test("位置、規格、數量皆空的列被略過（只有單位不算）", () => {
        const items = parseCapacity(resultSet([{ V1: "", V2: " ", V3: "", V4: "千片/月" }, { V1: "", V2: "", V3: "10", V4: "" }]));
        assert.deepEqual(items, [{ location: "", spec: "", quantity: "10", unit: "" }]);
    });
});

describe("esun: parseEtfHoldings", () => {
    test("過濾無代號列、名稱空白時以代號代替、依持股股數排序", () => {
        const items = parseEtfHoldings(fixture("etf-2330.synthetic.json"));
        assert.deepEqual(
            items.map((i) => i.symbol),
            ["0050", "006208", "00881", "00692", "00878"]
        );
        assert.deepEqual(items[0], { symbol: "0050", name: "元大台灣50", ratio: 61.23, shares: 1_312_345_678 });
        assert.equal(items.find((i) => i.symbol === "00692")?.name, "00692");
        assert.ok(!items.some((i) => i.name.includes("invalid")));
    });

    test("數值字串（含千分位）可解析，缺漏時為 0；非物件項目略過", () => {
        const items = parseEtfHoldings([
            { symbol: " 00940 ", name: " 元大臺灣價值高息 ", stock_holding_ratio: "3.5", stock_holding_stocknum: "1,000" },
            { symbol: "00939", name: 123 },
            null,
            "x",
            { symbol: 50, name: "數字代號" },
        ]);
        assert.deepEqual(items, [
            { symbol: "00940", name: "元大臺灣價值高息", ratio: 3.5, shares: 1000 },
            { symbol: "00939", name: "00939", ratio: 0, shares: 0 },
        ]);
    });

    const invalid: Array<[string, unknown]> = [
        ["Cloudflare HTML 字串", fixtureText("etf-cloudflare-challenge.html")],
        ["物件", { data: [] }],
        ["null", null],
    ];
    for (const [name, json] of invalid) {
        test(`非陣列（${name}）拋出 PayloadError`, () => assert.throws(() => parseEtfHoldings(json), isPayloadError));
    }

    test("空陣列回傳 []", () => assert.deepEqual(parseEtfHoldings([]), []));
});

// ============================================================================
// 💼 major.ts
// ============================================================================

describe("major: summarizeMajor", () => {
    test("真實資料（1 日）：淨買超、淨賣超、V7 成交量", () => {
        assert.deepEqual(summarizeMajor(fixture("major1-2330.json")), {
            date: "2026/11/04",
            netBuy: 12_728_481,
            netSell: -24_367_496,
            volume: 53_552_371,
        });
    });

    test("真實資料（5 日）：V7 為 5 日區間成交量", () => {
        const raw = summarizeMajor(fixture("major5-2330.json"));
        assert.ok(raw);
        assert.equal(raw.date, "2026/11/04");
        assert.equal(raw.volume, 190_561_922);
        assert.ok(raw.netBuy > 0);
        assert.ok(raw.netSell < 0);
    });

    const set = (rows: EsunRow[]): unknown => ({ ResultSet: { Result: rows } });

    test("V7 缺漏或為 0 時 volume 為 null", () => {
        const noV7 = summarizeMajor([set([{ V1: "2026/11/04", V4: "100", V5: "10" }]), set([{ V1: "2026/11/04", V4: "0", V5: "50" }])]);
        assert.deepEqual(noV7, { date: "2026/11/04", netBuy: 90, netSell: -50, volume: null });
        const zero = summarizeMajor([set([{ V1: "2026/11/04", V4: "100", V5: "10", V7: "0" }]), set([])]);
        assert.equal(zero?.volume, null);
        const dash = summarizeMajor([set([{ V1: "2026/11/04", V4: "100", V5: "10", V7: "-" }]), set([])]);
        assert.equal(dash?.volume, null);
    });

    test("部分列有 V7 時取最大值", () => {
        const raw = summarizeMajor([set([{ V1: "2026/11/04", V4: "1", V7: "" }, { V1: "2026/11/04", V4: "1", V7: "5,000" }]), set([{ V1: "2026/11/04", V5: "1", V7: "4000" }])]);
        assert.equal(raw?.volume, 5000);
    });

    test("只有賣超組時以賣超組日期為準", () => {
        const raw = summarizeMajor([set([]), set([{ V1: "2026/11/03", V4: "0", V5: "300", V7: "1000" }])]);
        assert.deepEqual(raw, { date: "2026/11/03", netBuy: 0, netSell: -300, volume: 1000 });
    });

    test("兩組皆空回傳 null", () => {
        assert.equal(summarizeMajor([set([]), set([])]), null);
        assert.equal(summarizeMajor([]), null);
    });

    test("缺少日期拋出 PayloadError", () => {
        assert.throws(() => summarizeMajor([set([{ V4: "100", V5: "1", V7: "1000" }]), set([])]), isPayloadError);
        assert.throws(() => summarizeMajor([set([{ V1: "  ", V4: "100" }]), set([])]), isPayloadError);
    });

    test("非陣列回應（例如單一 ResultSet 或 HTML）拋出 PayloadError", () => {
        assert.throws(() => summarizeMajor(fixture("basic-2330.json")), isPayloadError);
        assert.throws(() => summarizeMajor("<html>"), isPayloadError);
    });
});

describe("major: parseFinmindVolumes / volumeForPeriod", () => {
    const series = parseFinmindVolumes(fixture("finmind-2330.json"));

    test("真實資料：7 個交易日、日期遞增", () => {
        assert.equal(series.length, 7);
        assert.deepEqual(series[0], { date: "2026-10-27", volume: 38_173_147 });
        assert.deepEqual(series[6], { date: "2026-11-04", volume: 53_879_371 });
    });

    test("亂序輸入會排序，日期正規化，成交量 0 / 無效 / 非物件列被略過", () => {
        const out = parseFinmindVolumes({
            data: [
                { date: "2026/11/04", Trading_Volume: "1,000" },
                { date: "2026-11-03", Trading_Volume: 500 },
                { date: "2026-11-02", Trading_Volume: 0 },
                { date: "bad", Trading_Volume: 1 },
                { date: 20261101, Trading_Volume: 1 },
                { date: "2026-10-31", Trading_Volume: "N/A" },
                null,
                { date: "2026-10-30", Trading_Volume: 200 },
            ],
        });
        assert.deepEqual(out, [
            { date: "2026-10-30", volume: 200 },
            { date: "2026-11-03", volume: 500 },
            { date: "2026-11-04", volume: 1000 },
        ]);
    });

    const invalid: Array<[string, unknown]> = [
        ["缺 data", { msg: "error", status: 402 }],
        ["data 非陣列", { data: {} }],
        ["null", null],
        ["字串", "<html>"],
    ];
    for (const [name, json] of invalid) {
        test(`FinMind 回應錯誤（${name}）拋出 PayloadError`, () => assert.throws(() => parseFinmindVolumes(json), isPayloadError));
    }

    const periods: Array<[string, string, number, number | null]> = [
        ["1 日（玉山日期格式）", "2026/11/04", 1, 53_879_371],
        ["5 日", "2026/11/04", 5, 196_201_622],
        ["7 日（剛好足夠）", "2026-11-04", 7, 256_241_604],
        ["8 日（天數不足）", "2026/11/04", 8, null],
        ["以中間日期為終點 2 日", "2026/10/30", 2, 55_019_847],
        ["終點日不在序列（FinMind 尚未更新）", "2026/11/05", 1, null],
        ["終點日格式錯誤", "bad", 1, null],
        ["天數 0", "2026/11/04", 0, null],
        ["天數負數", "2026/11/04", -1, null],
    ];
    for (const [name, end, days, expected] of periods) {
        test(`volumeForPeriod：${name}`, () => assert.equal(volumeForPeriod(series, end, days), expected));
    }

    test("volumeForPeriod：空序列回傳 null", () => {
        const empty: DailyVolume[] = [];
        assert.equal(volumeForPeriod(empty, "2026/11/04", 1), null);
    });
});

describe("major: toMajorPeriod", () => {
    test("真實資料 1 日：比率 -21.73%，來源為玉山", () => {
        const raw = summarizeMajor(fixture("major1-2330.json"));
        assert.ok(raw);
        assert.deepEqual(toMajorPeriod(raw, 1), {
            days: 1,
            date: "2026/11/04",
            netBuy: 12_728_481,
            netSell: -24_367_496,
            volume: 53_552_371,
            ratio: -21.73,
            volumeSource: "esun",
        });
    });

    test("真實資料 5 日：比率 -17.84%；有 V7 時忽略 FinMind 備援", () => {
        const raw = summarizeMajor(fixture("major5-2330.json"));
        assert.ok(raw);
        const p = toMajorPeriod(raw, 5, 999_999_999);
        assert.equal(p?.ratio, -17.84);
        assert.equal(p?.volume, 190_561_922);
        assert.equal(p?.volumeSource, "esun");
    });

    test("V7 缺漏時改用 FinMind 成交量", () => {
        const raw: MajorRaw = { date: "2026/11/04", netBuy: 12_728_481, netSell: -24_367_496, volume: null };
        const series = parseFinmindVolumes(fixture("finmind-2330.json"));
        const p = toMajorPeriod(raw, 1, volumeForPeriod(series, raw.date, 1));
        assert.equal(p?.volumeSource, "finmind");
        assert.equal(p?.volume, 53_879_371);
        assert.equal(p?.ratio, Math.round(((12_728_481 - 24_367_496) / 53_879_371) * 10_000) / 100);
    });

    test("兩種分母都不可用時回傳 null", () => {
        const raw: MajorRaw = { date: "2026/11/04", netBuy: 1, netSell: -1, volume: null };
        assert.equal(toMajorPeriod(raw, 1), null);
        assert.equal(toMajorPeriod(raw, 1, null), null);
        assert.equal(toMajorPeriod(raw, 1, 0), null);
        assert.equal(toMajorPeriod(raw, 1, -5), null);
        assert.equal(toMajorPeriod({ ...raw, volume: 0 }, 1), null);
    });

    const rounding: Array<[string, number, number, number, number]> = [
        ["1/3 → 33.33", 1, 0, 3, 33.33],
        ["2/3 → 66.67", 2, 0, 3, 66.67],
        ["淨賣超（正號輸入也取絕對值）", 0, 25, 100, -25],
        ["買賣相抵 → 0", 500, -500, 1000, 0],
    ];
    for (const [name, netBuy, netSell, volume, expected] of rounding) {
        test(`比率四捨五入至小數 2 位：${name}`, () => {
            assert.equal(toMajorPeriod({ date: "d", netBuy, netSell, volume }, 1)?.ratio, expected);
        });
    }

    test("極小負值四捨五入後為 +0 而非 -0", () => {
        const p = toMajorPeriod({ date: "d", netBuy: 0, netSell: -1, volume: 1_000_000_000 }, 1);
        assert.ok(p);
        assert.ok(Object.is(p.ratio, 0), `ratio 應為 +0，得到 ${Object.is(p.ratio, -0) ? "-0" : p.ratio}`);
    });
});

// ============================================================================
// 📊 market.ts
// ============================================================================

const MARKET_FILES: Record<MarketListId, string> = {
    nav: "market-nav.json",
    pb: "market-pb.json",
    eps: "market-eps.json",
    pe: "market-pe.json",
    dividendYield: "market-yield.json",
    grossMargin: "market-margin.json",
    roe: "market-roe.json",
    roa: "market-roa.json",
    trustBuy: "market-trustbuy.json",
    trustSell: "market-trustsell.json",
    foreignBuy: "market-foreignbuy.json",
    foreignSell: "market-foreignsell.json",
    trustHold: "market-trusthold.json",
    foreignHold: "market-foreignhold.json",
};

function allIndexes(): Record<MarketListId, MarketIndex | undefined> {
    const out = {} as Record<MarketListId, MarketIndex | undefined>;
    for (const id of Object.keys(MARKET_FILES) as MarketListId[]) {
        out[id] = indexMarketList(fixture(MARKET_FILES[id]), MARKET_LISTS[id].keyField as "V1" | "V2");
    }
    return out;
}

describe("market: indexMarketList", () => {
    test("基本面清單以 V1（AS 代號）建立索引", () => {
        const idx = indexMarketList(fixture("market-nav.json"), "V1");
        assert.equal(idx.size, 6);
        assert.equal(idx.get("AS2330")?.V2, "248.05");
        assert.equal(idx.has("2026/06/01"), false);
    });

    test("籌碼清單以 V2（AS 代號）建立索引", () => {
        const idx = indexMarketList(fixture("market-trustbuy.json"), "V2");
        assert.deepEqual([...idx.keys()], ["AS2330", "AS2454", "AS8150", "AS2303"]);
        assert.equal(indexMarketList(fixture("market-trustbuy.json"), "V1").size, 1, "籌碼清單的 V1 是日期，誤用會全部擠成一筆");
    });

    test("每份清單的 keyField 設定與真實資料一致（索引得到 AS2330 或該清單的股票）", () => {
        for (const id of Object.keys(MARKET_FILES) as MarketListId[]) {
            const json = fixture(MARKET_FILES[id]);
            const rows = esunRows(json);
            const idx = indexMarketList(json, MARKET_LISTS[id].keyField as "V1" | "V2");
            assert.equal(idx.size, new Set(rows.map((r) => r[MARKET_LISTS[id].keyField as "V1" | "V2"])).size, id);
            for (const key of idx.keys()) assert.match(key, /^AS\d{4,6}$/, `${id} 的索引鍵應為 AS 代號`);
        }
    });

    test("重複代號以第一筆為準；鍵值去空白；空鍵略過", () => {
        const idx = indexMarketList(
            resultSet([{ V1: " AS2330 ", V2: "first" }, { V1: "AS2330", V2: "second" }, { V1: "", V2: "empty" }, { V2: "missing" }]),
            "V1"
        );
        assert.equal(idx.size, 1);
        assert.equal(idx.get("AS2330")?.V2, "first");
    });

    test("空清單回傳空索引；結構錯誤拋錯", () => {
        assert.equal(indexMarketList(fixture("market-foreignbuy.json"), "V2").size, 0);
        assert.throws(() => indexMarketList("<html>", "V1"), isPayloadError);
    });

    test("marketSymbol", () => assert.equal(marketSymbol("2330"), "AS2330"));
});

describe("market: parseContinuous（真實資料列）", () => {
    const trustBuy = indexMarketList(fixture("market-trustbuy.json"), "V2");
    const trustSell = indexMarketList(fixture("market-trustsell.json"), "V2");
    const foreignSell = indexMarketList(fixture("market-foreignsell.json"), "V2");

    const cases: Array<[string, EsunRow | undefined, ReturnType<typeof parseContinuous>]> = [
        [
            "投信連買延續：AS2330 V10=24, V11=23",
            trustBuy.get("AS2330"),
            { date: "2026/11/04", direction: "buy", days: 24, turned: false, previousDays: 0, lots: 3715, amountThousand: 8_432_521 },
        ],
        [
            "投信由賣轉買：AS8150 V10=1, V11=-1",
            trustBuy.get("AS8150"),
            { date: "2026/11/04", direction: "buy", days: 1, turned: true, previousDays: 1, lots: 6, amountThousand: 496 },
        ],
        [
            "投信由連賣 9 天轉買：AS2303 V10=1, V11=-9",
            trustBuy.get("AS2303"),
            { date: "2026/11/04", direction: "buy", days: 1, turned: true, previousDays: 9, lots: 3107, amountThousand: 321_763 },
        ],
        [
            "投信連賣延續：AS2105 V10=-9, V11=-8",
            trustSell.get("AS2105"),
            { date: "2026/11/04", direction: "sell", days: 9, turned: false, previousDays: 0, lots: -353, amountThousand: -10_742 },
        ],
        [
            "投信由連買 3 天轉賣：AS2801 V10=-1, V11=3",
            trustSell.get("AS2801"),
            { date: "2026/11/04", direction: "sell", days: 1, turned: true, previousDays: 3, lots: -8, amountThousand: -234 },
        ],
        [
            "外資連賣延續：AS2330 V10=-19, V11=-18",
            foreignSell.get("AS2330"),
            { date: "2026/11/04", direction: "sell", days: 19, turned: false, previousDays: 0, lots: -21_604, amountThousand: -49_035_410 },
        ],
    ];
    for (const [name, row, expected] of cases) {
        test(name, () => {
            assert.ok(row, "fixture 中應存在此列");
            assert.deepEqual(parseContinuous(row), expected);
        });
    }

    const edge: Array<[string, EsunRow | undefined, ReturnType<typeof parseContinuous>]> = [
        ["undefined → null", undefined, null],
        ["V10=0 → null", { V1: "d", V10: "0", V11: "5" }, null],
        ["V10 缺漏 → null", { V1: "d", V11: "5" }, null],
        ["V10 非數字 → null", { V1: "d", V10: "-", V11: "5" }, null],
        [
            "V11=0（首日，無前段）→ 非轉向",
            { V1: " 2026/11/04 ", V10: "1", V11: "0" },
            { date: "2026/11/04", direction: "buy", days: 1, turned: false, previousDays: 0, lots: 0, amountThousand: 0 },
        ],
        [
            "V11 缺漏 → 非轉向，張數金額缺漏為 0",
            { V10: "-2" },
            { date: "", direction: "sell", days: 2, turned: false, previousDays: 0, lots: 0, amountThousand: 0 },
        ],
    ];
    for (const [name, row, expected] of edge) {
        test(`邊界：${name}`, () => assert.deepEqual(parseContinuous(row), expected));
    }
});

describe("market: buildMarketSnapshot", () => {
    test("台積電：全部 14 份清單的真實資料", () => {
        assert.deepEqual(buildMarketSnapshot("2330", allIndexes()), {
            nav: { value: 248.05, date: "2026/06/01" },
            pb: { value: 9.11, date: "2026/11/04" },
            eps: { value: 27.25, date: "2026/06/01" },
            pe: { value: 26.2, date: "2026/11/04" },
            dividendYield: { value: 0.97, date: "2026/11/04" },
            grossMargin: { value: 67.72, date: "2026/06/01" },
            roe: { value: 11.39, date: "2026/06/01" },
            roa: { value: 7.86, date: "2026/06/01" },
            trust: { date: "2026/11/04", direction: "buy", days: 24, turned: false, previousDays: 0, lots: 3715, amountThousand: 8_432_521 },
            foreign: { date: "2026/11/04", direction: "sell", days: 19, turned: false, previousDays: 0, lots: -21_604, amountThousand: -49_035_410 },
            trustHoldPct: 3.92,
            foreignHoldPct: 68.31,
            failed: 0,
            unavailable: [],
        });
    });

    test("聯電：季資料日期較新（2026/09/01），投信由賣轉買，不在外資連續清單", () => {
        const s = buildMarketSnapshot("2303", allIndexes());
        assert.deepEqual(s.nav, { value: 37.55, date: "2026/09/01" });
        assert.equal(quarterLabel(s.eps.date), "2026Q3");
        assert.equal(s.trust?.direction, "buy");
        assert.equal(s.trust?.turned, true);
        assert.equal(s.trust?.previousDays, 9);
        assert.equal(s.foreign, null);
        assert.equal(s.trustHoldPct, 9.72);
        assert.equal(s.foreignHoldPct, 38.6);
    });

    test("彰銀：毛利率 V2 為空字串 → value 為 null 但保留日期；投信取自賣超清單", () => {
        const s = buildMarketSnapshot("2801", allIndexes());
        assert.deepEqual(s.grossMargin, { value: null, date: "2026/06/01" });
        assert.deepEqual(s.nav, { value: null, date: null }, "不在清單中");
        assert.equal(s.trust?.direction, "sell");
        assert.equal(s.trust?.turned, true);
        assert.equal(s.trust?.previousDays, 3);
        assert.equal(s.foreign, null);
        assert.equal(s.trustHoldPct, null);
    });

    test("每股淨值 V2 為空（AS1215）→ value null", () => {
        assert.deepEqual(buildMarketSnapshot("1215", allIndexes()).nav, { value: null, date: "2026/09/01" });
    });

    test("不在任何清單的股票：全部為 null、failed=0", () => {
        const s = buildMarketSnapshot("9999", allIndexes());
        assert.deepEqual(s.pe, { value: null, date: null });
        assert.equal(s.trust, null);
        assert.equal(s.foreign, null);
        assert.equal(s.trustHoldPct, null);
        assert.equal(s.foreignHoldPct, null);
        assert.equal(s.failed, 0);
    });

    test("部分清單載入失敗：failed 計數，其餘資料不受影響", () => {
        const idx = allIndexes();
        idx.pe = undefined;
        idx.foreignSell = undefined;
        idx.trustHold = undefined;
        const s = buildMarketSnapshot("2330", idx);
        assert.equal(s.failed, 3);
        assert.deepEqual(s.pe, { value: null, date: null });
        assert.equal(s.foreign, null);
        assert.equal(s.trustHoldPct, null);
        assert.deepEqual(s.pb, { value: 9.11, date: "2026/11/04" });
        assert.equal(s.trust?.days, 24);
    });

    test("全部清單失敗：failed = 清單總數", () => {
        const idx = {} as Record<MarketListId, MarketIndex | undefined>;
        for (const id of Object.keys(MARKET_LISTS) as MarketListId[]) idx[id] = undefined;
        assert.equal(buildMarketSnapshot("2330", idx).failed, Object.keys(MARKET_LISTS).length);
    });

    test("同時出現在買、賣清單時以買超清單為準；買超列無效時退回賣超清單", () => {
        const idx = allIndexes();
        idx.foreignBuy = indexMarketList(resultSet([{ V1: "2026/11/04", V2: "AS2330", V6: "100", V9: "2000", V10: "1", V11: "-19" }]), "V2");
        const s = buildMarketSnapshot("2330", idx);
        assert.deepEqual(s.foreign, { date: "2026/11/04", direction: "buy", days: 1, turned: true, previousDays: 19, lots: 100, amountThousand: 2000 });

        idx.foreignBuy = indexMarketList(resultSet([{ V1: "2026/11/04", V2: "AS2330", V10: "0" }]), "V2");
        assert.equal(buildMarketSnapshot("2330", idx).foreign?.direction, "sell");
    });
});

describe("market: quarterLabel", () => {
    const cases: Array<[string | null, string | null]> = [
        ["2026/06/01", "2026Q2"],
        ["2026/09/01", "2026Q3"],
        ["2026-12-01", "2026Q4"],
        ["2026/01/15", "2026Q1"],
        ["2026/3/1", "2026Q1"],
        ["2026/04/01", "2026Q2"],
        ["2026/13/01", "2026/13/01"],
        ["2026/00/01", "2026/00/01"],
        ["季報", "季報"],
        ["", null],
        [null, null],
    ];
    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => assert.equal(quarterLabel(input), expected));
    }
});
