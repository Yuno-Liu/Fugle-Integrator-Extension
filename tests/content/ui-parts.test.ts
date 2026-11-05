/**
 * 富果頁面上的 UI 元件：工具列（toolbar.ts）、盤中預估量與時鐘（widgets.ts）、
 * 搜尋視窗（search.ts）、無障礙對話框（modal.ts）。
 */
import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { setupDom, setupFuglePage, waitFor, flush } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl } from "../helpers/chrome";
import { Toolbar, TOOLBAR_ID } from "../../src/content/toolbar";
import type { ToolbarActions } from "../../src/content/toolbar";
import { Clock, CLOCK_ID, ESTIMATE_ID, EstimateBadge } from "../../src/content/widgets";
import { highlight, openSearch } from "../../src/content/search";
import { openModal } from "../../src/content/modal";
import type { StockContext } from "../../src/content/page";
import type { CardPosition, RelatedStock, SearchResults, UiSettings } from "../../src/shared/types";

const TSMC: StockContext = { stockId: "2330", name: "台積電", market: "上市" };

function baseSettings(patch: Partial<UiSettings> = {}): UiSettings {
    return { position: "right", visible: true, collapsed: false, sections: {}, theme: "auto", shortcut: "Alt+Q", hiddenLinks: [], ...patch };
}

// ============================================================================
// Toolbar
// ============================================================================

type ActionLog = Array<[string, unknown?]>;

function createToolbar(initial: Partial<UiSettings> = {}): { toolbar: Toolbar; calls: ActionLog; settings: { value: UiSettings } } {
    const calls: ActionLog = [];
    const settings = { value: baseSettings(initial) };
    const actions: ToolbarActions = {
        search: () => calls.push(["search"]),
        setPosition: (p: CardPosition) => calls.push(["setPosition", p]),
        popout: () => calls.push(["popout"]),
        setVisible: (v: boolean) => calls.push(["setVisible", v]),
        openOptions: () => calls.push(["openOptions"]),
    };
    return { toolbar: new Toolbar(actions, () => settings.value), calls, settings };
}

function withFuglePage<T>(fn: (env: DomEnv) => T | Promise<T>): Promise<T> {
    const env = setupFuglePage();
    return Promise.resolve()
        .then(() => fn(env))
        .finally(() => env.cleanup());
}

const links = (el: HTMLElement | null): HTMLAnchorElement[] => [...(el?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];

describe("Toolbar", () => {
    test("渲染進富果頁首 .card-group-header__upper-left，且只有一份", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure(TSMC, document);
            toolbar.ensure(TSMC, document);
            toolbar.ensure(TSMC, document);
            const host = document.querySelector(".card-group-header__upper-left");
            assert.equal(document.querySelectorAll(`#${TOOLBAR_ID}`).length, 1);
            assert.equal(toolbar.element?.parentElement, host);
            // 未實作方向鍵導覽，因此使用 role=group（而非 toolbar）
            assert.equal(toolbar.element?.getAttribute("role"), "group");
        }));

    test("8 個外部連結的網址（台積電 2330 上市）", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure(TSMC, document);
            const hrefs = links(toolbar.element).map((a) => a.getAttribute("href"));
            assert.deepEqual(hrefs, [
                "https://www.wantgoo.com/stock/2330",
                "https://www.cmoney.tw/forum/stock/2330",
                "https://warrantlb8888.cmoney.tw/DispositionGod/stock/2330",
                "https://tw.tradingview.com/chart/2i2CtMYT/?symbol=TWSE:2330",
                "https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl.djhtm?a=2330&b=3",
                "https://fubon-ebrokerdj.fbs.com.tw/z/zc/zco/zco_2330.djhtm",
                "https://gemini.google.com/gem/1QUXOXLuTZt54GwWAClfuBcs7Q4LlFRsc?usp=sharing&p=2330%20%E5%8F%B0%E7%A9%8D%E9%9B%BB",
                "https://chatgpt.com/g/g-p-6a7bd905e76c8191845afc2c828aec0f/project?prompt=2330%20%E5%8F%B0%E7%A9%8D%E9%9B%BB",
            ]);
        }));

    test("所有外部連結都是新分頁開啟且 rel=noopener noreferrer，title 含股票名稱與代碼", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure(TSMC, document);
            const all = links(toolbar.element);
            assert.equal(all.length, 8);
            for (const a of all) {
                assert.equal(a.getAttribute("target"), "_blank");
                assert.deepEqual(a.getAttribute("rel")?.split(/\s+/).sort(), ["noopener", "noreferrer"]);
                assert.match(a.title, /：台積電（2330）$/);
            }
        }));

    const markets: Array<[string, string]> = [
        ["上市", "TWSE:9962"],
        ["上櫃", "TPEX:9962"],
        ["興櫃", "TPEX:9962"],
    ];
    for (const [market, symbol] of markets) {
        test(`TradingView 依市場別：${market} → ${symbol}`, () =>
            withFuglePage(({ document }) => {
                const { toolbar } = createToolbar();
                toolbar.ensure({ stockId: "9962", name: "有益", market }, document);
                const tv = links(toolbar.element).find((a) => a.href.includes("tradingview"));
                assert.ok(tv);
                assert.equal(new URL(tv.href).searchParams.get("symbol"), symbol);
            }));
    }

    test("Gemini / ChatGPT 提示詞正確編碼含 & 的名稱（不會截斷查詢字串）", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure({ stockId: "6488", name: "A&B 電子 #1", market: "上櫃" }, document);
            const all = links(toolbar.element);
            const gemini = new URL(all.find((a) => a.href.includes("gemini"))!.href);
            assert.equal(gemini.searchParams.get("p"), "6488 A&B 電子 #1");
            assert.equal(gemini.searchParams.get("usp"), "sharing");
            assert.equal(gemini.hash, "");
            const chatgpt = new URL(all.find((a) => a.href.includes("chatgpt"))!.href);
            assert.equal(chatgpt.searchParams.get("prompt"), "6488 A&B 電子 #1");
            assert.equal([...chatgpt.searchParams.keys()].length, 1);
        }));

    test("名稱尚未渲染（空字串）時提示詞只含代碼，title 以代碼代替名稱", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure({ stockId: "2330", name: "", market: "上市" }, document);
            const gemini = links(toolbar.element).find((a) => a.href.includes("gemini"))!;
            assert.equal(new URL(gemini.href).searchParams.get("p"), "2330");
            assert.match(gemini.title, /：2330（2330）$/);
        }));

    test("股票名稱含 HTML 時被跳脫，不會插入元素", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure({ stockId: "2330", name: '<img src=x onerror="alert(1)">', market: "上市" }, document);
            assert.equal(toolbar.element?.querySelector("img"), null);
            assert.equal(links(toolbar.element).length, 8);
        }));

    test("hiddenLinks 設定隱藏指定連結；全部隱藏時連分隔線也不顯示", () =>
        withFuglePage(({ document }) => {
            const { toolbar, settings } = createToolbar({ hiddenLinks: ["cmoney", "gemini"] });
            toolbar.ensure(TSMC, document);
            const hrefs = links(toolbar.element).map((a) => a.href);
            assert.equal(hrefs.length, 6);
            assert.equal(hrefs.some((h) => h.includes("cmoney.tw/forum") || h.includes("gemini")), false);

            settings.value = baseSettings({ hiddenLinks: ["wantgoo", "cmoney", "dispose", "tradingview", "fubon-institution", "fubon-major", "gemini", "chatgpt"] });
            toolbar.ensure(TSMC, document);
            assert.equal(links(toolbar.element).length, 0);
            assert.equal(toolbar.element?.querySelector(".fi-toolbar__sep"), null);
            assert.ok(toolbar.element?.querySelector("[data-action='search']"), "內部控制仍在");
        }));

    test("只有股票 / 名稱 / 市場 / hiddenLinks 改變時才重建內容", () =>
        withFuglePage(({ document }) => {
            const { toolbar, settings } = createToolbar();
            toolbar.ensure(TSMC, document);
            const first = toolbar.element?.querySelector("a");
            assert.ok(first);

            // 位置 / 開關改變只同步狀態，不重建
            settings.value = baseSettings({ position: "left", visible: false });
            toolbar.ensure(TSMC, document);
            assert.equal(toolbar.element?.querySelector("a"), first);

            const steps: Array<[string, StockContext, Partial<UiSettings>]> = [
                ["名稱", { ...TSMC, name: "台積電 2" }, {}],
                ["市場", { ...TSMC, name: "台積電 2", market: "上櫃" }, {}],
                ["股票", { stockId: "2454", name: "聯發科", market: "上市" }, {}],
                ["hiddenLinks", { stockId: "2454", name: "聯發科", market: "上市" }, { hiddenLinks: ["chatgpt"] }],
            ];
            let previous: HTMLAnchorElement | null = first;
            for (const [what, ctx, patch] of steps) {
                settings.value = baseSettings(patch);
                toolbar.ensure(ctx, document);
                const now = toolbar.element?.querySelector("a");
                assert.notEqual(now, previous, `${what}改變應重建`);
                previous = now ?? null;
            }
            assert.equal(links(toolbar.element)[0]?.getAttribute("href"), "https://www.wantgoo.com/stock/2454");
        }));

    test("富果重新渲染頁首（清空或替換宿主）後重新掛回", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure(TSMC, document);
            const el = toolbar.element;

            const host = document.querySelector(".card-group-header__upper-left") as HTMLElement;
            host.innerHTML = "<div class='card-group-header__info'></div>";
            assert.equal(el?.isConnected, false);
            toolbar.ensure(TSMC, document);
            assert.equal(toolbar.element, el, "沿用同一個元素（保留事件監聽）");
            assert.equal(el?.parentElement, host);

            const newHost = document.createElement("div");
            newHost.className = "card-group-header__upper-left";
            host.replaceWith(newHost);
            toolbar.ensure(TSMC, document);
            assert.equal(el?.parentElement, newHost);
            assert.equal(links(el).length, 8);
        }));

    test("頁面沒有宿主時不建立工具列", () => {
        const env = setupDom();
        try {
            const { toolbar } = createToolbar();
            toolbar.ensure(TSMC, env.document);
            assert.equal(toolbar.element, null);
            assert.equal(env.document.getElementById(TOOLBAR_ID), null);
        } finally {
            env.cleanup();
        }
    });

    test("syncState：位置按鈕 aria-pressed 與資訊卡開關 checked 跟隨設定", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar({ position: "right", visible: true });
            toolbar.ensure(TSMC, document);
            const pressed = (): Record<string, string | null> =>
                Object.fromEntries([...toolbar.element!.querySelectorAll<HTMLElement>("[data-position]")].map((b) => [b.dataset.position, b.getAttribute("aria-pressed")]));
            const toggle = toolbar.element!.querySelector<HTMLInputElement>("input[role='switch']")!;
            assert.deepEqual(pressed(), { left: "false", right: "true", default: "false" });
            assert.equal(toggle.checked, true);

            toolbar.syncState(baseSettings({ position: "default", visible: false }));
            assert.deepEqual(pressed(), { left: "false", right: "false", default: "true" });
            assert.equal(toggle.checked, false);
        }));

    test("點擊按鈕呼叫對應動作；開關 change 事件呼叫 setVisible", () =>
        withFuglePage(({ document, window }) => {
            const { toolbar, calls } = createToolbar({ visible: true });
            toolbar.ensure(TSMC, document);
            const el = toolbar.element!;
            const click = (sel: string): void => (el.querySelector(sel) as HTMLElement).click();

            click("[data-action='search']");
            click("[data-position='left']");
            click("[data-position='default']");
            click("[data-action='popout']");
            click("[data-action='options']");

            const toggle = el.querySelector<HTMLInputElement>("[data-action='visible']")!;
            toggle.checked = false;
            toggle.dispatchEvent(new window.Event("change", { bubbles: true }));

            // 點擊開關的文字標籤（label）也會切換
            (el.querySelector(".fi-switch span:last-child") as HTMLElement).click();

            assert.deepEqual(calls, [["search"], ["setPosition", "left"], ["setPosition", "default"], ["popout"], ["openOptions"], ["setVisible", false], ["setVisible", true]]);

            // 點擊外部連結不觸發任何內部動作
            calls.length = 0;
            const link = el.querySelector("a")!;
            link.addEventListener("click", (e) => e.preventDefault());
            link.click();
            assert.deepEqual(calls, []);
        }));

    test("remove() 移除元素，之後 ensure 重新建立", () =>
        withFuglePage(({ document }) => {
            const { toolbar } = createToolbar();
            toolbar.ensure(TSMC, document);
            toolbar.remove();
            assert.equal(document.getElementById(TOOLBAR_ID), null);
            assert.equal(toolbar.element, null);
            toolbar.ensure(TSMC, document);
            assert.equal(document.querySelectorAll(`#${TOOLBAR_ID}`).length, 1);
            assert.equal(links(toolbar.element).length, 8);
        }));
});

// ============================================================================
// EstimateBadge（盤中預估量）
// ============================================================================

/** 台北時間 → Date（台北 = UTC+8） */
const taipei = (iso: string): Date => new Date(`${iso}+08:00`);

function setPageTime(doc: Document, text: string): void {
    (doc.querySelector(".card-group-header__time span:nth-child(2)") as HTMLElement).textContent = text;
}
function setPageVolume(doc: Document, text: string): void {
    (doc.querySelector(".card-group-header__volume span:nth-child(2)") as HTMLElement).textContent = text;
}

describe("EstimateBadge", () => {
    // 2026-11-05 為週四；頁面總量 53,879 張
    const active: Array<{ at: string; multiplier: number; expected: string }> = [
        { at: "2026-11-05T09:05:00", multiplier: 8, expected: "431,032" },
        { at: "2026-11-05T10:00:00", multiplier: 3, expected: "161,637" },
        { at: "2026-11-05T11:22:30", multiplier: 1.66, expected: "89,439" },
        { at: "2026-11-05T12:07:00", multiplier: 1.42, expected: "76,508" },
        { at: "2026-11-05T13:29:59", multiplier: 1.1, expected: "59,266" },
    ];
    for (const { at, multiplier, expected } of active) {
        test(`盤中 ${at.slice(11, 16)}：預估量 = floor(53,879 × ${multiplier}) = ${expected} 張`, () =>
            withFuglePage(({ document }) => {
                setPageTime(document, at.slice(11));
                const badge = new EstimateBadge();
                badge.update(document, taipei(at));
                const el = document.getElementById(ESTIMATE_ID)!;
                assert.ok(el);
                assert.equal(el.hidden, false);
                assert.equal(el.textContent, `預估量 ≈ ${expected} 張`);
                assert.equal(el.title, `依盤中時間推估全日成交量：目前 53,879 張 × 經驗係數 ${multiplier}`);
                assert.equal(el.parentElement, document.querySelector(".card-group-header__volume-and-time"));
            }));
    }

    const inactive: Array<{ why: string; at: string; time: string; volume?: string }> = [
        { why: "富果顯示「11/04 收盤」（真實頁面）", at: "2026-11-05T10:00:00", time: "11/04 收盤" },
        { why: "盤中時段但富果顯示「休市」（颱風假）", at: "2026-11-05T10:00:00", time: "休市" },
        { why: "開盤前 08:59", at: "2026-11-05T08:59:59", time: "08:59:59" },
        { why: "13:30 收盤後", at: "2026-11-05T13:30:00", time: "13:30:00" },
        { why: "盤後 14:00（避免把實際量標成預估量）", at: "2026-11-05T14:00:00", time: "14:00:00" },
        { why: "週六", at: "2026-11-07T10:00:00", time: "10:00:00" },
        { why: "週日", at: "2026-11-08T10:00:00", time: "10:00:00" },
        { why: "成交量 0 張", at: "2026-11-05T09:01:00", time: "09:01:00", volume: "0 張" },
        { why: "成交量尚未載入", at: "2026-11-05T09:01:00", time: "09:01:00", volume: "-- 張" },
    ];
    for (const { why, at, time, volume } of inactive) {
        test(`不顯示：${why}`, () =>
            withFuglePage(({ document }) => {
                setPageTime(document, time);
                if (volume) setPageVolume(document, volume);
                new EstimateBadge().update(document, taipei(at));
                // 非盤中時段不建立元素（也不讀取頁面）；盤中但不符合條件時元素存在但隱藏
                const el = document.getElementById(ESTIMATE_ID);
                assert.ok(el === null || el.hidden, `預估量不應顯示：${el?.textContent ?? ""}`);
            }));
    }

    test("盤中顯示後進入收盤時段：已建立的元素會被隱藏", () =>
        withFuglePage(({ document }) => {
            setPageTime(document, "10:00:00");
            const badge = new EstimateBadge();
            badge.update(document, taipei("2026-11-05T10:00:00"));
            assert.equal(document.getElementById(ESTIMATE_ID)?.hidden, false);
            badge.update(document, taipei("2026-11-05T13:31:00"));
            assert.equal(document.getElementById(ESTIMATE_ID)?.hidden, true);
        }));

    test("海外時區使用者：以台北時間判斷盤中（UTC 02:00 = 台北 10:00）", () =>
        withFuglePage(({ document }) => {
            setPageTime(document, "10:00:00");
            new EstimateBadge().update(document, new Date("2026-11-05T02:00:00Z"));
            assert.equal(document.getElementById(ESTIMATE_ID)?.textContent, "預估量 ≈ 161,637 張");
        }));

    test("盤中 → 收盤：同一個徽章由顯示轉為隱藏；成交量變動時文字更新", () =>
        withFuglePage(({ document }) => {
            const badge = new EstimateBadge();
            setPageTime(document, "10:00:00");
            badge.update(document, taipei("2026-11-05T10:00:00"));
            const el = document.getElementById(ESTIMATE_ID)!;
            setPageVolume(document, "60,000 張");
            badge.update(document, taipei("2026-11-05T10:01:00"));
            assert.equal(el.textContent, "預估量 ≈ 180,000 張");
            setPageTime(document, "11/05 收盤");
            badge.update(document, taipei("2026-11-05T13:29:00"));
            assert.equal(el.hidden, true);
            assert.equal(document.querySelectorAll(`#${ESTIMATE_ID}`).length, 1);
        }));

    test("富果重新渲染成交量區塊後重新掛回宿主", () =>
        withFuglePage(({ document }) => {
            const badge = new EstimateBadge();
            setPageTime(document, "10:00:00");
            badge.update(document, taipei("2026-11-05T10:00:00"));
            const el = document.getElementById(ESTIMATE_ID)!;

            const host = document.querySelector(".card-group-header__volume-and-time") as HTMLElement;
            const fresh = host.cloneNode(true) as HTMLElement;
            fresh.querySelector(`#${ESTIMATE_ID}`)?.remove();
            host.replaceWith(fresh);
            assert.equal(el.isConnected, false);

            badge.update(document, taipei("2026-11-05T10:00:05"));
            assert.equal(el.parentElement, fresh);
            assert.equal(el.hidden, false);
            assert.equal(document.querySelectorAll(`#${ESTIMATE_ID}`).length, 1);

            badge.remove();
            assert.equal(document.getElementById(ESTIMATE_ID), null);
        }));

    test("沒有成交量宿主時不做任何事", () => {
        const env = setupDom();
        try {
            new EstimateBadge().update(env.document, taipei("2026-11-05T10:00:00"));
            assert.equal(env.document.getElementById(ESTIMATE_ID), null);
        } finally {
            env.cleanup();
        }
    });
});

// ============================================================================
// Clock
// ============================================================================

describe("Clock", () => {
    const pad = (n: number): string => String(n).padStart(2, "0");
    const hms = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    async function withClock(fn: (ctx: { document: Document; clock: Clock; start: Date }) => void): Promise<void> {
        const start = new Date(2026, 10, 5, 10, 15, 30, 200); // 本地時間 2026-11-05（週四）10:15:30.200
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: start.getTime() });
        const env = setupFuglePage();
        const clock = new Clock();
        try {
            fn({ document: env.document, clock, start });
        } finally {
            clock.remove();
            mock.timers.reset();
            env.cleanup();
        }
    }

    test("插入在 .tw-market 正後方，顯示時間與完整日期（週四）", () =>
        withClock(({ document, clock }) => {
            clock.ensure(document);
            const market = document.querySelector(".tw-market")!;
            const el = document.getElementById(CLOCK_ID)!;
            assert.equal(market.nextElementSibling, el);
            assert.equal(el.getAttribute("role"), "timer");
            assert.equal(el.querySelector(".fi-num")?.textContent, "10:15:30");
            assert.equal(el.querySelector(".fi-clock__date")?.textContent, "2026-11-05（週四）");
            assert.equal(el.getAttribute("aria-label"), "目前時間，2026-11-05（週四）");
        }));

    test("每秒更新同一個文字節點（不重建 DOM），跨日時日期也更新", () =>
        withClock(({ document, clock, start }) => {
            clock.ensure(document);
            const el = document.getElementById(CLOCK_ID)!;
            const timeSpan = el.querySelector(".fi-num")!;
            const node = timeSpan.firstChild;
            mock.timers.tick(1000);
            assert.equal(timeSpan.textContent, hms(new Date(start.getTime() + 1000)));
            mock.timers.tick(3000);
            assert.equal(timeSpan.textContent, "10:15:34");
            assert.equal(timeSpan.firstChild, node);
            assert.equal(document.getElementById(CLOCK_ID), el);

            // 推進到隔天（週五）
            mock.timers.tick(14 * 3600 * 1000);
            assert.equal(el.querySelector(".fi-clock__date")?.textContent, "2026-11-06（週五）");
        }));

    test("重複 ensure 不會產生多個時鐘或多個計時器；富果重繪後重新插回", () =>
        withClock(({ document, clock }) => {
            clock.ensure(document);
            clock.ensure(document);
            const el = document.getElementById(CLOCK_ID)!;
            el.remove();
            clock.ensure(document);
            assert.equal(document.querySelectorAll(`#${CLOCK_ID}`).length, 1);
            assert.equal(document.querySelector(".tw-market")?.nextElementSibling, el);
            mock.timers.tick(1000);
            assert.equal(el.querySelector(".fi-num")?.textContent, "10:15:31");
        }));

    test("pause() 停止更新，再次 ensure 恢復；remove() 移除元素", () =>
        withClock(({ document, clock }) => {
            clock.ensure(document);
            const time = (): string | null | undefined => document.querySelector(`#${CLOCK_ID} .fi-num`)?.textContent;
            clock.pause();
            mock.timers.tick(5000);
            assert.equal(time(), "10:15:30");
            clock.ensure(document);
            assert.equal(time(), "10:15:35");
            clock.remove();
            assert.equal(document.getElementById(CLOCK_ID), null);
            mock.timers.tick(2000); // 不應拋錯
        }));

    test("頁面沒有 .tw-market 時不插入", () => {
        const env = setupDom();
        try {
            const clock = new Clock();
            clock.ensure(env.document);
            assert.equal(env.document.getElementById(CLOCK_ID), null);
            clock.remove();
        } finally {
            env.cleanup();
        }
    });
});

// ============================================================================
// highlight
// ============================================================================

describe("highlight", () => {
    const cases: Array<[string, string, string, string]> = [
        ["台積電", "積", "台<mark class=\"fi-mark\">積</mark>電", "中文子字串"],
        ["台積電", "台積電", "<mark class=\"fi-mark\">台積電</mark>", "完全符合"],
        ["2330", "233", "<mark class=\"fi-mark\">233</mark>0", "代碼開頭"],
        ["TSMC Corp", "corp", "TSMC <mark class=\"fi-mark\">Corp</mark>", "不分大小寫，保留原字串大小寫"],
        ["臺灣大", "台灣", "<mark class=\"fi-mark\">臺灣</mark>大", "臺 / 台 視為相同，標示原字"],
        ["ＡＢＣ", "b", "Ａ<mark class=\"fi-mark\">Ｂ</mark>Ｃ", "全形英數（NFKC）"],
        ["台積電", "台 積", "<mark class=\"fi-mark\">台積</mark>電", "查詢中的空白被忽略"],
        ["A<b>&\"x\"", "b", "A&lt;<mark class=\"fi-mark\">b</mark>&gt;&amp;&quot;x&quot;", "其餘字元跳脫"],
        ["<script>", "script", "&lt;<mark class=\"fi-mark\">script</mark>&gt;", "符合片段本身也跳脫"],
        ["台積電", "聯發科", "台積電", "沒有符合"],
        ["<b>台積電</b>", "", "&lt;b&gt;台積電&lt;/b&gt;", "空查詢：僅跳脫"],
        ["㈱台積", "台積", "㈱台積", "正規化改變長度時不標示（避免錯位）"],
    ];
    for (const [text, query, expected, why] of cases) {
        test(`${why}：highlight(${JSON.stringify(text)}, ${JSON.stringify(query)})`, () => {
            assert.equal(highlight(text, query).value, expected);
        });
    }
});

// ============================================================================
// openSearch
// ============================================================================

const SEARCH_DATA: Record<string, SearchResults> = {
    台: {
        stocks: [
            { code: "2330", name: "台積電", capital: 2593.24 },
            { code: "3045", name: "台灣大", capital: 34.97 },
        ],
        categories: [
            { type: "概念", name: "台積電概念股", count: 42 },
            { type: "產業", name: "半導體業", count: 168 },
            { type: "集團", name: "台積電集團", count: 9 },
        ],
    },
    "2454": { stocks: [{ code: "2454", name: "聯發科", capital: 160.03 }], categories: [] },
    "<b>": { stocks: [], categories: [] },
};

const CATEGORY_DATA: Record<string, RelatedStock[]> = {
    半導體業: [
        { code: "2330", name: "台積電", capital: 2593.24 },
        { code: "2303", name: "聯電", capital: 1254.2 },
        { code: "2454", name: "聯發科", capital: 160.03 },
        { code: "3711", name: "日月光投控", capital: 436.5 },
    ],
    AI: [{ code: "2382", name: "廣達", capital: 386.3 }],
};

interface SearchEnv {
    env: DomEnv;
    fake: FakeChromeControl;
    navigated: string[];
    modal: ReturnType<typeof openSearch>;
    input: HTMLInputElement;
    results: HTMLElement;
    sentOf(type: string): any[];
}

async function withSearch(
    opts: { local?: Record<string, unknown>; handler?: (msg: any) => unknown; initialCategory?: Parameters<typeof openSearch>[1] },
    fn: (s: SearchEnv) => Promise<void>
): Promise<void> {
    const env = setupFuglePage();
    const fake = installFakeChrome({
        local: opts.local,
        handler:
            opts.handler ??
            ((msg) => {
                if (msg.type === "search") return { ok: true, data: SEARCH_DATA[msg.query] ?? { stocks: [], categories: [] } };
                if (msg.type === "category") return { ok: true, data: CATEGORY_DATA[msg.name] ?? [] };
                return { ok: false, error: "unexpected", code: "bad-request" };
            }),
    });
    const navigated: string[] = [];
    const modal = openSearch({ currentStockId: () => "2330", navigate: (code) => navigated.push(code) }, opts.initialCategory);
    try {
        await fn({
            env,
            fake,
            navigated,
            modal,
            input: modal.body.querySelector<HTMLInputElement>(".fi-search__input")!,
            results: modal.body.querySelector<HTMLElement>("#fi-search-results")!,
            sentOf: (type) => fake.sent.filter((m) => m.type === type),
        });
    } finally {
        modal.close();
        await flush(5);
        fake.uninstall();
        env.cleanup();
    }
}

function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}
function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
}
const optionsOf = (results: HTMLElement): HTMLElement[] => [...results.querySelectorAll<HTMLElement>('[role="option"]')];
const selectedIndex = (results: HTMLElement): number => optionsOf(results).findIndex((o) => o.getAttribute("aria-selected") === "true");

describe("openSearch", () => {
    test("開啟後為對話框、輸入框取得焦點、顯示使用說明", () =>
        withSearch({}, async ({ input, results, modal }) => {
            assert.equal(modal.root.querySelector("[role='dialog']")?.getAttribute("aria-modal"), "true");
            await waitFor(() => results.querySelector(".fi-search__empty") !== null, 500);
            await waitFor(() => document.activeElement === input, 500);
            assert.match(results.textContent ?? "", /輸入股票代號/);
            assert.equal(results.querySelector("[data-recent]"), null);
        }));

    test("輸入防抖（約 120ms）後只送出最後一次查詢，結果依 個股 → 產業 → 概念 → 集團 分組", () =>
        withSearch({}, async ({ input, results, sentOf }) => {
            typeInto(input, "台積");
            typeInto(input, " 台 ");
            await flush(40);
            assert.equal(sentOf("search").length, 0, "防抖期間不送出");
            await waitFor(() => optionsOf(results).length > 0, 1000);
            assert.deepEqual(sentOf("search"), [{ type: "search", query: "台" }]);

            const groups = [...results.querySelectorAll(".fi-search__group")].map((g) => g.textContent);
            assert.deepEqual(groups, ["個股 · 2", "產業 · 1", "概念 · 1", "集團 · 1"]);
            const opts = optionsOf(results);
            assert.deepEqual(
                opts.map((o) => o.dataset.code ?? `${o.dataset.type}:${o.dataset.name}`),
                ["2330", "3045", "產業:半導體業", "概念:台積電概念股", "集團:台積電集團"]
            );
            // 個股連結、標示、股本、目前個股
            assert.equal(opts[0]?.getAttribute("href"), "/ai/2330");
            assert.equal(opts[0]?.querySelector("mark")?.textContent, "台");
            assert.match(opts[0]?.textContent ?? "", /目前 · 股本 2,593 億/);
            assert.match(opts[1]?.textContent ?? "", /股本 35\.0 億/);
            assert.doesNotMatch(opts[1]?.textContent ?? "", /目前/);
            assert.match(opts[2]?.textContent ?? "", /168 檔/);
            assert.equal(input.getAttribute("aria-expanded"), "true");
            assert.equal(selectedIndex(results), 0, "第一筆預設為選取");
            assert.equal(input.getAttribute("aria-activedescendant"), opts[0]?.id);
        }));

    test("↓ / ↑ 循環選取，Enter 開啟個股：導覽、關閉視窗、記錄最近搜尋", () =>
        withSearch({}, async ({ input, results, navigated, fake, modal }) => {
            typeInto(input, "台");
            await waitFor(() => optionsOf(results).length === 5, 1000);
            assert.equal(key(input, "ArrowDown").defaultPrevented, true);
            assert.equal(selectedIndex(results), 1);
            key(input, "ArrowUp");
            key(input, "ArrowUp");
            assert.equal(selectedIndex(results), 4, "從第一筆往上循環到最後一筆");
            key(input, "ArrowDown");
            key(input, "ArrowDown");
            assert.equal(selectedIndex(results), 1);
            assert.equal(input.getAttribute("aria-activedescendant"), optionsOf(results)[1]?.id);

            key(input, "Enter");
            assert.deepEqual(navigated, ["3045"]);
            assert.equal(modal.root.isConnected, false);
            assert.equal(document.getElementById("fi-search-modal"), null);
            await waitFor(() => Array.isArray(fake.local.get("fi.recentSearches")), 500);
            assert.deepEqual(fake.local.get("fi.recentSearches"), ["台"]);
        }));

    test("滑鼠點擊個股：攔截改走 SPA 導覽；Ctrl / 中鍵點擊交給瀏覽器開新分頁", () =>
        withSearch({}, async ({ input, results, navigated }) => {
            typeInto(input, "台");
            await waitFor(() => optionsOf(results).length === 5, 1000);
            const link = optionsOf(results)[0]!;

            let browserDefault = false;
            const guard = (e: Event): void => {
                browserDefault = !e.defaultPrevented;
                e.preventDefault(); // jsdom 不做真正導覽
            };
            document.addEventListener("click", guard);
            link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
            assert.equal(browserDefault, true);
            assert.deepEqual(navigated, []);

            link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
            assert.equal(browserDefault, false);
            document.removeEventListener("click", guard);
            assert.deepEqual(navigated, ["2330"]);
        }));

    test("選取分類 → 顯示成員與篩選框；篩選；返回後恢復先前結果與選取", () =>
        withSearch({}, async ({ input, results, sentOf, navigated }) => {
            typeInto(input, "台");
            await waitFor(() => optionsOf(results).length === 5, 1000);
            key(input, "ArrowDown");
            key(input, "ArrowDown");
            assert.equal(optionsOf(results)[2]?.dataset.name, "半導體業");
            key(input, "Enter");

            await waitFor(() => results.querySelector("[data-filter]") !== null, 1000);
            assert.deepEqual(sentOf("category"), [{ type: "category", categoryType: "產業", name: "半導體業" }]);
            assert.match(results.querySelector(".fi-search__crumb")?.textContent ?? "", /產業\s*半導體業（4 檔）/);
            const chips = [...results.querySelectorAll<HTMLAnchorElement>(".fi-search__grid [data-code]")];
            assert.deepEqual(
                chips.map((c) => c.dataset.code),
                ["2330", "2303", "2454", "3711"]
            );
            assert.ok(chips[0]?.classList.contains("fi-chip--self"), "目前個股有標記");
            assert.match(chips[0]?.textContent ?? "", /目前/);
            const filter = results.querySelector<HTMLInputElement>("[data-filter]")!;
            assert.equal(document.activeElement, filter, "篩選框取得焦點");

            typeInto(filter, "聯");
            assert.deepEqual(
                chips.filter((c) => !c.hidden).map((c) => c.dataset.code),
                ["2303", "2454"]
            );
            typeInto(filter, "3711");
            assert.deepEqual(
                chips.filter((c) => !c.hidden).map((c) => c.dataset.code),
                ["3711"]
            );
            typeInto(filter, "");
            assert.equal(chips.filter((c) => c.hidden).length, 0);

            (results.querySelector("[data-back]") as HTMLElement).click();
            assert.equal(optionsOf(results).length, 5, "恢復先前的搜尋結果");
            assert.equal(selectedIndex(results), 2, "恢復先前的選取位置");
            assert.equal(document.activeElement, input);

            // 恢復後的結果仍可用鍵盤開啟
            key(input, "ArrowUp");
            key(input, "ArrowUp");
            key(input, "Enter");
            assert.deepEqual(navigated, ["2330"]);
        }));

    test("點擊分類中的個股即導覽到該股", () =>
        withSearch({ initialCategory: { type: "產業", name: "半導體業" } }, async ({ results, navigated, modal, sentOf }) => {
            await waitFor(() => results.querySelector("[data-code='2454']") !== null, 1000);
            assert.equal(results.querySelector("[data-back]"), null, "直接開啟分類時沒有返回按鈕");
            assert.equal(sentOf("search").length, 0);
            (results.querySelector("[data-code='2454']") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
            assert.deepEqual(navigated, ["2454"]);
            assert.equal(modal.root.isConnected, false);
        }));

    test("Esc 關閉視窗並取消尚未送出的查詢", () =>
        withSearch({}, async ({ input, modal, sentOf }) => {
            typeInto(input, "台");
            key(input, "Escape");
            assert.equal(modal.root.isConnected, false);
            await flush(180);
            assert.equal(sentOf("search").length, 0);
        }));

    test("空白查詢顯示 chrome.storage.local 的最近搜尋；點擊後重新搜尋", () =>
        withSearch({ local: { "fi.recentSearches": ["台", "AI", 42, "散熱"] } }, async ({ input, results, sentOf }) => {
            await waitFor(() => results.querySelector("[data-recent]") !== null, 500);
            const chips = [...results.querySelectorAll<HTMLElement>("[data-recent]")];
            assert.deepEqual(
                chips.map((c) => c.textContent),
                ["台", "AI", "散熱"],
                "非字串項目被略過"
            );
            assert.match(results.textContent ?? "", /最近搜尋/);
            chips[0]!.click();
            assert.equal(input.value, "台");
            await waitFor(() => optionsOf(results).length === 5, 1000);
            assert.deepEqual(sentOf("search"), [{ type: "search", query: "台" }]);

            // 清空輸入回到最近搜尋
            typeInto(input, "   ");
            await waitFor(() => results.querySelector("[data-recent]") !== null, 500);
            assert.equal(optionsOf(results).length, 0);
            assert.equal(input.getAttribute("aria-expanded"), "false");
        }));

    test("最近搜尋：新查詢放最前面、去除重複", () =>
        withSearch({ local: { "fi.recentSearches": ["AI", "2454", "散熱"] } }, async ({ input, results, fake }) => {
            typeInto(input, "2454");
            await waitFor(() => optionsOf(results).length === 1, 1000);
            key(input, "Enter");
            await waitFor(() => (fake.local.get("fi.recentSearches") as string[])[0] === "2454", 500);
            assert.deepEqual(fake.local.get("fi.recentSearches"), ["2454", "AI", "散熱"]);
        }));

    test("沒有結果時顯示提示（查詢字串經跳脫）", () =>
        withSearch({}, async ({ input, results }) => {
            typeInto(input, "<b>");
            await waitFor(() => /找不到/.test(results.textContent ?? ""), 1000);
            assert.match(results.textContent ?? "", /找不到「<b>」的相關結果/);
            assert.equal(results.querySelector("b"), null);
            assert.equal(input.getAttribute("aria-expanded"), "false");
        }));

    test("背景回報錯誤時顯示 role=alert 的錯誤訊息", () =>
        withSearch({ handler: () => ({ ok: false, error: "股票資料庫載入失敗", code: "upstream" }) }, async ({ input, results }) => {
            typeInto(input, "台");
            await waitFor(() => results.querySelector("[role='alert']") !== null, 1000);
            assert.equal(results.querySelector("[role='alert']")?.textContent, "搜尋失敗：股票資料庫載入失敗");
        }));

    test("分類載入失敗時顯示錯誤", () =>
        withSearch(
            {
                initialCategory: { type: "概念", name: "AI" },
                handler: (msg) => (msg.type === "category" ? { ok: false, error: "分類不存在", code: "not-found" } : { ok: true, data: { stocks: [], categories: [] } }),
            },
            async ({ results }) => {
                await waitFor(() => results.querySelector("[role='alert']") !== null, 1000);
                assert.equal(results.querySelector("[role='alert']")?.textContent, "載入失敗：分類不存在");
            }
        ));

    test("較慢的舊查詢結果不會覆蓋較新的結果", () => {
        const handler = async (msg: any): Promise<unknown> => {
            if (msg.query === "台") await new Promise((r) => setTimeout(r, 200));
            return { ok: true, data: SEARCH_DATA[msg.query] ?? { stocks: [], categories: [] } };
        };
        return withSearch({ handler }, async ({ input, results }) => {
            typeInto(input, "台");
            await flush(140); // 「台」已送出但尚未回應
            typeInto(input, "2454");
            await waitFor(() => optionsOf(results).length === 1, 1000);
            await flush(150); // 等「台」的慢回應抵達
            assert.deepEqual(
                optionsOf(results).map((o) => o.dataset.code),
                ["2454"]
            );
        });
    });

    test(
        "快速輸入後立即按 Enter：應開啟新查詢的第一筆，而非畫面上舊查詢的結果",
        () =>
            withSearch({}, async ({ input, results, navigated }) => {
                typeInto(input, "台");
                await waitFor(() => optionsOf(results).length === 5, 1000);
                typeInto(input, "2454");
                key(input, "Enter"); // 防抖中立即按 Enter
                await flush(50);
                assert.notDeepEqual(navigated, ["2330"], "不應開啟舊查詢「台」的第一筆 2330");
                await waitFor(() => navigated.length > 0, 500);
                assert.deepEqual(navigated, ["2454"]);
            })
    );
});

// ============================================================================
// openModal
// ============================================================================

describe("openModal", () => {
    function withModal(fn: (ctx: { document: Document; trigger: HTMLButtonElement; closes: { count: number }; modal: ReturnType<typeof openModal> }) => void | Promise<void>): Promise<void> {
        const env = setupDom();
        const doc = env.document;
        const trigger = doc.createElement("button");
        trigger.id = "trigger";
        trigger.textContent = "開啟";
        doc.body.appendChild(trigger);
        trigger.focus();
        const closes = { count: 0 };
        const modal = openModal({ id: "fi-test-modal", title: "<測試>標題", onClose: () => closes.count++, doc });
        modal.body.innerHTML = `<input id="a"><button id="b">B</button><div hidden><button id="h">隱藏</button></div><button id="dis" disabled>停用</button>`;
        return Promise.resolve()
            .then(() => fn({ document: doc, trigger, closes, modal }))
            .finally(() => {
                modal.close();
                env.cleanup();
            });
    }

    test("role=dialog、aria-modal，標題以 aria-labelledby 關聯且經跳脫", () =>
        withModal(({ document, modal }) => {
            const dialog = modal.root.querySelector("[role='dialog']")!;
            assert.equal(dialog.getAttribute("aria-modal"), "true");
            const title = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
            assert.equal(title.textContent, "<測試>標題");
            assert.equal(modal.root.parentElement, document.body);
        }));

    test("Tab 焦點鎖定：外部 → 第一個；最後一個 → 第一個；Shift+Tab 第一個 → 最後一個（略過隱藏 / 停用）", () =>
        withModal(({ document, modal }) => {
            const closeBtn = modal.root.querySelector<HTMLElement>("[data-modal-close]")!;
            const a = document.getElementById("a")!;
            const b = document.getElementById("b")!;

            assert.equal(key(document.activeElement!, "Tab").defaultPrevented, true);
            assert.equal(document.activeElement, closeBtn, "焦點在外部時 Tab 移到對話框第一個元素");

            b.focus();
            assert.equal(key(b, "Tab").defaultPrevented, true);
            assert.equal(document.activeElement, closeBtn, "最後一個 Tab 回到第一個");

            assert.equal(key(closeBtn, "Tab", { shiftKey: true }).defaultPrevented, true);
            assert.equal(document.activeElement, b, "第一個 Shift+Tab 到最後一個（不是隱藏或停用的按鈕）");

            a.focus();
            assert.equal(key(a, "Tab").defaultPrevented, false, "中間元素交給瀏覽器的預設 Tab 行為");
            assert.equal(key(a, "Tab", { shiftKey: true }).defaultPrevented, false);
        }));

    test("Esc 關閉、阻止事件傳到富果自己的快捷鍵處理，焦點回到開啟前的元素", () =>
        withModal(({ document, trigger, closes, modal }) => {
            let pageSawEscape = false;
            document.body.addEventListener("keydown", (e) => {
                if (e.key === "Escape") pageSawEscape = true;
            });
            document.getElementById("a")!.focus();
            const ev = key(document.activeElement!, "Escape");
            assert.equal(ev.defaultPrevented, true);
            assert.equal(pageSawEscape, false);
            assert.equal(modal.root.isConnected, false);
            assert.equal(document.activeElement, trigger);
            assert.equal(closes.count, 1);
        }));

    test("在遮罩上 mousedown 關閉；在對話框內 mousedown 不關閉", () =>
        withModal(({ modal, closes }) => {
            modal.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            modal.root.querySelector(".fi-modal")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            assert.equal(modal.root.isConnected, true);
            modal.root.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            assert.equal(modal.root.isConnected, false);
            assert.equal(closes.count, 1);
        }));

    test("關閉按鈕可關閉；多次 close() / Esc 只呼叫 onClose 一次", () =>
        withModal(({ document, modal, closes, trigger }) => {
            (modal.root.querySelector("[data-modal-close]") as HTMLElement).click();
            modal.close();
            modal.close();
            key(document.body, "Escape");
            assert.equal(closes.count, 1);
            assert.equal(document.activeElement, trigger);
        }));

    test("關閉後不再攔截 Tab / Esc", () =>
        withModal(({ modal, trigger }) => {
            modal.close();
            trigger.focus();
            assert.equal(key(trigger, "Tab").defaultPrevented, false);
            assert.equal(key(trigger, "Escape").defaultPrevented, false);
        }));

    test("以相同 id 再次開啟會取代舊的對話框", () =>
        withModal(({ document, modal }) => {
            const second = openModal({ id: "fi-test-modal", title: "第二個", doc: document });
            try {
                assert.equal(document.querySelectorAll("#fi-test-modal").length, 1);
                assert.equal(modal.root.isConnected, false);
                assert.equal(second.root.isConnected, true);
                // 舊對話框的鍵盤處理不再作用；Esc 關閉新的
                key(document.body, "Escape");
                assert.equal(second.root.isConnected, false);
            } finally {
                second.close();
            }
        }));
});
