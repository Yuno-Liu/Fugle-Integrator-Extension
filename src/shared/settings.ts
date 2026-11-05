/**
 * ============================================================================
 * ⚙️ UI 設定：預設值、正規化、舊版資料搬移
 * ============================================================================
 *
 * 舊版把設定與 FinMind Token 存在「富果網域」的 localStorage，
 * 任何富果頁面上的腳本都讀得到 Token。新版改存 chrome.storage（擴充功能私有），
 * 並在第一次執行時自動搬移、刪除舊資料。
 */

import type { CardPosition, ThemePreference, UiSettings } from "./types";
import { DEFAULT_POSITION, DEFAULT_SHORTCUT, DEFAULT_THEME, LEGACY_LOCAL_STORAGE, LOCAL_KEYS } from "./constants";
import { normalizeShortcut } from "../utils/shortcut";

/** 區塊 id、外部連結 id 等設定鍵的格式 */
export const SETTING_KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

export const DEFAULT_SETTINGS: Readonly<UiSettings> = Object.freeze({
    position: DEFAULT_POSITION,
    visible: true,
    collapsed: false,
    sections: {},
    theme: DEFAULT_THEME,
    shortcut: DEFAULT_SHORTCUT,
    hiddenLinks: [],
});

/** 建立一份可修改的預設設定 */
export function defaultSettings(): UiSettings {
    return { ...DEFAULT_SETTINGS, sections: {}, hiddenLinks: [] };
}

export function normalizeHiddenLinks(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((v): v is string => typeof v === "string" && SETTING_KEY_PATTERN.test(v)))];
}

export function normalizePosition(value: unknown): CardPosition {
    return value === "left" || value === "right" || value === "default" ? value : DEFAULT_POSITION;
}

export function normalizeTheme(value: unknown): ThemePreference {
    return value === "light" || value === "dark" || value === "auto" ? value : DEFAULT_THEME;
}

export function normalizeSections(value: unknown): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (typeof value !== "object" || value === null) return out;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "boolean" && SETTING_KEY_PATTERN.test(k)) out[k] = v;
    }
    return out;
}

/** 由 chrome.storage.local / sync 的原始內容組出完整設定 */
export function settingsFromStorage(local: Record<string, unknown>, sync: Record<string, unknown>, shortcutKey: string): UiSettings {
    return {
        position: normalizePosition(local[LOCAL_KEYS.position]),
        visible: typeof local[LOCAL_KEYS.visible] === "boolean" ? (local[LOCAL_KEYS.visible] as boolean) : DEFAULT_SETTINGS.visible,
        collapsed: typeof local[LOCAL_KEYS.collapsed] === "boolean" ? (local[LOCAL_KEYS.collapsed] as boolean) : DEFAULT_SETTINGS.collapsed,
        sections: normalizeSections(local[LOCAL_KEYS.sections]),
        theme: normalizeTheme(local[LOCAL_KEYS.theme]),
        shortcut: normalizeShortcut(typeof sync[shortcutKey] === "string" ? (sync[shortcutKey] as string) : null) ?? DEFAULT_SHORTCUT,
        hiddenLinks: normalizeHiddenLinks(local[LOCAL_KEYS.hiddenLinks]),
    };
}

/** 一次性搬移的結果 */
export interface LegacyMigration {
    /** 要寫入 chrome.storage.local 的內容 */
    values: Record<string, unknown>;
    /** 要從 localStorage 刪除的鍵 */
    removeKeys: string[];
}

/**
 * 讀取舊版 localStorage 內容，轉為 chrome.storage.local 格式。
 * @param storage 只需 length / key / getItem（方便測試）
 */
export function collectLegacySettings(storage: Pick<Storage, "length" | "key" | "getItem">): LegacyMigration {
    const values: Record<string, unknown> = {};
    const removeKeys: string[] = [];

    const position = storage.getItem(LEGACY_LOCAL_STORAGE.position);
    if (position !== null) {
        values[LOCAL_KEYS.position] = normalizePosition(position);
        removeKeys.push(LEGACY_LOCAL_STORAGE.position);
    }
    const visible = storage.getItem(LEGACY_LOCAL_STORAGE.visible);
    if (visible !== null) {
        values[LOCAL_KEYS.visible] = visible !== "false";
        removeKeys.push(LEGACY_LOCAL_STORAGE.visible);
    }
    const collapsed = storage.getItem(LEGACY_LOCAL_STORAGE.collapsed);
    if (collapsed !== null) {
        values[LOCAL_KEYS.collapsed] = collapsed === "true";
        removeKeys.push(LEGACY_LOCAL_STORAGE.collapsed);
    }
    const token = storage.getItem(LEGACY_LOCAL_STORAGE.token);
    if (token !== null) {
        if (token.trim()) values[LOCAL_KEYS.finmindToken] = token.trim();
        removeKeys.push(LEGACY_LOCAL_STORAGE.token);
    }

    const sections: Record<string, boolean> = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || !key.startsWith(LEGACY_LOCAL_STORAGE.sectionPrefix)) continue;
        const id = key.slice(LEGACY_LOCAL_STORAGE.sectionPrefix.length);
        const value = storage.getItem(key);
        if (SETTING_KEY_PATTERN.test(id) && value !== null) sections[id] = value !== "false";
        removeKeys.push(key);
    }
    if (Object.keys(sections).length > 0) values[LOCAL_KEYS.sections] = sections;

    return { values, removeKeys };
}
