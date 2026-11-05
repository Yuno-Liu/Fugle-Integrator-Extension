/**
 * ============================================================================
 * ⚙️ 設定頁
 * ============================================================================
 *
 * 所有變更立即寫入 chrome.storage；富果頁面的 content script 透過
 * chrome.storage.onChanged 即時套用，不需重新整理。
 */

import type { CardPosition, ThemePreference, UiSettings } from "../shared/types";
import { DEFAULT_SHORTCUT, LOCAL_KEYS, SYNC_KEYS } from "../shared/constants";
import { EXTERNAL_LINKS } from "../shared/links";
import { settingsFromStorage } from "../shared/settings";
import { send } from "../shared/runtime";
import { isUsableShortcut, normalizeShortcut, shortcutFromEvent } from "../utils/shortcut";

/** 瀏覽器或系統保留、不應被覆寫的組合 */
const RESERVED = new Set(
    [
        ...["T", "W", "N", "L", "R", "F", "C", "V", "X", "Z", "Y", "A", "S", "P", "D", "H", "J", "K", "E", "O", "Q", "Tab", "1", "2", "3", "4", "5", "6", "7", "8", "9"].flatMap((k) => [`Ctrl+${k}`, `Meta+${k}`]),
        "Ctrl+Shift+T",
        "Ctrl+Shift+N",
        "Ctrl+Shift+W",
        "Ctrl+Shift+Tab",
        "Ctrl+Shift+I",
        "Ctrl+Shift+J",
        "Ctrl+Shift+Delete",
        "Meta+Shift+T",
        "Meta+Shift+N",
        "Alt+F4",
        "Alt+Tab",
        "Alt+Home",
        "Alt+ArrowLeft",
        "Alt+ArrowRight",
    ].map((s) => normalizeShortcut(s) ?? s)
);

export function isReservedShortcut(shortcut: string): boolean {
    const normalized = normalizeShortcut(shortcut);
    return normalized !== null && RESERVED.has(normalized);
}

const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not found`);
    return el as T;
};

function flash(el: HTMLElement, text: string, ok = true, ms = 2500): void {
    el.textContent = text;
    el.className = `status ${ok ? "ok" : "err"}`;
    const token = String(Date.now());
    el.dataset.token = token;
    if (ms > 0) {
        setTimeout(() => {
            if (el.dataset.token === token) el.textContent = "";
        }, ms);
    }
}

async function readSettings(): Promise<{ settings: UiSettings; token: string }> {
    const [local, sync] = await Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(SYNC_KEYS.shortcut)]);
    const token = local[LOCAL_KEYS.finmindToken];
    return { settings: settingsFromStorage(local, sync, SYNC_KEYS.shortcut), token: typeof token === "string" ? token : "" };
}


function render(settings: UiSettings): void {
    const shortcutInput = $<HTMLInputElement>("shortcut-input");
    if (!shortcutInput.classList.contains("recording")) shortcutInput.value = settings.shortcut;
    document.querySelectorAll<HTMLInputElement>('input[name="position"]').forEach((r) => (r.checked = r.value === settings.position));
    document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((r) => (r.checked = r.value === settings.theme));
    $<HTMLInputElement>("visible").checked = settings.visible;
    $<HTMLInputElement>("collapsed").checked = settings.collapsed;
    const hidden = new Set(settings.hiddenLinks);
    document.querySelectorAll<HTMLInputElement>("input[data-link]").forEach((c) => (c.checked = !hidden.has(c.dataset.link ?? "")));
}

function setupShortcut(getCurrent: () => string): void {
    const input = $<HTMLInputElement>("shortcut-input");
    const status = $("shortcut-status");

    const save = async (value: string): Promise<void> => {
        await chrome.storage.sync.set({ [SYNC_KEYS.shortcut]: value });
        input.value = value;
        flash(status, `✅ 已儲存：${value}`);
    };

    input.addEventListener("focus", () => {
        input.classList.add("recording");
        input.value = "請按下組合鍵…";
    });
    input.addEventListener("blur", () => {
        input.classList.remove("recording");
        input.value = getCurrent();
    });
    input.addEventListener("keydown", (event) => {
        const hasCommandModifier = event.ctrlKey || event.altKey || event.metaKey;
        if (event.key === "Tab" && !hasCommandModifier) return; // 不形成鍵盤陷阱
        event.preventDefault();
        if (event.key === "Escape") {
            flash(status, "已取消", true, 1500);
            input.blur();
            return;
        }
        const shortcut = shortcutFromEvent(event);
        if (!shortcut) return; // 只按了修飾鍵
        if (!isUsableShortcut(shortcut)) {
            flash(status, `❌「${shortcut}」需包含 Ctrl、Alt 或 ⌘`, false, 4000);
            return;
        }
        if (isReservedShortcut(shortcut)) {
            flash(status, `❌「${shortcut}」是瀏覽器保留的快捷鍵，請換一組`, false, 4000);
            return;
        }
        void save(shortcut).then(() => input.blur());
    });
    $("reset-shortcut").addEventListener("click", () => void save(DEFAULT_SHORTCUT));
}

function setupCard(): void {
    const status = $("card-status");
    const saved = (): void => flash(status, "✅ 已儲存", true, 1500);
    document.querySelectorAll<HTMLInputElement>('input[name="position"]').forEach((r) =>
        r.addEventListener("change", () => {
            if (r.checked) void chrome.storage.local.set({ [LOCAL_KEYS.position]: r.value as CardPosition }).then(saved);
        })
    );
    document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((r) =>
        r.addEventListener("change", () => {
            if (r.checked) void chrome.storage.local.set({ [LOCAL_KEYS.theme]: r.value as ThemePreference }).then(saved);
        })
    );
    $<HTMLInputElement>("visible").addEventListener("change", (e) => void chrome.storage.local.set({ [LOCAL_KEYS.visible]: (e.target as HTMLInputElement).checked }).then(saved));
    $<HTMLInputElement>("collapsed").addEventListener("change", (e) => void chrome.storage.local.set({ [LOCAL_KEYS.collapsed]: (e.target as HTMLInputElement).checked }).then(saved));
    $("reset-sections").addEventListener("click", () => void chrome.storage.local.set({ [LOCAL_KEYS.sections]: {} }).then(() => flash(status, "✅ 已重設各區塊狀態")));
}

function setupLinks(): void {
    const container = $("links");
    const status = $("links-status");
    for (const link of EXTERNAL_LINKS) {
        const label = document.createElement("label");
        label.className = "check";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.dataset.link = link.id;
        label.append(box, ` ${link.label}`);
        label.title = link.title;
        container.appendChild(label);
    }
    container.addEventListener("change", () => {
        const hidden = [...container.querySelectorAll<HTMLInputElement>("input[data-link]")].filter((c) => !c.checked).map((c) => c.dataset.link ?? "");
        void chrome.storage.local.set({ [LOCAL_KEYS.hiddenLinks]: hidden }).then(() => flash(status, "✅ 已儲存", true, 1500));
    });
}

function setupData(initialToken: string): void {
    const input = $<HTMLInputElement>("token-input");
    const toggle = $<HTMLButtonElement>("toggle-token");
    const status = $("token-status");
    input.value = initialToken;

    toggle.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.textContent = show ? "隱藏" : "顯示";
        toggle.setAttribute("aria-pressed", String(show));
    });
    $("save-token").addEventListener("click", async () => {
        const token = input.value.trim();
        if (!token) {
            flash(status, "❌ Token 不能為空；若要移除請按「清除」", false, 4000);
            return;
        }
        await chrome.storage.local.set({ [LOCAL_KEYS.finmindToken]: token });
        flash(status, "✅ Token 已儲存");
    });
    $("clear-token").addEventListener("click", async () => {
        await chrome.storage.local.remove(LOCAL_KEYS.finmindToken);
        input.value = "";
        flash(status, "✅ 已清除 Token");
    });

    const cacheStatus = $("cache-status");
    $("clear-cache").addEventListener("click", async () => {
        try {
            await send({ type: "clearCache" });
            flash(cacheStatus, "✅ 已清除快取，下次開啟個股時會重新下載資料");
        } catch (error) {
            flash(cacheStatus, `❌ 清除失敗：${error instanceof Error ? error.message : String(error)}`, false, 5000);
        }
    });
}

export async function startOptions(): Promise<void> {
    $("version").textContent = chrome.runtime.getManifest().version;
    let { settings, token } = await readSettings();
    setupShortcut(() => settings.shortcut);
    setupCard();
    setupLinks();
    setupData(token);
    render(settings);

    // 富果頁面上的變更（例如切換位置）也即時反映在設定頁
    chrome.storage.onChanged.addListener(() => {
        void readSettings().then((next) => {
            settings = next.settings;
            token = next.token;
            render(settings);
        });
    });
}
