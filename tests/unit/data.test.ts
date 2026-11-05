/**
 * 資料層：股票資料庫索引（StockIndex）、UI 設定正規化與舊版搬移、訊息協定驗證。
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers/fixtures";
import { StockIndex, isStockDatabase, normalizeSearchText } from "../../src/core/stockIndex";
import {
    DEFAULT_SETTINGS,
    collectLegacySettings,
    defaultSettings,
    normalizeHiddenLinks,
    normalizePosition,
    normalizeSections,
    normalizeTheme,
    settingsFromStorage,
} from "../../src/shared/settings";
import { DATASET_NAMES, parseRequest } from "../../src/shared/messages";
import { LOCAL_KEYS, SYNC_KEYS } from "../../src/shared/constants";
import type { CategoryType, StockDatabase } from "../../src/shared/types";

// ============================================================================
// 測試資料
// ============================================================================

const SUBSET = fixture<StockDatabase>("stock-db-subset.json");
const codes = (list: ReadonlyArray<{ code: string }>): string[] => list.map((s) => s.code);
const names = (list: ReadonlyArray<{ name: string }>): string[] => list.map((s) => s.name);

type Row = [code: string, type: CategoryType, name: string];
function db(stocks: Array<[code: string, name: string, capital?: number]>, cats: Row[] = []): StockDatabase {
    return {
        basicInfo: stocks.map(([code, name, capital]) => ({ 股票代碼: code, 股票名稱: name, ...(capital === undefined ? {} : { 股本_億元: capital }) })),
        categories: cats.map(([code, type, name]) => ({ 股票代碼: code, 分類類型: type, 分類名稱: name })),
    };
}

// ============================================================================
// normalizeSearchText / isStockDatabase
// ============================================================================

describe("normalizeSearchText", () => {
    const cases: Array<[input: string, expected: string]> = [
        ["２３３０", "2330"],
        ["ＡＩ伺服器", "ai伺服器"],
        ["臺積電", "台積電"],
        ["  台 積\t電\n", "台積電"],
        ["00632R", "00632r"],
        ["IC　設計", "ic設計"], // 全形空白經 NFKC 轉為一般空白後去除
        ["", ""],
    ];
    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
            assert.equal(normalizeSearchText(input), expected);
        });
    }
});

describe("isStockDatabase", () => {
    const cases: Array<[label: string, value: unknown, expected: boolean]> = [
        ["真實資料庫子集", SUBSET, true],
        ["有個股但無分類（空陣列）", { basicInfo: [{ 股票代碼: "2330", 股票名稱: "台積電" }], categories: [] }, true],
        ["basicInfo 為空", { basicInfo: [], categories: [] }, false],
        ["缺 categories", { basicInfo: [{ 股票代碼: "2330", 股票名稱: "台積電" }] }, false],
        ["categories 不是陣列", { basicInfo: [{}], categories: {} }, false],
        ["null", null, false],
        ["陣列", [], false],
        ["字串", "stock-data", false],
        ["Cloudflare / 404 HTML 被解析後的字串", "<html></html>", false],
    ];
    for (const [label, value, expected] of cases) {
        test(label, () => assert.equal(isStockDatabase(value), expected));
    }
});

// ============================================================================
// StockIndex：建立索引
// ============================================================================

describe("StockIndex 建立索引（真實資料庫子集）", () => {
    const index = new StockIndex(SUBSET);

    test("個股數與分類數與原始資料一致", () => {
        const stockCodes = new Set(SUBSET.basicInfo.map((b) => b.股票代碼));
        const catKeys = new Set(SUBSET.categories.filter((c) => stockCodes.has(c.股票代碼)).map((c) => `${c.分類類型}|${c.分類名稱}`));
        assert.equal(index.stockCount, stockCodes.size);
        assert.equal(index.stockCount, 15);
        assert.equal(index.categoryCount, catKeys.size);
    });

    test("getStock 回傳代碼、名稱與股本；查無則為 null", () => {
        assert.deepEqual(index.getStock("2330"), { code: "2330", name: "台積電", capital: 2593.24 });
        assert.deepEqual(index.getStock("9962"), { code: "9962", name: "有益", capital: 9.02 });
        assert.equal(index.getStock("0000"), null);
        assert.equal(index.getStock(""), null);
    });

    test("categoriesOf 依類型回傳分類（保持資料庫順序）", () => {
        assert.deepEqual(index.categoriesOf("2330", "產業"), ["IC生產", "IC製造", "晶圓代工"]);
        assert.deepEqual(index.categoriesOf("2330", "概念"), ["台積電概念股", "人工智慧AI概念股", "AI伺服器概念股"]);
        assert.deepEqual(index.categoriesOf("2330", "集團"), ["台積電集團"]);
        assert.deepEqual(index.categoriesOf("9962", "概念"), []);
        assert.deepEqual(index.categoriesOf("0000", "產業"), []);
    });

    test("categoriesOf 回傳複本，修改不影響索引", () => {
        const list = index.categoriesOf("2330", "集團");
        list.push("竄改");
        assert.deepEqual(index.categoriesOf("2330", "集團"), ["台積電集團"]);
    });

    test("members 依股本由大到小排序", () => {
        assert.deepEqual(codes(index.members("概念", "台積電概念股")), ["2330", "3711", "5347", "6488", "4919", "3707"]);
        const caps = index.members("產業", "IC製造").map((s) => s.capital);
        assert.deepEqual(caps, [...caps].sort((a, b) => b - a));
        assert.equal(caps.length, 10);
    });

    test("members 可排除目前個股", () => {
        assert.deepEqual(codes(index.members("集團", "台積電集團", "2330")), ["5347"]);
        assert.deepEqual(codes(index.members("概念", "台積電概念股", "2330")), ["3711", "5347", "6488", "4919", "3707"]);
    });

    test("members：類型不符或分類不存在時回傳空陣列", () => {
        assert.deepEqual(index.members("概念", "IC製造"), []);
        assert.deepEqual(index.members("產業", "不存在的分類"), []);
    });
});

describe("StockIndex 建立索引（邊界資料）", () => {
    test("分類成員若不在 basicInfo（已下市）會被排除；全員下市的分類不計入", () => {
        const index = new StockIndex(
            db(
                [["2330", "台積電", 2593.24], ["2303", "聯電", 1257.01]],
                [["2330", "產業", "晶圓代工"], ["2303", "產業", "晶圓代工"], ["9999", "產業", "晶圓代工"], ["8888", "產業", "下市分類"]],
            ),
        );
        assert.deepEqual(codes(index.members("產業", "晶圓代工")), ["2330", "2303"]);
        assert.deepEqual(index.members("產業", "下市分類"), []);
        assert.equal(index.categoryCount, 1);
    });

    test("重複的分類列只算一次", () => {
        const index = new StockIndex(db([["2330", "台積電", 1]], [["2330", "概念", "AI"], ["2330", "概念", "AI"]]));
        assert.deepEqual(index.categoriesOf("2330", "概念"), ["AI"]);
        assert.equal(index.members("概念", "AI").length, 1);
    });

    test("同名分類在不同類型下視為不同分類", () => {
        const index = new StockIndex(db([["2330", "台積電", 1], ["2303", "聯電", 1]], [["2330", "概念", "晶圓"], ["2303", "產業", "晶圓"]]));
        assert.deepEqual(codes(index.members("概念", "晶圓")), ["2330"]);
        assert.deepEqual(codes(index.members("產業", "晶圓")), ["2303"]);
        assert.equal(index.categoryCount, 2);
    });

    test("無效資料列被略過：空代碼、空名稱、未知分類類型、重複代碼（先出現者為準）", () => {
        const raw = {
            basicInfo: [
                { 股票代碼: " 2330 ", 股票名稱: " 台積電 ", 股本_億元: 2593.24 },
                { 股票代碼: "2330", 股票名稱: "重複", 股本_億元: 1 },
                { 股票代碼: "", 股票名稱: "沒有代碼" },
                { 股票代碼: "1234", 股票名稱: "" },
            ],
            categories: [
                { 股票代碼: "2330", 分類類型: "其他", 分類名稱: "未知類型" },
                { 股票代碼: "2330", 分類類型: "產業", 分類名稱: "" },
                { 股票代碼: "", 分類類型: "產業", 分類名稱: "空代碼" },
                { 股票代碼: "2330", 分類類型: "產業", 分類名稱: " 晶圓代工 " },
            ],
        } as unknown as StockDatabase;
        const index = new StockIndex(raw);
        assert.equal(index.stockCount, 1);
        assert.deepEqual(index.getStock("2330"), { code: "2330", name: "台積電", capital: 2593.24 });
        assert.equal(index.categoryCount, 1);
        assert.deepEqual(index.categoriesOf("2330", "產業"), ["晶圓代工"]);
    });

    test("股本缺漏或非有限數值時視為 0，排序時排在最後；同股本依代碼排序", () => {
        const raw = db(
            [["3000", "無股本"], ["2000", "NaN 股本", Number.NaN], ["1000", "大", 100], ["1500", "同股本B", 0]],
            [["3000", "產業", "X"], ["2000", "產業", "X"], ["1000", "產業", "X"], ["1500", "產業", "X"]],
        );
        const index = new StockIndex(raw);
        assert.equal(index.getStock("3000")?.capital, 0);
        assert.equal(index.getStock("2000")?.capital, 0);
        assert.deepEqual(codes(index.members("產業", "X")), ["1000", "1500", "2000", "3000"]);
    });

    test("缺少 basicInfo / categories 欄位也不會丟出例外", () => {
        const index = new StockIndex({} as StockDatabase);
        assert.equal(index.stockCount, 0);
        assert.equal(index.categoryCount, 0);
        assert.deepEqual(index.search("2330", 10, 10), { stocks: [], categories: [] });
    });
});

// ============================================================================
// StockIndex.related
// ============================================================================

describe("StockIndex.related", () => {
    const index = new StockIndex(SUBSET);

    test("2330：三種類型皆回傳，排除自己，分類依成員數由少到多", () => {
        const groups = index.related("2330", {}, 10);
        assert.deepEqual(
            groups.概念.map((c) => [c.name, c.total]),
            [["AI伺服器概念股", 4], ["人工智慧AI概念股", 5], ["台積電概念股", 5]],
        );
        // IC生產、晶圓代工同為 6 檔（中英混合名稱的相對順序由 zh-Hant 定序決定，這裡只驗證成員數排序）
        assert.deepEqual(groups.產業.map((c) => c.total), [6, 6, 9]);
        assert.deepEqual(groups.產業.slice(0, 2).map((c) => c.name).sort(), ["IC生產", "晶圓代工"].sort());
        assert.equal(groups.產業[2]?.name, "IC製造");
        assert.deepEqual(groups.集團.map((c) => [c.name, c.total]), [["台積電集團", 1]]);
        for (const type of ["概念", "產業", "集團"] as const) {
            for (const cat of groups[type]) {
                assert.equal(cat.type, type);
                assert.ok(!codes(cat.stocks).includes("2330"), `${cat.name} 不應包含 2330`);
            }
        }
    });

    test("每個分類的成員依股本排序", () => {
        const groups = index.related("2330", {}, 10);
        const ai = groups.概念.find((c) => c.name === "人工智慧AI概念股");
        assert.deepEqual(names(ai?.stocks ?? []), ["鴻海", "聯電", "日月光投控", "聯發科", "新唐"]);
    });

    test("limit 只限制回傳個股數，total 仍為完整成員數", () => {
        const groups = index.related("2330", {}, 2);
        const ic = groups.產業.find((c) => c.name === "IC製造");
        assert.equal(ic?.total, 9);
        assert.deepEqual(codes(ic?.stocks ?? []), ["2303", "2344"]);
        assert.equal(ic?.stocks.length, 2);
    });

    test("API 回傳的分類與資料庫合併並去重", () => {
        // 9962 在資料庫只有「不鏽鋼」（唯一成員 → 排除自己後為空，不回傳）
        const groups = index.related("9962", { 產業: ["IC製造", "不鏽鋼", "IC製造"], 集團: ["台積電集團"] }, 3);
        assert.deepEqual(groups.產業.map((c) => c.name), ["IC製造"]);
        assert.equal(groups.產業[0]?.total, 10);
        assert.deepEqual(codes(groups.產業[0]?.stocks ?? []), ["2330", "2303", "2344"]);
        assert.deepEqual(groups.集團.map((c) => [c.name, c.total]), [["台積電集團", 2]]);
        assert.deepEqual(groups.概念, []);
    });

    test("API 分類與資料庫已有分類重複時不會出現兩次", () => {
        const groups = index.related("2330", { 集團: ["台積電集團"], 概念: ["AI伺服器概念股"] }, 10);
        assert.equal(groups.集團.length, 1);
        assert.equal(groups.概念.filter((c) => c.name === "AI伺服器概念股").length, 1);
    });

    test("資料庫查無的 API 分類會被略過", () => {
        const groups = index.related("2330", { 概念: ["火星概念股"], 產業: ["量子電腦"] }, 10);
        assert.ok(!groups.概念.some((c) => c.name === "火星概念股"));
        assert.ok(!groups.產業.some((c) => c.name === "量子電腦"));
    });

    test("API 分類放錯類型（產業名稱放在概念）時不會誤配", () => {
        const groups = index.related("9962", { 概念: ["IC製造"] }, 10);
        assert.deepEqual(groups.概念, []);
    });

    test("資料庫沒有的個股：只回傳 API 提供且資料庫認得的分類", () => {
        const groups = index.related("6789", { 集團: ["台積電集團", "不存在集團"] }, 10);
        assert.deepEqual(groups.集團.map((c) => codes(c.stocks)), [["2330", "5347"]]);
        assert.deepEqual(groups.概念, []);
        assert.deepEqual(groups.產業, []);
    });

    test("成員數相同時依名稱排序（穩定、與輸入順序無關）", () => {
        const raw = db(
            [["1", "甲", 3], ["2", "乙", 2], ["3", "丙", 1]],
            [["1", "概念", "B概念"], ["2", "概念", "B概念"], ["1", "概念", "A概念"], ["3", "概念", "A概念"], ["1", "概念", "C單一"], ["2", "概念", "C單一"], ["3", "概念", "C單一"]],
        );
        const groups = new StockIndex(raw).related("1", {}, 10);
        assert.deepEqual(groups.概念.map((c) => [c.name, c.total]), [["A概念", 1], ["B概念", 1], ["C單一", 2]]);
    });
});

// ============================================================================
// StockIndex.search
// ============================================================================

describe("StockIndex.search 個股排序", () => {
    // 每一檔恰好命中一種規則
    const ranking = new StockIndex(
        db([
            ["9120", "代碼包含", 9000], // 代碼包含 "12"（30）
            ["9003", "創12", 8000], // 名稱包含（40）
            ["9002", "12生技", 7000], // 名稱開頭（70）
            ["1201", "代碼開頭小", 10], // 代碼開頭（80）
            ["1299", "代碼開頭大", 50], // 代碼開頭（80），股本較大
            ["9001", "12", 1], // 名稱完全符合（95）
            ["12", "代碼完全符合", 0.5], // 代碼完全符合（100）
            ["5555", "無關", 99999],
        ]),
    );

    test("排序：代碼完全 > 名稱完全 > 代碼開頭 > 名稱開頭 > 名稱包含 > 代碼包含；同分依股本", () => {
        const { stocks } = ranking.search("12", 20, 20);
        assert.deepEqual(codes(stocks), ["12", "9001", "1299", "1201", "9002", "9003", "9120"]);
    });

    test("stockLimit 截斷結果", () => {
        assert.deepEqual(codes(ranking.search("12", 3, 20).stocks), ["12", "9001", "1299"]);
        assert.deepEqual(ranking.search("12", 0, 20).stocks, []);
    });

    test("同分同股本時依代碼排序", () => {
        const index = new StockIndex(db([["2303", "聯電", 1], ["2302", "麗正", 1], ["2301", "光寶科", 1]]));
        assert.deepEqual(codes(index.search("230", 10, 10).stocks), ["2301", "2302", "2303"]);
    });

    test("回傳欄位只有 code / name / capital", () => {
        const { stocks } = ranking.search("12", 1, 0);
        assert.deepEqual(stocks, [{ code: "12", name: "代碼完全符合", capital: 0.5 }]);
    });

    test("英數代碼不分大小寫（00632R）", () => {
        const index = new StockIndex(db([["00632R", "元大台灣50反1", 10], ["0050", "元大台灣50", 20]]));
        assert.deepEqual(codes(index.search("00632r", 10, 10).stocks), ["00632R"]);
    });
});

describe("StockIndex.search 真實資料庫子集", () => {
    const index = new StockIndex(SUBSET);
    const cases: Array<[label: string, query: string, firstCode: string]> = [
        ["代碼完全符合", "2330", "2330"],
        ["全形數字（NFKC）", "２３３０", "2330"],
        ["「臺」視同「台」", "臺積電", "2330"],
        ["忽略空白", " 台 積 電 ", "2330"],
        ["名稱開頭", "台積", "2330"],
        ["名稱完全符合優先於名稱開頭", "世界", "5347"],
        ["名稱包含", "月光", "3711"],
    ];
    for (const [label, query, firstCode] of cases) {
        test(`${label}：${JSON.stringify(query)} → ${firstCode}`, () => {
            assert.equal(index.search(query, 5, 5).stocks[0]?.code, firstCode);
        });
    }

    test("代碼開頭「23」：依股本由大到小", () => {
        const { stocks } = index.search("23", 20, 0);
        assert.deepEqual(codes(stocks), ["2330", "2317", "2303", "2344", "2337", "2342"]);
    });

    test("代碼開頭優先於代碼包含（「37」）", () => {
        const { stocks } = index.search("37", 20, 0);
        // 3707、3711 代碼開頭；2337 代碼包含
        assert.deepEqual(codes(stocks), ["3711", "3707", "2337"]);
    });

    test("空字串或只有空白：回傳空結果", () => {
        for (const q of ["", "   ", "\t\n", "　"]) {
            assert.deepEqual(index.search(q, 20, 30), { stocks: [], categories: [] }, JSON.stringify(q));
        }
    });

    test("查無結果", () => {
        assert.deepEqual(index.search("不存在的公司", 20, 30), { stocks: [], categories: [] });
    });
});

describe("StockIndex.search 分類", () => {
    const index = new StockIndex(SUBSET);

    test("分類完全符合排第一，回傳類型、名稱與成員數", () => {
        const { categories } = index.search("IC製造", 0, 5);
        assert.deepEqual(categories[0], { type: "產業", name: "IC製造", count: 10 });
    });

    test("開頭符合優先於包含；同分依成員數由多到少", () => {
        const { categories } = index.search("ic", 0, 30);
        const list = names(categories);
        // 開頭符合：IC製造(10) > IC生產(7) > IC設計(2)
        assert.deepEqual(list.slice(0, 3), ["IC製造", "IC生產", "IC設計"]);
        // 其餘皆為「包含」
        for (const name of list.slice(3)) {
            assert.ok(!name.toLowerCase().startsWith("ic") && name.toLowerCase().includes("ic"), name);
        }
        assert.ok(list.includes("IO控制IC"));
        assert.ok(list.includes("消費性IC"));
        const counts = categories.slice(3).map((c) => c.count);
        assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
    });

    test("小寫英文可搜到大寫分類（AI）", () => {
        const { categories } = index.search("ai", 0, 10);
        assert.deepEqual(
            categories.map((c) => [c.name, c.count]),
            [["AI伺服器概念股", 5], ["人工智慧AI概念股", 6]],
        );
    });

    test("categoryLimit 截斷分類結果", () => {
        assert.equal(index.search("ic", 0, 2).categories.length, 2);
        assert.deepEqual(index.search("ic", 0, 0).categories, []);
    });

    test("個股與分類同時命中時各自回傳", () => {
        const res = index.search("台積電", 5, 5);
        assert.equal(res.stocks[0]?.code, "2330");
        // 兩者皆為「開頭符合」，依成員數由多到少
        assert.deepEqual(names(res.categories), ["台積電概念股", "台積電集團"]);
        assert.equal(res.categories.find((c) => c.name === "台積電概念股")?.count, 6);
        assert.equal(res.categories.find((c) => c.name === "台積電集團")?.count, 2);
    });

    test("全員下市的分類不會出現在搜尋結果", () => {
        const index2 = new StockIndex(db([["2330", "台積電", 1]], [["9999", "產業", "下市產業"], ["2330", "產業", "晶圓代工"]]));
        assert.deepEqual(index2.search("產業", 0, 10).categories, []);
        assert.deepEqual(index2.search("下市", 0, 10).categories, []);
    });
});

// ============================================================================
// settings
// ============================================================================

describe("settings 正規化", () => {
    test("normalizePosition", () => {
        for (const v of ["left", "right", "default"]) assert.equal(normalizePosition(v), v);
        for (const v of ["top", "", null, undefined, 1, "LEFT"]) assert.equal(normalizePosition(v), "right");
    });

    test("normalizeTheme：富果淺色、深色與跟隨富果（auto）", () => {
        for (const v of ["light", "dark", "auto"]) assert.equal(normalizeTheme(v), v);
        for (const v of ["Dark", "system", "", null, undefined, true]) assert.equal(normalizeTheme(v), "auto");
    });

    test("normalizeSections 只保留合法 id 與布林值", () => {
        assert.deepEqual(
            normalizeSections({ basic: true, "major-chip": false, Bad: true, "has space": true, ok2: "true", ["x".repeat(33)]: true, ["y".repeat(32)]: false }),
            { basic: true, "major-chip": false, ["y".repeat(32)]: false },
        );
        for (const v of [null, undefined, "basic", 1]) assert.deepEqual(normalizeSections(v), {});
    });

    test("normalizeHiddenLinks 過濾非法 id 並去重", () => {
        assert.deepEqual(normalizeHiddenLinks(["goodinfo", "wantgoo", "goodinfo", "Bad", 3, null, "a-b-1"]), ["goodinfo", "wantgoo", "a-b-1"]);
        for (const v of [null, "goodinfo", { 0: "goodinfo" }]) assert.deepEqual(normalizeHiddenLinks(v), []);
    });
});

describe("defaultSettings", () => {
    test("內容等於 DEFAULT_SETTINGS", () => {
        assert.deepEqual(defaultSettings(), { position: "right", visible: true, collapsed: false, sections: {}, theme: "auto", shortcut: "Alt+Q", hiddenLinks: [] });
        assert.deepEqual(defaultSettings(), { ...DEFAULT_SETTINGS });
    });

    test("每次回傳新物件；修改不影響預設值或下一份", () => {
        const a = defaultSettings();
        a.sections.basic = false;
        a.hiddenLinks.push("goodinfo");
        a.position = "left";
        const b = defaultSettings();
        assert.notEqual(a, b);
        assert.notEqual(a.sections, b.sections);
        assert.notEqual(a.hiddenLinks, b.hiddenLinks);
        assert.deepEqual(b.sections, {});
        assert.deepEqual(b.hiddenLinks, []);
        assert.equal(b.position, "right");
        assert.deepEqual(DEFAULT_SETTINGS.sections, {});
        assert.deepEqual(DEFAULT_SETTINGS.hiddenLinks, []);
    });

    test("DEFAULT_SETTINGS 已凍結", () => {
        assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
    });
});

describe("settingsFromStorage", () => {
    const KEY = SYNC_KEYS.shortcut;

    test("儲存區為空時全部採用預設值", () => {
        assert.deepEqual(settingsFromStorage({}, {}, KEY), defaultSettings());
    });

    test("讀取並正規化 local 的各項設定", () => {
        const local = {
            [LOCAL_KEYS.position]: "left",
            [LOCAL_KEYS.visible]: false,
            [LOCAL_KEYS.collapsed]: true,
            [LOCAL_KEYS.sections]: { basic: false, "BAD KEY": true },
            [LOCAL_KEYS.theme]: "dark",
            [LOCAL_KEYS.hiddenLinks]: ["goodinfo", "goodinfo"],
        };
        assert.deepEqual(settingsFromStorage(local, { [KEY]: "Ctrl+K" }, KEY), {
            position: "left",
            visible: false,
            collapsed: true,
            sections: { basic: false },
            theme: "dark",
            shortcut: "Ctrl+K",
            hiddenLinks: ["goodinfo"],
        });
    });

    test("非布林的 visible / collapsed（例如舊版字串）採用預設值", () => {
        const s = settingsFromStorage({ [LOCAL_KEYS.visible]: "false", [LOCAL_KEYS.collapsed]: "true" }, {}, KEY);
        assert.equal(s.visible, true);
        assert.equal(s.collapsed, false);
    });

    const shortcutCases: Array<[stored: unknown, expected: string]> = [
        ["alt+q", "Alt+Q"],
        ["Shift+Control+k", "Ctrl+Shift+K"],
        ["cmd+option+F", "Alt+Meta+F"],
        [" Ctrl + Shift + 1 ", "Ctrl+Shift+1"],
        ["Q", "Alt+Q"],
        ["Ctrl+A+B", "Alt+Q"],
        ["", "Alt+Q"],
        [42, "Alt+Q"],
        [null, "Alt+Q"],
    ];
    for (const [stored, expected] of shortcutCases) {
        test(`快捷鍵 ${JSON.stringify(stored)} → ${expected}`, () => {
            assert.equal(settingsFromStorage({}, { [KEY]: stored }, KEY).shortcut, expected);
        });
    }

    test("快捷鍵只從指定的 sync 鍵讀取", () => {
        assert.equal(settingsFromStorage({ [KEY]: "Ctrl+K" }, { other: "Ctrl+K" }, KEY).shortcut, "Alt+Q");
        assert.equal(settingsFromStorage({}, { custom: "Ctrl+K" }, "custom").shortcut, "Ctrl+K");
    });
});

describe("collectLegacySettings（舊版 localStorage 搬移）", () => {
    function storage(entries: Record<string, string>): Pick<Storage, "length" | "key" | "getItem"> {
        const keys = Object.keys(entries);
        return {
            get length() {
                return keys.length;
            },
            key: (i: number) => keys[i] ?? null,
            getItem: (k: string) => (Object.prototype.hasOwnProperty.call(entries, k) ? (entries[k] as string) : null),
        };
    }

    test("沒有舊資料時不搬移也不刪除", () => {
        assert.deepEqual(collectLegacySettings(storage({ unrelated: "1" })), { values: {}, removeKeys: [] });
    });

    test("完整舊版設定搬到 fi.* 並列出要刪除的鍵", () => {
        const result = collectLegacySettings(
            storage({
                "fugle-info-position": "left",
                "fugle-info-visible": "false",
                "fugle-info-collapsed": "true",
                "fugle-section-basic": "false",
                "fugle-section-major-chip": "true",
                "fugle-volume-api-token": "  eyJ.token  ",
                "other-site-key": "keep",
            }),
        );
        assert.deepEqual(result.values, {
            "fi.position": "left",
            "fi.visible": false,
            "fi.collapsed": true,
            "fi.finmindToken": "eyJ.token",
            "fi.sections": { basic: false, "major-chip": true },
        });
        assert.deepEqual(
            [...result.removeKeys].sort(),
            ["fugle-info-collapsed", "fugle-info-position", "fugle-info-visible", "fugle-section-basic", "fugle-section-major-chip", "fugle-volume-api-token"].sort(),
        );
        assert.ok(!result.removeKeys.includes("other-site-key"));
    });

    const boolCases: Array<[key: string, raw: string, field: string, expected: unknown]> = [
        ["fugle-info-visible", "true", "fi.visible", true],
        ["fugle-info-visible", "", "fi.visible", true],
        ["fugle-info-visible", "false", "fi.visible", false],
        ["fugle-info-collapsed", "false", "fi.collapsed", false],
        ["fugle-info-collapsed", "1", "fi.collapsed", false],
        ["fugle-info-collapsed", "true", "fi.collapsed", true],
        ["fugle-info-position", "default", "fi.position", "default"],
        ["fugle-info-position", "middle", "fi.position", "right"],
    ];
    for (const [key, raw, field, expected] of boolCases) {
        test(`${key}=${JSON.stringify(raw)} → ${field}=${JSON.stringify(expected)}`, () => {
            const result = collectLegacySettings(storage({ [key]: raw }));
            assert.deepEqual(result.values, { [field]: expected });
            assert.deepEqual(result.removeKeys, [key]);
        });
    }

    test("空白 Token 會被刪除但不搬移", () => {
        const result = collectLegacySettings(storage({ "fugle-volume-api-token": "   " }));
        assert.deepEqual(result.values, {});
        assert.deepEqual(result.removeKeys, ["fugle-volume-api-token"]);
    });

    test("非法的區塊 id 不搬移（但舊鍵仍會清除）", () => {
        const result = collectLegacySettings(storage({ "fugle-section-Bad Id": "true", "fugle-section-": "true", "fugle-section-ok": "true" }));
        assert.deepEqual(result.values, { "fi.sections": { ok: true } });
        assert.deepEqual([...result.removeKeys].sort(), ["fugle-section-", "fugle-section-Bad Id", "fugle-section-ok"]);
    });

    test("只有非法區塊 id 時不寫入 fi.sections", () => {
        const result = collectLegacySettings(storage({ "fugle-section-UPPER": "false" }));
        assert.ok(!("fi.sections" in result.values));
        assert.deepEqual(result.removeKeys, ["fugle-section-UPPER"]);
    });

    test("搬移結果可直接被 settingsFromStorage 讀回", () => {
        const { values } = collectLegacySettings(storage({ "fugle-info-position": "left", "fugle-info-collapsed": "true", "fugle-section-etf": "false" }));
        const s = settingsFromStorage(values, {}, SYNC_KEYS.shortcut);
        assert.equal(s.position, "left");
        assert.equal(s.collapsed, true);
        assert.deepEqual(s.sections, { etf: false });
    });
});

// ============================================================================
// parseRequest
// ============================================================================

describe("parseRequest 合法訊息", () => {
    test("dataset：每個資料集名稱皆可用；force 強制轉為布林", () => {
        for (const name of DATASET_NAMES) {
            assert.deepEqual(parseRequest({ type: "dataset", name, stockId: "2330" }), { type: "dataset", name, stockId: "2330", force: false });
        }
        assert.equal((parseRequest({ type: "dataset", name: "basic", stockId: "2330", force: true }) as { force?: boolean }).force, true);
        for (const force of ["true", 1, {}, null]) {
            assert.equal((parseRequest({ type: "dataset", name: "basic", stockId: "2330", force }) as { force?: boolean }).force, false, JSON.stringify(force));
        }
    });

    test("dataset：各種合法股票代碼", () => {
        for (const stockId of ["2330", "00878", "2881A", "00632R", "9962", "12345678"]) {
            assert.ok(parseRequest({ type: "dataset", name: "basic", stockId }), stockId);
        }
    });

    test("related：保留合法 extra 並捨棄未知類型與非陣列", () => {
        const req = parseRequest({
            type: "related",
            stockId: "2330",
            extra: { 概念: ["AI伺服器概念股"], 產業: "IC製造", 集團: [1, 2], 其他: ["x"], __proto__: { 概念: ["polluted"] } },
            limit: 10.9,
        });
        assert.deepEqual(req, { type: "related", stockId: "2330", extra: { 概念: ["AI伺服器概念股"] }, limit: 10 });
    });

    test("related：extra 缺漏或不是物件時視為空", () => {
        for (const extra of [undefined, null, "概念", 3]) {
            assert.deepEqual(parseRequest({ type: "related", stockId: "2330", extra, limit: 5 }), { type: "related", stockId: "2330", extra: {}, limit: 5 });
        }
    });

    test("related：過長的分類清單或名稱被捨棄", () => {
        const req = parseRequest({ type: "related", stockId: "2330", extra: { 概念: Array(501).fill("a"), 產業: ["x".repeat(101)], 集團: ["ok"] }, limit: 1 });
        assert.deepEqual(req, { type: "related", stockId: "2330", extra: { 集團: ["ok"] }, limit: 1 });
    });

    test("category：exclude 不合法時忽略", () => {
        assert.deepEqual(parseRequest({ type: "category", categoryType: "產業", name: "IC製造", exclude: "2330" }), { type: "category", categoryType: "產業", name: "IC製造", exclude: "2330" });
        assert.deepEqual(parseRequest({ type: "category", categoryType: "集團", name: "台積電集團", exclude: "../x" }), { type: "category", categoryType: "集團", name: "台積電集團", exclude: undefined });
    });

    test("search：接受空字串與 100 字以內的查詢", () => {
        assert.deepEqual(parseRequest({ type: "search", query: "台積" }), { type: "search", query: "台積" });
        assert.deepEqual(parseRequest({ type: "search", query: "" }), { type: "search", query: "" });
        assert.ok(parseRequest({ type: "search", query: "x".repeat(100) }));
    });

    test("無參數訊息：clearCache / openOptions / ping，且多餘欄位被丟棄", () => {
        for (const type of ["clearCache", "openOptions", "ping"] as const) {
            assert.deepEqual(parseRequest({ type, url: "https://evil.example", extra: 1 }), { type });
        }
    });

    test("回傳物件不帶入未知欄位（例如 url、token）", () => {
        const req = parseRequest({ type: "dataset", name: "etf", stockId: "2330", url: "https://evil.example", token: "x" });
        assert.deepEqual(Object.keys(req ?? {}).sort(), ["force", "name", "stockId", "type"]);
    });
});

describe("parseRequest 不合法訊息回傳 null", () => {
    const cases: Array<[label: string, value: unknown]> = [
        ["null", null],
        ["字串", "ping"],
        ["數字", 1],
        ["未知 type", { type: "fetch", url: "https://evil.example" }],
        ["缺 type", { stockId: "2330" }],
        ["type 大小寫不符", { type: "PING" }],
        ["dataset：路徑穿越代碼", { type: "dataset", name: "basic", stockId: "../x" }],
        ["dataset：小寫含空白代碼", { type: "dataset", name: "basic", stockId: "ab 12" }],
        ["dataset：小寫代碼", { type: "dataset", name: "basic", stockId: "00632r" }],
        ["dataset：過短代碼", { type: "dataset", name: "basic", stockId: "2" }],
        ["dataset：過長代碼", { type: "dataset", name: "basic", stockId: "123456789" }],
        ["dataset：含 URL 編碼字元", { type: "dataset", name: "basic", stockId: "2330%26" }],
        ["dataset：數字型代碼", { type: "dataset", name: "basic", stockId: 2330 }],
        ["dataset：未知資料集", { type: "dataset", name: "finmindVolume", stockId: "2330" }],
        ["dataset：原型屬性名稱", { type: "dataset", name: "toString", stockId: "2330" }],
        ["dataset：缺資料集", { type: "dataset", stockId: "2330" }],
        ["related：limit 為 0", { type: "related", stockId: "2330", extra: {}, limit: 0 }],
        ["related：limit 超過 500", { type: "related", stockId: "2330", extra: {}, limit: 501 }],
        ["related：limit 為負數", { type: "related", stockId: "2330", extra: {}, limit: -1 }],
        ["related：limit 為字串", { type: "related", stockId: "2330", extra: {}, limit: "10" }],
        ["related：limit 為 Infinity", { type: "related", stockId: "2330", extra: {}, limit: Infinity }],
        ["related：缺 limit", { type: "related", stockId: "2330", extra: {} }],
        ["related：不合法代碼", { type: "related", stockId: "2330/../", extra: {}, limit: 5 }],
        ["category：未知類型", { type: "category", categoryType: "其他", name: "x" }],
        ["category：名稱超過 100 字", { type: "category", categoryType: "產業", name: "x".repeat(101) }],
        ["category：名稱非字串", { type: "category", categoryType: "產業", name: ["IC製造"] }],
        ["search：查詢超過 100 字", { type: "search", query: "x".repeat(101) }],
        ["search：查詢非字串", { type: "search", query: 2330 }],
    ];
    for (const [label, value] of cases) {
        test(label, () => assert.equal(parseRequest(value), null));
    }

    test("related：limit 為 NaN 應被拒絕", () => {
        assert.equal(parseRequest({ type: "related", stockId: "2330", extra: {}, limit: Number.NaN }), null);
    });
});
