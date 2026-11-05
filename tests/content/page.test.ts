/**
 * 富果頁面轉接層（page.ts）、站內導覽（navigation.ts）、設定儲存（settingsStore.ts）。
 * DOM 以擷取自富果的真實個股頁頁首（2330 台積電）為基礎。
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { setupDom, setupFuglePage, setStockOnPage, waitFor, flush } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { installFakeChrome } from "../helpers/chrome";
import { findSearchInput, isFugleDark, readMarketClosed, readPrice, readStockContext, readVolumeLots } from "../../src/content/page";
import { cancelNavigationFallback, navigateToStock, shouldInterceptClick } from "../../src/content/navigation";
import { SettingsStore } from "../../src/content/settingsStore";
import type { UiSettings } from "../../src/shared/types";

/** 在富果頁面環境中執行，結束後一律清理 */
function withPage<T>(fn: (env: DomEnv) => T, url?: string): T {
    const env = setupFuglePage(url);
    try {
        return fn(env);
    } finally {
        env.cleanup();
    }
}

function setText(doc: Document, selector: string, text: string): void {
    const el = doc.querySelector(selector);
    assert.ok(el, `fixture 應包含 ${selector}`);
    el.textContent = text;
}

// ============================================================================
// page.ts
// ============================================================================

describe("readStockContext", () => {
    test("真實富果頁首：2330 台積電 上市（代碼前後的換行空白被去除）", () => {
        withPage(({ document }) => {
            assert.deepEqual(readStockContext(document), { stockId: "2330", name: "台積電", market: "上市" });
        });
    });

    test("SPA 切換股票後讀到新的個股與市場別", () => {
        withPage(({ document }) => {
            setStockOnPage(document, "9962", "有益", "上櫃");
            assert.deepEqual(readStockContext(document), { stockId: "9962", name: "有益", market: "上櫃" });
        });
    });

    const cases: Array<{ symbol: string; expected: string | null; why: string }> = [
        { symbol: "  00632r \n", expected: "00632R", why: "小寫 ETF 代碼轉大寫" },
        { symbol: "2881a", expected: "2881A", why: "特別股代碼轉大寫" },
        { symbol: "\n\t00878\n", expected: "00878", why: "去除換行與 tab" },
        { symbol: "", expected: null, why: "資料尚未渲染（空字串）" },
        { symbol: "台積電", expected: null, why: "非代碼文字" },
        { symbol: "23 30", expected: null, why: "代碼中間有空白" },
        { symbol: "2330.TW", expected: null, why: "含非法字元" },
        { symbol: "1", expected: null, why: "長度不足" },
        { symbol: "ABCDEFGHI", expected: null, why: "長度超過 8" },
    ];
    for (const { symbol, expected, why } of cases) {
        test(`代碼 ${JSON.stringify(symbol)} → ${expected ?? "null"}（${why}）`, () => {
            withPage(({ document }) => {
                setText(document, ".card-group-header__info__symbol", symbol);
                assert.equal(readStockContext(document)?.stockId ?? null, expected);
            });
        });
    }

    test("名稱內多餘空白被壓縮；名稱暫時為空時仍回傳代碼", () => {
        withPage(({ document }) => {
            setText(document, ".stock-name", "  元大 \n 台灣50  ");
            assert.equal(readStockContext(document)?.name, "元大 台灣50");
            setText(document, ".stock-name", "");
            assert.deepEqual(readStockContext(document), { stockId: "2330", name: "", market: "上市" });
        });
    });

    test("不在個股頁（沒有代碼元素）回傳 null", () => {
        const env = setupDom("<!doctype html><html><body><div class='home'>首頁</div></body></html>", "https://www.fugle.tw/");
        try {
            assert.equal(readStockContext(env.document), null);
        } finally {
            env.cleanup();
        }
    });
});

describe("readPrice / readVolumeLots / readMarketClosed", () => {
    test("真實頁首：股價 2260、總量 53,879 張、11/04 收盤", () => {
        withPage(({ document }) => {
            assert.equal(readPrice(document), 2260);
            assert.equal(readVolumeLots(document), 53879);
            assert.equal(readMarketClosed(document), true);
        });
    });

    const prices: Array<[string, number | null]> = [
        ["1,055.50", 1055.5],
        ["  98.7\n ", 98.7],
        ["--", null],
        ["0.00", null],
        ["", null],
    ];
    for (const [text, expected] of prices) {
        test(`股價文字 ${JSON.stringify(text)} → ${expected}`, () => {
            withPage(({ document }) => {
                setText(document, ".card-group-header__price__price", text);
                assert.equal(readPrice(document), expected);
            });
        });
    }

    const volumes: Array<[string, number | null]> = [
        ["53,879 張", 53879],
        ["1,234,567張", 1234567],
        ["0 張", 0],
        ["-- 張", null],
        ["", null],
    ];
    for (const [text, expected] of volumes) {
        test(`總量文字 ${JSON.stringify(text)} → ${expected}`, () => {
            withPage(({ document }) => {
                setText(document, ".card-group-header__volume span:nth-child(2)", text);
                assert.equal(readVolumeLots(document), expected);
            });
        });
    }

    const times: Array<[string, boolean]> = [
        ["11/04 收盤", true],
        ["休市", true],
        ["11/05 休市", true],
        ["13:25:03", false],
        ["11/05 10:32:15", false],
        ["", false],
    ];
    for (const [text, expected] of times) {
        test(`更新時間 ${JSON.stringify(text)} → 已收盤=${expected}`, () => {
            withPage(({ document }) => {
                setText(document, ".card-group-header__time span:nth-child(2)", text);
                assert.equal(readMarketClosed(document), expected);
            });
        });
    }

    test("缺少對應元素時：股價 / 總量為 null，收盤為 false", () => {
        const env = setupDom();
        try {
            assert.equal(readPrice(env.document), null);
            assert.equal(readVolumeLots(env.document), null);
            assert.equal(readMarketClosed(env.document), false);
        } finally {
            env.cleanup();
        }
    });
});

describe("findSearchInput", () => {
    test("真實頁面的 #ember14 是 DIV（市場下拉選單），應改用 input.search-bar__input", () => {
        withPage(({ document }) => {
            assert.equal(document.getElementById("ember14")?.tagName, "DIV");
            const input = findSearchInput(document);
            assert.ok(input);
            assert.equal(input.tagName, "INPUT");
            assert.equal(input.id, "ember13");
            assert.ok(input.classList.contains("search-bar__input"));
        });
    });

    test("#ember14 確實是輸入框時優先採用（相容舊版）", () => {
        const env = setupDom(
            `<!doctype html><html><body><header class="header"><div class="header__search"><input id="ember13" class="search-bar__input" type="search"></div><input id="ember14" type="text"></header></body></html>`
        );
        try {
            assert.equal(findSearchInput(env.document)?.id, "ember14");
        } finally {
            env.cleanup();
        }
    });

    test("沒有 search-bar 類別時退而使用 header 內的 type=search", () => {
        const env = setupDom(`<!doctype html><html><body><header><input id="q" type="search"></header><input id="other" type="search"></body></html>`);
        try {
            assert.equal(findSearchInput(env.document)?.id, "q");
        } finally {
            env.cleanup();
        }
    });

    test("頁面沒有任何搜尋框時回傳 null", () => {
        const env = setupDom(`<!doctype html><html><body><div id="ember14"></div><div class="search-bar__input"></div></body></html>`);
        try {
            assert.equal(findSearchInput(env.document), null);
        } finally {
            env.cleanup();
        }
    });
});

describe("isFugleDark（富果淺色 / 深色模式）", () => {
    test("真實頁面（淺色、無標記、背景透明）→ 淺色", () => {
        withPage(({ document }) => {
            assert.equal(isFugleDark(document), false);
        });
    });

    const markers: Array<{ name: string; apply: (doc: Document) => void; expected: boolean }> = [
        { name: ".body.dark-theme（舊版樣式）", apply: (d) => d.querySelector(".body")?.classList.add("dark-theme"), expected: true },
        { name: "html.tw-dark-theme（Tailwind）", apply: (d) => d.documentElement.classList.add("tw-dark-theme"), expected: true },
        { name: "body.tw-dark-theme", apply: (d) => d.body.classList.add("tw-dark-theme"), expected: true },
        { name: "html[data-theme=dark]", apply: (d) => d.documentElement.setAttribute("data-theme", "dark"), expected: true },
        { name: "html[data-theme=light]", apply: (d) => d.documentElement.setAttribute("data-theme", "light"), expected: false },
        { name: ".body.light-theme", apply: (d) => d.querySelector(".body")?.classList.add("light-theme"), expected: false },
    ];
    for (const { name, apply, expected } of markers) {
        test(`標記 ${name} → ${expected ? "深色" : "淺色"}`, () => {
            withPage(({ document }) => {
                apply(document);
                assert.equal(isFugleDark(document), expected);
            });
        });
    }

    const backgrounds: Array<{ name: string; body?: string; inner?: string; html?: string; expected: boolean }> = [
        { name: "body 深灰 #121212", body: "rgb(18, 18, 18)", expected: true },
        { name: "body 富果深色藍黑", body: "rgb(23, 27, 38)", expected: true },
        { name: "body 白色", body: "rgb(255, 255, 255)", expected: false },
        { name: "body 淺灰", body: "rgb(245, 246, 248)", expected: false },
        { name: ".body 深色優先於 body 白色", inner: "rgb(20, 20, 20)", body: "rgb(255, 255, 255)", expected: true },
        { name: ".body 白色優先於 html 深色", inner: "rgb(255, 255, 255)", html: "rgb(0, 0, 0)", expected: false },
        { name: ".body 半透明（alpha≤0.5）略過，改看 body 深色", inner: "rgba(255, 255, 255, 0.3)", body: "rgb(10, 10, 10)", expected: true },
        { name: "只有 html 深色", html: "rgb(17, 17, 17)", expected: true },
    ];
    for (const { name, body, inner, html, expected } of backgrounds) {
        test(`計算背景：${name} → ${expected ? "深色" : "淺色"}`, () => {
            withPage(({ document }) => {
                if (body) document.body.style.backgroundColor = body;
                if (inner) (document.querySelector(".body") as HTMLElement).style.backgroundColor = inner;
                if (html) document.documentElement.style.backgroundColor = html;
                assert.equal(isFugleDark(document), expected);
            });
        });
    }

    test("由淺色切換到深色再切回淺色，判斷即時跟著變", () => {
        withPage(({ document }) => {
            const inner = document.querySelector(".body") as HTMLElement;
            assert.equal(isFugleDark(document), false);
            inner.classList.add("dark-theme");
            assert.equal(isFugleDark(document), true);
            inner.classList.remove("dark-theme");
            inner.style.backgroundColor = "rgb(255, 255, 255)";
            assert.equal(isFugleDark(document), false);
        });
    });
});

// ============================================================================
// navigation.ts
// ============================================================================

describe("navigateToStock", () => {
    // 導覽會排定 SPA 失效時的備援計時；每個測試結束後取消，避免計時器殘留
    afterEach(() => cancelNavigationFallback());

    function track(env: DomEnv): { pops: number } {
        const state = { pops: 0 };
        env.window.addEventListener("popstate", () => state.pops++);
        return state;
    }

    test("pushState 到 /ai/<id> 並觸發一次 popstate（驅動 Ember 路由）", () => {
        withPage((env) => {
            const state = track(env);
            const before = env.window.history.length;
            assert.equal(navigateToStock("2454", env.window), true);
            assert.equal(env.window.location.pathname, "/ai/2454");
            assert.equal(env.window.history.length, before + 1);
            assert.equal(state.pops, 1);
        });
    });

    test("代碼前後空白與小寫會被正規化", () => {
        withPage((env) => {
            assert.equal(navigateToStock("  00632r ", env.window), true);
            assert.equal(env.window.location.pathname, "/ai/00632R");
        });
    });

    test("已在該個股頁時不重複 pushState / popstate，但回傳 true", () => {
        withPage((env) => {
            const state = track(env);
            const before = env.window.history.length;
            assert.equal(navigateToStock("2330", env.window), true);
            assert.equal(env.window.history.length, before);
            assert.equal(state.pops, 0);
        });
    });

    for (const bad of ["", "   ", "2", "23-30", "../admin", "2330/x", "ABCDEFGHI", "台積電", "2330?x=1"]) {
        test(`無效代碼 ${JSON.stringify(bad)} 被拒絕且不改變網址`, () => {
            withPage((env) => {
                const state = track(env);
                assert.equal(navigateToStock(bad, env.window), false);
                assert.equal(env.window.location.pathname, "/ai/2330");
                assert.equal(state.pops, 0);
            });
        });
    }
});

describe("shouldInterceptClick", () => {
    const cases: Array<{ name: string; init: MouseEventInit; prevent?: boolean; expected: boolean }> = [
        { name: "一般左鍵", init: { button: 0 }, expected: true },
        { name: "中鍵（開新分頁）", init: { button: 1 }, expected: false },
        { name: "右鍵", init: { button: 2 }, expected: false },
        { name: "Ctrl + 左鍵", init: { button: 0, ctrlKey: true }, expected: false },
        { name: "⌘ + 左鍵", init: { button: 0, metaKey: true }, expected: false },
        { name: "Shift + 左鍵（新視窗）", init: { button: 0, shiftKey: true }, expected: false },
        { name: "Alt + 左鍵（下載）", init: { button: 0, altKey: true }, expected: false },
        { name: "已被其他處理器 preventDefault", init: { button: 0 }, prevent: true, expected: false },
    ];
    for (const { name, init, prevent, expected } of cases) {
        test(`${name} → ${expected ? "攔截改走 SPA" : "交給瀏覽器"}`, () => {
            const env = setupDom();
            try {
                const link = env.document.createElement("a");
                link.href = "/ai/2454";
                env.document.body.appendChild(link);
                let result: boolean | null = null;
                if (prevent) link.addEventListener("click", (e) => e.preventDefault());
                env.document.addEventListener("click", (e) => {
                    result = shouldInterceptClick(e);
                    e.preventDefault(); // 避免 jsdom 嘗試導覽
                });
                link.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
                assert.equal(result, expected);
            } finally {
                env.cleanup();
            }
        });
    }
});

// ============================================================================
// settingsStore.ts
// ============================================================================

const LEGACY = {
    "fugle-info-position": "left",
    "fugle-info-visible": "false",
    "fugle-info-collapsed": "true",
    "fugle-section-ratings": "false",
    "fugle-section-etf": "true",
    "fugle-volume-api-token": "  secret-finmind-token  ",
};

function seedLocalStorage(storage: Storage, items: Record<string, string>): void {
    storage.clear();
    for (const [k, v] of Object.entries(items)) storage.setItem(k, v);
}

async function withStore<T>(
    opts: { local?: Record<string, unknown>; sync?: Record<string, unknown>; legacy?: Record<string, string> },
    fn: (ctx: { env: DomEnv; fake: ReturnType<typeof installFakeChrome> }) => Promise<T>
): Promise<T> {
    const env = setupDom();
    const fake = installFakeChrome({ local: opts.local, sync: opts.sync });
    try {
        seedLocalStorage(env.window.localStorage, opts.legacy ?? {});
        return await fn({ env, fake });
    } finally {
        fake.uninstall();
        env.cleanup();
    }
}

describe("SettingsStore.load：舊版 localStorage 一次性搬移", () => {
    test("舊版設定與 Token 搬到 chrome.storage.local 的 fi.* 鍵，並從富果網域刪除", async () => {
        await withStore({ legacy: { ...LEGACY, "unrelated-key": "keep-me" } }, async ({ env, fake }) => {
            const settings = await new SettingsStore().load();
            assert.equal(fake.local.get("fi.position"), "left");
            assert.equal(fake.local.get("fi.visible"), false);
            assert.equal(fake.local.get("fi.collapsed"), true);
            assert.deepEqual(fake.local.get("fi.sections"), { ratings: false, etf: true });
            assert.equal(fake.local.get("fi.finmindToken"), "secret-finmind-token");
            assert.equal(fake.local.get("fi.migratedFromLocalStorage"), true);

            const ls = env.window.localStorage;
            for (const key of Object.keys(LEGACY)) assert.equal(ls.getItem(key), null, `${key} 應被刪除`);
            assert.equal(ls.getItem("unrelated-key"), "keep-me", "不相關的鍵不可刪除");

            assert.equal(settings.position, "left");
            assert.equal(settings.visible, false);
            assert.equal(settings.collapsed, true);
            assert.deepEqual(settings.sections, { ratings: false, etf: true });
        });
    });

    test("已存在的 fi.* 設定不被舊值覆蓋（但舊鍵仍會刪除）", async () => {
        await withStore(
            { local: { "fi.position": "default", "fi.finmindToken": "new-token" }, legacy: LEGACY },
            async ({ env, fake }) => {
                const settings = await new SettingsStore().load();
                assert.equal(fake.local.get("fi.position"), "default");
                assert.equal(fake.local.get("fi.finmindToken"), "new-token");
                assert.equal(fake.local.get("fi.visible"), false, "不存在的鍵照常搬移");
                assert.equal(settings.position, "default");
                assert.equal(env.window.localStorage.getItem("fugle-info-position"), null);
                assert.equal(env.window.localStorage.getItem("fugle-volume-api-token"), null);
            }
        );
    });

    test("第二次載入不會重新搬移（即使 localStorage 又出現舊鍵）", async () => {
        await withStore({ legacy: LEGACY }, async ({ env, fake }) => {
            await new SettingsStore().load();
            assert.equal(fake.local.get("fi.position"), "left");

            env.window.localStorage.setItem("fugle-info-position", "default");
            env.window.localStorage.setItem("fugle-volume-api-token", "stale");
            const settings = await new SettingsStore().load();
            assert.equal(settings.position, "left");
            assert.equal(fake.local.get("fi.finmindToken"), "secret-finmind-token");
            assert.equal(env.window.localStorage.getItem("fugle-info-position"), "default", "已搬移過就不再動 localStorage");
        });
    });

    test("沒有舊資料時只寫入搬移標記，回傳預設設定", async () => {
        await withStore({}, async ({ fake }) => {
            const settings = await new SettingsStore().load();
            assert.deepEqual([...fake.local.keys()], ["fi.migratedFromLocalStorage"]);
            assert.deepEqual(settings, { position: "right", visible: true, collapsed: false, sections: {}, theme: "auto", shortcut: "Alt+Q", hiddenLinks: [] });
        });
    });

    test("快捷鍵讀自 chrome.storage.sync 的舊版 key（fugle-focus-input-shortcut）", async () => {
        await withStore({ sync: { "fugle-focus-input-shortcut": "alt+s" } }, async () => {
            const settings = await new SettingsStore().load(null);
            assert.equal(settings.shortcut, "Alt+S");
        });
    });

    test("傳入 legacy=null（無法存取 localStorage）時略過搬移", async () => {
        await withStore({ legacy: LEGACY }, async ({ env, fake }) => {
            await new SettingsStore().load(null);
            assert.equal(fake.local.has("fi.migratedFromLocalStorage"), false);
            assert.equal(env.window.localStorage.getItem("fugle-info-position"), "left");
        });
    });
});

describe("SettingsStore.update / onChange / 外部變更", () => {
    type Emit = { settings: UiSettings; changed: string[] };
    const record = (store: SettingsStore): Emit[] => {
        const emits: Emit[] = [];
        store.onChange((settings, changed) => emits.push({ settings: { ...settings }, changed: [...changed].sort() }));
        return emits;
    };

    test("update 立即生效並同步通知，再寫入 chrome.storage.local", async () => {
        await withStore({}, async ({ fake }) => {
            const store = new SettingsStore();
            await store.load(null);
            const emits = record(store);
            const pending = store.update({ position: "left", theme: "dark" });
            // 同步：尚未 await 就已通知、get() 已更新
            assert.equal(emits.length, 1);
            assert.deepEqual(emits[0]?.changed, ["position", "theme"]);
            assert.equal(store.get().position, "left");
            assert.equal(store.get().theme, "dark");
            await pending;
            assert.equal(fake.local.get("fi.position"), "left");
            assert.equal(fake.local.get("fi.theme"), "dark");
            await flush(5);
            assert.equal(emits.length, 1, "自己寫入造成的 onChanged 不應再通知一次");
        });
    });

    test("快捷鍵寫入 sync 的 fugle-focus-input-shortcut，不寫入 local", async () => {
        await withStore({}, async ({ fake }) => {
            const store = new SettingsStore();
            await store.load(null);
            await store.update({ shortcut: "Alt+S" });
            assert.equal(fake.sync.get("fugle-focus-input-shortcut"), "Alt+S");
            assert.equal([...fake.local.keys()].some((k) => /shortcut/i.test(k)), false);
        });
    });

    test("hiddenLinks / visible / collapsed 各自寫入對應的 fi.* 鍵", async () => {
        await withStore({}, async ({ fake }) => {
            const store = new SettingsStore();
            await store.load(null);
            await store.update({ hiddenLinks: ["cmoney", "gemini"], visible: false, collapsed: true });
            assert.deepEqual(fake.local.get("fi.hiddenLinks"), ["cmoney", "gemini"]);
            assert.equal(fake.local.get("fi.visible"), false);
            assert.equal(fake.local.get("fi.collapsed"), true);
        });
    });

    test("setSection 合併到既有區塊狀態並持久化", async () => {
        await withStore({ local: { "fi.sections": { ratings: false, etf: true } } }, async ({ fake }) => {
            const store = new SettingsStore();
            await store.load(null);
            const emits = record(store);
            await store.setSection("major", false);
            await store.setSection("etf", false);
            assert.deepEqual(store.get().sections, { ratings: false, etf: false, major: false });
            assert.deepEqual(fake.local.get("fi.sections"), { ratings: false, etf: false, major: false });
            assert.deepEqual(
                emits.map((e) => e.changed),
                [["sections"], ["sections"]]
            );
        });
    });

    test("其他分頁 / 設定頁修改 chrome.storage 時，get() 更新且只通知有變的鍵", async () => {
        await withStore({ local: { "fi.position": "right", "fi.theme": "auto" } }, async ({ fake }) => {
            const store = new SettingsStore();
            await store.load(null);
            const emits = record(store);

            // 另一個分頁同時寫入 position（改變）與 theme（相同值）
            await fake.chrome.storage.local.set({ "fi.position": "left", "fi.theme": "auto" });
            await waitFor(() => emits.length > 0, 500);
            assert.equal(store.get().position, "left");
            assert.deepEqual(emits[0]?.changed, ["position"]);

            // 設定頁切換深色主題
            await fake.chrome.storage.local.set({ "fi.theme": "dark" });
            await waitFor(() => emits.length > 1, 500);
            assert.equal(store.get().theme, "dark");
            assert.deepEqual(emits[1]?.changed, ["theme"]);
        });
    });

    test("另一台裝置同步了快捷鍵（storage.sync）→ 通知 shortcut 變更", async () => {
        await withStore({}, async ({ fake }) => {
            const store = new SettingsStore();
            await store.load(null);
            const emits = record(store);
            await fake.chrome.storage.sync.set({ "fugle-focus-input-shortcut": "Ctrl+Alt+F" });
            await waitFor(() => emits.length > 0, 500);
            assert.deepEqual(emits[0]?.changed, ["shortcut"]);
            assert.equal(store.get().shortcut, "Ctrl+Alt+F");
        });
    });

    test("與設定無關的 storage 變更（最近搜尋、Token、其他 sync 鍵）不會通知", async () => {
        await withStore({}, async ({ fake }) => {
            const store = new SettingsStore();
            await store.load(null);
            const emits = record(store);
            await fake.chrome.storage.local.set({ "fi.recentSearches": ["台積電"], "fi.finmindToken": "x" });
            await fake.chrome.storage.sync.set({ "other-key": 1 });
            await flush(10);
            assert.equal(emits.length, 0);
        });
    });

    test("取消訂閱後不再收到通知；監聽器拋錯不影響其他監聽器", async () => {
        await withStore({}, async () => {
            const store = new SettingsStore();
            await store.load(null);
            const calls: string[] = [];
            const off = store.onChange(() => calls.push("a"));
            store.onChange(() => {
                throw new Error("boom");
            });
            store.onChange(() => calls.push("c"));
            const origError = console.error;
            console.error = () => undefined;
            try {
                await store.update({ collapsed: true });
                off();
                await store.update({ collapsed: false });
            } finally {
                console.error = origError;
            }
            assert.deepEqual(calls, ["a", "c", "c"]);
        });
    });
});

describe("isFugleDark：標記只認全域容器", () => {
    test("頁面上局部元件帶有 dark-theme / tw-dark-theme / data-theme=dark 不會誤判為深色", () => {
        withPage(({ document }) => {
            const widget = document.createElement("div");
            widget.className = "dark-theme tw-dark-theme";
            widget.setAttribute("data-theme", "dark");
            document.querySelector(".card-group-header")?.appendChild(widget);
            assert.equal(isFugleDark(document), false);
        });
    });

    test("body.dark-theme 仍判定為深色", () => {
        withPage(({ document }) => {
            document.body.classList.add("dark-theme");
            assert.equal(isFugleDark(document), true);
        });
    });
});
