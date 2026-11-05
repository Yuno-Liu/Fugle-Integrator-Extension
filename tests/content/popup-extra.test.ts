/**
 * 彈出視窗鏡像（PopupMirror）補充測試：重新渲染後的焦點、摘要跳轉捲動、detach、
 * focusSelectorFor，以及在彈出視窗文件中開啟搜尋視窗（跨 window）。
 * 以第二個 jsdom 視窗模擬 window.open 取得的彈出視窗。
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl } from "../helpers/chrome";
import { flush, setupFuglePage, waitFor } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { PopupMirror, focusSelectorFor } from "../../src/content/popup";
import { openSearch } from "../../src/content/search";
import type { RelatedStock } from "../../src/shared/types";

let env: DomEnv;
let popupDom: JSDOM;
let popupClosed: boolean;

/** 頁面上的卡片（簡化版，結構與 InfoCard 相同的關鍵屬性） */
const CARD_HTML =
    '<div class="fi-card__header" data-role="header"><span data-role="name">台積電</span>' +
    '<div class="fi-card__status" data-role="status">更新於 13:00:00</div>' +
    '<div class="fi-summary" data-role="summary"><button type="button" class="fi-summary__item" data-action="goto" data-section="finance">本益比</button></div>' +
    '<button type="button" data-action="refresh">⟳</button><button type="button" data-action="popout">❐</button></div>' +
    '<div class="fi-card__body">' +
    '<section class="fi-section" data-section="basic"><button type="button" class="fi-section__header" data-action="toggle-section" data-section="basic" aria-expanded="true">基本資料</button><div class="fi-section__body">內容</div></section>' +
    '<section class="fi-section" data-section="finance"><button type="button" class="fi-section__header" data-action="toggle-section" data-section="finance" aria-expanded="false">財務指標</button><div class="fi-section__body" hidden>財務</div></section>' +
    "</div>";

function pageCard(): HTMLElement {
    const card = document.createElement("div");
    card.id = "fi-card";
    card.innerHTML = CARD_HTML;
    document.body.appendChild(card);
    return card;
}

/** 模擬 InfoCard.handleAction：在頁面卡片上切換區塊 / 展開跳轉的區塊 */
function cardActions(card: HTMLElement, log: string[]): (target: HTMLElement) => void {
    return (target) => {
        log.push(`${target.dataset.action}:${target.dataset.section ?? ""}`);
        const id = target.dataset.section ?? "";
        const header = card.querySelector<HTMLElement>(`.fi-section[data-section="${id}"] .fi-section__header`);
        const body = card.querySelector<HTMLElement>(`.fi-section[data-section="${id}"] .fi-section__body`);
        if (!header || !body) return;
        if (target.dataset.action === "toggle-section") {
            body.hidden = !body.hidden;
            header.setAttribute("aria-expanded", body.hidden ? "false" : "true");
        } else if (target.dataset.action === "goto") {
            body.hidden = false;
            header.setAttribute("aria-expanded", "true");
        }
    };
}

function makeMirror(card: () => HTMLElement | null, onAction: (target: HTMLElement) => void = () => undefined): PopupMirror {
    return new PopupMirror({
        getCard: card,
        getTitle: () => "台積電（2330）· 富果整合器",
        getTheme: () => "light",
        onAction: (target) => onAction(target),
    });
}

const popupDoc = (): Document => popupDom.window.document;
const clickIn = (el: Element): MouseEvent => {
    const event = new popupDom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(event);
    return event as unknown as MouseEvent;
};

beforeEach(() => {
    env = setupFuglePage();
    popupDom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "about:blank", pretendToBeVisual: true });
    popupClosed = false;
    Object.defineProperty(popupDom.window, "closed", { configurable: true, get: () => popupClosed });
    popupDom.window.focus = () => undefined; // jsdom 未實作 Window.focus()
    env.window.open = (() => popupDom.window) as unknown as typeof window.open;
});

afterEach(() => {
    popupDom.window.close();
    env.cleanup();
});

// ============================================================================
// 焦點保留
// ============================================================================

describe("PopupMirror：重新渲染後恢復焦點", () => {
    test("點擊 toggle-section 改變卡片 → 重新渲染後焦點回到同一個控制項（新節點）", async () => {
        const card = pageCard();
        const log: string[] = [];
        const mirror = makeMirror(() => card, cardActions(card, log));
        assert.equal(mirror.open(), true);

        const doc = popupDoc();
        const button = doc.querySelector<HTMLElement>("[data-action='toggle-section'][data-section='basic']");
        assert.ok(button);
        button.focus();
        assert.equal(doc.activeElement, button);

        clickIn(button);
        assert.deepEqual(log, ["toggle-section:basic"]);
        // 防抖（60ms）後重新渲染
        await waitFor(() => doc.querySelector("[data-action='toggle-section'][data-section='basic']") !== button, 300);
        const fresh = doc.querySelector<HTMLElement>("[data-action='toggle-section'][data-section='basic']");
        assert.ok(fresh && fresh !== button, "re-rendered");
        assert.equal(fresh.getAttribute("aria-expanded"), "false", "mirrors the page card");
        assert.equal(doc.activeElement, fresh, "focus restored to the same control");
    });

    test("焦點不在卡片內時，重新渲染不會搶焦點", async () => {
        const card = pageCard();
        const mirror = makeMirror(() => card);
        mirror.open();
        const doc = popupDoc();
        assert.equal(doc.activeElement, doc.body);
        (card.querySelector("[data-role='name']") as HTMLElement).textContent = "聯電";
        mirror.syncNow();
        assert.equal(doc.querySelector("#fi-card [data-role='name']")?.textContent, "聯電");
        assert.equal(doc.activeElement, doc.body);
    });
});

// ============================================================================
// 摘要跳轉
// ============================================================================

describe("PopupMirror：摘要 goto", () => {
    test("goto 交給 onAction 展開區塊，立即同步並在彈出視窗內捲動、聚焦區塊標題", () => {
        const card = pageCard();
        const log: string[] = [];
        const mirror = makeMirror(() => card, cardActions(card, log));
        mirror.open();
        const doc = popupDoc();
        const win = popupDom.window;

        const scrolls: Array<ScrollToOptions | undefined> = [];
        win.scrollTo = ((opts?: ScrollToOptions) => scrolls.push(opts)) as typeof win.scrollTo;
        // 讓區塊位於視窗下方 640px
        const realRect = win.HTMLElement.prototype.getBoundingClientRect;
        win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
            if (this.matches(".fi-section[data-section='finance']")) return { top: 640, bottom: 700, left: 0, right: 0, width: 0, height: 60, x: 0, y: 640, toJSON: () => ({}) } as DOMRect;
            return realRect.call(this);
        };
        try {
            const chip = doc.querySelector<HTMLElement>("#fi-card [data-action='goto'][data-section='finance']");
            assert.ok(chip);
            clickIn(chip);

            assert.deepEqual(log, ["goto:finance"]);
            // 不等防抖：goto 會立即同步
            const body = doc.querySelector<HTMLElement>("#fi-card .fi-section[data-section='finance'] .fi-section__body");
            assert.equal(body?.hidden, false, "expanded in the popup immediately");
            assert.equal(scrolls.length, 1);
            assert.equal(scrolls[0]?.top, 640);
            assert.equal(scrolls[0]?.behavior, "smooth");
            assert.equal(doc.activeElement, doc.querySelector("#fi-card .fi-section[data-section='finance'] .fi-section__header"));
        } finally {
            win.HTMLElement.prototype.getBoundingClientRect = realRect;
        }
    });

    test("goto 的區塊 id 不合法或不存在時不捲動", () => {
        const card = pageCard();
        card.querySelector("[data-action='goto']")?.setAttribute("data-section", "nope");
        const mirror = makeMirror(() => card);
        mirror.open();
        const scrolls: unknown[] = [];
        popupDom.window.scrollTo = ((opts?: unknown) => scrolls.push(opts)) as typeof popupDom.window.scrollTo;
        const chip = popupDoc().querySelector<HTMLElement>("#fi-card [data-action='goto']");
        assert.ok(chip);
        clickIn(chip);
        chip.setAttribute("data-section", 'x"]');
        clickIn(chip);
        assert.equal(scrolls.length, 0);
    });
});

// ============================================================================
// detach
// ============================================================================

describe("PopupMirror.detach", () => {
    test("標示已停止同步、清除擁有者；之後的點擊不再轉交，卡片變更也不再同步", async () => {
        const card = pageCard();
        const log: string[] = [];
        const mirror = makeMirror(() => card, cardActions(card, log));
        mirror.open();
        const doc = popupDoc();

        mirror.detach();
        const status = doc.querySelector<HTMLElement>("#fi-card [data-role='status']");
        assert.match(status?.textContent ?? "", /已停止同步/);
        assert.ok(status?.classList.contains("fi-card__status--warn"));
        assert.equal(doc.documentElement.dataset.fiOwner, "");
        assert.equal(mirror.isOpen(), false);

        const button = doc.querySelector<HTMLElement>("[data-action='toggle-section'][data-section='basic']");
        assert.ok(button);
        clickIn(button);
        assert.deepEqual(log, [], "click ignored after detach");

        (card.querySelector("[data-role='name']") as HTMLElement).textContent = "聯電";
        mirror.syncNow();
        mirror.sync();
        await flush(90);
        assert.equal(doc.querySelector("#fi-card [data-role='name']")?.textContent, "台積電", "no longer mirrored");
        assert.match(doc.querySelector("#fi-card [data-role='status']")?.textContent ?? "", /已停止同步/);
    });

    test("detach 取消尚未執行的防抖同步", async () => {
        const card = pageCard();
        const mirror = makeMirror(() => card);
        mirror.open();
        (card.querySelector("[data-role='name']") as HTMLElement).textContent = "聯電";
        mirror.sync();
        mirror.detach();
        await flush(90);
        assert.equal(popupDoc().querySelector("#fi-card [data-role='name']")?.textContent, "台積電");
    });

    test("未開啟或視窗已關閉時 detach 不會出錯", () => {
        const card = pageCard();
        const mirror = makeMirror(() => card);
        assert.doesNotThrow(() => mirror.detach());
        mirror.open();
        popupClosed = true;
        assert.doesNotThrow(() => mirror.detach());
        assert.doesNotMatch(popupDoc().body.textContent ?? "", /已停止同步/);
    });

    test("detach 後在新頁面重新 open 會重新接手同一個視窗", () => {
        const card = pageCard();
        const log: string[] = [];
        const mirror = makeMirror(() => card, cardActions(card, log));
        mirror.open();
        mirror.detach();
        assert.equal(popupDoc().documentElement.dataset.fiOwner, "");
        assert.equal(mirror.open(), true);
        assert.ok(popupDoc().documentElement.dataset.fiOwner, "ownership re-claimed");
        assert.equal(mirror.isOpen(), true);
        const button = popupDoc().querySelector<HTMLElement>("[data-action='toggle-section'][data-section='basic']");
        assert.ok(button);
        clickIn(button);
        // 📌 jsdom 的 document.open() 不會清除監聽器（瀏覽器會）；點擊處理器是固定的函式參照，
        //    重新綁定同一文件時不會重複註冊，因此兩種環境都只轉交一次
        assert.deepEqual(log, ["toggle-section:basic"]);
        assert.doesNotMatch(popupDoc().querySelector("#fi-card [data-role='status']")?.textContent ?? "", /已停止同步/);
    });
});

// ============================================================================
// focusSelectorFor
// ============================================================================

describe("focusSelectorFor", () => {
    const make = (tag: string, attrs: Record<string, string>): Element => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
    };

    test("依識別屬性組出選擇器（依固定順序）", () => {
        assert.equal(focusSelectorFor(make("button", { "data-section": "basic", "data-action": "toggle-section", class: "x" })), 'button[data-action="toggle-section"][data-section="basic"]');
        assert.equal(focusSelectorFor(make("a", { href: "/ai/2303", "data-fi-nav": "2303" })), 'a[data-fi-nav="2303"]');
        assert.equal(focusSelectorFor(make("button", { "data-action": "category", "data-type": "產業", "data-name": "晶圓代工" })), 'button[data-action="category"][data-type="產業"][data-name="晶圓代工"]');
    });

    test("組出的選擇器能找回同一個元素", () => {
        const host = document.createElement("div");
        host.innerHTML = '<button data-action="category" data-type="概念" data-name="AI 伺服器">x</button><button data-action="category" data-type="概念" data-name="散熱">y</button>';
        const target = host.lastElementChild;
        assert.ok(target);
        const selector = focusSelectorFor(target);
        assert.ok(selector);
        assert.equal(host.querySelector(selector), target);
    });

    const unsafe: Array<[string, Record<string, string>]> = [
        ["雙引號", { "data-action": "category", "data-name": 'A"B' }],
        ["反斜線", { "data-action": "category", "data-name": "A\\B" }],
        ["選擇器注入", { "data-action": "goto", "data-section": '"],[data-x="' }],
    ];
    for (const [why, attrs] of unsafe) {
        test(`值含${why} → null`, () => {
            assert.equal(focusSelectorFor(make("button", attrs)), null);
        });
    }

    test("沒有任何識別屬性 → null", () => {
        assert.equal(focusSelectorFor(make("button", { class: "fi-icon-btn", title: "x" })), null);
    });
});

// ============================================================================
// 在彈出視窗中開啟搜尋視窗
// ============================================================================

describe("openSearch：在彈出視窗文件中開啟", () => {
    const STOCKS: RelatedStock[] = [
        { code: "2330", name: "台積電", capital: 2593.24 },
        { code: "2303", name: "聯電", capital: 1254.2 },
        { code: "2454", name: "聯發科", capital: 160.03 },
    ];
    let fake: FakeChromeControl;

    beforeEach(() => {
        fake = installFakeChrome({
            handler: (msg) => (msg.type === "category" ? { ok: true, data: STOCKS } : { ok: true, data: { stocks: [], categories: [] } }),
        });
    });
    afterEach(() => {
        fake.uninstall();
    });

    test("對話框渲染在彈出視窗內（不在頁面）；分類篩選可用；點擊個股呼叫 navigate", async () => {
        const doc = popupDoc();
        const navigated: string[] = [];
        const modal = openSearch({ currentStockId: () => "2330", navigate: (code) => navigated.push(code) }, { type: "產業", name: "半導體業" }, doc);
        try {
            assert.equal(modal.root.ownerDocument, doc);
            assert.ok(doc.getElementById("fi-search-modal"), "modal in popup document");
            assert.equal(document.getElementById("fi-search-modal"), null, "not in the page");

            const results = modal.body.querySelector<HTMLElement>("#fi-search-results");
            assert.ok(results);
            await waitFor(() => results.querySelector("[data-filter]") !== null, 1000);
            assert.deepEqual(fake.sent.filter((m) => m.type === "category"), [{ type: "category", categoryType: "產業", name: "半導體業" }]);
            const filter = results.querySelector<HTMLInputElement>("[data-filter]");
            assert.ok(filter);
            assert.equal(doc.activeElement, filter, "filter focused inside the popup");

            const chips = [...results.querySelectorAll<HTMLElement>(".fi-search__grid [data-code]")];
            assert.deepEqual(
                chips.map((c) => c.dataset.code),
                ["2330", "2303", "2454"]
            );
            // 篩選：事件與元素都來自彈出視窗（不同 window 的建構函式）
            filter.value = "聯";
            filter.dispatchEvent(new popupDom.window.Event("input", { bubbles: true }));
            assert.deepEqual(
                chips.filter((c) => !c.hidden).map((c) => c.dataset.code),
                ["2303", "2454"]
            );
            filter.value = "";
            filter.dispatchEvent(new popupDom.window.Event("input", { bubbles: true }));
            assert.equal(chips.filter((c) => c.hidden).length, 0);

            const target = results.querySelector<HTMLElement>("[data-code='2454']");
            assert.ok(target);
            const event = clickIn(target);
            assert.equal(event.defaultPrevented, true, "SPA navigation instead of following the link");
            assert.deepEqual(navigated, ["2454"]);
            assert.equal(modal.root.isConnected, false, "modal closed");
            assert.equal(doc.getElementById("fi-search-modal"), null);
        } finally {
            modal.close();
            await flush(5);
        }
    });

    test("彈出視窗內按 Esc 關閉搜尋視窗", async () => {
        const doc = popupDoc();
        const modal = openSearch({ currentStockId: () => "2330", navigate: () => undefined }, { type: "概念", name: "AI" }, doc);
        try {
            const results = modal.body.querySelector<HTMLElement>("#fi-search-results");
            assert.ok(results);
            await waitFor(() => results.querySelector("[data-filter]") !== null, 1000);
            const esc = new popupDom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
            results.querySelector("[data-filter]")?.dispatchEvent(esc);
            assert.equal(modal.root.isConnected, false);
            assert.equal(doc.getElementById("fi-search-modal"), null);
        } finally {
            modal.close();
            await flush(5);
        }
    });
});
