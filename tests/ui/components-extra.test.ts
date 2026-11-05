/**
 * UI 元件補充（src/ui/components.ts）：
 * - financeContent：本益比為 0（玉山表示近四季虧損、不適用）時顯示「—」並在 title 說明
 * - majorContent：淨額欄以「遠離 0」捨入（正負對稱），占比取自 core/major.ts toMajorPeriod 的對稱捨入
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { financeContent, majorContent, majorMeta } from "../../src/ui/components";
import { toMajorPeriod } from "../../src/core/major";
import type { MajorPeriod, MarketSnapshot, MetricValue } from "../../src/shared/types";
import type { SafeHtml } from "../../src/utils/html";

function parse(out: SafeHtml | string | null | undefined): DocumentFragment {
    assert.ok(out !== null && out !== undefined, "預期輸出 HTML，實際為 null");
    return JSDOM.fragment(String(out));
}
const text = (node: ParentNode | Element | null | undefined): string => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (root: ParentNode, sel: string): Element[] => Array.from(root.querySelectorAll(sel));
const cells = (tr: Element): string[] => Array.from(tr.querySelectorAll("td")).map((td) => text(td));

// ============================================================================
// financeContent：本益比
// ============================================================================

const DAY = "2026/11/04";
const QUARTER = "2026/06/01";
const mv = (value: number | null, date: string | null): MetricValue => ({ value, date });

function snapshot(over: Partial<MarketSnapshot> = {}): MarketSnapshot {
    return {
        nav: mv(248.05, QUARTER),
        pb: mv(9.11, DAY),
        eps: mv(27.25, QUARTER),
        pe: mv(26.2, DAY),
        dividendYield: mv(0.97, DAY),
        grossMargin: mv(67.72, QUARTER),
        roe: mv(11.39, QUARTER),
        roa: mv(7.86, QUARTER),
        trust: null,
        foreign: null,
        trustHoldPct: null,
        foreignHoldPct: null,
        failed: 0,
        unavailable: [],
        ...over,
    };
}

function peTile(f: DocumentFragment): { value: string; title: string; tile: Element } {
    const tile = all(f, ".fi-kpi").find((k) => text(k.querySelector(".fi-kpi__label")) === "本益比");
    assert.ok(tile, "應有本益比指標");
    return { value: text(tile.querySelector(".fi-kpi__value")), title: tile.getAttribute("title") ?? "", tile };
}

describe("financeContent()：本益比", () => {
    test("本益比為 0（近四季虧損）→ 顯示「—」，title 說明近四季虧損、本益比不適用並附資料日", () => {
        const f = parse(financeContent(snapshot({ pe: mv(0, DAY), eps: mv(-1.23, QUARTER) }), null, null));
        const pe = peTile(f);
        assert.equal(pe.value, "—");
        assert.notEqual(pe.value, "0.00");
        assert.equal(pe.title, `近四季虧損，本益比不適用。資料日 ${DAY}`);
        assert.doesNotMatch(pe.title, /股價 ÷ 近四季 EPS/);
        assert.ok(!pe.tile.querySelector(".fi-kpi__value")?.classList.contains("fi-down"), "「—」不套用負值顏色");
        // 其他指標不受影響
        const eps = all(f, ".fi-kpi").find((k) => text(k.querySelector(".fi-kpi__label")) === "EPS（2026Q2）");
        assert.equal(text(eps?.querySelector(".fi-kpi__value")), "-1.23");
        // 附註仍列出本益比的資料日
        assert.match(text(f.querySelector(".fi-note")), new RegExp(`本益比、股價淨值比、殖利率資料日 ${DAY}`));
    });

    test("本益比為 0 且沒有資料日 → title 只有虧損說明", () => {
        const f = parse(financeContent(snapshot({ pe: mv(0, null) }), null, null));
        const pe = peTile(f);
        assert.equal(pe.value, "—");
        assert.equal(pe.title, "近四季虧損，本益比不適用。");
    });

    const positives: Array<[number, string]> = [
        [26.2, "26.20"],
        [0.01, "0.01"],
        [1234.567, "1,234.57"],
    ];
    for (const [value, shown] of positives) {
        test(`正本益比 ${value} → ${shown}，title 為一般公式說明`, () => {
            const pe = peTile(parse(financeContent(snapshot({ pe: mv(value, DAY) }), null, null)));
            assert.equal(pe.value, shown);
            assert.equal(pe.title, `股價 ÷ 近四季 EPS。資料日 ${DAY}`);
        });
    }

    test("負本益比（近四季 EPS 合計為負）→「—」，title 同樣說明近四季虧損", () => {
        const pe = peTile(parse(financeContent(snapshot({ pe: mv(-15.3, DAY) }), null, null)));
        assert.equal(pe.value, "—");
        assert.equal(pe.title, `近四季虧損，本益比不適用。資料日 ${DAY}`);
    });

    test("本益比缺值（null）→「—」，title 不是虧損說明", () => {
        const pe = peTile(parse(financeContent(snapshot({ pe: mv(null, null) }), null, null)));
        assert.equal(pe.value, "—");
        assert.doesNotMatch(pe.title, /虧損/);
        assert.match(pe.title, /^股價 ÷ 近四季 EPS。/);
    });

    test("只有本益比 0、其餘全缺時整區為 null（「—」不算有值）", () => {
        const empty = mv(null, null);
        const m = snapshot({ nav: empty, pb: empty, eps: empty, pe: mv(0, DAY), dividendYield: empty, grossMargin: empty, roe: empty, roa: empty });
        assert.equal(financeContent(m, null, null), null);
    });
});

// ============================================================================
// majorContent：淨額欄與占比的對稱捨入
// ============================================================================

function period(netBuy: number, netSell: number, volume = 100_000_000): MajorPeriod {
    const p = toMajorPeriod({ date: DAY, netBuy, netSell, volume }, 1);
    assert.ok(p, "toMajorPeriod 應回傳區間");
    return p;
}

const firstRow = (p: MajorPeriod): Element => all(parse(majorContent({ periods: [p, null, null, null, null] })), "tbody tr")[0]!;

describe("majorContent()：淨額欄（張）遠離 0 捨入", () => {
    // [買超股數, 賣超股數, 預期淨額欄]
    const cases: Array<[number, number, string, string]> = [
        [0, -500, "-1", "淨賣 500 股 = -0.5 張 → -1（不是 Math.round 的 -0）"],
        [500, 0, "+1", "淨買 500 股 = +0.5 張 → +1"],
        [0, -1_500, "-2", "-1.5 張 → -2（Math.round 會得到 -1）"],
        [1_500, 0, "+2", "+1.5 張 → +2"],
        [0, -2_500, "-3", "-2.5 張 → -3"],
        [2_500, 0, "+3", "+2.5 張 → +3"],
        [0, -499, "0", "-0.499 張 → 0（不顯示 -0）"],
        [499, 0, "0", "+0.499 張 → 0（不加 + 號）"],
        [1_000, -1_000, "0", "買賣相抵 → 0"],
        [12_728_481, -24_367_496, "-11,639", "真實 2330 主1：-11,639.015 張"],
        [3_000_500, -1_000_000, "+2,001", "+2,000.5 張 → +2,001（千分位）"],
        [1_000_000, -3_000_500, "-2,001", "-2,000.5 張 → -2,001（與正值對稱）"],
    ];
    for (const [netBuy, netSell, expected, why] of cases) {
        test(why, () => {
            const tr = firstRow(period(netBuy, netSell));
            assert.equal(cells(tr)[3], expected);
            // 顏色依顯示的張數：顯示 0 時不套用買賣超顏色
            const tone = expected === "0" ? "fi-flat" : expected.startsWith("-") ? "fi-down" : "fi-up";
            const td = tr.querySelectorAll("td")[3];
            assert.ok(td?.classList.contains(tone), `淨額 ${expected} 應為 ${tone}，實際 ${td?.className}`);
        });
    }

    test("正負對稱：淨額 ±N.5 張的顯示只差正負號", () => {
        for (const halfLots of [500, 1_500, 10_500, 123_456_500]) {
            const pos = cells(firstRow(period(halfLots, 0)))[3]!;
            const neg = cells(firstRow(period(0, -halfLots)))[3]!;
            assert.equal(pos.replace(/^\+/, ""), neg.replace(/^-/, ""), `±${halfLots} 股`);
            assert.ok(pos.startsWith("+"));
            assert.ok(neg.startsWith("-"));
        }
    });

    test("買超 / 賣超欄同樣以張為單位遠離 0 捨入（賣超取絕對值）", () => {
        const tr = firstRow(period(1_500, -2_500));
        assert.deepEqual(cells(tr).slice(1, 4), ["2", "3", "-1"]);
    });
});

describe("majorContent()：占比由 toMajorPeriod 對稱捨入至小數 2 位", () => {
    // [買超, 賣超, 成交量, 預期 ratio, 顯示]
    const cases: Array<[number, number, number, number, string]> = [
        [0, -21_735, 100_000, -21.74, "-21.74%"],
        [21_735, 0, 100_000, 21.74, "+21.74%"],
        [1_000_000, -3_173_500, 10_000_000, -21.74, "-21.74%"],
        [0, -5, 100_000, -0.01, "-0.01%"],
        [5, 0, 100_000, 0.01, "+0.01%"],
    ];
    for (const [netBuy, netSell, volume, ratio, shown] of cases) {
        test(`(${netBuy} − |${netSell}|) ÷ ${volume} → ${shown}`, () => {
            const p = period(netBuy, netSell, volume);
            assert.equal(p.ratio, ratio);
            const tr = firstRow(p);
            assert.equal(cells(tr)[4], shown);
            assert.equal(majorMeta({ periods: [p, null, null, null, null] }), `主1 ${shown}`);
        });
    }

    test("-21.735% 與 +21.735% 捨入結果互為相反數（Math.round 會得到 -21.73 / 21.74）", () => {
        const neg = period(0, -21_735, 100_000);
        const pos = period(21_735, 0, 100_000);
        assert.equal(neg.ratio, -pos.ratio);
        assert.notEqual(neg.ratio, Math.round(-2173.5) / 100);
    });

    test("-21.74% 的長條往下、寬度 = 21.74 / 30 × 50 = 36.2%，淨額與占比都是 fi-down", () => {
        const tr = firstRow(period(0, -21_735, 100_000));
        const tds = tr.querySelectorAll("td");
        assert.ok(tds[3]?.classList.contains("fi-down"));
        assert.ok(tds[4]?.classList.contains("fi-down"));
        const fill = tr.querySelector<HTMLElement>(".fi-bar__fill");
        assert.ok(fill?.classList.contains("fi-bar__fill--down"));
        assert.equal(fill?.getAttribute("style"), "width:36.2%");
    });

    test("極小淨賣超捨入為 0.00% 時不顯示「-0.00%」，長條為向上空條", () => {
        const p = period(0, -1, 1_000_000_000);
        assert.ok(Object.is(p.ratio, 0));
        const tr = firstRow(p);
        assert.equal(cells(tr)[4], "0.00%");
        assert.equal(tr.querySelector(".fi-bar__fill")?.getAttribute("style"), "width:0.0%");
    });
});
