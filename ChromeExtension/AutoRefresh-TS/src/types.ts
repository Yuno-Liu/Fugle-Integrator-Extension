export interface TabRefreshConfig {
    tabId: number;
    url: string;
    enabled: boolean;
    interval: number; // 預設秒數（例如 10）
    actualInterval: number; // 加上隨機浮動後的當前週期秒數
    nextRefreshTimestamp: number; // 下次重新整理的 UNIX 時間戳 (ms)
    hardReload: boolean; // 是否強制重新整理（略過快取）
    showFloatingBadge: boolean; // 是否在網頁顯示懸浮倒數計時小工具
    randomJitter: number; // 隨機浮動範圍（秒，例如 0 代表不浮動，3 代表 ±3 秒）
    refreshCount: number; // 當前分頁累計已重新整理次數
    lastRefreshedAt: number | null; // 上次重新整理時間 (ms)
}

export interface GlobalDefaults {
    defaultInterval: number;
    defaultHardReload: boolean;
    defaultShowFloatingBadge: boolean;
    defaultRandomJitter: number;
}

export type ExtensionAction =
    | { action: "GET_TAB_CONFIG"; tabId?: number }
    | { action: "START_REFRESH"; tabId: number; config: Partial<TabRefreshConfig> }
    | { action: "STOP_REFRESH"; tabId: number }
    | { action: "TRIGGER_IMMEDIATE_REFRESH"; tabId: number; hardReload?: boolean }
    | { action: "COUNTDOWN_TICK"; tabId: number; remainingSeconds: number }
    | { action: "RELOAD_REQUESTED"; tabId: number; hardReload?: boolean }
    | { action: "TOGGLE_FLOATING_BADGE"; tabId: number; show: boolean };

export const DEFAULT_CONFIG: Omit<TabRefreshConfig, "tabId" | "url"> = {
    enabled: false,
    interval: 10,
    actualInterval: 10,
    nextRefreshTimestamp: 0,
    hardReload: false,
    showFloatingBadge: true,
    randomJitter: 0,
    refreshCount: 0,
    lastRefreshedAt: null
};

export function formatTime(ms: number | null): string {
    if (!ms) return "--:--:--";
    const date = new Date(ms);
    return date.toLocaleTimeString("zh-TW", { hour12: false });
}

export function formatSecondsToTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const remS = s % 60;
    if (m === 0) {
        return `${remS}s`;
    }
    const remM = m % 60;
    const h = Math.floor(m / 60);
    if (h === 0) {
        return `${String(remM).padStart(2, "0")}:${String(remS).padStart(2, "0")}`;
    }
    return `${String(h).padStart(2, "0")}:${String(remM).padStart(2, "0")}:${String(remS).padStart(2, "0")}`;
}
