/**
 * content script 控制器（App）：chrome 替身扮演 background，以 fixtures 回應資料集。
 * 監看迴圈以手動呼叫 app.tick() 驅動；需要經過時間的地方暫時位移 Date.now()，不實際等待。
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers/fixtures";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl } from "../helpers/chrome";
import { flush, setStockOnPage, setupFuglePage, waitFor } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { App } from "../../src/content/app";
import { CARD_ID } from "../../src/content/card";
import { TOOLBAR_ID } from "../../src/content/toolbar";
import { CLOCK_ID } from "../../src/content/widgets";
import { SECTIONS } from "../../src/content/sections";
import { STYLE_ELEMENT_ID } from "../../src/ui/styles";
import { parseBasic, parseCapacity, parseEtfHoldings, parseNames, parseRatings, parseRelations } from "../../src/core/esun";
import { summarizeMajor, toMajorPeriod } from "../../src/core/major";
import { buildMarketSnapshot, indexMarketList } from "../../src/core/market";
import type { MarketIndex } from "../../src/core/market";
import { LOCAL_KEYS, SYNC_KEYS, UNMOUNT_GRACE_MS } from "../../src/shared/constants";
import type { MarketListId } from "../../src/shared/constants";
import { DATASET_NAMES } from "../../src/shared/messages";
import type { DatasetMap, DatasetName } from "../../src/shared/messages";
import type { RelatedGroups } from "../../src/shared/types";

// ============================================================================
// 以真實 fixtures 組出 background 會回傳的資料集
// ============================================================================

function buildData(): DatasetMap {
    const list = (name: string, key: "V1" | "V2"): MarketIndex => indexMarketList(fixture(name), key);
    const indexes: Record<MarketListId, MarketIndex | undefined> = {
        nav: list("market-nav.json", "V1"),
        pb: list("market-pb.json", "V1"),
        eps: list("market-eps.json", "V1"),
        pe: list("market-pe.json", "V1"),
        dividendYield: list("market-yield.json", "V1"),
        grossMargin: list("market-margin.json", "V1"),
        roe: list("market-roe.json", "V1"),
        roa: list("market-roa.json", "V1"),
        trustBuy: list("market-trustbuy.json", "V2"),
        trustSell: list("market-trustsell.json", "V2"),
        foreignBuy: list("market-foreignbuy.json", "V2"),
        foreignSell: list("market-foreignsell.json", "V2"),
        trustHold: list("market-trusthold.json", "V2"),
        foreignHold: list("market-foreignhold.json", "V2"),
    };
    const raw1 = summarizeMajor(fixture("major1-2330.json"));
    return {
        basic: parseBasic(fixture("basic-2330.json")),
        industry: parseNames(fixture("industry-2330.json")),
        concept: parseNames(fixture("concept-2330.json")),
        group: parseNames(fixture("group-2330.json")),
        relations: {
            suppliers: parseRelations(fixture("relation-suppliers-2330.json")),
            customers: parseRelations(fixture("relation-customers-2330.json")),
            rivals: [],
            alliances: [],
            investOuts: [],
            investIns: [],
            failed: 0,
        },
        ratings: parseRatings(fixture("ratings-2330.json")),
        etf: parseEtfHoldings(fixture("etf-2330.synthetic.json")),
        capacity: parseCapacity(fixture("capacity-2330.json")),
        major: { periods: [raw1 ? toMajorPeriod(raw1, 1) : null, null, null, null, null] },
        market: buildMarketSnapshot("2330", indexes),
    };
}

const DATA = buildData();
const RELATED: RelatedGroups = { 產業: [], 集團: [], 概念: [] };

interface DatasetMessage {
    type: "dataset";
    name: DatasetName;
    stockId: string;
    force?: boolean;
}

/** 模擬 background：資料集一律以 2330 的真實資料回應（2454 的名稱改掉以便辨識） */
function backgroundHandler(message: { type: string; name?: DatasetName; stockId?: string }): unknown {
    if (message.type === "dataset" && message.name) {
        let data: unknown = DATA[message.name];
        if (message.name === "basic" && message.stockId === "2454" && DATA.basic) data = { ...DATA.basic, shortName: "聯發科", fullName: "聯發科技股份有限公司" };
        // background 的 dataset 回應：{ ok, data: { data, meta } }
        return { ok: true, data: { data, meta: { fetchedAt: Date.now(), stale: false } } };
    }
    if (message.type === "related") return { ok: true, data: RELATED };
    if (message.type === "openOptions") return { ok: true, data: { opened: true } };
    return { ok: false, error: "unsupported", code: "invalid" };
}

// ============================================================================
// 測試環境
// ============================================================================

interface Ctx {
    env: DomEnv;
    doc: Document;
    fake: FakeChromeControl;
    app: App;
}

let active: Ctx | null = null;

function setup(options: { local?: Record<string, unknown>; sync?: Record<string, unknown>; dark?: string } = {}): Ctx {
    const env = setupFuglePage();
    if (options.dark) applyDarkMarker(env.document, options.dark);
    const fake = installFakeChrome({ handler: backgroundHandler, local: options.local, sync: options.sync });
    const app = new App();
    active = { env, doc: env.document, fake, app };
    return active;
}

/** 在 Fugle 頁面上加上深色模式標記（三種寫法） */
function applyDarkMarker(doc: Document, kind: string): void {
    const body = doc.querySelector(".body") ?? doc.body;
    if (kind === "dark-theme") body.classList.add("dark-theme");
    else if (kind === "tw-dark-theme") doc.documentElement.classList.add("tw-dark-theme");
    else if (kind === "data-theme") doc.documentElement.setAttribute("data-theme", "dark");
}

afterEach(async () => {
    const ctx = active;
    active = null;
    if (!ctx) return;
    try {
        ctx.app.stop();
        // 讓已送出的 chrome 訊息回呼在替身移除前完成
        await flush(20);
    } finally {
        ctx.fake.uninstall();
        ctx.env.cleanup();
    }
});

/** 暫時把 Date.now() 往後推，模擬經過一段時間 */
function withClockAhead<T>(ms: number, fn: () => T): T {
    const realNow = Date.now;
    const offset = realNow() + ms;
    Date.now = () => offset;
    try {
        return fn();
    } finally {
        Date.now = realNow;
    }
}

const card = (doc: Document): HTMLElement | null => doc.getElementById(CARD_ID);
const datasetMessages = (fake: FakeChromeControl): DatasetMessage[] => fake.sent.filter((m): m is DatasetMessage => m?.type === "dataset");
const allSettled = (doc: Document): boolean => {
    const sections = [...(card(doc)?.querySelectorAll<HTMLElement>(".fi-section") ?? [])];
    return sections.length === SECTIONS.length && sections.every((s) => s.dataset.state !== "loading");
};

// ============================================================================
// 啟動
// ============================================================================

describe("App.start", () => {
    test("載入設定、注入樣式，第一次 tick 掛上工具列、資訊卡與時鐘並載入資料", async () => {
        const { doc, fake, app } = setup();
        await app.start();

        assert.ok(doc.getElementById(STYLE_ELEMENT_ID), "styles injected");
        assert.equal(doc.querySelectorAll(`#${STYLE_ELEMENT_ID}`).length, 1);
        const toolbar = doc.getElementById(TOOLBAR_ID);
        assert.ok(toolbar);
        assert.equal(toolbar.parentElement, doc.querySelector(".card-group-header__upper-left"));
        const clock = doc.getElementById(CLOCK_ID);
        assert.ok(clock);
        assert.equal(doc.querySelector(".tw-market")?.nextElementSibling, clock);

        const el = card(doc);
        assert.ok(el);
        assert.equal(el.dataset.stockId, "2330");
        assert.equal(el.parentElement, doc.body, "default position is floating right");
        assert.ok(el.classList.contains("fi-card--right"));

        await waitFor(() => allSettled(doc), 1500);
        const requested = datasetMessages(fake);
        assert.deepEqual(requested.map((m) => m.name).sort(), [...DATASET_NAMES].sort());
        assert.ok(requested.every((m) => m.stockId === "2330" && m.force === false));
        assert.ok(fake.sent.some((m) => m?.type === "related" && m.stockId === "2330"));
        assert.match(el.querySelector("[data-role='status']")?.textContent ?? "", /^更新於 \d\d:\d\d:\d\d$/);
        assert.equal(el.querySelector("[data-role='name']")?.textContent, "台積電");
        assert.ok(el.querySelectorAll(".fi-summary__item").length >= 5);
    });

    test("儲存的設定生效：嵌入位置 → 卡片放在富果頁首、工具列按鈕同步", async () => {
        const { doc, app } = setup({ local: { [LOCAL_KEYS.position]: "default", [LOCAL_KEYS.collapsed]: true } });
        await app.start();
        const el = card(doc);
        assert.ok(el);
        assert.equal(el.parentElement, doc.querySelector(".card-group-header"));
        assert.equal(el.querySelector<HTMLElement>("[data-role='body']")?.hidden, true);
        assert.equal(doc.querySelector(`#${TOOLBAR_ID} [data-position='default']`)?.getAttribute("aria-pressed"), "true");
    });

    test("重複 tick 不會重複掛載或重新載入", async () => {
        const { doc, fake, app } = setup();
        await app.start();
        const sent = datasetMessages(fake).length;
        app.tick();
        app.tick();
        assert.equal(doc.querySelectorAll(`#${CARD_ID}`).length, 1);
        assert.equal(doc.querySelectorAll(`#${TOOLBAR_ID}`).length, 1);
        assert.equal(doc.querySelectorAll(`#${CLOCK_ID}`).length, 1);
        assert.equal(datasetMessages(fake).length, sent);
    });
});

// ============================================================================
// SPA 導覽
// ============================================================================

describe("App：SPA 切換股票", () => {
    test("頁面代碼變更 → 為新股票重新載入，畫面上只保留一份卡片與工具列", async () => {
        const { doc, fake, app } = setup();
        await app.start();
        await waitFor(() => allSettled(doc), 1500);

        setStockOnPage(doc, "2454", "聯發科");
        app.tick();
        assert.equal(card(doc)?.dataset.stockId, "2454");
        assert.equal(card(doc)?.querySelector("[data-role='name']")?.textContent, "聯發科");
        assert.equal(doc.querySelectorAll(`#${CARD_ID}`).length, 1);
        assert.equal(doc.querySelectorAll(`#${TOOLBAR_ID}`).length, 1);

        await waitFor(() => allSettled(doc), 1500);
        const for2454 = datasetMessages(fake).filter((m) => m.stockId === "2454");
        assert.deepEqual(for2454.map((m) => m.name).sort(), [...DATASET_NAMES].sort(), "each dataset requested exactly once");
        assert.match(card(doc)?.querySelector("[data-role='sub']")?.textContent ?? "", /聯發科技股份有限公司/);
        // 工具列外部連結改為新股票
        assert.ok([...doc.querySelectorAll<HTMLAnchorElement>(`#${TOOLBAR_ID} a`)].some((a) => a.href.includes("2454")));
        assert.ok(![...doc.querySelectorAll<HTMLAnchorElement>(`#${TOOLBAR_ID} a`)].some((a) => a.href.includes("2330")));
    });

    test("只有名稱 / 市場別變更（同一檔股票）→ 更新標題但不重新載入", async () => {
        const { doc, fake, app } = setup();
        await app.start();
        await waitFor(() => allSettled(doc), 1500);
        const sent = datasetMessages(fake).length;
        setStockOnPage(doc, "2330", "台積電", "上櫃");
        app.tick();
        assert.equal(card(doc)?.querySelector("[data-role='code']")?.textContent, "2330 · 上櫃");
        assert.equal(datasetMessages(fake).length, sent);
    });

    test("離開個股頁超過寬限時間才移除 UI；回到個股頁後重新掛上", async () => {
        const { doc, app } = setup();
        await app.start();
        const symbol = doc.querySelector(".card-group-header__info__symbol");
        assert.ok(symbol);
        const parent = symbol.parentElement;
        assert.ok(parent);
        symbol.remove();

        app.tick();
        assert.ok(card(doc), "still mounted during the grace period");
        assert.ok(doc.getElementById(TOOLBAR_ID));
        withClockAhead(UNMOUNT_GRACE_MS - 200, () => app.tick());
        assert.ok(card(doc), "still mounted just before the grace period ends");

        withClockAhead(UNMOUNT_GRACE_MS + 100, () => app.tick());
        assert.equal(card(doc), null);
        assert.equal(doc.getElementById(TOOLBAR_ID), null);

        parent.prepend(symbol);
        app.tick();
        assert.equal(card(doc)?.dataset.stockId, "2330");
        assert.equal(doc.querySelectorAll(`#${TOOLBAR_ID}`).length, 1);
    });

    test("短暫讀不到代碼（富果重繪中）不會移除 UI，且不重新載入", async () => {
        const { doc, fake, app } = setup();
        await app.start();
        const sent = datasetMessages(fake).length;
        setStockOnPage(doc, "", "");
        app.tick();
        setStockOnPage(doc, "2330", "台積電");
        app.tick();
        // 寬限時間重新計算：再次消失後立刻 tick 不應移除
        setStockOnPage(doc, "", "");
        withClockAhead(UNMOUNT_GRACE_MS - 500, () => app.tick());
        assert.ok(card(doc));
        assert.equal(datasetMessages(fake).length, sent);
    });

    test("富果重繪頁首移除了注入元素 → 下一次 tick 重新掛上（不重抓資料）", async () => {
        const { doc, fake, app } = setup();
        await app.start();
        const sent = datasetMessages(fake).length;
        card(doc)?.remove();
        doc.getElementById(TOOLBAR_ID)?.remove();
        app.tick();
        assert.ok(card(doc)?.isConnected);
        assert.ok(doc.getElementById(TOOLBAR_ID)?.isConnected);
        assert.equal(datasetMessages(fake).length, sent);
    });
});

// ============================================================================
// 主題：富果有淺色與深色模式
// ============================================================================

describe("App：主題跟隨富果淺色 / 深色模式", () => {
    test("淺色頁面 → data-fi-theme=light", async () => {
        const { doc, app } = setup();
        await app.start();
        assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "light");
    });

    for (const marker of ["dark-theme", "tw-dark-theme", "data-theme"]) {
        test(`深色標記 ${marker} → data-fi-theme=dark`, async () => {
            const { doc, app } = setup({ dark: marker });
            await app.start();
            assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "dark");
        });
    }

    test("執行中切換富果主題 → 下一次檢查時跟著切換（淺 → 深 → 淺）", async () => {
        const { doc, app } = setup();
        await app.start();
        const root = doc.documentElement;
        const body = doc.querySelector(".body") ?? doc.body;

        body.classList.add("dark-theme");
        app.tick();
        assert.equal(root.getAttribute("data-fi-theme"), "light", "theme check is throttled");
        withClockAhead(2_000, () => app.tick());
        assert.equal(root.getAttribute("data-fi-theme"), "dark");

        body.classList.remove("dark-theme");
        withClockAhead(4_000, () => app.tick());
        assert.equal(root.getAttribute("data-fi-theme"), "light");
    });

    const prefCases: Array<{ pref: string; dark: boolean; expected: string }> = [
        { pref: "light", dark: true, expected: "light" },
        { pref: "dark", dark: false, expected: "dark" },
        { pref: "auto", dark: true, expected: "dark" },
        { pref: "auto", dark: false, expected: "light" },
    ];
    for (const c of prefCases) {
        test(`主題設定 ${c.pref}、富果${c.dark ? "深色" : "淺色"} → ${c.expected}`, async () => {
            const { doc, app } = setup({ local: { [LOCAL_KEYS.theme]: c.pref }, dark: c.dark ? "dark-theme" : undefined });
            await app.start();
            assert.equal(doc.documentElement.getAttribute("data-fi-theme"), c.expected);
        });
    }

    test("設定頁變更主題 → 立即套用（不必等節流）", async () => {
        const { doc, app } = setup();
        await app.start();
        assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "light");
        await chrome.storage.local.set({ [LOCAL_KEYS.theme]: "dark" });
        await waitFor(() => doc.documentElement.getAttribute("data-fi-theme") === "dark", 500);
        await chrome.storage.local.set({ [LOCAL_KEYS.theme]: "auto" });
        await waitFor(() => doc.documentElement.getAttribute("data-fi-theme") === "light", 500);
    });
});

// ============================================================================
// 快捷鍵
// ============================================================================

describe("App：快捷鍵聚焦富果搜尋框", () => {
    const press = (doc: Document, init: KeyboardEventInit): KeyboardEvent => {
        const view = doc.defaultView;
        assert.ok(view);
        const event = new view.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
        doc.body.dispatchEvent(event);
        return event;
    };

    test("預設 Alt+Q（code KeyQ）→ 聚焦 input.search-bar__input 並攔截事件", async () => {
        const { doc, app } = setup();
        await app.start();
        const input = doc.querySelector<HTMLInputElement>("input.search-bar__input");
        assert.ok(input);
        assert.notEqual(doc.activeElement, input);
        const event = press(doc, { key: "q", code: "KeyQ", altKey: true });
        assert.equal(doc.activeElement, input);
        assert.equal(event.defaultPrevented, true);
    });

    test("非快捷鍵組合不攔截", async () => {
        const { doc, app } = setup();
        await app.start();
        const input = doc.querySelector<HTMLInputElement>("input.search-bar__input");
        for (const init of [{ key: "q", code: "KeyQ" }, { key: "w", code: "KeyW", altKey: true }, { key: "q", code: "KeyQ", altKey: true, shiftKey: true }]) {
            const event = press(doc, init);
            assert.equal(event.defaultPrevented, false, JSON.stringify(init));
            assert.notEqual(doc.activeElement, input);
        }
    });

    test("非英文鍵盤配置（key 為其他字元）仍以實體按鍵 KeyQ 判斷", async () => {
        const { doc, app } = setup();
        await app.start();
        press(doc, { key: "œ", code: "KeyQ", altKey: true });
        assert.equal(doc.activeElement, doc.querySelector("input.search-bar__input"));
    });

    test("自訂快捷鍵（chrome.storage.sync）", async () => {
        const { doc, app } = setup({ sync: { [SYNC_KEYS.shortcut]: "Ctrl+Shift+K" } });
        await app.start();
        const input = doc.querySelector("input.search-bar__input");
        press(doc, { key: "q", code: "KeyQ", altKey: true });
        assert.notEqual(doc.activeElement, input);
        press(doc, { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true });
        assert.equal(doc.activeElement, input);
    });

    test("stop() 後移除快捷鍵監聽", async () => {
        const { doc, app } = setup();
        await app.start();
        app.stop();
        const event = press(doc, { key: "q", code: "KeyQ", altKey: true });
        assert.equal(event.defaultPrevented, false);
        assert.notEqual(doc.activeElement, doc.querySelector("input.search-bar__input"));
    });
});

// ============================================================================
// 擴充功能 context 失效
// ============================================================================

describe("App：擴充功能更新後 context 失效", () => {
    test("狀態列提示重新整理，監看迴圈停止", async () => {
        const realSetInterval = globalThis.setInterval;
        const realClearInterval = globalThis.clearInterval;
        const intervals = new Set<unknown>();
        const cleared = new Set<unknown>();
        globalThis.setInterval = ((fn: () => void, ms?: number) => {
            const id = realSetInterval(fn, ms);
            intervals.add(id);
            return id;
        }) as typeof setInterval;
        globalThis.clearInterval = ((id: Parameters<typeof clearInterval>[0]) => {
            cleared.add(id);
            realClearInterval(id);
        }) as typeof clearInterval;
        try {
            const { doc, fake, app } = setup();
            await app.start();
            await waitFor(() => allSettled(doc), 1500);
            assert.equal(intervals.size, 1, "one watch loop");

            fake.invalidate();
            app.tick();
            const status = card(doc)?.querySelector<HTMLElement>("[data-role='status']");
            assert.match(status?.textContent ?? "", /擴充功能已更新，請重新整理頁面/);
            assert.ok(status?.classList.contains("fi-card__status--warn"));
            for (const id of intervals) assert.ok(cleared.has(id), "watch loop interval cleared");

            // 停止後不再反應頁面變化，也不再送出訊息
            const sent = fake.sent.length;
            setStockOnPage(doc, "2454", "聯發科");
            app.tick();
            await flush(10);
            assert.equal(card(doc)?.dataset.stockId, "2330");
            assert.equal(fake.sent.length, sent);
            assert.match(status?.textContent ?? "", /請重新整理頁面/);
        } finally {
            globalThis.setInterval = realSetInterval;
            globalThis.clearInterval = realClearInterval;
        }
    });

    test("資料載入中 context 失效 → 之後到達的區塊結果不會蓋掉重新整理提示", async () => {
        const { doc, fake, app } = setup();
        // background 延遲回應，確保 context 失效時請求仍在進行中
        fake.setHandler(async (message) => {
            await new Promise((r) => setTimeout(r, 30));
            return backgroundHandler(message);
        });
        await app.start();
        assert.ok(card(doc));
        fake.invalidate();
        app.tick();
        assert.match(card(doc)?.querySelector("[data-role='status']")?.textContent ?? "", /請重新整理頁面/);
        await flush(80);
        // 迴歸：修正前，稍後到達的資料會把狀態列改寫為「更新於 HH:MM:SS」，提示因此消失
        assert.match(card(doc)?.querySelector("[data-role='status']")?.textContent ?? "", /請重新整理頁面/);
    });

    test("重新整理時才發現 context 失效（ExtensionContextError）→ 停止監看、不再送出訊息", async () => {
        const { doc, fake, app } = setup();
        await app.start();
        await waitFor(() => allSettled(doc), 1500);
        fake.invalidate();
        // 使用者按下重新整理：送出請求時才發現 context 失效（tick 尚未偵測到）
        card(doc)?.querySelector<HTMLElement>("[data-action='refresh']")?.click();
        await flush(10);
        const sent = fake.sent.length;
        setStockOnPage(doc, "2454", "聯發科");
        app.tick();
        await flush(10);
        assert.equal(card(doc)?.dataset.stockId, "2330");
        assert.equal(fake.sent.length, sent);
    });

    test("重新整理時才發現 context 失效 → 狀態列保留重新整理提示", async () => {
        const { doc, fake, app } = setup();
        await app.start();
        await waitFor(() => allSettled(doc), 1500);
        fake.invalidate();
        card(doc)?.querySelector<HTMLElement>("[data-action='refresh']")?.click();
        await flush(10);
        // 迴歸：修正前，所有區塊以 ExtensionContextError 結束後 finish() 會把狀態列清成空字串
        const status = card(doc)?.querySelector<HTMLElement>("[data-role='status']");
        assert.match(status?.textContent ?? "", /擴充功能已更新，請重新整理頁面/);
        assert.ok(status?.classList.contains("fi-card__status--warn"));
    });
});
