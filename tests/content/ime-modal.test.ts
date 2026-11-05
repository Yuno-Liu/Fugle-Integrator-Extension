/**
 * 輸入法組字（IME）與對話框生命週期：
 * - modal.ts：isImeComposing、組字中的 Esc 不關閉、重複開啟同 id 的監聽器清理、hasOpenModal / closeAllModals、
 *   在另一份文件（彈出視窗）中開啟時的焦點鎖定
 * - search.ts：組字中的 Enter 不開啟結果；防抖期間按 Enter 開啟「新查詢」的第一筆
 */
import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupDom, setupFuglePage, waitFor, flush } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl } from "../helpers/chrome";
import { closeAllModals, hasOpenModal, isImeComposing, openModal } from "../../src/content/modal";
import { openSearch } from "../../src/content/search";
import type { SearchResults } from "../../src/shared/types";

// ============================================================================
// 共用工具
// ============================================================================

function key(target: EventTarget, k: string, init: KeyboardEventInit = {}, view: { KeyboardEvent: typeof KeyboardEvent } = globalThis): KeyboardEvent {
    const ev = new view.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
}

function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

const optionsOf = (results: HTMLElement): HTMLElement[] => [...results.querySelectorAll<HTMLElement>('[role="option"]')];
const selectedIndex = (results: HTMLElement): number => optionsOf(results).findIndex((o) => o.getAttribute("aria-selected") === "true");

/** 兩種組字中的標記：Chrome 的 isComposing，以及舊瀏覽器 / 部分輸入法的 keyCode 229 */
const COMPOSING: Array<{ name: string; init: KeyboardEventInit }> = [
    { name: "isComposing=true", init: { isComposing: true } },
    { name: "keyCode=229", init: { keyCode: 229 } as KeyboardEventInit },
];

// ============================================================================
// isImeComposing
// ============================================================================

describe("isImeComposing", () => {
    const cases: Array<{ name: string; init: KeyboardEventInit; expected: boolean }> = [
        { name: "isComposing=true", init: { key: "Enter", isComposing: true }, expected: true },
        { name: "keyCode=229（Process）", init: { key: "Process", keyCode: 229 } as KeyboardEventInit, expected: true },
        { name: "isComposing=true 且 keyCode=229", init: { key: "Enter", isComposing: true, keyCode: 229 } as KeyboardEventInit, expected: true },
        { name: "一般 Enter（keyCode 13）", init: { key: "Enter", keyCode: 13 } as KeyboardEventInit, expected: false },
        { name: "一般 Escape（keyCode 27）", init: { key: "Escape", keyCode: 27 } as KeyboardEventInit, expected: false },
        { name: "未指定 keyCode", init: { key: "a" }, expected: false },
    ];
    for (const { name, init, expected } of cases) {
        test(`${name} → ${expected}`, () => {
            const env = setupDom();
            try {
                assert.equal(isImeComposing(new KeyboardEvent("keydown", init)), expected);
            } finally {
                env.cleanup();
            }
        });
    }
});

// ============================================================================
// openModal：組字中的 Esc
// ============================================================================

function withModalPage(fn: (ctx: { env: DomEnv; closes: { count: number }; modal: ReturnType<typeof openModal> }) => void | Promise<void>): Promise<void> {
    const env = setupDom();
    const closes = { count: 0 };
    const modal = openModal({ id: "fi-ime-modal", title: "IME", onClose: () => closes.count++, doc: env.document });
    modal.body.innerHTML = `<input id="field"><button id="ok">OK</button>`;
    return Promise.resolve()
        .then(() => fn({ env, closes, modal }))
        .finally(() => {
            closeAllModals(env.document);
            env.cleanup();
        });
}

describe("openModal：輸入法組字中", () => {
    for (const { name, init } of COMPOSING) {
        test(`組字中（${name}）按 Esc 不關閉對話框、不阻止預設行為（交給輸入法取消選字）`, () =>
            withModalPage(({ env, closes, modal }) => {
                const field = env.document.getElementById("field") as HTMLInputElement;
                field.focus();
                field.dispatchEvent(new Event("compositionstart", { bubbles: true }));
                const ev = key(field, "Escape", init);
                assert.equal(modal.root.isConnected, true);
                assert.equal(ev.defaultPrevented, false);
                assert.equal(closes.count, 0);
                assert.equal(hasOpenModal(env.document), true);

                // 組字結束後同一個按鍵正常關閉
                field.dispatchEvent(new Event("compositionend", { bubbles: true }));
                const after = key(field, "Escape");
                assert.equal(after.defaultPrevented, true);
                assert.equal(modal.root.isConnected, false);
                assert.equal(closes.count, 1);
                assert.equal(hasOpenModal(env.document), false);
            }));

        test(`組字中（${name}）按 Tab 不被焦點鎖定攔截`, () =>
            withModalPage(({ env }) => {
                const ok = env.document.getElementById("ok") as HTMLElement;
                ok.focus();
                const ev = key(ok, "Tab", init);
                assert.equal(ev.defaultPrevented, false);
                assert.equal(env.document.activeElement, ok);
                // 組字結束後：最後一個元素按 Tab 回到第一個（關閉按鈕）
                assert.equal(key(ok, "Tab").defaultPrevented, true);
                assert.equal(env.document.activeElement, env.document.querySelector("[data-modal-close]"));
            }));
    }
});

// ============================================================================
// openModal：重複開啟、hasOpenModal / closeAllModals
// ============================================================================

describe("openModal：重複開啟與全部關閉", () => {
    test("以相同 id 再次開啟：舊的 onClose 只呼叫一次，document 上只剩一個有效的 capture keydown 監聽器", () => {
        const env = setupDom();
        const doc = env.document;
        const active = new Set<unknown>();
        const origAdd = doc.addEventListener;
        const origRemove = doc.removeEventListener;
        const add = mock.method(doc, "addEventListener", function (this: Document, type: string, listener: unknown, options?: unknown) {
            if (type === "keydown" && options === true) active.add(listener);
            return origAdd.call(this, type, listener as EventListener, options as boolean);
        });
        const remove = mock.method(doc, "removeEventListener", function (this: Document, type: string, listener: unknown, options?: unknown) {
            if (type === "keydown" && options === true) active.delete(listener);
            return origRemove.call(this, type, listener as EventListener, options as boolean);
        });
        const firstCloses = { count: 0 };
        const secondCloses = { count: 0 };
        try {
            const first = openModal({ id: "fi-dup", title: "第一個", onClose: () => firstCloses.count++, doc });
            assert.equal(active.size, 1);
            const firstListener = [...active][0];

            const second = openModal({ id: "fi-dup", title: "第二個", onClose: () => secondCloses.count++, doc });
            assert.equal(firstCloses.count, 1, "舊對話框的 onClose 被呼叫一次");
            assert.equal(secondCloses.count, 0);
            assert.equal(active.size, 1, "只剩新對話框的監聽器");
            assert.ok(!active.has(firstListener), "舊監聽器已移除");
            assert.equal(
                remove.mock.calls.filter((c) => c.arguments[0] === "keydown" && c.arguments[1] === firstListener && c.arguments[2] === true).length,
                1,
                "舊監聽器以相同的 capture 參數移除"
            );
            assert.equal(first.root.isConnected, false);
            assert.equal(doc.querySelectorAll("#fi-dup").length, 1);
            assert.equal(hasOpenModal(doc), true);

            // 再次關閉舊的 handle 不會影響新的對話框，也不會再呼叫 onClose
            first.close();
            assert.equal(firstCloses.count, 1);
            assert.equal(second.root.isConnected, true);
            assert.equal(hasOpenModal(doc), true, "舊 handle 的 close() 不會把新的從登錄中移除");

            // Esc 只關閉新的對話框
            const ev = key(doc.body, "Escape");
            assert.equal(ev.defaultPrevented, true);
            assert.equal(second.root.isConnected, false);
            assert.equal(secondCloses.count, 1);
            assert.equal(firstCloses.count, 1);
            assert.equal(active.size, 0, "全部關閉後不留監聽器");
            assert.equal(hasOpenModal(doc), false);

            // 之後的 Esc 不再被攔截
            assert.equal(key(doc.body, "Escape").defaultPrevented, false);
            assert.ok(add.mock.callCount() >= 2);
        } finally {
            closeAllModals(doc);
            add.mock.restore();
            remove.mock.restore();
            env.cleanup();
        }
    });

    test("頁面上已有相同 id 的殘留元素（例如舊版內容腳本留下）時被移除", () => {
        const env = setupDom();
        try {
            const stale = env.document.createElement("div");
            stale.id = "fi-stale";
            env.document.body.appendChild(stale);
            const modal = openModal({ id: "fi-stale", title: "新", doc: env.document });
            assert.equal(stale.isConnected, false);
            assert.equal(env.document.querySelectorAll("#fi-stale").length, 1);
            assert.equal(env.document.getElementById("fi-stale"), modal.root);
            modal.close();
        } finally {
            env.cleanup();
        }
    });

    test("hasOpenModal / closeAllModals：關閉所有對話框，每個 onClose 各一次", () => {
        const env = setupDom();
        const doc = env.document;
        try {
            assert.equal(hasOpenModal(doc), false);
            const calls: string[] = [];
            const a = openModal({ id: "fi-a", title: "A", onClose: () => calls.push("a"), doc });
            const b = openModal({ id: "fi-b", title: "B", onClose: () => calls.push("b"), doc });
            assert.equal(hasOpenModal(doc), true);

            a.close();
            assert.equal(hasOpenModal(doc), true, "還有 B");
            closeAllModals(doc);
            assert.deepEqual(calls.sort(), ["a", "b"]);
            assert.equal(b.root.isConnected, false);
            assert.equal(hasOpenModal(doc), false);
            assert.equal(doc.querySelector(".fi-modal-backdrop"), null);

            closeAllModals(doc); // 沒有對話框時不出錯
            assert.equal(calls.length, 2);
        } finally {
            closeAllModals(doc);
            env.cleanup();
        }
    });

    test("hasOpenModal / closeAllModals 預設使用全域 document", () => {
        const env = setupDom();
        try {
            const calls: string[] = [];
            openModal({ id: "fi-global", title: "G", onClose: () => calls.push("g") });
            assert.equal(hasOpenModal(), true);
            closeAllModals();
            assert.equal(hasOpenModal(), false);
            assert.deepEqual(calls, ["g"]);
        } finally {
            env.cleanup();
        }
    });
});

// ============================================================================
// openModal：另一份文件（彈出視窗）
// ============================================================================

describe("openModal：在第二份 JSDOM 文件中開啟", () => {
    function withTwoDocs(fn: (ctx: { page: DomEnv; popup: JSDOM; pdoc: Document }) => void): void {
        const page = setupDom();
        const popup = new JSDOM("<!doctype html><html><head></head><body><button id='opener'>開啟</button></body></html>", { url: "about:blank", pretendToBeVisual: true });
        try {
            fn({ page, popup, pdoc: popup.window.document });
        } finally {
            closeAllModals(popup.window.document);
            closeAllModals(page.document);
            popup.window.close();
            page.cleanup();
        }
    }

    test("對話框建立在指定文件中；登錄依文件分開", () =>
        withTwoDocs(({ page, pdoc }) => {
            const modal = openModal({ id: "fi-popup-modal", title: "彈出", doc: pdoc });
            assert.equal(modal.root.ownerDocument, pdoc);
            assert.equal(modal.root.parentElement, pdoc.body);
            assert.equal(page.document.getElementById("fi-popup-modal"), null, "不會出現在頁面文件");
            assert.equal(hasOpenModal(pdoc), true);
            assert.equal(hasOpenModal(page.document), false);

            closeAllModals(page.document);
            assert.equal(modal.root.isConnected, true, "關閉頁面的對話框不影響彈出視窗");
        }));

    test("Tab 焦點鎖定在彈出視窗文件內；Esc 關閉後焦點回到彈出視窗中的開啟按鈕", () =>
        withTwoDocs(({ page, popup, pdoc }) => {
            const view = popup.window as unknown as { KeyboardEvent: typeof KeyboardEvent };
            const opener = pdoc.getElementById("opener") as HTMLElement;
            opener.focus();
            assert.equal(pdoc.activeElement, opener);

            let closes = 0;
            const modal = openModal({ id: "fi-popup-modal", title: "彈出", onClose: () => closes++, doc: pdoc });
            modal.body.innerHTML = `<input id="p-a"><button id="p-b">B</button>`;
            const closeBtn = modal.root.querySelector<HTMLElement>("[data-modal-close]")!;
            const last = pdoc.getElementById("p-b") as HTMLElement;

            // 焦點仍在對話框外 → Tab 移到第一個
            assert.equal(key(opener, "Tab", {}, view).defaultPrevented, true);
            assert.equal(pdoc.activeElement, closeBtn);
            // Shift+Tab 從第一個繞到最後一個
            assert.equal(key(closeBtn, "Tab", { shiftKey: true }, view).defaultPrevented, true);
            assert.equal(pdoc.activeElement, last);
            // 最後一個 Tab 回到第一個
            assert.equal(key(last, "Tab", {}, view).defaultPrevented, true);
            assert.equal(pdoc.activeElement, closeBtn);

            // 頁面文件的 Esc 不會關閉彈出視窗中的對話框
            key(page.document.body, "Escape");
            assert.equal(modal.root.isConnected, true);

            // 組字中的 Esc 也不會
            key(closeBtn, "Escape", { isComposing: true }, view);
            assert.equal(modal.root.isConnected, true);

            assert.equal(key(closeBtn, "Escape", {}, view).defaultPrevented, true);
            assert.equal(modal.root.isConnected, false);
            assert.equal(closes, 1);
            assert.equal(pdoc.activeElement, opener, "焦點回到彈出視窗中開啟前的元素");
        }));
});

// ============================================================================
// openSearch：組字中的 Enter / Esc，以及防抖期間的 Enter
// ============================================================================

const SEARCH_DATA: Record<string, SearchResults> = {
    台: {
        stocks: [
            { code: "2330", name: "台積電", capital: 2593.24 },
            { code: "3045", name: "台灣大", capital: 34.97 },
        ],
        categories: [{ type: "產業", name: "半導體業", count: 168 }],
    },
    聯: {
        stocks: [
            { code: "2303", name: "聯電", capital: 1254.2 },
            { code: "2454", name: "聯發科", capital: 160.03 },
        ],
        categories: [],
    },
    散熱: { stocks: [], categories: [{ type: "概念", name: "散熱", count: 37 }] },
};

interface SearchCtx {
    fake: FakeChromeControl;
    navigated: string[];
    modal: ReturnType<typeof openSearch>;
    input: HTMLInputElement;
    results: HTMLElement;
    searches(): string[];
}

async function withSearch(fn: (s: SearchCtx) => Promise<void>, handler?: (msg: any) => unknown): Promise<void> {
    const env = setupFuglePage();
    const fake = installFakeChrome({
        handler:
            handler ??
            ((msg) => {
                if (msg.type === "search") return { ok: true, data: SEARCH_DATA[msg.query] ?? { stocks: [], categories: [] } };
                if (msg.type === "category") return { ok: true, data: [{ code: "3017", name: "奇鋐", capital: 38.6 }] };
                return { ok: false, error: "unexpected", code: "bad-request" };
            }),
    });
    const navigated: string[] = [];
    const modal = openSearch({ currentStockId: () => "2330", navigate: (code) => navigated.push(code) });
    try {
        await fn({
            fake,
            navigated,
            modal,
            input: modal.body.querySelector<HTMLInputElement>(".fi-search__input")!,
            results: modal.body.querySelector<HTMLElement>("#fi-search-results")!,
            searches: () => fake.sent.filter((m) => m.type === "search").map((m) => m.query),
        });
    } finally {
        modal.close();
        await flush(5);
        fake.uninstall();
        env.cleanup();
    }
}

describe("openSearch：輸入法組字中", () => {
    for (const { name, init } of COMPOSING) {
        test(`結果已顯示時，組字中（${name}）的 Enter 不開啟結果；組字結束後的 Enter 開啟選取項`, () =>
            withSearch(async ({ input, results, navigated, modal }) => {
                typeInto(input, "台");
                await waitFor(() => optionsOf(results).length === 3, 1000);
                key(input, "ArrowDown");
                assert.equal(selectedIndex(results), 1);

                const ev = key(input, "Enter", init);
                assert.equal(ev.defaultPrevented, false, "Enter 交給輸入法確認選字");
                await flush(20);
                assert.deepEqual(navigated, []);
                assert.equal(modal.root.isConnected, true);

                // 組字中的方向鍵也屬於輸入法（選字），不移動結果選取
                key(input, "ArrowDown", init);
                assert.equal(selectedIndex(results), 1);

                input.dispatchEvent(new Event("compositionend", { bubbles: true }));
                assert.equal(key(input, "Enter").defaultPrevented, true);
                assert.deepEqual(navigated, ["3045"]);
                assert.equal(modal.root.isConnected, false);
            }));

        test(`組字中（${name}）的 Esc 不關閉搜尋視窗，也不取消防抖中的查詢`, () =>
            withSearch(async ({ input, results, modal, searches }) => {
                typeInto(input, "聯");
                key(input, "Escape", init);
                assert.equal(modal.root.isConnected, true);
                await waitFor(() => optionsOf(results).length === 2, 1000);
                assert.deepEqual(searches(), ["聯"], "防抖中的查詢照常送出");

                const ev = key(input, "Escape");
                assert.equal(ev.defaultPrevented, true);
                assert.equal(modal.root.isConnected, false);
                assert.equal(document.getElementById("fi-search-modal"), null);
            }));

        test(`防抖期間組字中（${name}）的 Enter 不觸發立即查詢，也不開啟任何結果`, () =>
            withSearch(async ({ input, results, navigated, searches }) => {
                typeInto(input, "聯");
                key(input, "Enter", init);
                assert.deepEqual(searches(), [], "沒有因 Enter 立即送出查詢");
                await waitFor(() => optionsOf(results).length === 2, 1000);
                await flush(20);
                assert.deepEqual(navigated, []);
                assert.deepEqual(searches(), ["聯"], "只有防抖後的一次查詢");
            }));
    }
});

describe("openSearch：防抖期間按 Enter", () => {
    test("畫面上是舊查詢（且已移動選取）時，輸入新查詢立即按 Enter → 開啟新查詢的第一筆", () =>
        withSearch(async ({ input, results, navigated, searches, modal }) => {
            typeInto(input, "台");
            await waitFor(() => optionsOf(results).length === 3, 1000);
            key(input, "ArrowDown");
            assert.equal(optionsOf(results)[selectedIndex(results)]?.dataset.code, "3045");

            typeInto(input, "聯");
            const ev = key(input, "Enter");
            assert.equal(ev.defaultPrevented, true);
            assert.deepEqual(navigated, [], "不會同步開啟畫面上的舊結果");

            await waitFor(() => navigated.length > 0, 500);
            assert.deepEqual(navigated, ["2303"], "新查詢「聯」的第一筆，而非舊結果的 3045 / 2330");
            assert.equal(modal.root.isConnected, false);

            await flush(160); // 超過防抖時間：被取消的防抖查詢不應再送出
            assert.deepEqual(searches(), ["台", "聯"]);
        }));

    test("尚未有任何結果時輸入後立即按 Enter → 立即查詢並開啟第一筆", () =>
        withSearch(async ({ input, navigated, searches }) => {
            typeInto(input, "聯");
            key(input, "Enter");
            assert.deepEqual(searches(), ["聯"], "Enter 取消防抖並立即查詢");
            await waitFor(() => navigated.length > 0, 500);
            assert.deepEqual(navigated, ["2303"]);
            await flush(160);
            assert.deepEqual(searches(), ["聯"]);
        }));

    test("新查詢的第一筆是分類時，立即 Enter 進入該分類", () =>
        withSearch(async ({ input, results, navigated, fake }) => {
            typeInto(input, "台");
            await waitFor(() => optionsOf(results).length === 3, 1000);
            typeInto(input, "散熱");
            key(input, "Enter");
            await waitFor(() => results.querySelector("[data-filter]") !== null, 1000);
            assert.deepEqual(
                fake.sent.filter((m) => m.type === "category"),
                [{ type: "category", categoryType: "概念", name: "散熱" }]
            );
            assert.deepEqual(navigated, []);
            assert.ok(results.querySelector("[data-code='3017']"));
        }));

    test("立即查詢較慢、期間改了輸入且新查詢已送出：過期的回應不會開啟任何結果", () => {
        const handler = async (msg: any): Promise<unknown> => {
            if (msg.type !== "search") return { ok: false, error: "unexpected", code: "bad-request" };
            if (msg.query === "台") await new Promise((r) => setTimeout(r, 200));
            return { ok: true, data: SEARCH_DATA[msg.query] ?? { stocks: [], categories: [] } };
        };
        return withSearch(async ({ input, results, navigated, fake }) => {
            typeInto(input, "台");
            key(input, "Enter"); // 立即查詢「台」（200ms 後才回應）
            typeInto(input, "聯"); // 回應前又改了輸入；120ms 防抖後送出「聯」
            await waitFor(() => optionsOf(results).length === 2, 1000);
            await waitFor(() => fake.sent.length >= 2, 500);
            await flush(120); // 「台」的慢回應抵達
            assert.deepEqual(navigated, [], "過期的「台」不會開啟 2330");
            assert.deepEqual(
                optionsOf(results).map((o) => o.dataset.code),
                ["2303", "2454"]
            );
        }, handler);
    });

    test("按 Enter 後、結果回來前又繼續輸入（新查詢仍在防抖中）→ 不開啟舊查詢的結果", () => {
        const handler = async (msg: any): Promise<unknown> => {
            if (msg.type !== "search") return { ok: false, error: "unexpected", code: "bad-request" };
            if (msg.query === "台") await new Promise((r) => setTimeout(r, 40));
            return { ok: true, data: SEARCH_DATA[msg.query] ?? { stocks: [], categories: [] } };
        };
        return withSearch(async ({ input, results, navigated, searches, modal }) => {
            typeInto(input, "台");
            key(input, "Enter"); // 立即查詢「台」（40ms 後才回應）
            typeInto(input, "台積"); // 回應前繼續輸入；「台積」要等 120ms 防抖才送出
            await waitFor(() => optionsOf(results).length > 0, 1000); // 「台」的結果先回來
            assert.deepEqual(searches(), ["台"], "新查詢仍在防抖中");
            await flush(5);
            assert.deepEqual(navigated, [], "使用者已改了輸入，不開啟「台」的第一筆");
            assert.equal(modal.root.isConnected, true);
            await flush(160);
            assert.deepEqual(searches(), ["台", "台積"]);
            assert.deepEqual(navigated, []);
        }, handler);
    });

    test("畫面上的結果已是目前輸入時，Enter 開啟選取項（不重新查詢）", () =>
        withSearch(async ({ input, results, navigated, searches }) => {
            typeInto(input, "聯");
            await waitFor(() => optionsOf(results).length === 2, 1000);
            key(input, "ArrowDown");
            key(input, "Enter");
            assert.deepEqual(navigated, ["2454"], "同步開啟選取的第二筆");
            assert.deepEqual(searches(), ["聯"]);
        }));
});
