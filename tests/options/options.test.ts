/**
 * 設定頁（src/options/main.ts）
 * 載入真實的 options.html，以 fake chrome.storage / runtime 驅動 UI。
 * 狀態訊息的自動清除使用 setTimeout，因此以 mock.timers 控制；
 * 非同步流程以 setImmediate（不受 mock 影響）推進。
 */
import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupDom } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl, FakeChromeOptions } from "../helpers/chrome";
import { isReservedShortcut, startOptions } from "../../src/options/main";
import { EXTERNAL_LINKS } from "../../src/shared/links";
import { LOCAL_KEYS, SYNC_KEYS } from "../../src/shared/constants";

const OPTIONS_HTML = readFileSync(join(process.cwd(), "options.html"), "utf8");
/**
 * 📌 不使用 chrome-extension:// URL：jsdom 視其為 opaque origin，存取 window.localStorage 會丟出
 *    SecurityError，而 setupDom() 會把 localStorage 複製到 globalThis。設定頁本身不依賴 URL。
 */
const PAGE_URL = "http://localhost/options.html";

let env: DomEnv | null = null;
let fake: FakeChromeControl | null = null;

/** 讓 microtask / 非同步 storage 呼叫跑完（setImmediate 不受 mock.timers 影響） */
async function settle(rounds = 10): Promise<void> {
    for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

async function start(options: FakeChromeOptions = {}): Promise<FakeChromeControl> {
    env = setupDom(OPTIONS_HTML, PAGE_URL);
    fake = installFakeChrome(options);
    mock.timers.enable({ apis: ["setTimeout"] });
    await startOptions();
    await settle();
    return fake;
}

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    assert.ok(el, `#${id} should exist`);
    return el as T;
};
const shortcutInput = (): HTMLInputElement => byId<HTMLInputElement>("shortcut-input");
const radio = (name: string, value: string): HTMLInputElement => {
    const el = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
    assert.ok(el, `radio ${name}=${value} should exist`);
    return el;
};
const checkedValue = (name: string): string | undefined => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
const linkBox = (id: string): HTMLInputElement => {
    const el = document.querySelector<HTMLInputElement>(`input[data-link="${id}"]`);
    assert.ok(el, `link checkbox ${id} should exist`);
    return el;
};

function press(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    shortcutInput().dispatchEvent(event);
    return event;
}

function selectRadio(el: HTMLInputElement): void {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
    mock.timers.reset();
    fake?.uninstall();
    fake = null;
    env?.cleanup();
    env = null;
});

describe("isReservedShortcut", () => {
    test("browser-reserved Ctrl / ⌘ combinations are reserved", () => {
        for (const s of ["Ctrl+T", "Ctrl+W", "Ctrl+N", "Ctrl+Tab", "Ctrl+1", "Ctrl+9", "Meta+T", "Meta+Q", "Ctrl+Shift+T", "Ctrl+Shift+I", "Ctrl+Shift+Delete", "Meta+Shift+N"]) {
            assert.equal(isReservedShortcut(s), true, s);
        }
    });

    test("Alt system combinations are reserved", () => {
        for (const s of ["Alt+F4", "Alt+Tab", "Alt+Home", "Alt+ArrowLeft", "Alt+ArrowRight"]) assert.equal(isReservedShortcut(s), true, s);
    });

    test("matching is normalization-aware (aliases, case, modifier order)", () => {
        assert.equal(isReservedShortcut("ctrl+t"), true);
        assert.equal(isReservedShortcut("Control+w"), true);
        assert.equal(isReservedShortcut("Cmd+W"), true);
        assert.equal(isReservedShortcut("Shift+Ctrl+T"), true);
        assert.equal(isReservedShortcut("Command+Shift+t"), true);
        assert.equal(isReservedShortcut(" Ctrl + Shift + J "), true);
    });

    test("ordinary extension shortcuts are not reserved", () => {
        for (const s of ["Alt+Q", "Alt+W", "Alt+K", "Ctrl+Shift+K", "Ctrl+Alt+T", "Alt+1", "Meta+Shift+K", "Ctrl+0"]) {
            assert.equal(isReservedShortcut(s), false, s);
        }
    });

    test("invalid strings are not reserved", () => {
        for (const s of ["", "T", "Ctrl", "Ctrl+A+B", "garbage"]) assert.equal(isReservedShortcut(s), false, JSON.stringify(s));
    });
});

describe("startOptions: initial render", () => {
    test("version text comes from chrome.runtime.getManifest()", async () => {
        await start({ version: "9.8.7" });
        assert.equal(byId("version").textContent, "9.8.7");
    });

    test("defaults when storage is empty", async () => {
        await start();
        assert.equal(shortcutInput().value, "Alt+Q");
        assert.equal(checkedValue("position"), "right");
        assert.equal(checkedValue("theme"), "auto");
        assert.equal(byId<HTMLInputElement>("visible").checked, true);
        assert.equal(byId<HTMLInputElement>("collapsed").checked, false);
        assert.equal(byId<HTMLInputElement>("token-input").value, "");
        assert.equal(byId<HTMLInputElement>("token-input").type, "password");
        for (const link of EXTERNAL_LINKS) assert.equal(linkBox(link.id).checked, true, link.id);
    });

    test("shows the saved (normalized) shortcut and stored settings", async () => {
        await start({
            sync: { [SYNC_KEYS.shortcut]: "shift+ctrl+k" },
            local: {
                [LOCAL_KEYS.position]: "left",
                [LOCAL_KEYS.theme]: "dark",
                [LOCAL_KEYS.visible]: false,
                [LOCAL_KEYS.collapsed]: true,
                [LOCAL_KEYS.hiddenLinks]: ["gemini", "cmoney"],
                [LOCAL_KEYS.finmindToken]: "tok-123",
            },
        });
        assert.equal(shortcutInput().value, "Ctrl+Shift+K");
        assert.equal(checkedValue("position"), "left");
        assert.equal(checkedValue("theme"), "dark");
        assert.equal(byId<HTMLInputElement>("visible").checked, false);
        assert.equal(byId<HTMLInputElement>("collapsed").checked, true);
        assert.equal(byId<HTMLInputElement>("token-input").value, "tok-123");
        assert.equal(linkBox("gemini").checked, false);
        assert.equal(linkBox("cmoney").checked, false);
        assert.equal(linkBox("wantgoo").checked, true);
    });

    test("invalid stored values fall back to defaults", async () => {
        await start({ sync: { [SYNC_KEYS.shortcut]: "Q" }, local: { [LOCAL_KEYS.position]: "top", [LOCAL_KEYS.theme]: "neon", [LOCAL_KEYS.finmindToken]: 42 } });
        assert.equal(shortcutInput().value, "Alt+Q");
        assert.equal(checkedValue("position"), "right");
        assert.equal(checkedValue("theme"), "auto");
        assert.equal(byId<HTMLInputElement>("token-input").value, "");
    });

    test("the 8 external-link checkboxes render from EXTERNAL_LINKS in order", async () => {
        await start();
        const labels = [...document.querySelectorAll<HTMLLabelElement>("#links label.check")];
        assert.equal(EXTERNAL_LINKS.length, 8);
        assert.equal(labels.length, EXTERNAL_LINKS.length);
        labels.forEach((label, i) => {
            const link = EXTERNAL_LINKS[i]!;
            const box = label.querySelector<HTMLInputElement>("input");
            assert.ok(box);
            assert.equal(box.type, "checkbox");
            assert.equal(box.dataset.link, link.id);
            assert.equal(label.title, link.title);
            assert.equal(label.textContent?.trim(), link.label);
        });
    });
});

describe("startOptions: shortcut recorder", () => {
    test("focusing enters recording mode; blur restores the saved shortcut", async () => {
        await start({ sync: { [SYNC_KEYS.shortcut]: "Alt+K" } });
        const input = shortcutInput();
        input.focus();
        assert.equal(input.value, "請按下組合鍵…");
        assert.ok(input.classList.contains("recording"));
        input.blur();
        assert.equal(input.value, "Alt+K");
        assert.ok(!input.classList.contains("recording"));
    });

    test("Alt+KeyW saves Alt+W to chrome.storage.sync and shows ✅", async () => {
        const c = await start();
        const input = shortcutInput();
        input.focus();
        const event = press({ key: "w", code: "KeyW", altKey: true });
        assert.equal(event.defaultPrevented, true);
        await settle();
        assert.equal(c.sync.get(SYNC_KEYS.shortcut), "Alt+W");
        const status = byId("shortcut-status");
        assert.equal(status.textContent, "✅ 已儲存：Alt+W");
        assert.ok(status.classList.contains("ok"));
        assert.equal(input.value, "Alt+W");
        assert.ok(!input.classList.contains("recording"), "input leaves recording mode after saving");
    });

    test("macOS Option key (non-ASCII event.key) is resolved through event.code", async () => {
        const c = await start();
        shortcutInput().focus();
        press({ key: "∑", code: "KeyW", altKey: true });
        await settle();
        assert.equal(c.sync.get(SYNC_KEYS.shortcut), "Alt+W");
    });

    test("the success message clears after 2.5 s", async () => {
        await start();
        shortcutInput().focus();
        press({ key: "w", code: "KeyW", altKey: true });
        await settle();
        const status = byId("shortcut-status");
        mock.timers.tick(2499);
        assert.equal(status.textContent, "✅ 已儲存：Alt+W");
        mock.timers.tick(1);
        assert.equal(status.textContent, "");
    });

    test("Shift+KeyA shows the needs-Ctrl/Alt/⌘ error and does not save", async () => {
        const c = await start();
        const input = shortcutInput();
        input.focus();
        const event = press({ key: "A", code: "KeyA", shiftKey: true });
        await settle();
        assert.equal(event.defaultPrevented, true);
        assert.equal(c.sync.has(SYNC_KEYS.shortcut), false);
        const status = byId("shortcut-status");
        assert.equal(status.textContent, "❌「Shift+A」需包含 Ctrl、Alt 或 ⌘");
        assert.ok(status.classList.contains("err"));
        assert.ok(input.classList.contains("recording"), "stays in recording mode for another try");
    });

    test("Ctrl+KeyT shows the reserved-shortcut error and does not save", async () => {
        const c = await start();
        shortcutInput().focus();
        const event = press({ key: "t", code: "KeyT", ctrlKey: true });
        await settle();
        assert.equal(event.defaultPrevented, true);
        assert.equal(c.sync.has(SYNC_KEYS.shortcut), false);
        const status = byId("shortcut-status");
        assert.equal(status.textContent, "❌「Ctrl+T」是瀏覽器保留的快捷鍵，請換一組");
        assert.ok(status.classList.contains("err"));
    });

    test("error messages clear after 4 s", async () => {
        await start();
        shortcutInput().focus();
        press({ key: "t", code: "KeyT", ctrlKey: true });
        const status = byId("shortcut-status");
        mock.timers.tick(3999);
        assert.notEqual(status.textContent, "");
        mock.timers.tick(1);
        assert.equal(status.textContent, "");
    });

    test("plain Tab and Shift+Tab are not prevented (no keyboard trap)", async () => {
        const c = await start();
        shortcutInput().focus();
        assert.equal(press({ key: "Tab", code: "Tab" }).defaultPrevented, false);
        assert.equal(press({ key: "Tab", code: "Tab", shiftKey: true }).defaultPrevented, false);
        await settle();
        assert.equal(c.sync.has(SYNC_KEYS.shortcut), false);
        assert.equal(byId("shortcut-status").textContent, "");
    });

    test("Ctrl+Tab is captured and rejected as reserved", async () => {
        const c = await start();
        shortcutInput().focus();
        assert.equal(press({ key: "Tab", code: "Tab", ctrlKey: true }).defaultPrevented, true);
        await settle();
        assert.equal(c.sync.has(SYNC_KEYS.shortcut), false);
        assert.equal(byId("shortcut-status").textContent, "❌「Ctrl+Tab」是瀏覽器保留的快捷鍵，請換一組");
    });

    test("other plain keys are prevented but do nothing", async () => {
        const c = await start();
        const input = shortcutInput();
        input.focus();
        assert.equal(press({ key: "a", code: "KeyA" }).defaultPrevented, true);
        assert.equal(press({ key: "Enter", code: "Enter" }).defaultPrevented, true);
        await settle();
        assert.equal(c.sync.has(SYNC_KEYS.shortcut), false);
        assert.equal(byId("shortcut-status").textContent, "");
        assert.equal(input.value, "請按下組合鍵…");
    });

    test("Escape cancels recording and restores the current shortcut", async () => {
        const c = await start({ sync: { [SYNC_KEYS.shortcut]: "Alt+K" } });
        const input = shortcutInput();
        input.focus();
        const event = press({ key: "Escape", code: "Escape" });
        await settle();
        assert.equal(event.defaultPrevented, true);
        assert.equal(byId("shortcut-status").textContent, "已取消");
        assert.equal(input.value, "Alt+K");
        assert.ok(!input.classList.contains("recording"));
        assert.notEqual(document.activeElement, input);
        assert.equal(c.sync.get(SYNC_KEYS.shortcut), "Alt+K");
    });

    test("pressing only a modifier does nothing", async () => {
        const c = await start();
        const input = shortcutInput();
        input.focus();
        press({ key: "Alt", code: "AltLeft", altKey: true });
        press({ key: "Control", code: "ControlLeft", ctrlKey: true });
        press({ key: "Shift", code: "ShiftLeft", shiftKey: true });
        await settle();
        assert.equal(c.sync.has(SYNC_KEYS.shortcut), false);
        assert.equal(byId("shortcut-status").textContent, "");
        assert.equal(input.value, "請按下組合鍵…");
        assert.ok(input.classList.contains("recording"));
    });

    test("auto-repeat keydown is ignored", async () => {
        const c = await start();
        shortcutInput().focus();
        press({ key: "w", code: "KeyW", altKey: true, repeat: true });
        await settle();
        assert.equal(c.sync.has(SYNC_KEYS.shortcut), false);
    });

    test("重設 button writes Alt+Q", async () => {
        const c = await start({ sync: { [SYNC_KEYS.shortcut]: "Ctrl+Shift+K" } });
        assert.equal(shortcutInput().value, "Ctrl+Shift+K");
        byId("reset-shortcut").click();
        await settle();
        assert.equal(c.sync.get(SYNC_KEYS.shortcut), "Alt+Q");
        assert.equal(shortcutInput().value, "Alt+Q");
        assert.equal(byId("shortcut-status").textContent, "✅ 已儲存：Alt+Q");
    });
});

describe("startOptions: card settings", () => {
    test("position radios write fi.position", async () => {
        const c = await start();
        selectRadio(radio("position", "left"));
        await settle();
        assert.equal(c.local.get(LOCAL_KEYS.position), "left");
        assert.equal(byId("card-status").textContent, "✅ 已儲存");
        selectRadio(radio("position", "default"));
        await settle();
        assert.equal(c.local.get(LOCAL_KEYS.position), "default");
    });

    test("theme radios write fi.theme", async () => {
        const c = await start();
        for (const value of ["dark", "light", "auto"]) {
            selectRadio(radio("theme", value));
            await settle();
            assert.equal(c.local.get(LOCAL_KEYS.theme), value);
            assert.equal(checkedValue("theme"), value);
        }
    });

    test("visible / collapsed checkboxes write fi.visible / fi.collapsed", async () => {
        const c = await start();
        byId("visible").click();
        await settle();
        assert.equal(c.local.get(LOCAL_KEYS.visible), false);
        byId("collapsed").click();
        await settle();
        assert.equal(c.local.get(LOCAL_KEYS.collapsed), true);
        byId("visible").click();
        await settle();
        assert.equal(c.local.get(LOCAL_KEYS.visible), true);
        assert.equal(byId("card-status").textContent, "✅ 已儲存");
    });

    test("saved status clears after 1.5 s", async () => {
        await start();
        byId("collapsed").click();
        await settle();
        const status = byId("card-status");
        assert.equal(status.textContent, "✅ 已儲存");
        mock.timers.tick(1500);
        assert.equal(status.textContent, "");
    });

    test("重設各區塊 writes fi.sections = {}", async () => {
        const c = await start({ local: { [LOCAL_KEYS.sections]: { basic: false, chips: true } } });
        byId("reset-sections").click();
        await settle();
        assert.deepEqual(c.local.get(LOCAL_KEYS.sections), {});
        assert.equal(byId("card-status").textContent, "✅ 已重設各區塊狀態");
    });
});

describe("startOptions: external links", () => {
    test("unchecking writes fi.hiddenLinks; re-checking removes it", async () => {
        const c = await start();
        linkBox("gemini").click();
        await settle();
        assert.deepEqual(c.local.get(LOCAL_KEYS.hiddenLinks), ["gemini"]);
        assert.equal(byId("links-status").textContent, "✅ 已儲存");
        linkBox("wantgoo").click();
        await settle();
        assert.deepEqual(c.local.get(LOCAL_KEYS.hiddenLinks), ["wantgoo", "gemini"]);
        linkBox("gemini").click();
        await settle();
        assert.deepEqual(c.local.get(LOCAL_KEYS.hiddenLinks), ["wantgoo"]);
        linkBox("wantgoo").click();
        await settle();
        assert.deepEqual(c.local.get(LOCAL_KEYS.hiddenLinks), []);
    });
});

describe("startOptions: FinMind token", () => {
    test("empty / whitespace save shows ❌ and does not write", async () => {
        const c = await start({ local: { [LOCAL_KEYS.finmindToken]: "old" } });
        const input = byId<HTMLInputElement>("token-input");
        input.value = "   ";
        byId("save-token").click();
        await settle();
        assert.equal(c.local.get(LOCAL_KEYS.finmindToken), "old");
        const status = byId("token-status");
        assert.equal(status.textContent, "❌ Token 不能為空；若要移除請按「清除」");
        assert.ok(status.classList.contains("err"));
    });

    test("empty save with no token stored writes nothing", async () => {
        const c = await start();
        byId("save-token").click();
        await settle();
        assert.equal(c.local.has(LOCAL_KEYS.finmindToken), false);
    });

    test("save trims and writes fi.finmindToken", async () => {
        const c = await start();
        byId<HTMLInputElement>("token-input").value = "  abc123  ";
        byId("save-token").click();
        await settle();
        assert.equal(c.local.get(LOCAL_KEYS.finmindToken), "abc123");
        const status = byId("token-status");
        assert.equal(status.textContent, "✅ Token 已儲存");
        assert.ok(status.classList.contains("ok"));
    });

    test("顯示 / 隱藏 toggles input type, label and aria-pressed", async () => {
        await start();
        const input = byId<HTMLInputElement>("token-input");
        const toggle = byId<HTMLButtonElement>("toggle-token");
        assert.equal(toggle.getAttribute("aria-pressed"), "false");
        toggle.click();
        assert.equal(input.type, "text");
        assert.equal(toggle.textContent, "隱藏");
        assert.equal(toggle.getAttribute("aria-pressed"), "true");
        toggle.click();
        assert.equal(input.type, "password");
        assert.equal(toggle.textContent, "顯示");
        assert.equal(toggle.getAttribute("aria-pressed"), "false");
    });

    test("清除 removes the key and empties the input", async () => {
        const c = await start({ local: { [LOCAL_KEYS.finmindToken]: "secret" } });
        const input = byId<HTMLInputElement>("token-input");
        assert.equal(input.value, "secret");
        byId("clear-token").click();
        await settle();
        assert.equal(c.local.has(LOCAL_KEYS.finmindToken), false);
        assert.equal(input.value, "");
        assert.equal(byId("token-status").textContent, "✅ 已清除 Token");
    });
});

describe("startOptions: clear cache", () => {
    test("sends {type:'clearCache'} and shows ✅ on success", async () => {
        const c = await start({ handler: (m) => (m.type === "clearCache" ? { ok: true, data: { cleared: true } } : undefined) });
        byId("clear-cache").click();
        await settle();
        assert.deepEqual(c.sent, [{ type: "clearCache" }]);
        const status = byId("cache-status");
        assert.equal(status.textContent, "✅ 已清除快取，下次開啟個股時會重新下載資料");
        assert.ok(status.classList.contains("ok"));
    });

    test("handler returning {ok:false,error} shows ❌ with the message", async () => {
        const c = await start({ handler: () => ({ ok: false, error: "磁碟已滿" }) });
        byId("clear-cache").click();
        await settle();
        assert.deepEqual(c.sent, [{ type: "clearCache" }]);
        const status = byId("cache-status");
        assert.equal(status.textContent, "❌ 清除失敗：磁碟已滿");
        assert.ok(status.classList.contains("err"));
        mock.timers.tick(4999);
        assert.equal(status.textContent, "❌ 清除失敗：磁碟已滿");
        mock.timers.tick(1);
        assert.equal(status.textContent, "");
    });

    test("a runtime messaging error is reported too", async () => {
        const c = await start({ handler: () => ({ ok: true, data: { cleared: true } }) });
        c.failNextMessage("Could not establish connection.");
        byId("clear-cache").click();
        await settle();
        assert.equal(byId("cache-status").textContent, "❌ 清除失敗：Could not establish connection.");
    });
});

describe("startOptions: external storage changes", () => {
    test("local changes re-render radios, checkboxes and links", async () => {
        const c = await start();
        await c.chrome.storage.local.set({
            [LOCAL_KEYS.position]: "default",
            [LOCAL_KEYS.theme]: "light",
            [LOCAL_KEYS.visible]: false,
            [LOCAL_KEYS.collapsed]: true,
            [LOCAL_KEYS.hiddenLinks]: ["tradingview"],
        });
        await settle();
        assert.equal(checkedValue("position"), "default");
        assert.equal(checkedValue("theme"), "light");
        assert.equal(byId<HTMLInputElement>("visible").checked, false);
        assert.equal(byId<HTMLInputElement>("collapsed").checked, true);
        assert.equal(linkBox("tradingview").checked, false);
        assert.equal(linkBox("gemini").checked, true);
    });

    test("sync shortcut change updates the field and the blur fallback", async () => {
        const c = await start();
        await c.chrome.storage.sync.set({ [SYNC_KEYS.shortcut]: "Ctrl+Alt+F" });
        await settle();
        const input = shortcutInput();
        assert.equal(input.value, "Ctrl+Alt+F");
        input.focus();
        input.blur();
        assert.equal(input.value, "Ctrl+Alt+F");
    });

    test("an external change while recording does not overwrite the prompt", async () => {
        const c = await start();
        const input = shortcutInput();
        input.focus();
        await c.chrome.storage.sync.set({ [SYNC_KEYS.shortcut]: "Alt+Z" });
        await settle();
        assert.equal(input.value, "請按下組合鍵…");
        input.blur();
        assert.equal(input.value, "Alt+Z");
    });
});
