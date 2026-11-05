/**
 * ============================================================================
 * ⚙️ 設定儲存（chrome.storage）
 * ============================================================================
 *
 * - 讀取：啟動時一次載入到記憶體，之後同步讀取（UI 反應不需等待）
 * - 寫入：先更新記憶體並通知監聽者，再非同步寫入 chrome.storage
 * - 其他分頁 / 設定頁的變更透過 chrome.storage.onChanged 即時同步
 */

import type { UiSettings } from "../shared/types";
import { LOCAL_KEYS, SYNC_KEYS } from "../shared/constants";
import { collectLegacySettings, defaultSettings, settingsFromStorage } from "../shared/settings";
import { log } from "../utils/log";

export type SettingsListener = (settings: UiSettings, changed: ReadonlySet<keyof UiSettings>) => void;

const LOCAL_KEY_OF: Partial<Record<keyof UiSettings, string>> = {
    position: LOCAL_KEYS.position,
    visible: LOCAL_KEYS.visible,
    collapsed: LOCAL_KEYS.collapsed,
    sections: LOCAL_KEYS.sections,
    theme: LOCAL_KEYS.theme,
    hiddenLinks: LOCAL_KEYS.hiddenLinks,
};

/**
 * 只讀取 UI 需要的鍵：FinMind Token 等機密不會被載入富果頁面的 content script。
 */
const UI_LOCAL_KEYS: string[] = Object.values(LOCAL_KEY_OF).filter((k): k is string => typeof k === "string");

export class SettingsStore {
    private current: UiSettings = defaultSettings();
    private readonly listeners = new Set<SettingsListener>();
    private subscribed = false;

    get(): UiSettings {
        return this.current;
    }

    /** 載入設定；首次執行時把舊版 localStorage 設定搬到 chrome.storage */
    async load(legacy: Storage | null = safeLocalStorage()): Promise<UiSettings> {
        await this.migrate(legacy);
        const [local, sync] = await Promise.all([chrome.storage.local.get(UI_LOCAL_KEYS), chrome.storage.sync.get(SYNC_KEYS.shortcut)]);
        this.current = settingsFromStorage(local, sync, SYNC_KEYS.shortcut);
        this.subscribe();
        return this.current;
    }

    onChange(listener: SettingsListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** 更新設定（立即生效，背景寫入） */
    update(patch: Partial<UiSettings>): Promise<void> {
        const changed = new Set(Object.keys(patch) as Array<keyof UiSettings>);
        this.current = { ...this.current, ...patch };
        this.emit(changed);

        const local: Record<string, unknown> = {};
        const sync: Record<string, unknown> = {};
        for (const key of changed) {
            if (key === "shortcut") sync[SYNC_KEYS.shortcut] = this.current.shortcut;
            else {
                const storageKey = LOCAL_KEY_OF[key];
                if (storageKey) local[storageKey] = this.current[key];
            }
        }
        const writes: Array<Promise<void>> = [];
        if (Object.keys(local).length) writes.push(chrome.storage.local.set(local));
        if (Object.keys(sync).length) writes.push(chrome.storage.sync.set(sync));
        return Promise.all(writes).then(
            () => undefined,
            (error: unknown) => log.warn("儲存設定失敗：", error)
        );
    }

    /** 設定單一區塊的展開狀態 */
    setSection(id: string, open: boolean): Promise<void> {
        return this.update({ sections: { ...this.current.sections, [id]: open } });
    }

    private emit(changed: ReadonlySet<keyof UiSettings>): void {
        for (const listener of this.listeners) {
            try {
                listener(this.current, changed);
            } catch (error) {
                log.error("設定監聽器錯誤：", error);
            }
        }
    }

    private subscribe(): void {
        if (this.subscribed) return;
        this.subscribed = true;
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local" && area !== "sync") return;
            const relevant = Object.keys(changes).some((k) => (area === "sync" ? k === SYNC_KEYS.shortcut : Object.values(LOCAL_KEY_OF).includes(k)));
            if (!relevant) return;
            void Promise.all([chrome.storage.local.get(UI_LOCAL_KEYS), chrome.storage.sync.get(SYNC_KEYS.shortcut)]).then(([local, sync]) => {
                const next = settingsFromStorage(local, sync, SYNC_KEYS.shortcut);
                const changed = new Set<keyof UiSettings>();
                for (const key of Object.keys(next) as Array<keyof UiSettings>) {
                    if (JSON.stringify(next[key]) !== JSON.stringify(this.current[key])) changed.add(key);
                }
                if (changed.size === 0) return;
                this.current = next;
                this.emit(changed);
            });
        });
    }

    private async migrate(legacy: Storage | null): Promise<void> {
        if (!legacy) return;
        try {
            const done = await chrome.storage.local.get(LOCAL_KEYS.migrated);
            if (done[LOCAL_KEYS.migrated]) return;
            const { values, removeKeys } = collectLegacySettings(legacy);
            const existing = await chrome.storage.local.get(Object.keys(values));
            // 不覆蓋新版已存在的設定
            const toWrite: Record<string, unknown> = { [LOCAL_KEYS.migrated]: true };
            for (const [key, value] of Object.entries(values)) {
                if (existing[key] === undefined) toWrite[key] = value;
            }
            await chrome.storage.local.set(toWrite);
            for (const key of removeKeys) legacy.removeItem(key);
        } catch (error) {
            log.warn("舊版設定搬移失敗：", error);
        }
    }
}

function safeLocalStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}
