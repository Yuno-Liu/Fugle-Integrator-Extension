/**
 * ============================================================================
 * ⌨️ 快捷鍵解析
 * ============================================================================
 *
 * 快捷鍵以「修飾鍵+按鍵」字串表示，例如 "Alt+Q"、"Ctrl+Shift+K"。
 *
 * 📌 使用 KeyboardEvent.code 判斷字母與數字鍵：
 *    macOS 按 Option+Q 時 event.key 會是 "œ"，以 code（"KeyQ"）判斷才穩定。
 */

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Alt",
    option: "Alt",
    opt: "Alt",
    shift: "Shift",
    meta: "Meta",
    cmd: "Meta",
    command: "Meta",
    win: "Meta",
    super: "Meta",
};

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

export type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"> & {
    repeat?: boolean;
    isComposing?: boolean;
};

/** 取得事件的主要按鍵名稱（不含修飾鍵）；純修飾鍵回傳 null */
function baseKey(event: ShortcutEvent): string | null {
    if (MODIFIER_KEYS.has(event.key)) return null;
    const letter = /^Key([A-Z])$/.exec(event.code ?? "");
    if (letter) return letter[1] ?? null;
    const digit = /^Digit([0-9])$/.exec(event.code ?? "");
    if (digit) return digit[1] ?? null;
    if (!event.key || event.key === "Unidentified" || event.key === "Dead") return null;
    if (event.key === " ") return "Space";
    // "+" 本身是分隔符號，以名稱表示才能正確解析（Ctrl+Plus 而非 Ctrl++）
    if (event.key === "+") return "Plus";
    return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

/**
 * 將鍵盤事件轉為標準化快捷鍵字串。
 * 需至少一個修飾鍵；重複觸發（按住）與輸入法組字中的事件回傳 null。
 */
export function shortcutFromEvent(event: ShortcutEvent): string | null {
    if (event.repeat || event.isComposing) return null;
    const key = baseKey(event);
    if (!key) return null;
    const mods: Modifier[] = [];
    if (event.ctrlKey) mods.push("Ctrl");
    if (event.altKey) mods.push("Alt");
    if (event.shiftKey) mods.push("Shift");
    if (event.metaKey) mods.push("Meta");
    if (mods.length === 0) return null;
    return [...mods, key].join("+");
}

/**
 * 正規化使用者輸入或舊版儲存的快捷鍵字串。
 * - 修飾鍵別名（Control/Cmd/Option）轉為標準名稱並排序
 * - 單一字元按鍵轉大寫
 * 格式不正確時回傳 null。
 */
export function normalizeShortcut(value: string | null | undefined): string | null {
    if (!value) return null;
    // 相容「Ctrl++」寫法：結尾的 "+" 視為 Plus 鍵
    const parts = value
        .trim()
        .replace(/\+\s*\+$/, "+Plus")
        .split("+")
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length < 2) return null;
    const mods = new Set<Modifier>();
    let key: string | null = null;
    for (const part of parts) {
        const mod = MODIFIER_ALIASES[part.toLowerCase()];
        if (mod) {
            mods.add(mod);
        } else if (key === null) {
            key = part.length === 1 ? part.toUpperCase() : part;
        } else {
            return null; // 兩個以上的一般按鍵
        }
    }
    if (!key || mods.size === 0) return null;
    return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** 是否為可用的全域快捷鍵：必須包含 Ctrl / Alt / Meta 其中之一（避免 Shift+字母干擾一般輸入） */
export function isUsableShortcut(value: string | null | undefined): boolean {
    const normalized = normalizeShortcut(value);
    if (!normalized) return false;
    const parts = normalized.split("+");
    return parts.some((p) => p === "Ctrl" || p === "Alt" || p === "Meta");
}

/** 判斷事件是否符合指定快捷鍵 */
export function matchesShortcut(event: ShortcutEvent, shortcut: string | null | undefined): boolean {
    const target = normalizeShortcut(shortcut);
    if (!target) return false;
    const pressed = shortcutFromEvent(event);
    return pressed !== null && normalizeShortcut(pressed) === target;
}
