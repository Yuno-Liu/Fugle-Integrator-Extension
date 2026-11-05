/**
 * content script 控制器（App）補充測試：浮動卡片定位、彈出視窗、pagehide、
 * 快捷鍵與對話框、其他分頁的區塊設定、自動主題的背景亮度檢查頻率。
 * chrome 替身扮演 background 並以 fixtures 回應資料集；每個測試結束都會 app.stop()。
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fixture } from "../helpers/fixtures";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl } from "../helpers/chrome";
import { flush, setupFuglePage, waitFor } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { App } from "../../src/content/app";
import { CARD_ID } from "../../src/content/card";
import { TOOLBAR_ID } from "../../src/content/toolbar";
import { SECTIONS } from "../../src/content/sections";
import { parseBasic, parseCapacity, parseEtfHoldings, parseNames, parseRatings, parseRelations } from "../../src/core/esun";
import { summarizeMajor, toMajorPeriod } from "../../src/core/major";
import { buildMarketSnapshot, indexMarketList } from "../../src/core/market";
import type { MarketIndex } from "../../src/core/market";
import { LOCAL_KEYS } from "../../src/shared/constants";
import type { MarketListId } from "../../src/shared/constants";
import type { DatasetMap, DatasetName } from "../../src/shared/messages";
import type { RelatedGroups } from "../../src/shared/types";

// ============================================================================
// background 替身（真實 fixtures）
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

function backgroundHandler(message: { type: string; name?: DatasetName }): unknown {
    if (message.type === "dataset" && message.name) return { ok: true, data: { data: DATA[message.name], meta: { fetchedAt: Date.now(), stale: false } } };
    if (message.type === "related") return { ok: true, data: RELATED };
    if (message.type === "search") return { ok: true, data: { stocks: [], categories: [] } };
    if (message.type === "category") return { ok: true, data: [] };
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
const cleanups: Array<() => void> = [];

function setup(options: { local?: Record<string, unknown> } = {}): Ctx {
    const env = setupFuglePage();
    const fake = installFakeChrome({ handler: backgroundHandler, local: options.local });
    const app = new App();
    active = { env, doc: env.document, fake, app };
    return active;
}

afterEach(async () => {
    const ctx = active;
    active = null;
    if (!ctx) return;
    try {
        ctx.app.stop();
        await flush(20);
    } finally {
        while (cleanups.length) {
            try {
                cleanups.pop()?.();
            } catch {
                // 忽略
            }
        }
        ctx.fake.uninstall();
        ctx.env.cleanup();
    }
});

/** 暫時把 Date.now() 往後推 */
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
const statusText = (doc: Document): string => card(doc)?.querySelector("[data-role='status']")?.textContent ?? "";
const allSettled = (doc: Document): boolean => {
    const sections = [...(card(doc)?.querySelectorAll<HTMLElement>(".fi-section") ?? [])];
    return sections.length === SECTIONS.length && sections.every((s) => s.dataset.state !== "loading");
};

/** 讓元素的 getBoundingClientRect 回傳指定的下緣（可隨時修改） */
function stubBottom(el: Element | null, box: { bottom: number }): void {
    assert.ok(el, "element to stub");
    Object.defineProperty(el, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ x: 0, y: 0, top: box.bottom - 50, left: 0, right: 0, width: 0, height: 50, bottom: box.bottom, toJSON: () => ({}) }),
    });
}

function setInnerHeight(win: Window, value: number): void {
    Object.defineProperty(win, "innerHeight", { configurable: true, value });
}

/** 以第二個 jsdom 視窗模擬 window.open 取得的彈出視窗（jsdom 沒有 window.closed，以 getter 控制） */
function fakePopupWindow(): { win: Window; setClosed(closed: boolean): void } {
    const popup = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "about:blank" });
    let closed = false;
    Object.defineProperty(popup.window, "closed", { configurable: true, get: () => closed });
    popup.window.focus = () => undefined; // jsdom 未實作 Window.focus()
    cleanups.push(() => popup.window.close());
    return { win: popup.window as unknown as Window, setClosed: (c) => (closed = c) };
}

// ============================================================================
// 浮動卡片定位
// ============================================================================

describe("App：浮動資訊卡位置（--fi-card-top）", () => {
    test("對齊富果個股頁首下緣 + 8px；捲動後重新計算，最低不高於導覽列下緣 + 8px", async () => {
        const { env, doc, app } = setup();
        const navBox = { bottom: 60 };
        const headerBox = { bottom: 200 };
        stubBottom(doc.querySelector("header.header"), navBox);
        stubBottom(doc.querySelector(".card-group-header"), headerBox);
        setInnerHeight(env.window, 1000);

        await app.start();
        const el = card(doc);
        assert.ok(el);
        assert.ok(el.classList.contains("fi-card--floating"));
        assert.equal(el.style.getPropertyValue("--fi-card-top"), "208px");

        // 往下捲：頁首移出畫面 → 卡片貼齊導覽列下方
        headerBox.bottom = -300;
        env.window.dispatchEvent(new env.window.Event("scroll"));
        await waitFor(() => el.style.getPropertyValue("--fi-card-top") === "68px", 500);

        // 捲回一半
        headerBox.bottom = 150;
        env.window.dispatchEvent(new env.window.Event("scroll"));
        await waitFor(() => el.style.getPropertyValue("--fi-card-top") === "158px", 500);
    });

    test("頁首很低時不超過視窗高度的 45%", async () => {
        const { env, doc, app } = setup();
        stubBottom(doc.querySelector("header.header"), { bottom: 60 });
        stubBottom(doc.querySelector(".card-group-header"), { bottom: 900 });
        setInnerHeight(env.window, 1000);
        await app.start();
        assert.equal(card(doc)?.style.getPropertyValue("--fi-card-top"), "450px");
    });

    test("連續多次 scroll 事件只在下一個動畫影格計算一次", async () => {
        const { env, doc, app } = setup();
        let reads = 0;
        const headerBox = { bottom: 200 };
        const header = doc.querySelector(".card-group-header");
        assert.ok(header);
        Object.defineProperty(header, "getBoundingClientRect", {
            configurable: true,
            value: () => {
                reads++;
                return { top: 0, bottom: headerBox.bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
            },
        });
        stubBottom(doc.querySelector("header.header"), { bottom: 60 });
        setInnerHeight(env.window, 1000);
        await app.start();
        const before = reads;
        headerBox.bottom = 100;
        for (let i = 0; i < 5; i++) env.window.dispatchEvent(new env.window.Event("scroll"));
        await waitFor(() => card(doc)?.style.getPropertyValue("--fi-card-top") === "108px", 500);
        await flush(40);
        assert.equal(reads - before, 1, "one layout read per animation frame");
    });

    test("嵌入模式（非浮動）不設定 --fi-card-top", async () => {
        const { env, doc, app } = setup({ local: { [LOCAL_KEYS.position]: "default" } });
        stubBottom(doc.querySelector("header.header"), { bottom: 60 });
        stubBottom(doc.querySelector(".card-group-header"), { bottom: 200 });
        setInnerHeight(env.window, 1000);
        await app.start();
        env.window.dispatchEvent(new env.window.Event("scroll"));
        await flush(40);
        assert.equal(card(doc)?.style.getPropertyValue("--fi-card-top"), "");
    });
});

// ============================================================================
// 彈出視窗
// ============================================================================

describe("App：彈出視窗", () => {
    test("瀏覽器阻擋 window.open（回傳 null）→ 狀態列提示允許彈出視窗，卡片保持顯示", async () => {
        const { env, doc, app } = setup();
        env.window.open = (() => null) as typeof window.open;
        await app.start();
        await waitFor(() => allSettled(doc), 1500);
        card(doc)?.querySelector<HTMLElement>("[data-action='popout']")?.click();
        assert.match(statusText(doc), /瀏覽器阻擋了彈出視窗/);
        assert.ok(card(doc)?.querySelector("[data-role='status']")?.classList.contains("fi-card__status--warn"));
        assert.equal(card(doc)?.hidden, false);
    });

    test("彈出視窗開啟期間隱藏頁面卡片；視窗關閉後下一次 tick 恢復顯示", async () => {
        const { env, doc, app } = setup();
        const popup = fakePopupWindow();
        const opened: string[] = [];
        env.window.open = ((_url: string, name: string) => {
            opened.push(name);
            return popup.win;
        }) as typeof window.open;
        await app.start();
        await waitFor(() => allSettled(doc), 1500);

        doc.querySelector<HTMLElement>(`#${TOOLBAR_ID} [data-action='popout']`)?.click();
        assert.deepEqual(opened, ["FugleIntegratorCard"]);
        assert.equal(card(doc)?.hidden, true, "page card hidden while popup is open");
        assert.equal(popup.win.document.querySelector("#fi-card [data-role='name']")?.textContent, "台積電", "popup mirrors the card");

        app.tick();
        assert.equal(card(doc)?.hidden, true, "still hidden while open");

        popup.setClosed(true);
        app.tick();
        assert.equal(card(doc)?.hidden, false, "restored after the popup closed");
    });

    test("pagehide → 彈出視窗顯示「已停止同步」", async () => {
        const { env, doc, app } = setup();
        const popup = fakePopupWindow();
        env.window.open = (() => popup.win) as typeof window.open;
        await app.start();
        await waitFor(() => allSettled(doc), 1500);
        card(doc)?.querySelector<HTMLElement>("[data-action='popout']")?.click();
        const popupStatus = (): HTMLElement | null => popup.win.document.querySelector<HTMLElement>("#fi-card [data-role='status']");
        assert.ok(popupStatus());
        assert.doesNotMatch(popupStatus()?.textContent ?? "", /已停止同步/);

        env.window.dispatchEvent(new env.window.Event("pagehide"));
        assert.match(popupStatus()?.textContent ?? "", /已停止同步/);
        assert.ok(popupStatus()?.classList.contains("fi-card__status--warn"));
    });
});

// ============================================================================
// 快捷鍵與整合器對話框
// ============================================================================

describe("App：快捷鍵與整合器搜尋視窗", () => {
    test("搜尋視窗開著時按 Alt+Q → 先關閉視窗再聚焦富果搜尋框", async () => {
        const { env, doc, app } = setup();
        await app.start();
        doc.querySelector<HTMLElement>(`#${TOOLBAR_ID} [data-action='search']`)?.click();
        const modal = doc.getElementById("fi-search-modal");
        assert.ok(modal?.isConnected, "integrator search modal open");

        const event = new env.window.KeyboardEvent("keydown", { key: "q", code: "KeyQ", altKey: true, bubbles: true, cancelable: true });
        doc.body.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
        assert.equal(doc.getElementById("fi-search-modal"), null, "modal closed first");
        assert.equal(doc.activeElement, doc.querySelector("input.search-bar__input"));
        // 焦點延遲設定（setTimeout 0）不應把焦點搶回已關閉的對話框
        await flush(10);
        assert.equal(doc.activeElement, doc.querySelector("input.search-bar__input"));
    });

    test("頁面沒有富果搜尋框 → 改開整合器搜尋視窗", async () => {
        const { env, doc, app } = setup();
        doc.querySelectorAll("input.search-bar__input, header input[type='search'], #ember14").forEach((el) => el.remove());
        await app.start();
        doc.body.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "q", code: "KeyQ", altKey: true, bubbles: true, cancelable: true }));
        assert.ok(doc.getElementById("fi-search-modal"));
    });
});

// ============================================================================
// 其他分頁 / 設定頁變更區塊展開狀態
// ============================================================================

describe("App：chrome.storage 的 fi.sections 變更", () => {
    test("其他 context 寫入 fi.sections → 套用到目前的卡片", async () => {
        const { doc, app } = setup();
        await app.start();
        const body = (id: string): HTMLElement | null => card(doc)?.querySelector<HTMLElement>(`.fi-section[data-section="${id}"] .fi-section__body`) ?? null;
        const expanded = (id: string): string | null | undefined => card(doc)?.querySelector(`.fi-section[data-section="${id}"] .fi-section__header`)?.getAttribute("aria-expanded");
        assert.equal(body("basic")?.hidden, false);
        assert.equal(body("capacity")?.hidden, true);

        await chrome.storage.local.set({ [LOCAL_KEYS.sections]: { basic: false, capacity: true } });
        await waitFor(() => body("basic")?.hidden === true, 500);
        assert.equal(expanded("basic"), "false");
        assert.equal(body("capacity")?.hidden, false);
        assert.equal(expanded("capacity"), "true");
        assert.deepEqual(app.settings.get().sections, { basic: false, capacity: true });

        // 設定頁「重設」：移除 → 全部回到預設
        await chrome.storage.local.remove(LOCAL_KEYS.sections);
        await waitFor(() => body("basic")?.hidden === false, 500);
        assert.equal(body("capacity")?.hidden, true);
    });
});

// ============================================================================
// 主題 auto：背景亮度檢查頻率
// ============================================================================

describe("App：主題 auto 且沒有深色標記時的背景檢查", () => {
    test("getComputedStyle 檢查最多每 15 秒一次；背景變深後於下一次檢查切換為深色", async () => {
        const { env, doc, app } = setup();
        const realGcs = env.window.getComputedStyle.bind(env.window);
        let calls = 0;
        let dark = false;
        env.window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
            calls++;
            const style = realGcs(el, pseudo ?? undefined);
            if (!dark) return style;
            return new Proxy(style, { get: (t, p) => (p === "backgroundColor" ? "rgb(18, 18, 18)" : Reflect.get(t, p)) });
        }) as typeof window.getComputedStyle;

        await app.start();
        assert.equal(app.settings.get().theme, "auto");
        assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "light");
        const afterStart = calls;
        assert.ok(afterStart > 0, "checked once at start");

        dark = true;
        // 主題檢查每 1.5 秒一次，但背景檢查要等 15 秒
        for (const ahead of [2_000, 5_000, 10_000, 14_000]) {
            withClockAhead(ahead, () => app.tick());
            assert.equal(calls, afterStart, `no getComputedStyle at +${ahead}ms`);
            assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "light");
        }

        withClockAhead(16_000, () => app.tick());
        assert.ok(calls > afterStart, "background re-checked after 15s");
        assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "dark");

        const afterSecond = calls;
        withClockAhead(20_000, () => app.tick());
        assert.equal(calls, afterSecond, "next check waits another 15s");
    });

    test("有深色標記時完全不呼叫 getComputedStyle", async () => {
        const { env, doc, app } = setup();
        (doc.querySelector(".body") ?? doc.body).classList.add("dark-theme");
        let calls = 0;
        const realGcs = env.window.getComputedStyle.bind(env.window);
        env.window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
            calls++;
            return realGcs(el, pseudo ?? undefined);
        }) as typeof window.getComputedStyle;
        await app.start();
        withClockAhead(20_000, () => app.tick());
        assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "dark");
        assert.equal(calls, 0);
    });
});
