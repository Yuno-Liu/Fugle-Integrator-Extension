/**
 * UI 元件（src/ui/components.ts）：純函式 HTML 產生器。
 *
 * 以 JSDOM.fragment 解析輸出後做結構斷言；資料盡量取自 tests/fixtures 的真實 API 回應，
 * 並經過 core/esun.ts、core/major.ts、core/market.ts 的正式解析流程。
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fixture } from "../helpers/fixtures";
import {
    basicContent,
    capacityContent,
    categoryChip,
    chipList,
    continuousContent,
    continuousMeta,
    emptyBlock,
    errorBlock,
    etfContent,
    etfUnavailable,
    financeContent,
    investContent,
    majorContent,
    majorMeta,
    parseRevenueMix,
    ratingContent,
    ratingMeta,
    ratingStats,
    ratingStrength,
    relatedContent,
    relationContent,
    relationMeta,
    row,
    stockChip,
    summaryChips,
    type SummaryItem,
} from "../../src/ui/components";
import { parseBasic, parseCapacity, parseEtfHoldings, parseNames, parseRatings, parseRelations } from "../../src/core/esun";
import { parseFinmindVolumes, summarizeMajor, toMajorPeriod, volumeForPeriod } from "../../src/core/major";
import { buildMarketSnapshot, indexMarketList, type MarketIndex } from "../../src/core/market";
import { dateToEpochDay, epochDayMonthsAgo, type TaipeiParts } from "../../src/core/session";
import { LIMITS, MARKET_LISTS, type MarketListId } from "../../src/shared/constants";
import { html, type SafeHtml } from "../../src/utils/html";
import type { BasicInfo, MajorSummary, MarketSnapshot, RatingItem, RelatedCategory, RelatedGroups, RelationItem, Relations } from "../../src/shared/types";

// ============================================================================
// 共用工具
// ============================================================================

function parse(out: SafeHtml | string | null | undefined): DocumentFragment {
    assert.ok(out !== null && out !== undefined, "預期輸出 HTML，實際為 null");
    return JSDOM.fragment(String(out));
}

const text = (node: ParentNode | Element | null | undefined): string => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (root: ParentNode, sel: string): Element[] => Array.from(root.querySelectorAll(sel));
const cells = (tr: Element): string[] => Array.from(tr.querySelectorAll("td")).map((td) => text(td));

const DANGEROUS_TAGS = new Set(["IMG", "SCRIPT", "IFRAME", "OBJECT", "EMBED", "STYLE", "LINK", "META", "FORM", "INPUT", "VIDEO", "AUDIO"]);

/** 資料中的字串不可產生任何元素或事件屬性；且必須以純文字原樣呈現 */
function assertInert(root: DocumentFragment, mustAppearAsText: readonly string[] = []): void {
    for (const el of all(root, "*")) {
        assert.ok(!DANGEROUS_TAGS.has(el.tagName), `資料產生了 <${el.tagName.toLowerCase()}> 元素`);
        for (const attr of Array.from(el.attributes)) {
            assert.ok(!/^on/i.test(attr.name), `資料產生了事件屬性 ${attr.name}`);
            if (attr.name === "href") assert.ok(!/^\s*javascript:/i.test(attr.value), `href 不可為 javascript: (${attr.value})`);
        }
    }
    const content = root.textContent ?? "";
    const titles = all(root, "[title]").map((el) => el.getAttribute("title") ?? "").join("\n");
    for (const s of mustAppearAsText) {
        assert.ok(content.includes(s) || titles.includes(s), `預期以純文字呈現：${s}`);
    }
}

const XSS = {
    img: "<img src=x onerror=alert(1)>",
    script: '"><script>alert(1)</script>',
    dq: '" onmouseover="alert(1)',
    sq: "' onfocus='alert(1)' autofocus='",
    tick: "`${alert(1)}`",
} as const;
const XSS_ALL = Object.values(XSS);

// ============================================================================
// 真實資料（fixtures → core 解析）
// ============================================================================

const BASIC_2330 = parseBasic(fixture("basic-2330.json"))!;
const BASIC_9962 = parseBasic(fixture("basic-9962.json"))!;
const INDUSTRIES = parseNames(fixture("industry-2330.json"));
const CONCEPTS = parseNames(fixture("concept-2330.json"));
const GROUPS = parseNames(fixture("group-2330.json"));
const SUPPLIERS = parseRelations(fixture("relation-suppliers-2330.json"));
const CUSTOMERS = parseRelations(fixture("relation-customers-2330.json"));
const RATINGS = parseRatings(fixture("ratings-2330.json"));
const CAPACITY = parseCapacity(fixture("capacity-2330.json"));
const ETFS = parseEtfHoldings(fixture("etf-2330.synthetic.json"));

/** 2026/11/04 收盤價（取自 market-trustbuy V4） */
const PRICE_2330 = 2260;

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

function marketIndexes(missing: readonly MarketListId[] = []): Record<MarketListId, MarketIndex | undefined> {
    const out = {} as Record<MarketListId, MarketIndex | undefined>;
    for (const id of Object.keys(MARKET_FILES) as MarketListId[]) {
        out[id] = missing.includes(id) ? undefined : indexMarketList(fixture(MARKET_FILES[id]), MARKET_LISTS[id].keyField);
    }
    return out;
}

const snapshot = (stockId: string, missing: readonly MarketListId[] = []): MarketSnapshot => buildMarketSnapshot(stockId, marketIndexes(missing));

function emptyRelations(over: Partial<Relations> = {}): Relations {
    return { suppliers: [], customers: [], rivals: [], alliances: [], investOuts: [], investIns: [], failed: 0, ...over };
}

function basic(over: Partial<BasicInfo> = {}): BasicInfo {
    return {
        fullName: "",
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
        ...over,
    };
}

/** 以玉山欄位格式建立關係企業回應並交給正式解析器 */
const relationsFrom = (rows: Array<[id: string, name: string]>): RelationItem[] =>
    parseRelations({ ResultSet: { Result: rows.map(([V6, V7]) => ({ V1: "2330.TW", V2: "台積電", V6, V7 })) } });

// ============================================================================
// 基礎元件
// ============================================================================

describe("errorBlock / emptyBlock", () => {
    test("errorBlock：role=alert、訊息為純文字、重試按鈕帶 section", () => {
        const f = parse(errorBlock("HTTP 503", "major"));
        const box = f.querySelector(".fi-error");
        assert.equal(box?.getAttribute("role"), "alert");
        assert.match(text(box), /載入失敗：HTTP 503/);
        const btn = f.querySelector("button[data-action='retry']");
        assert.equal(btn?.getAttribute("data-section"), "major");
        assert.equal(btn?.getAttribute("type"), "button");
    });

    test("errorBlock / emptyBlock：惡意訊息不會產生元素", () => {
        for (const p of XSS_ALL) {
            assertInert(parse(errorBlock(p, p)), [p]);
            const btn = parse(errorBlock("x", p)).querySelector("button");
            assert.equal(btn?.getAttribute("data-section"), p);
            assertInert(parse(emptyBlock(p)), [p]);
        }
    });

    test("emptyBlock 以 .fi-empty 呈現訊息", () => {
        const f = parse(emptyBlock("沒有資料"));
        assert.equal(text(f.querySelector(".fi-empty")), "沒有資料");
    });
});

describe("row()", () => {
    test("內容為 null 或空字串時不輸出", () => {
        assert.equal(row("標籤", null), null);
        assert.equal(row("標籤", html``), null);
    });

    test("輸出標籤與內容；有顏色時加上色點", () => {
        const f = parse(row("供應商", html`<b>內容</b>`, "#4c8bf5"));
        assert.equal(text(f.querySelector(".fi-row__label")), "供應商");
        assert.equal(f.querySelector(".fi-row__content b")?.textContent, "內容");
        assert.match(f.querySelector(".fi-dot")?.getAttribute("style") ?? "", /--fi-dot:#4c8bf5/);
        assert.equal(parse(row("無色", html`x`)).querySelector(".fi-dot"), null);
    });

    test("標籤中的 HTML 會被跳脫", () => {
        assertInert(parse(row(XSS.img, html`x`)), [XSS.img]);
    });
});

describe("chipList()", () => {
    const chips = (n: number): SafeHtml[] => Array.from({ length: n }, (_, i) => html`<span class="c">${i}</span>`);

    test("空清單回傳 null", () => {
        assert.equal(chipList([], 5, "k"), null);
    });

    test("數量 ≤ limit 時全部顯示、沒有展開按鈕", () => {
        for (const n of [1, 5]) {
            const f = parse(chipList(chips(n), 5, "k"));
            assert.equal(all(f, ".c").length, n);
            assert.equal(f.querySelector(".fi-more"), null);
            assert.equal(f.querySelector(".fi-overflow"), null);
        }
    });

    test("超過 limit：多出的項目隱藏，展開按鈕以 aria-controls 指向隱藏區塊", () => {
        const f = parse(chipList(chips(7), 5, "concept"));
        const overflow = f.querySelector(".fi-overflow");
        assert.ok(overflow);
        assert.equal(overflow.hasAttribute("hidden"), true);
        assert.equal(overflow.id, "fi-more-concept");
        assert.equal(all(overflow, ".c").length, 2);
        assert.equal(all(f, ".fi-chips > .c").length, 5, "前 5 個在可見區");

        const btn = f.querySelector("button.fi-more");
        assert.ok(btn);
        assert.equal(btn.getAttribute("data-action"), "expand");
        assert.equal(btn.getAttribute("aria-controls"), "fi-more-concept");
        assert.equal(btn.getAttribute("data-target"), "fi-more-concept");
        assert.equal(btn.getAttribute("aria-expanded"), "false");
        assert.equal(text(btn), "顯示全部 7");
    });
});

describe("stockChip / categoryChip", () => {
    test("stockChip：href 為 /ai/<code>、data-fi-nav 帶代號、預設 title", () => {
        const a = parse(stockChip("2330", "台積電")).querySelector("a");
        assert.ok(a);
        assert.equal(a.getAttribute("href"), "/ai/2330");
        assert.equal(a.getAttribute("data-fi-nav"), "2330");
        assert.equal(a.getAttribute("title"), "前往 台積電（2330）");
        assert.equal(text(a.querySelector(".fi-chip__sub")), "2330");
        assert.equal(text(a), "台積電2330");
    });

    test("stockChip：自訂 title；代號經 URL 編碼", () => {
        const a = parse(stockChip("00632R", "元大台灣50反1", "自訂")).querySelector("a");
        assert.equal(a?.getAttribute("title"), "自訂");
        assert.equal(a?.getAttribute("href"), "/ai/00632R");
        const evil = parse(stockChip("../x?y#z", "n")).querySelector("a");
        assert.equal(evil?.getAttribute("href"), "/ai/..%2Fx%3Fy%23z");
    });

    test("stockChip / categoryChip：惡意名稱與代號皆為純文字", () => {
        for (const p of XSS_ALL) {
            const f = parse(stockChip(p, p));
            assertInert(f, [p]);
            const a = f.querySelector("a");
            assert.equal(a?.getAttribute("data-fi-nav"), p);
            assert.ok(a?.getAttribute("href")?.startsWith("/ai/"));

            const c = parse(categoryChip("概念", p, 3));
            assertInert(c, [p]);
            assert.equal(c.querySelector("button")?.getAttribute("data-name"), p);
        }
    });

    test("categoryChip：data-action=category、帶類型與數量", () => {
        const btn = parse(categoryChip("產業", "晶圓代工", 12)).querySelector("button");
        assert.equal(btn?.getAttribute("data-action"), "category");
        assert.equal(btn?.getAttribute("data-type"), "產業");
        assert.equal(btn?.getAttribute("data-name"), "晶圓代工");
        assert.equal(text(btn?.querySelector(".fi-chip__sub")), "12");
        assert.equal(parse(categoryChip("產業", "晶圓代工")).querySelector(".fi-chip__sub"), null);
    });
});

// ============================================================================
// 基本資料
// ============================================================================

describe("parseRevenueMix()", () => {
    test("真實 basic-2330 V5：13 項、依比重遞減、年度 2025年", () => {
        const mix = parseRevenueMix(BASIC_2330.revenueMix);
        assert.ok(mix);
        assert.equal(mix.year, "2025年");
        assert.equal(mix.items.length, 13);
        assert.deepEqual(mix.items[0], { name: "晶圓-5奈米", pct: 30.98 });
        assert.deepEqual(mix.items.at(-1), { name: "晶圓-20奈米", pct: 0.11 });
        const pcts = mix.items.map((i) => i.pct);
        assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a));
        // 名稱中含數字（製程節點）不可被誤判為比重
        assert.ok(mix.items.some((i) => i.name === "晶圓-0.15及0.18微米" && i.pct === 2.32));
        assert.ok(mix.items.some((i) => i.name === "晶圓-40及45奈米" && i.pct === 2.51));
        assert.ok(mix.items.some((i) => i.name === "晶圓-0.25微米以上" && i.pct === 0.51));
        assert.ok(mix.items.some((i) => i.name === "其他" && i.pct === 14.08));
        const total = pcts.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(total - 100) < 0.05, `比重合計約 100%（實際 ${total}）`);
    });

    const cases: Array<[label: string, input: string, expected: ReturnType<typeof parseRevenueMix>]> = [
        ["單一項目（basic-9962）", BASIC_9962.revenueMix, { items: [{ name: "不銹鋼板", pct: 100 }], year: "2025年" }],
        ["全形括號年度", "A產品60%、B產品40%（2024年）", { items: [{ name: "A產品", pct: 60 }, { name: "B產品", pct: 40 }], year: "2024年" }],
        ["無年度、逗號分隔、% 前有空白", "記憶體 25.5 %，其他74.5%", { items: [{ name: "其他", pct: 74.5 }, { name: "記憶體", pct: 25.5 }], year: null }],
        ["名稱尾端為數字", "晶圓-0.15及0.18微米2.32%", { items: [{ name: "晶圓-0.15及0.18微米", pct: 2.32 }], year: null }],
        ["無法解析的文字", "主要經營晶圓代工業務", null],
        ["只有年度", "(2025年)", null],
        ["空字串", "", null],
    ];
    for (const [label, input, expected] of cases) {
        test(label, () => {
            assert.deepEqual(parseRevenueMix(input), expected);
        });
    }
});

describe("basicContent()", () => {
    const content = (): DocumentFragment => parse(basicContent(BASIC_2330, INDUSTRIES, CONCEPTS));
    const rowByLabel = (f: DocumentFragment, label: string): Element | undefined => all(f, ".fi-row").find((r) => text(r.querySelector(".fi-row__label")) === label);

    test("沒有任何資料時回傳 null", () => {
        assert.equal(basicContent(null, [], []), null);
        assert.equal(basicContent(basic(), [], []), null);
    });

    test("列順序：營收比重、產業、概念、經營、日期、官網", () => {
        const labels = all(content(), ".fi-row__label").map((l) => text(l));
        assert.deepEqual(labels, ["營收比重", "產業", "概念", "經營", "日期", "官網"]);
    });

    test("營收比重：前 5 項顯示、其餘 8 項收合；年度註記", () => {
        const r = rowByLabel(content(), "營收比重")!;
        const visible = all(r, ".fi-mix > .fi-mix__row");
        assert.equal(visible.length, 5);
        assert.equal(text(visible[0]?.querySelector(".fi-mix__name")), "晶圓-5奈米");
        assert.equal(text(visible[0]?.querySelector(".fi-mix__pct")), "30.98%");
        const overflow = r.querySelector(".fi-overflow");
        assert.equal(overflow?.hasAttribute("hidden"), true);
        assert.equal(all(overflow!, ".fi-mix__row").length, 8);
        assert.equal(text(r.querySelector("button.fi-more")), "其他 8 項");
        assert.equal(text(r.querySelector(".fi-note")), "資料年度：2025年");
        // 長條寬度皆為合法百分比
        for (const fill of all(r, ".fi-mix__fill")) assert.match(fill.getAttribute("style") ?? "", /^width:\d+(\.\d)?%$/);
    });

    test("營收比重無法解析時原樣顯示文字", () => {
        const f = parse(basicContent(basic({ revenueMix: "主要經營晶圓代工" }), [], []));
        assert.equal(f.querySelector(".fi-mix"), null);
        assert.equal(text(f.querySelector(".fi-row__content")), "主要經營晶圓代工");
    });

    test("產業為分類按鈕（保留原順序）", () => {
        const btns = all(rowByLabel(content(), "產業")!, "button.fi-chip");
        assert.deepEqual(
            btns.map((b) => b.getAttribute("data-name")),
            ["IC生產", "IC製造", "晶圓代工"]
        );
        for (const b of btns) {
            assert.equal(b.getAttribute("data-action"), "category");
            assert.equal(b.getAttribute("data-type"), "產業");
        }
    });

    test("概念依 zh-Hant 排序、超過上限收合，且不修改輸入陣列", () => {
        const input = [...CONCEPTS];
        const r = rowByLabel(content(), "概念")!;
        const names = all(r, "button.fi-chip").map((b) => b.getAttribute("data-name"));
        assert.equal(names.length, CONCEPTS.length);
        assert.deepEqual(names, [...CONCEPTS].sort((a, b) => a.localeCompare(b, "zh-Hant")));
        assert.notDeepEqual(names, CONCEPTS, "原始順序與排序後不同（排序確實發生）");
        assert.deepEqual(CONCEPTS, input);
        // 中文名稱依筆畫：人(2) < 台(5) < 碳(14)
        const idx = (n: string): number => names.indexOf(n);
        assert.ok(idx("人工智慧AI概念股") < idx("台積電概念股"));
        assert.ok(idx("台積電概念股") < idx("碳權概念股"));
        for (const b of all(r, "button.fi-chip")) assert.equal(b.getAttribute("data-type"), "概念");

        assert.equal(all(r, ".fi-chips > button.fi-chip").length, LIMITS.chips);
        assert.equal(text(r.querySelector("button.fi-more")), `顯示全部 ${CONCEPTS.length}`);
        assert.equal(r.querySelector("button.fi-more")?.getAttribute("aria-controls"), "fi-more-concept");
    });

    test("經營與日期列", () => {
        const f = content();
        assert.equal(text(rowByLabel(f, "經營")?.querySelector(".fi-row__content")), "董事長 魏哲家 · 總經理 魏哲家");
        assert.equal(text(rowByLabel(f, "日期")?.querySelector(".fi-row__content")), "成立 1987/02/21 · 上市櫃 1994/09/05");
        const partial = parse(basicContent(basic({ president: "張睿芯", listedDate: "2006/07/10" }), [], []));
        assert.equal(text(rowByLabel(partial, "經營")?.querySelector(".fi-row__content")), "總經理 張睿芯");
        assert.equal(text(rowByLabel(partial, "日期")?.querySelector(".fi-row__content")), "上市櫃 2006/07/10");
    });

    test("官網：新分頁開啟、rel=noopener、顯示去除協定的網址", () => {
        const a = rowByLabel(content(), "官網")?.querySelector("a");
        assert.equal(a?.getAttribute("href"), "https://www.tsmc.com/");
        assert.equal(a?.getAttribute("target"), "_blank");
        assert.match(a?.getAttribute("rel") ?? "", /noopener/);
        assert.equal(text(a), "www.tsmc.com ↗");
    });

    test("官網僅允許 http(s)：javascript: / data: 不輸出", () => {
        for (const website of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "  JaVaScRiPt:alert(1)"]) {
            const f = parse(basicContent(basic({ website, chairman: "x" }), [], []));
            assert.equal(rowByLabel(f, "官網"), undefined, website);
            assertInert(f);
        }
    });

    test("XSS：營收、分類、人名、網址中的惡意字串不會產生元素或屬性", () => {
        for (const p of XSS_ALL) {
            const b = basic({
                revenueMix: `${p}60%、其他40% (2025年)`,
                chairman: p,
                president: p,
                foundedDate: p,
                listedDate: p,
                website: `https://evil.example/${p}`,
            });
            const f = parse(basicContent(b, [p], [p]));
            assertInert(f, [p]);
            const a = rowByLabel(f, "官網")?.querySelector("a");
            assert.ok(a?.getAttribute("href")?.startsWith("https://evil.example/"));
            // 無法解析的營收字串同樣以純文字呈現
            assertInert(parse(basicContent(basic({ revenueMix: p }), [], [])), [p]);
        }
    });
});

// ============================================================================
// 主力買賣
// ============================================================================

describe("majorContent() — 真實 major1 / major5", () => {
    const raw1 = summarizeMajor(fixture("major1-2330.json"))!;
    const raw5 = summarizeMajor(fixture("major5-2330.json"))!;
    const p1 = toMajorPeriod(raw1, 1)!;
    const p5 = toMajorPeriod(raw5, 5)!;
    const summary: MajorSummary = { periods: [p1, null, p5, null, null] };

    test("前提：real data 計算值", () => {
        assert.equal(raw1.netBuy, 12_728_481);
        assert.equal(raw1.netSell, -24_367_496);
        assert.equal(p1.ratio, -21.73);
        assert.equal(p5.ratio, -17.84);
    });

    test("五列：主1/主3/主5/主10/主20，數值以張為單位", () => {
        const f = parse(majorContent(summary));
        const rows = all(f, "tbody tr");
        assert.equal(rows.length, 5);
        assert.deepEqual(rows.map((r) => cells(r)[0]), ["主1", "主3", "主5", "主10", "主20"]);
        assert.deepEqual(cells(rows[0]!).slice(1, 5), ["12,728", "24,367", "-11,639", "-21.73%"]);
        assert.deepEqual(cells(rows[2]!).slice(1, 5), ["31,066", "65,070", "-34,004", "-17.84%"]);
        assert.equal(rows[0]!.getAttribute("title"), "區間成交量 53,552 張");
    });

    test("顏色：買超紅、賣超綠、淨額與占比依正負", () => {
        const tds = all(parse(majorContent(summary)), "tbody tr")[0]!.querySelectorAll("td");
        assert.ok(tds[1]?.classList.contains("fi-up"));
        assert.ok(tds[2]?.classList.contains("fi-down"));
        assert.ok(tds[3]?.classList.contains("fi-down"));
        assert.ok(tds[4]?.classList.contains("fi-down"));
        assert.ok(tds[5]?.querySelector(".fi-bar__fill--down"));
    });

    test("缺資料的區間顯示 — 並套用 muted 樣式", () => {
        const rows = all(parse(majorContent(summary)), "tbody tr");
        for (const i of [1, 3, 4]) {
            assert.ok(rows[i]!.classList.contains("fi-table__muted"));
            assert.deepEqual(cells(rows[i]!).slice(1, 5), ["—", "—", "—", "—"]);
        }
    });

    test("正值占比帶 + 號、長條往上", () => {
        const pos = toMajorPeriod({ date: "2026/11/04", netBuy: 30_000_000, netSell: -10_000_000, volume: 100_000_000 }, 1)!;
        const tr = all(parse(majorContent({ periods: [pos, null, null, null, null] })), "tbody tr")[0]!;
        assert.deepEqual(cells(tr).slice(1, 5), ["30,000", "10,000", "+20,000", "+20.00%"]);
        assert.ok(tr.querySelector(".fi-bar__fill--up"));
    });

    test("附註：資料日與公式；全部來自玉山時沒有 FinMind 說明", () => {
        const note = text(parse(majorContent(summary)).querySelector(".fi-note"));
        assert.match(note, /^資料日 2026\/11\/04/);
        assert.doesNotMatch(note, /FinMind/);
    });

    test("分母改用 FinMind 時附註說明", () => {
        const series = parseFinmindVolumes(fixture("finmind-2330.json"));
        const fallback = volumeForPeriod(series, raw1.date, 1);
        assert.equal(fallback, 53_879_371);
        const p = toMajorPeriod({ ...raw1, volume: null }, 1, fallback)!;
        assert.equal(p.volumeSource, "finmind");
        const f = parse(majorContent({ periods: [p, null, p5, null, null] }));
        assert.match(text(f.querySelector(".fi-note")), /部分區間成交量取自 FinMind/);
    });

    test("全部區間皆無資料 → null；majorMeta", () => {
        assert.equal(majorContent({ periods: [null, null, null, null, null] }), null);
        assert.equal(majorMeta(summary), "主1 -21.73%");
        assert.equal(majorMeta({ periods: [null, null, p5, null, null] }), "");
    });

    test("不出現 NaN / undefined", () => {
        const out = String(majorContent(summary));
        assert.doesNotMatch(out, /NaN|undefined/);
    });
});

// ============================================================================
// 法人連續買賣超
// ============================================================================

describe("continuousContent() / continuousMeta() — 真實 market 清單", () => {
    const rowsOf = (m: MarketSnapshot): Element[] => all(parse(continuousContent(m)), "tbody tr");

    test("2330：投信連買 24 天、外資連賣 19 天（天數不帶負號）", () => {
        const m = snapshot("2330");
        const [trust, foreign] = rowsOf(m);
        assert.deepEqual(cells(trust!), ["投信", "3.92%", "連買 24 天", "+3,715 張", "+84.33 億"]);
        assert.deepEqual(cells(foreign!), ["外資", "68.31%", "連賣 19 天", "-21,604 張", "-490.35 億"]);
        assert.doesNotMatch(text(foreign), /連賣 -/);
        assert.ok(trust!.querySelector(".fi-up"));
        assert.ok(foreign!.querySelector(".fi-down"));
        assert.equal(trust!.querySelector(".fi-badge"), null, "延續（V10、V11 同號）不顯示轉向");
        assert.equal(text(parse(continuousContent(m)).querySelector(".fi-note")), "資料日 2026/11/04");
        assert.equal(continuousMeta(m), "投信連買24 · 外資連賣19");
    });

    const turned: Array<[stock: string, streak: string, badge: string, title: string]> = [
        ["2801", "連賣 1 天", "轉賣", "前一日為連買 3 天"],
        ["8150", "連買 1 天", "轉買", "前一日為連賣 1 天"],
        ["2303", "連買 1 天", "轉買", "前一日為連賣 9 天"],
    ];
    for (const [stock, streak, badgeText, title] of turned) {
        test(`${stock}：${streak} + ${badgeText} 標記（${title}）`, () => {
            const trust = rowsOf(snapshot(stock))[0]!;
            const cell = trust.querySelectorAll("td")[2]!;
            assert.match(text(cell), new RegExp(`^${streak}`));
            const badge = cell.querySelector(".fi-badge");
            assert.equal(text(badge), badgeText);
            assert.equal(badge?.getAttribute("title"), title);
            assert.ok(badge?.classList.contains(badgeText === "轉買" ? "fi-badge--up" : "fi-badge--down"));
        });
    }

    test("2105：延續連賣 9 天，無轉向標記；小金額以「萬」顯示", () => {
        const trust = rowsOf(snapshot("2105"))[0]!;
        assert.deepEqual(cells(trust).slice(2), ["連賣 9 天", "-353 張", "-1,074.2 萬"]);
        assert.equal(trust.querySelector(".fi-badge"), null);
    });

    test("不在排行中（清單已載入，但沒有這檔）：顯示 —；只有持股比也會輸出", () => {
        const indexes = marketIndexes();
        for (const id of ["trustBuy", "trustSell", "foreignBuy", "foreignSell"] as const) indexes[id] = new Map();
        const m = buildMarketSnapshot("2330", indexes);
        const [trust, foreign] = rowsOf(m);
        assert.deepEqual(cells(trust!), ["投信", "3.92%", "—", "—", "—"]);
        assert.deepEqual(cells(foreign!), ["外資", "68.31%", "—", "—", "—"]);
        assert.equal(parse(continuousContent(m)).querySelector(".fi-note"), null);
        assert.equal(continuousMeta(m), "");
    });

    test("連買連賣清單載入失敗：顯示「暫缺」並附註，不會誤判為不在排行中", () => {
        const m = snapshot("2330", ["trustBuy", "trustSell", "foreignBuy", "foreignSell"]);
        const [trust, foreign] = rowsOf(m);
        assert.deepEqual(cells(trust!), ["投信", "3.92%", "暫缺", "—", "—"]);
        assert.deepEqual(cells(foreign!), ["外資", "68.31%", "暫缺", "—", "—"]);
        const notes = [...parse(continuousContent(m)).querySelectorAll(".fi-note")].map((n) => n.textContent ?? "");
        assert.ok(notes.some((n) => /載入失敗/.test(n)), notes.join(" | "));
    });

    test("持股比清單載入失敗：持股比欄顯示「暫缺」", () => {
        const m = snapshot("2330", ["trustHold"]);
        const [trust] = rowsOf(m);
        assert.equal(cells(trust!)[1], "暫缺");
    });

    test("所有法人清單都失敗：仍顯示表格（全部暫缺）而不是整個區塊消失", () => {
        const m = snapshot("9999", ["trustBuy", "trustSell", "foreignBuy", "foreignSell", "trustHold", "foreignHold"]);
        assert.notEqual(continuousContent(m), null);
    });

    test("完全沒有資料 → null", () => {
        assert.equal(continuousContent(snapshot("9999")), null);
        assert.equal(continuousMeta(snapshot("9999")), "");
    });
});

// ============================================================================
// 關係企業 / 投資佈局
// ============================================================================

describe("relationContent / investContent / relationMeta", () => {
    const REL = emptyRelations({ suppliers: SUPPLIERS, customers: CUSTOMERS });
    const rowByLabel = (f: DocumentFragment, label: string): Element | undefined => all(f, ".fi-row").find((r) => text(r.querySelector(".fi-row__label")) === label);

    test("真實資料：集團為分類按鈕、供應商（含 .TE 上櫃）為富果連結", () => {
        const f = parse(relationContent(GROUPS, REL, "2330"));
        assert.deepEqual(all(f, ".fi-row__label").map((l) => text(l)), ["集團", "供應商", "客戶"]);
        const g = rowByLabel(f, "集團")!.querySelector("button");
        assert.equal(g?.getAttribute("data-type"), "集團");
        assert.equal(g?.getAttribute("data-name"), "台積電集團");

        const sup = all(rowByLabel(f, "供應商")!, "a.fi-chip");
        assert.equal(sup.length, 11, "重複列已去除");
        const te = sup.find((a) => a.getAttribute("data-fi-nav") === "4537");
        assert.equal(te?.getAttribute("href"), "/ai/4537");
        assert.ok(rowByLabel(f, "供應商")!.querySelector(".fi-dot"));
    });

    test("非台股：不可連結、顯示「代號.交易所」標籤", () => {
        const f = parse(relationContent([], REL, "2330"));
        const cust = rowByLabel(f, "客戶")!;
        const plain = all(cust, ".fi-chip--plain");
        assert.equal(plain.length, 6);
        for (const el of plain) {
            assert.equal(el.tagName, "SPAN");
            assert.equal(el.closest("a"), null);
            assert.equal(el.hasAttribute("href"), false);
        }
        const apple = plain.find((el) => text(el).startsWith("Apple"))!;
        assert.equal(text(apple.querySelector(".fi-chip__sub")), "AAPL.US");
        assert.match(apple.getAttribute("title") ?? "", /非台股（AAPL\.US）/);
        assert.deepEqual(all(cust, "a.fi-chip").map((a) => a.getAttribute("data-fi-nav")), ["2379", "2388", "2454", "2458"]);
    });

    test("其他交易所 / 無後綴代號", () => {
        const items = relationsFrom([
            ["600000.SH", "浦發銀行"],
            ["0700.HK", "騰訊"],
            ["SAMSUNG", "三星"],
            ["6488.TE", "環球晶"],
        ]);
        const f = parse(relationContent([], emptyRelations({ rivals: items }), "2330"));
        const r = rowByLabel(f, "競爭對手")!;
        assert.deepEqual(all(r, ".fi-chip--plain .fi-chip__sub").map((s) => text(s)), ["600000.SH", "0700.HK", "SAMSUNG"]);
        assert.deepEqual(all(r, "a.fi-chip").map((a) => a.getAttribute("href")), ["/ai/6488"]);
    });

    test("目前個股本身不是連結", () => {
        const items = relationsFrom([["2330.TW", "台積電"], ["2303.TW", "聯電"]]);
        const f = parse(relationContent([], emptyRelations({ alliances: items }), "2330"));
        const self = f.querySelector(".fi-chip--self");
        assert.ok(self);
        assert.equal(self.tagName, "SPAN");
        assert.equal(text(self), "台積電2330");
        assert.equal(all(f, "a.fi-chip").length, 1);
        assert.equal(all(f, "a[href='/ai/2330']").length, 0);
    });

    test("超過上限時收合並提供 aria-controls 展開按鈕", () => {
        const items = relationsFrom(Array.from({ length: LIMITS.chips + 3 }, (_, i): [string, string] => [`${1000 + i}.TW`, `公司${i}`]));
        const f = parse(relationContent([], emptyRelations({ suppliers: items }), "2330"));
        const btn = f.querySelector("button.fi-more");
        assert.equal(btn?.getAttribute("aria-controls"), "fi-more-rel-suppliers");
        assert.equal(all(f.querySelector("#fi-more-rel-suppliers")!, "a").length, 3);
    });

    test("部分失敗附註；全部為空 → null", () => {
        const f = parse(relationContent(GROUPS, emptyRelations({ suppliers: SUPPLIERS, failed: 2 }), "2330"));
        assert.equal(text(all(f, ".fi-note").at(-1)), "部分關係資料載入失敗（2 類）");
        assert.equal(relationContent([], emptyRelations(), "2330"), null);
        assert.equal(relationContent([], null, "2330"), null);
        // 只有集團、沒有關係資料（null）仍可輸出
        assert.ok(relationContent(GROUPS, null, "2330"));
        assert.equal(parse(relationContent(GROUPS, emptyRelations(), "2330")).querySelector(".fi-note"), null);
    });

    test("investContent：轉投資 / 被投資；空 → null", () => {
        const outs = relationsFrom([["2330.TW", "台積電"], ["3443.TW", "創意"], ["TSMCAZ.US", "TSMC Arizona"]]);
        const ins = relationsFrom([["0050.TW", "元大台灣50"]]);
        const f = parse(investContent(emptyRelations({ investOuts: outs, investIns: ins })));
        assert.deepEqual(all(f, ".fi-row__label").map((l) => text(l)), ["轉投資", "被投資"]);
        // 投資關係不判斷「目前個股」，台股皆可連結
        assert.equal(f.querySelector(".fi-chip--self"), null);
        assert.equal(all(f, "a.fi-chip").length, 3);
        assert.equal(investContent(emptyRelations()), null);
    });

    test("relationMeta：四類關係家數合計（不含投資）", () => {
        assert.equal(relationMeta(REL), "21 家");
        assert.equal(relationMeta(emptyRelations({ investOuts: SUPPLIERS })), "");
        assert.equal(relationMeta(null), "");
        assert.equal(parseRelations(fixture("relation-empty.json")).length, 0);
    });

    test("XSS：關係企業名稱、代號、交易所", () => {
        for (const p of XSS_ALL) {
            const items: RelationItem[] = [
                { code: p, name: p, exchange: "US", isTaiwan: false },
                { code: p, name: p, exchange: "TW", isTaiwan: true },
                { code: "2330", name: p, exchange: "TW", isTaiwan: true },
                { code: "X", name: p, exchange: p, isTaiwan: false },
            ];
            const rel = emptyRelations({ suppliers: items, customers: items, rivals: items, alliances: items, investOuts: items, investIns: items, failed: 1 });
            assertInert(parse(relationContent([p], rel, "2330")), [p]);
            assertInert(parse(investContent(rel)), [p]);
        }
    });
});

// ============================================================================
// 機構評等
// ============================================================================

describe("ratingStrength()", () => {
    const cases: Array<[rating: string, expected: number | null]> = [
        ["強力買進", 5],
        ["強烈買進", 5],
        ["Strong Buy", 5],
        ["買進", 4],
        ["加碼", 4],
        ["優於大盤", 4],
        ["Outperform", 4],
        ["Overweight", 4],
        ["BUY", 4],
        ["中立", 3],
        ["持有", 3],
        ["區間操作", 3],
        ["中性", 3],
        ["Neutral", 3],
        ["Market Perform", 3],
        ["Equal Weight", 3],
        ["減碼", 2],
        ["劣於大盤", 2],
        ["Underperform", 2],
        ["Underweight", 2],
        ["賣出", 1],
        ["Sell", 1],
        ["", null],
        ["   ", null],
        ["未評等", null],
    ];
    for (const [rating, expected] of cases) {
        test(`${JSON.stringify(rating)} → ${expected}`, () => {
            assert.equal(ratingStrength(rating), expected);
        });
    }

    test("強度順序：強力買進 > 買進 > 中立 > 減碼 > 賣出", () => {
        const order = ["強力買進", "買進", "中立", "減碼", "賣出"].map(ratingStrength) as number[];
        assert.deepEqual(order, [...order].sort((a, b) => b - a));
    });
});

const TODAY: TaipeiParts = { year: 2026, month: 11, day: 5, hour: 10, minute: 0, second: 0, weekday: 4 };
const CUTOFF = epochDayMonthsAgo(TODAY, LIMITS.ratingMonths);

const rating = (date: string, broker: string, r: string, target: number | null, previous = ""): RatingItem => ({ date, broker, rating: r, target, previous });

describe("ratingStats()", () => {
    test("6 個月區間：2026/05/05 起算（含當日）", () => {
        assert.equal(CUTOFF, dateToEpochDay("2026/05/05"));
        const list = [rating("2026/10/16", "A", "買進", 3000), rating("2026/05/05", "B", "買進", 2000), rating("2026/05/04", "C", "買進", 9999), rating("壞日期", "D", "買進", 9999)];
        const s = ratingStats(list, CUTOFF);
        assert.deepEqual(s.recent.map((r) => r.broker), ["A", "B"]);
        assert.equal(s.count, 2);
        assert.equal(s.max, 3000);
        assert.equal(s.min, 2000);
        assert.equal(s.avg, 2500);
    });

    test("月底夾到該月最後一天（8/31 往前 6 個月 → 2/28）", () => {
        const cutoff = epochDayMonthsAgo({ ...TODAY, month: 8, day: 31 }, 6);
        assert.equal(cutoff, dateToEpochDay("2026/02/28"));
    });

    test("目標價為 null 或 ≤ 0 不列入統計", () => {
        const s = ratingStats([rating("2026/10/01", "A", "買進", null), rating("2026/10/01", "B", "買進", 0), rating("2026/10/01", "C", "買進", 100)], CUTOFF);
        assert.equal(s.count, 3);
        assert.deepEqual([s.min, s.max, s.avg], [100, 100, 100]);
        const none = ratingStats([rating("2026/10/01", "A", "中立", null)], CUTOFF);
        assert.deepEqual([none.count, none.min, none.max, none.avg], [1, null, null, null]);
    });

    test("真實 ratings-2330：8 筆，平均 3,356、最高 3,560、最低 3,250", () => {
        const s = ratingStats(RATINGS, CUTOFF);
        assert.equal(s.count, 8);
        assert.equal(s.avg, 3356);
        assert.equal(s.max, 3560);
        assert.equal(s.min, 3250);
    });
});

describe("ratingContent()", () => {
    test("真實資料摘要：平均目標價與相對現價的潛在空間", () => {
        const f = parse(ratingContent(RATINGS, PRICE_2330, CUTOFF, 6));
        const summary = text(f.firstElementChild);
        assert.match(summary, /^近 6 個月 8 筆/);
        assert.match(summary, /平均目標價 3,356\.00 \(\+48\.5%\)/);
        assert.match(summary, /最高 3,560\.00 \(\+57\.5%\)/);
        assert.match(summary, /最低 3,250\.00 \(\+43\.8%\)/);
        const range = f.querySelector(".fi-range");
        assert.ok(range);
        assert.ok(range.querySelector(".fi-range__now"), "有現價時標示現價位置");
        assert.equal(ratingMeta(RATINGS, PRICE_2330, CUTOFF), "8 筆 · 均價 +48.5%");
    });

    test("真實資料表格：同日只顯示一次日期、目標價、潛在空間", () => {
        const rows = all(parse(ratingContent(RATINGS, PRICE_2330, CUTOFF, 6)), "tbody tr");
        assert.equal(rows.length, 8);
        assert.deepEqual(cells(rows[0]!), ["2026/10/16", "康和投顧", "買進", "3,560", "+57.5%"]);
        assert.equal(cells(rows[1]!)[0], "", "同一天的後續列不重複日期");
        assert.ok(rows[0]!.querySelectorAll("td")[4]?.classList.contains("fi-up"));
    });

    test("第一金投顧：區間操作 → 買進 為 ▲ 調升", () => {
        const rows = all(parse(ratingContent(RATINGS, PRICE_2330, CUTOFF, 6)), "tbody tr");
        const first = rows.find((r) => cells(r)[1] === "第一金投顧")!;
        const badge = first.querySelector(".fi-badge");
        assert.equal(text(badge), "▲ 調升");
        assert.ok(badge?.classList.contains("fi-badge--up"));
        assert.equal(badge?.getAttribute("title"), "前次：區間操作");
        // 其他前次與本次相同 → 無標記
        assert.equal(all(parse(ratingContent(RATINGS, PRICE_2330, CUTOFF, 6)), ".fi-badge").length, 1);
    });

    const changes: Array<[label: string, now: string, prev: string, badge: string | null, cls: string | null]> = [
        ["調降", "中立", "買進", "▼ 調降", "fi-badge--down"],
        ["調升（英文）", "Buy", "Neutral", "▲ 調升", "fi-badge--up"],
        ["同強度不同用語 → 變更", "加碼", "買進", "變更", null],
        ["未知評等 → 變更", "Trading Buy", "買進", "變更", null],
        ["無前次評等", "買進", "", null, null],
        ["相同", "買進", "買進", null, null],
    ];
    for (const [label, now, prev, badgeText, cls] of changes) {
        test(`評等變化：${label}`, () => {
            const f = parse(ratingContent([rating("2026/10/01", "X", now, 100, prev)], 100, CUTOFF, 6));
            const badge = f.querySelector("tbody .fi-badge");
            if (badgeText === null) {
                assert.equal(badge, null);
                return;
            }
            assert.equal(text(badge), badgeText);
            if (cls) assert.ok(badge?.classList.contains(cls));
            else assert.ok(!badge?.classList.contains("fi-badge--up") && !badge?.classList.contains("fi-badge--down"));
        });
    }

    test("近 N 個月無評等 → 空狀態文字", () => {
        const old = [rating("2025/01/01", "A", "買進", 100)];
        const f = parse(ratingContent(old, 100, CUTOFF, 6));
        assert.equal(text(f.querySelector(".fi-empty")), "近 6 個月無機構評等");
        assert.equal(f.querySelector("table"), null);
        assert.equal(text(parse(ratingContent([], null, CUTOFF, 3)).querySelector(".fi-empty")), "近 3 個月無機構評等");
        assert.equal(ratingMeta(old, 100, CUTOFF), "");
    });

    test(`超過 ${LIMITS.ratings} 筆：多出的列放在隱藏 tbody，並提供展開按鈕`, () => {
        const list = Array.from({ length: LIMITS.ratings + 3 }, (_, i) => rating(`2026/10/${String(20 - i).padStart(2, "0")}`, `券商${i}`, "買進", 100 + i));
        const f = parse(ratingContent(list, 100, CUTOFF, 6));
        const bodies = all(f, "table tbody");
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0]!.querySelectorAll("tr").length, LIMITS.ratings);
        assert.equal(bodies[1]!.id, "fi-more-ratings");
        assert.ok(bodies[1]!.hasAttribute("hidden"));
        assert.equal(bodies[1]!.querySelectorAll("tr").length, 3);
        const btn = f.querySelector("button.fi-more");
        assert.equal(btn?.getAttribute("data-target"), "fi-more-ratings");
        assert.equal(text(btn), `顯示全部 ${LIMITS.ratings + 3} 筆`);
        // 剛好上限時沒有展開
        assert.equal(parse(ratingContent(list.slice(0, LIMITS.ratings), 100, CUTOFF, 6)).querySelector("button.fi-more"), null);
    });

    test("價格為 null：沒有潛在空間、不標示現價，也不出現 NaN", () => {
        const out = ratingContent(RATINGS, null, CUTOFF, 6);
        const f = parse(out);
        assert.doesNotMatch(String(out), /NaN|undefined|Infinity/);
        assert.doesNotMatch(text(f.firstElementChild), /%/);
        assert.equal(f.querySelector(".fi-range__now"), null);
        assert.ok(f.querySelector(".fi-range__avg"));
        for (const r of all(f, "tbody tr")) assert.equal(cells(r)[4], "—");
        assert.equal(ratingMeta(RATINGS, null, CUTOFF), "8 筆");
    });

    test("全部無目標價：摘要只顯示筆數，目標價欄為 —；小數目標價保留 2 位", () => {
        const f = parse(ratingContent([rating("2026/10/01", "A", "中立", null)], 100, CUTOFF, 6));
        assert.equal(text(f.firstElementChild), "近 6 個月 1 筆評等");
        assert.equal(f.querySelector(".fi-range"), null);
        assert.deepEqual(cells(all(f, "tbody tr")[0]!).slice(3), ["—", "—"]);
        const dec = parse(ratingContent([rating("2026/10/01", "A", "買進", 123.5)], 100, CUTOFF, 6));
        assert.equal(cells(all(dec, "tbody tr")[0]!)[3], "123.50");
    });

    test("XSS：券商、評等、前次評等", () => {
        for (const p of XSS_ALL) {
            const f = parse(ratingContent([rating("2026/10/01", p, p, 100, `${p}x`), rating("2026/10/01", "B", "買進", 120, p)], 110, CUTOFF, 6));
            assertInert(f, [p]);
        }
    });
});

// ============================================================================
// ETF 持股
// ============================================================================

describe("etfContent() / etfUnavailable()", () => {
    test("合併 FindBillion 持股：檔數、合計張數、占發行股數比", () => {
        assert.equal(ETFS.length, 5, "無 symbol 的列已排除");
        const f = parse(etfContent(ETFS, BASIC_2330));
        const head = text(f.firstElementChild);
        // 合計 1,846,913,577 股 = 184.69 萬張；÷ 25,932,370 千股 = 7.12%
        assert.equal(head, "共 5 檔 ETF 持有 · 合計 184.69 萬張 · 約占發行股數 7.12%");
    });

    test("沒有發行股數時省略占比", () => {
        const head = text(parse(etfContent(ETFS, null)).firstElementChild);
        assert.doesNotMatch(head, /發行股數/);
        assert.doesNotMatch(text(parse(etfContent(ETFS, basic({ sharesThousand: 0 }))).firstElementChild), /發行股數/);
    });

    test("表格：每列為富果連結 + 名稱、權重、持有張數（直接顯示，不必滑鼠移上）", () => {
        const f = parse(etfContent(ETFS, BASIC_2330));
        const rows = all(f, "tbody tr");
        const links = rows.map((r) => r.querySelector("a.fi-link"));
        assert.deepEqual(
            links.map((a) => a?.getAttribute("data-fi-nav")),
            ["0050", "006208", "00881", "00692", "00878"]
        );
        assert.equal(links[0]!.getAttribute("href"), "/ai/0050");
        assert.deepEqual(
            [...rows[0]!.querySelectorAll("td")].map((td) => text(td)),
            ["0050 元大台灣50", "61.23%", "131.23 萬張"]
        );
        assert.deepEqual(
            [...rows[2]!.querySelectorAll("td")].map((td) => text(td)),
            ["00881 國泰台灣5G+", "30.12%", "9.88 萬張"]
        );
        // 空名稱以代號代替時不重複顯示代號
        assert.equal(text(rows[3]!.querySelector("td")), "00692");
        // 未滿 1 萬張以「張」表示
        const small = parse(etfContent([{ symbol: "00900", name: "小型", ratio: 0.5, shares: 9_876_543 }], null));
        assert.deepEqual(
            [...small.querySelectorAll("tbody td")].map((td) => text(td)),
            ["00900 小型", "0.50%", "9,877 張"]
        );
        assert.doesNotMatch(String(etfContent(ETFS, BASIC_2330)), /NaN|undefined/);
    });

    test(`超過 ${LIMITS.etf} 檔時收合`, () => {
        const many = Array.from({ length: LIMITS.etf + 2 }, (_, i) => ({ symbol: `00${900 + i}`, name: `ETF${i}`, ratio: 1, shares: 1000 * (100 - i) }));
        const f = parse(etfContent(many, BASIC_2330));
        assert.equal(f.querySelector("button.fi-more")?.getAttribute("aria-controls"), "fi-more-etf");
        const overflow = f.querySelector("#fi-more-etf")!;
        assert.equal(overflow.tagName, "TBODY");
        assert.ok(overflow.hasAttribute("hidden"));
        assert.equal(all(overflow, "a").length, 2);
        assert.equal(all(f, "tbody:not([hidden]) tr").length, LIMITS.etf);
    });

    test("空清單 → null", () => {
        assert.equal(etfContent([], BASIC_2330), null);
    });

    test("etfUnavailable：連到 FindBillion 頁面並可重試", () => {
        const f = parse(etfUnavailable("2330"));
        const a = f.querySelector("a");
        assert.equal(a?.getAttribute("href"), "https://www.findbillion.com/twstock/2330/etf");
        assert.equal(a?.getAttribute("target"), "_blank");
        assert.match(a?.getAttribute("rel") ?? "", /noopener/);
        assert.match(text(a), /持有 2330 的 ETF/);
        const btn = f.querySelector("button[data-action='retry']");
        assert.equal(btn?.getAttribute("data-section"), "etf");
    });

    test("XSS：ETF 名稱、代號與 etfUnavailable 的代號", () => {
        for (const p of XSS_ALL) {
            assertInert(parse(etfContent([{ symbol: p, name: p, ratio: 1, shares: 5000 }], BASIC_2330)), [p]);
            const f = parse(etfUnavailable(p));
            assertInert(f, [p]);
            assert.ok(f.querySelector("a")?.getAttribute("href")?.startsWith("https://www.findbillion.com/twstock/"));
        }
    });
});

// ============================================================================
// 財務指標
// ============================================================================

describe("financeContent()", () => {
    const kpis = (f: DocumentFragment): Record<string, string> =>
        Object.fromEntries(all(f, ".fi-kpi").map((k) => [text(k.querySelector(".fi-kpi__label")), text(k.querySelector(".fi-kpi__value"))]));

    test("2330 真實資料：10 個指標與季別標籤", () => {
        const f = parse(financeContent(snapshot("2330"), BASIC_2330, PRICE_2330));
        assert.deepEqual(kpis(f), {
            本益比: "26.20",
            股價淨值比: "9.11",
            "EPS（2026Q2）": "27.25",
            殖利率: "0.97%",
            每股淨值: "248.05",
            毛利率: "67.72%",
            "ROE（單季）": "11.39%",
            "ROA（單季）": "7.86%",
            股本: "2,593.24 億",
            市值: "58.61 兆",
        });
        assert.equal(text(f.querySelector(".fi-note")), "EPS、毛利率、ROE、ROA 為 2026Q2 單季數據；本益比、股價淨值比、殖利率資料日 2026/11/04");
    });

    test("tile title 帶資料日 / 季別與面額", () => {
        const f = parse(financeContent(snapshot("2330"), BASIC_2330, PRICE_2330));
        const title = (label: string): string => all(f, ".fi-kpi").find((k) => text(k.querySelector(".fi-kpi__label")) === label)?.getAttribute("title") ?? "";
        assert.match(title("本益比"), /資料日 2026\/11\/04/);
        assert.match(title("毛利率"), /2026Q2 單季/);
        assert.equal(title("每股淨值"), "2026Q2");
        assert.equal(title("股本"), "實收資本額，每股面額 10.00 元");
    });

    test("2303 為 2026Q3（09/01）", () => {
        const f = parse(financeContent(snapshot("2303"), null, null));
        assert.ok("EPS（2026Q3）" in kpis(f));
        assert.match(text(f.querySelector(".fi-note")), /2026Q3 單季數據/);
    });

    test("市值 < 1 兆時以億表示（9962 上櫃）", () => {
        const f = parse(financeContent(null, BASIC_9962, 20));
        // 股本 902,203 千元 = 9.02 億；市值 20 × 90,220 千股 = 18.04 億
        assert.deepEqual(kpis(f), { 股本: "9.02 億", 市值: "18.04 億" });
        assert.equal(f.querySelector(".fi-note"), null);
    });

    test("缺值顯示 —（V2 為空字串的 2801），不出現 NaN / undefined", () => {
        const m = snapshot("2801");
        assert.equal(m.grossMargin.value, null);
        const out = financeContent(m, basic({ capitalThousand: 100_000_000 }), null);
        const k = kpis(parse(out));
        assert.equal(k["毛利率"], "—");
        assert.equal(k["本益比"], "—");
        assert.equal(k["EPS"], "—", "沒有季別時標籤不加括號");
        assert.equal(k["市值"], "—");
        assert.equal(k["股本"], "1,000.00 億");
        assert.doesNotMatch(String(out), /NaN|undefined|null|Infinity/);
    });

    test("所有指標皆缺 → null", () => {
        assert.equal(financeContent(null, null, null), null);
        assert.equal(financeContent(snapshot("9999"), basic(), PRICE_2330), null);
        assert.equal(financeContent(null, basic({ sharesThousand: 1000 }), null), null, "沒有股價無法計算市值");
    });

    test("負 EPS / ROE 以綠色（fi-down）呈現", () => {
        const m = snapshot("2330");
        const neg: MarketSnapshot = { ...m, eps: { value: -1.5, date: "2026/06/01" }, roe: { value: -2, date: "2026/06/01" } };
        const f = parse(financeContent(neg, null, null));
        const val = (label: string): Element | null | undefined => all(f, ".fi-kpi").find((k) => text(k.querySelector(".fi-kpi__label")) === label)?.querySelector(".fi-kpi__value");
        assert.ok(val("EPS（2026Q2）")?.classList.contains("fi-down"));
        assert.ok(val("ROE（單季）")?.classList.contains("fi-down"));
        assert.ok(!val("ROA（單季）")?.classList.contains("fi-down"));
    });

    test("部分全市場清單載入失敗時附註", () => {
        const f = parse(financeContent(snapshot("2330", ["roe", "roa"]), BASIC_2330, PRICE_2330));
        assert.equal(text(all(f, ".fi-note").at(-1)), "部分全市場資料載入失敗（2 份）");
        assert.equal(kpis(f)["ROE（單季）"], "—");
    });
});

// ============================================================================
// 相關個股
// ============================================================================

describe("relatedContent()", () => {
    const cat = (type: RelatedCategory["type"], name: string, n: number, total = n): RelatedCategory => ({
        type,
        name,
        total,
        stocks: Array.from({ length: n }, (_, i) => ({ code: `${2000 + i}`, name: `${name}${i}`, capital: 100 - i })),
    });
    const groups = (over: Partial<RelatedGroups>): RelatedGroups => ({ 產業: [], 集團: [], 概念: [], ...over });

    test("全部為空 → null", () => {
        assert.equal(relatedContent(groups({})), null);
    });

    test("順序：同產業、同集團、同概念；id 不重複", () => {
        const f = parse(relatedContent(groups({ 概念: [cat("概念", "C", 1)], 產業: [cat("產業", "I1", 2), cat("產業", "I2", 2)], 集團: [cat("集團", "G", 1)] })));
        assert.deepEqual(all(f, ".fi-group-title").map((t) => text(t)), ["同產業（2）", "同集團（1）", "同概念（1）"]);
        const ids = all(f, ".fi-cat__body").map((b) => b.id);
        assert.deepEqual(ids, ["fi-cat-0", "fi-cat-1", "fi-cat-2", "fi-cat-3"]);
        for (const head of all(f, ".fi-cat__head")) {
            const body = f.querySelector(`#${head.getAttribute("aria-controls")}`);
            assert.ok(body, "aria-controls 對應到內容區塊");
            assert.equal(head.getAttribute("data-action"), "toggle-cat");
        }
    });

    test("產業、集團預設展開（即使超過 3 個）；概念 > 3 時收合、≤ 3 時展開", () => {
        const four = [1, 2, 3, 4].map((i) => cat("概念", `C${i}`, 1));
        const f = parse(relatedContent(groups({ 產業: [1, 2, 3, 4].map((i) => cat("產業", `I${i}`, 1)), 集團: [cat("集團", "G", 1)], 概念: four })));
        for (const c of all(f, ".fi-cat")) {
            const head = c.querySelector(".fi-cat__head")!;
            const body = c.querySelector(".fi-cat__body")!;
            const isConcept = text(head.querySelector(".fi-cat__name")).startsWith("C");
            assert.equal(head.getAttribute("aria-expanded"), isConcept ? "false" : "true");
            assert.equal(body.hasAttribute("hidden"), isConcept);
        }
        const three = parse(relatedContent(groups({ 概念: four.slice(0, 3) })));
        for (const head of all(three, ".fi-cat__head")) assert.equal(head.getAttribute("aria-expanded"), "true");
        for (const body of all(three, ".fi-cat__body")) assert.equal(body.hasAttribute("hidden"), false);
    });

    test("成員為富果連結；總數多於顯示數時提供「全部 N 檔 →」", () => {
        const f = parse(relatedContent(groups({ 產業: [cat("產業", "晶圓代工", 10, 25), cat("產業", "IC製造", 3)] })));
        const [big, small] = all(f, ".fi-cat");
        assert.equal(text(big!.querySelector(".fi-cat__count")), "25 檔");
        assert.equal(all(big!, "a.fi-chip").length, 10);
        assert.equal(big!.querySelector("a.fi-chip")?.getAttribute("href"), "/ai/2000");
        const more = big!.querySelector("button.fi-more");
        assert.equal(text(more), "全部 25 檔 →");
        assert.equal(more?.getAttribute("data-action"), "category");
        assert.equal(more?.getAttribute("data-type"), "產業");
        assert.equal(more?.getAttribute("data-name"), "晶圓代工");
        assert.equal(small!.querySelector("button.fi-more"), null);
    });

    test("XSS：分類名稱與個股名稱", () => {
        for (const p of XSS_ALL) {
            const c: RelatedCategory = { type: "概念", name: p, total: 5, stocks: [{ code: p, name: p, capital: 1 }] };
            assertInert(parse(relatedContent(groups({ 概念: [c], 產業: [{ ...c, type: "產業" }] }))), [p]);
        }
    });
});

// ============================================================================
// 產能 / 摘要
// ============================================================================

describe("capacityContent()", () => {
    test("真實 capacity-2330：每筆一列", () => {
        const f = parse(capacityContent(CAPACITY));
        const rows = all(f, "tbody tr");
        assert.equal(rows.length, CAPACITY.length);
        assert.ok(rows.length > 0);
        assert.deepEqual(cells(rows[0]!), ["上海松江廠(Fab 10)", "8吋廠", "120", "千片/月"]);
        assert.deepEqual(all(f, "thead th").map((th) => text(th)), ["位置", "規格", "數量", "單位"]);
    });

    test("缺欄位顯示 —；空清單 → null", () => {
        const f = parse(capacityContent([{ location: "", spec: "12吋", quantity: "", unit: "" }]));
        assert.deepEqual(cells(all(f, "tbody tr")[0]!), ["—", "12吋", "—", ""]);
        assert.equal(capacityContent([]), null);
    });

    test("XSS：產能欄位", () => {
        for (const p of XSS_ALL) assertInert(parse(capacityContent([{ location: p, spec: p, quantity: p, unit: p }])), [p]);
    });
});

describe("summaryChips()", () => {
    const items: SummaryItem[] = [
        { label: "主1", value: "-21.73%", tone: "down", section: "major", title: "主力買賣超占比" },
        { label: "投信", value: "連買24", tone: "up", section: "continuous", title: "投信連續買超" },
    ];

    test("每個項目為跳至區塊的按鈕，色調套用 fi-<tone>", () => {
        const btns = all(parse(summaryChips(items)), "button.fi-summary__item");
        assert.equal(btns.length, 2);
        assert.equal(btns[0]!.getAttribute("data-action"), "goto");
        assert.equal(btns[0]!.getAttribute("data-section"), "major");
        assert.equal(btns[0]!.getAttribute("title"), "主力買賣超占比");
        assert.equal(text(btns[0]!.querySelector(".fi-summary__label")), "主1");
        const v = btns[0]!.querySelector(".fi-summary__value");
        assert.equal(text(v), "-21.73%");
        assert.ok(v?.classList.contains("fi-down"));
        assert.ok(btns[1]!.querySelector(".fi-summary__value")?.classList.contains("fi-up"));
    });

    test("空清單 → 空字串", () => {
        assert.equal(String(summaryChips([])), "");
    });

    test("XSS：label / value / section / title", () => {
        for (const p of XSS_ALL) assertInert(parse(summaryChips([{ label: p, value: p, tone: "flat", section: p, title: p }])), [p]);
    });
});
