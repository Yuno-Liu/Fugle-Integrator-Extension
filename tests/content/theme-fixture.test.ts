/**
 * 富果淺色 / 深色模式偵測 ↔ 富果真實樣式表（tests/fixtures/fugle-dark-selectors.css）。
 *
 * 富果的深色樣式有兩套：
 * - 舊版 fugle-desktop.css：每條規則以 `.body.dark-theme` 為前綴（class 加在 <div class="body">）
 * - Tailwind chunk：dark: 變體編譯為 `:is(.tw-dark-theme *)`（class 加在 <html> / <body>）
 *
 * 這裡從 fixture 擷取規則的「根選擇器」，確認整合器的 FUGLE.darkMarkers / hasDarkMarker() 偵測的正是這些根；
 * 之後更新 fixture 時若富果改了選擇器，這些測試會先失敗。
 */
import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fixtureText } from "../helpers/fixtures";
import { setupFuglePage } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { hasDarkMarker, isDarkBackground, isFugleDark } from "../../src/content/page";
import { FUGLE } from "../../src/shared/constants";

// ============================================================================
// 解析 fixture
// ============================================================================

const CSS = fixtureText("fugle-dark-selectors.css");

/** 以 jsdom 的 CSSOM 解析，回傳每條樣式規則的選擇器（已依頂層逗號拆開） */
function parseSelectors(css: string): string[] {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
    try {
        const style = dom.window.document.createElement("style");
        style.textContent = css;
        dom.window.document.head.appendChild(style);
        const rules = [...(style.sheet?.cssRules ?? [])] as CSSStyleRule[];
        return rules.flatMap((r) => splitTopLevel(r.selectorText));
    } finally {
        dom.window.close();
    }
}

/** 只拆開最外層的逗號（:is(...) 內的逗號不拆） */
function splitTopLevel(selector: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < selector.length; i++) {
        const c = selector[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) {
            out.push(selector.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(selector.slice(start).trim());
    return out.filter(Boolean);
}

const RULE_COUNT = (CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/\{/g) ?? []).length;
const SELECTORS = parseSelectors(CSS);
const TAILWIND = SELECTORS.filter((s) => s.includes("tw-dark-theme"));
const LEGACY = SELECTORS.filter((s) => !s.includes("tw-dark-theme"));

/** 舊版規則的根：第一個複合選擇器（例如 ".body.dark-theme"） */
const LEGACY_ROOTS = [...new Set(LEGACY.map((s) => s.split(/\s+/)[0] ?? ""))];
/** Tailwind 規則的根：:is(...) 的內容（例如 ".tw-dark-theme *"） */
const TAILWIND_ROOTS = [...new Set(TAILWIND.map((s) => /:is\(([^()]*)\)/.exec(s)?.[1]?.trim() ?? ""))];

function withPage<T>(fn: (env: DomEnv) => T): T {
    const env = setupFuglePage();
    try {
        return fn(env);
    } finally {
        env.cleanup();
    }
}

// ============================================================================
// fixture 結構（富果改版時提早發現）
// ============================================================================

describe("富果深色樣式 fixture 的選擇器", () => {
    test("每條規則都被解析（沒有因語法不支援而遺漏），且兩種樣式都有", () => {
        assert.ok(RULE_COUNT > 0);
        assert.equal(SELECTORS.length, RULE_COUNT, "CSSOM 解析出的規則數應等於原文的規則區塊數");
        assert.ok(LEGACY.length > 0, "應包含舊版 .body.dark-theme 規則");
        assert.ok(TAILWIND.length > 0, "應包含 Tailwind :is(.tw-dark-theme *) 規則");
        assert.equal(LEGACY.length + TAILWIND.length, SELECTORS.length);
    });

    test("每條舊版規則都以「.body.dark-theme 」（後接子孫選擇器）開頭", () => {
        for (const s of LEGACY) {
            assert.ok(s.startsWith(".body.dark-theme "), `舊版規則根選擇器改變：${s}`);
        }
        assert.deepEqual(LEGACY_ROOTS, [".body.dark-theme"]);
    });

    test("每條 Tailwind 深色規則都含「:is(.tw-dark-theme *)」且只有這一種根", () => {
        for (const s of TAILWIND) {
            assert.ok(s.includes(":is(.tw-dark-theme *)"), `Tailwind 深色變體改變：${s}`);
            assert.ok(s.startsWith(".dark:tw-") || s.startsWith(".dark\\:tw-"), `應為 dark: 前綴的工具類別：${s}`);
        }
        assert.deepEqual(TAILWIND_ROOTS, [".tw-dark-theme *"]);
    });

    test("原文中的 Tailwind 規則以跳脫的 .dark\\: 前綴撰寫（與編譯後的 chunk 一致）", () => {
        const raw = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
        const twRaw = raw.match(/^[^{}\n]*:is\(\.tw-dark-theme \*\)\s*\{/gm) ?? [];
        assert.equal(twRaw.length, TAILWIND.length);
        for (const line of twRaw) assert.match(line, /^\.dark\\:tw-/);
    });
});

// ============================================================================
// 根選擇器 ↔ 整合器的偵測
// ============================================================================

describe("深色根選擇器與 FUGLE.darkMarkers 一致", () => {
    test("darkMarkers 是合法選擇器，且每個片段都能單獨使用", () =>
        withPage(({ document }) => {
            assert.doesNotThrow(() => document.querySelector(FUGLE.darkMarkers));
            for (const part of splitTopLevel(FUGLE.darkMarkers)) {
                assert.doesNotThrow(() => document.querySelector(part), part);
            }
        }));

    test("真實頁面（淺色）：沒有深色標記，fixture 的根選擇器都不成立", () =>
        withPage(({ document }) => {
            assert.equal(hasDarkMarker(document), false);
            for (const root of LEGACY_ROOTS) assert.equal(document.querySelector(root), null, root);
            for (const root of TAILWIND_ROOTS) assert.equal(document.querySelector(`:is(${root})`), null, root);
        }));

    test("舊版：.body 元素加上 dark-theme → fixture 的根選擇器命中 .body，且 hasDarkMarker() 為 true", () =>
        withPage(({ document }) => {
            const body = document.querySelector(".body");
            assert.ok(body, "真實頁面應有 <div class=\"body\">");
            body.classList.add("dark-theme");
            for (const root of LEGACY_ROOTS) {
                assert.equal(document.querySelector(root), body, `${root} 應命中 .body`);
                assert.ok(body.matches(FUGLE.darkMarkers), `darkMarkers 應涵蓋 ${root}`);
            }
            // 舊版規則的子孫部分作用在 .body 之下（例如頁首卡片）
            assert.ok(body.contains(document.querySelector(FUGLE.header)), "富果頁首卡片位於 .body 之下");
            assert.equal(hasDarkMarker(document), true);
            assert.equal(isFugleDark(document), true);

            body.classList.remove("dark-theme");
            assert.equal(hasDarkMarker(document), false, "切回淺色即時反映");
        }));

    for (const where of ["html", "body"] as const) {
        test(`Tailwind：<${where}> 加上 tw-dark-theme → 頁面內容符合 :is(.tw-dark-theme *)，且 hasDarkMarker() 為 true`, () =>
            withPage(({ document }) => {
                const host = where === "html" ? document.documentElement : document.body;
                host.classList.add("tw-dark-theme");
                const header = document.querySelector(FUGLE.header);
                assert.ok(header);
                for (const root of TAILWIND_ROOTS) {
                    assert.ok(header.matches(`:is(${root})`), `Tailwind dark: 變體應作用於頁首（${root}）`);
                }
                assert.ok(host.matches(FUGLE.darkMarkers));
                assert.equal(hasDarkMarker(document), true);
                assert.equal(isFugleDark(document), true);
            }));
    }

    const nested: Array<{ name: string; selector: string; cls: string }> = [
        { name: "頁首卡片 .card-group-header 加 dark-theme", selector: ".card-group-header", cls: "dark-theme" },
        { name: "頁首卡片 .card-group-header 加 tw-dark-theme", selector: ".card-group-header", cls: "tw-dark-theme" },
        { name: "網站頁首 header.header 加 dark-theme", selector: "header.header", cls: "dark-theme" },
        { name: "網站頁首 header.header 加 tw-dark-theme", selector: "header.header", cls: "tw-dark-theme" },
        { name: "市場下拉 .tw-market 加 tw-dark-theme", selector: ".tw-market", cls: "tw-dark-theme" },
    ];
    for (const { name, selector, cls } of nested) {
        test(`巢狀元件不算整頁深色：${name} → hasDarkMarker() 為 false`, () =>
            withPage(({ document }) => {
                const el = document.querySelector(selector);
                assert.ok(el, `fixture 應包含 ${selector}`);
                el.classList.add(cls);
                assert.equal(hasDarkMarker(document), false);
                assert.equal(isFugleDark(document), false);
            }));
    }
});

// ============================================================================
// hasDarkMarker / isDarkBackground 的分工
// ============================================================================

describe("isFugleDark = hasDarkMarker || isDarkBackground", () => {
    type Marker = "none" | "legacy" | "tailwind";
    type Background = "none" | "dark-body" | "light-body" | "dark-inner";
    const applyMarker = (doc: Document, m: Marker): void => {
        if (m === "legacy") doc.querySelector(".body")?.classList.add("dark-theme");
        if (m === "tailwind") doc.documentElement.classList.add("tw-dark-theme");
    };
    const applyBackground = (doc: Document, b: Background): void => {
        if (b === "dark-body") doc.body.style.backgroundColor = "rgb(18, 18, 18)";
        if (b === "light-body") doc.body.style.backgroundColor = "rgb(255, 255, 255)";
        if (b === "dark-inner") (doc.querySelector(".body") as HTMLElement).style.backgroundColor = "rgb(23, 27, 38)";
    };
    const expectedMarker = (m: Marker): boolean => m !== "none";
    const expectedBackground = (b: Background): boolean => b === "dark-body" || b === "dark-inner";

    for (const m of ["none", "legacy", "tailwind"] as const) {
        for (const b of ["none", "dark-body", "light-body", "dark-inner"] as const) {
            test(`標記 ${m} × 背景 ${b}`, () =>
                withPage(({ document }) => {
                    applyMarker(document, m);
                    applyBackground(document, b);
                    const marker = hasDarkMarker(document);
                    const background = isDarkBackground(document);
                    assert.equal(marker, expectedMarker(m), "hasDarkMarker 只看標記");
                    assert.equal(background, expectedBackground(b), "isDarkBackground 只看背景亮度");
                    assert.equal(isFugleDark(document), marker || background);
                }));
        }
    }

    test("有深色標記但背景仍為淺色（富果樣式尚未套用）→ 深色：標記優先", () =>
        withPage(({ document }) => {
            document.documentElement.classList.add("tw-dark-theme");
            (document.querySelector(".body") as HTMLElement).style.backgroundColor = "rgb(255, 255, 255)";
            assert.equal(isDarkBackground(document), false);
            assert.equal(isFugleDark(document), true);
        }));

    test("hasDarkMarker 不呼叫 getComputedStyle（可頻繁呼叫）；isDarkBackground 才會", () =>
        withPage(({ document, window }) => {
            const spy = mock.method(window, "getComputedStyle");
            try {
                hasDarkMarker(document);
                assert.equal(spy.mock.callCount(), 0);
                isDarkBackground(document);
                assert.ok(spy.mock.callCount() > 0);
            } finally {
                spy.mock.restore();
            }
        }));

    test("注入富果真實深色樣式表後：舊版規則不改 .body 背景，偵測仍靠標記", () =>
        withPage(({ document }) => {
            const style = document.createElement("style");
            style.textContent = CSS;
            document.head.appendChild(style);
            document.querySelector(".body")?.classList.add("dark-theme");
            assert.equal(isDarkBackground(document), false, "fixture 規則不設定頁面背景");
            assert.equal(hasDarkMarker(document), true);
            assert.equal(isFugleDark(document), true);
        }));
});
