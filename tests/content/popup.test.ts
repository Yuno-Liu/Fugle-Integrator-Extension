/**
 * 彈出視窗鏡像（src/content/popup.ts）
 * 以第二個 jsdom 視窗模擬 window.open 取得的彈出視窗。
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupFuglePage } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { PopupMirror } from "../../src/content/popup";

let env: DomEnv;
let popupDom: JSDOM;
let openCalls: Array<{ name: string; features: string }>;

function cardElement(html: string): HTMLElement {
    const card = document.createElement("div");
    card.id = "fi-card";
    card.innerHTML = html;
    document.body.appendChild(card);
    return card;
}

const CARD_HTML =
    '<div class="fi-card__header" data-role="header"><span data-role="name">台積電</span>' +
    '<button data-action="refresh">⟳</button><button data-action="popout">❐</button><button data-action="cycle-position">⇄</button><button data-action="hide-card">✕</button></div>' +
    '<div class="fi-card__body"><section class="fi-section" data-section="basic"><button class="fi-section__header" data-action="toggle-section" data-section="basic">基本資料</button></section>' +
    '<a href="/ai/2303" data-fi-nav="2303">聯電</a></div>';

function makeMirror(card: () => HTMLElement | null, onAction: (target: HTMLElement) => void = () => undefined): PopupMirror {
    return new PopupMirror({
        getCard: card,
        getTitle: () => "台積電（2330）· 富果整合器",
        getTheme: () => "dark",
        onAction: (target) => onAction(target),
    });
}

beforeEach(() => {
    env = setupFuglePage();
    popupDom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "about:blank" });
    openCalls = [];
    (globalThis as any).screen = { availWidth: 1920, availHeight: 1080 };
    env.window.open = ((_url: string, name: string, features: string) => {
        openCalls.push({ name, features });
        return popupDom.window;
    }) as any;
    (globalThis as any).window.open = env.window.open;
});

afterEach(() => {
    popupDom.window.close();
    env.cleanup();
});

describe("PopupMirror", () => {
    test("open() 建立文件：樣式、主題、標題與卡片內容；移除彈出視窗不需要的控制項", () => {
        const card = cardElement(CARD_HTML);
        const mirror = makeMirror(() => card);
        assert.equal(mirror.open(), true);
        assert.equal(openCalls.length, 1);
        assert.equal(openCalls[0]?.name, "FugleIntegratorCard");

        const doc = popupDom.window.document;
        assert.equal(doc.documentElement.getAttribute("data-fi-theme"), "dark");
        assert.equal(doc.title, "台積電（2330）· 富果整合器");
        assert.ok(doc.querySelectorAll("style").length >= 2, "注入主樣式與彈出視窗樣式");
        const mirrored = doc.getElementById("fi-card");
        assert.ok(mirrored);
        assert.equal(mirrored.querySelector("[data-role='name']")?.textContent, "台積電");
        assert.ok(mirrored.querySelector("[data-action='refresh']"), "保留重新整理");
        for (const action of ["popout", "cycle-position", "hide-card"]) {
            assert.equal(mirrored.querySelector(`[data-action='${action}']`), null, `移除 ${action}`);
        }
    });

    test("syncNow() 反映卡片變更；內容沒變時不重寫", () => {
        const card = cardElement(CARD_HTML);
        const mirror = makeMirror(() => card);
        mirror.open();
        const doc = popupDom.window.document;
        const before = doc.getElementById("fi-card")?.firstElementChild;

        mirror.syncNow();
        assert.equal(doc.getElementById("fi-card")?.firstElementChild, before, "未變更時保留同一批節點");

        (card.querySelector("[data-role='name']") as HTMLElement).textContent = "聯電";
        mirror.syncNow();
        assert.equal(doc.querySelector("#fi-card [data-role='name']")?.textContent, "聯電");
    });

    test("卡片不存在（非個股頁）時顯示提示", () => {
        let card: HTMLElement | null = cardElement(CARD_HTML);
        const mirror = makeMirror(() => card);
        mirror.open();
        card = null;
        mirror.syncNow();
        assert.match(popupDom.window.document.getElementById("fi-card")?.textContent ?? "", /不是個股頁/);
    });

    test("彈出視窗中的點擊轉交給頁面卡片處理", () => {
        const card = cardElement(CARD_HTML);
        const handled: string[] = [];
        const mirror = makeMirror(
            () => card,
            (target) => handled.push(target.dataset.action ?? `nav:${target.dataset.fiNav}`)
        );
        mirror.open();
        const doc = popupDom.window.document;
        (doc.querySelector("[data-action='toggle-section']") as HTMLElement).click();
        (doc.querySelector("a[data-fi-nav]") as HTMLElement).click();
        assert.deepEqual(handled, ["toggle-section", "nav:2303"]);
    });

    test("富果分頁重新整理後（新的實例取得同一個彈出視窗），只有新實例處理點擊", () => {
        const card = cardElement(CARD_HTML);
        const oldHandled: string[] = [];
        const newHandled: string[] = [];
        const oldMirror = makeMirror(
            () => card,
            (t) => oldHandled.push(t.dataset.action ?? "")
        );
        oldMirror.open();

        const newMirror = makeMirror(
            () => card,
            (t) => newHandled.push(t.dataset.action ?? "")
        );
        assert.equal(newMirror.open(), true);
        (popupDom.window.document.querySelector("[data-action='toggle-section']") as HTMLElement).click();

        assert.deepEqual(newHandled, ["toggle-section"], "新實例必須能處理互動");
        assert.deepEqual(oldHandled, [], "舊實例不應再處理");
    });

    test("瀏覽器阻擋彈出視窗時 open() 回傳 false", () => {
        const card = cardElement(CARD_HTML);
        (globalThis as any).window.open = () => null;
        const mirror = makeMirror(() => card);
        assert.equal(mirror.open(), false);
        assert.equal(mirror.isOpen(), false);
    });

    test("close() 後 isOpen() 為 false", () => {
        const card = cardElement(CARD_HTML);
        const mirror = makeMirror(() => card);
        mirror.open();
        assert.equal(mirror.isOpen(), true);
        mirror.close();
        assert.equal(mirror.isOpen(), false);
    });
});
