import { DEFAULT_FOCUS_INPUT_SHORTCUT, FOCUS_INPUT_SHORTCUT_KEY } from "./config/constants";

function formatShortcut(event: KeyboardEvent): string | null {
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const ignoredKeys = new Set(["Alt", "Control", "Shift", "Meta"]);
    if (ignoredKeys.has(key)) return null;

    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    if (parts.length === 0) return null;
    parts.push(key);
    return parts.join("+");
}

async function initShortcutSettings(): Promise<void> {
    const input = document.getElementById("shortcut-input") as HTMLInputElement | null;
    const saveBtn = document.getElementById("save-shortcut-btn") as HTMLButtonElement | null;
    const resetBtn = document.getElementById("reset-shortcut-btn") as HTMLButtonElement | null;
    const statusEl = document.getElementById("shortcut-status") as HTMLElement | null;

    if (!input || !saveBtn || !resetBtn || !statusEl) return;

    const result = await chrome.storage.sync.get(FOCUS_INPUT_SHORTCUT_KEY);
    input.value = typeof result[FOCUS_INPUT_SHORTCUT_KEY] === "string" && result[FOCUS_INPUT_SHORTCUT_KEY].trim() ? result[FOCUS_INPUT_SHORTCUT_KEY] : DEFAULT_FOCUS_INPUT_SHORTCUT;

    input.addEventListener("keydown", (event) => {
        event.preventDefault();
        const shortcut = formatShortcut(event);
        if (!shortcut) return;
        input.value = shortcut;
    });

    saveBtn.addEventListener("click", async () => {
        const value = input.value.trim() || DEFAULT_FOCUS_INPUT_SHORTCUT;
        await chrome.storage.sync.set({ [FOCUS_INPUT_SHORTCUT_KEY]: value });
        statusEl.textContent = "✅ 快捷鍵已儲存";
    });

    resetBtn.addEventListener("click", async () => {
        input.value = DEFAULT_FOCUS_INPUT_SHORTCUT;
        await chrome.storage.sync.set({ [FOCUS_INPUT_SHORTCUT_KEY]: DEFAULT_FOCUS_INPUT_SHORTCUT });
        statusEl.textContent = "✅ 已重設為 Alt+Q";
    });
}

void initShortcutSettings();
