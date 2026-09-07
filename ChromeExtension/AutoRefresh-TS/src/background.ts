import { DEFAULT_CONFIG, type TabRefreshConfig } from "./types";

// 輔助函式：取得指定 tabId 的設定
async function getTabConfig(tabId: number, url = ""): Promise<TabRefreshConfig> {
    const key = `tab_${tabId}`;
    const data = await chrome.storage.local.get(key);
    if (data[key]) {
        return data[key] as TabRefreshConfig;
    }
    return {
        ...DEFAULT_CONFIG,
        tabId,
        url
    };
}

// 輔助函式：儲存 tab 設定
async function saveTabConfig(config: TabRefreshConfig): Promise<void> {
    await chrome.storage.local.set({ [`tab_${config.tabId}`]: config });
}

// 計算下一次刷新的秒數（包含隨機抖動）
function computeNextInterval(baseInterval: number, jitter: number): number {
    if (jitter <= 0) return Math.max(1, baseInterval);
    const offset = Math.floor(Math.random() * (jitter * 2 + 1)) - jitter;
    return Math.max(1, baseInterval + offset);
}

// 設置 Chrome Alarms 作為背景防休眠備援
function setupAlarm(tabId: number, delayInSeconds: number) {
    const alarmName = `refresh_tab_${tabId}`;
    chrome.alarms.clear(alarmName, () => {
        // chrome.alarms 延遲以分鐘為單位，若小於 1 分鐘由 content script 處理，但設定 1 分鐘後保險觸發
        const delayInMinutes = Math.max(0.5, delayInSeconds / 60);
        chrome.alarms.create(alarmName, { delayInMinutes });
    });
}

function clearAlarm(tabId: number) {
    chrome.alarms.clear(`refresh_tab_${tabId}`);
}

// 處理分頁關閉
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.remove(`tab_${tabId}`);
    clearAlarm(tabId);
});

// 處理分頁切換時更新 Badge
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const config = await getTabConfig(activeInfo.tabId);
        if (config.enabled) {
            const remaining = Math.max(0, Math.ceil((config.nextRefreshTimestamp - Date.now()) / 1000));
            chrome.action.setBadgeText({ text: `${remaining}s`, tabId: activeInfo.tabId });
            chrome.action.setBadgeBackgroundColor({ color: "#10B981", tabId: activeInfo.tabId });
        } else {
            chrome.action.setBadgeText({ text: "", tabId: activeInfo.tabId });
        }
    } catch {
        // 忽略可能的分頁存取異常
    }
});

// 處理 Alarm 觸發（分頁在背景休眠時的備用機制）
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith("refresh_tab_")) {
        const tabId = parseInt(alarm.name.replace("refresh_tab_", ""), 10);
        if (!isNaN(tabId)) {
            const config = await getTabConfig(tabId);
            if (config.enabled && Date.now() >= config.nextRefreshTimestamp - 1000) {
                await executeReload(tabId, config);
            }
        }
    }
});

// 執行重新整理邏輯
async function executeReload(tabId: number, currentConfig?: TabRefreshConfig) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
            await stopRefresh(tabId);
            return;
        }

        const config = currentConfig || (await getTabConfig(tabId, tab.url));
        if (!config.enabled) return;

        const nextInt = computeNextInterval(config.interval, config.randomJitter);
        const updatedConfig: TabRefreshConfig = {
            ...config,
            actualInterval: nextInt,
            nextRefreshTimestamp: Date.now() + nextInt * 1000,
            refreshCount: config.refreshCount + 1,
            lastRefreshedAt: Date.now()
        };

        await saveTabConfig(updatedConfig);
        setupAlarm(tabId, nextInt + 2);

        chrome.tabs.reload(tabId, { bypassCache: config.hardReload }, () => {
            if (chrome.runtime.lastError) {
                console.warn("Reload tab error:", chrome.runtime.lastError.message);
            }
        });
    } catch (err) {
        console.warn("Execute reload error:", err);
    }
}

// 停止特定分頁的自動刷新
async function stopRefresh(tabId: number) {
    const config = await getTabConfig(tabId);
    config.enabled = false;
    await saveTabConfig(config);
    clearAlarm(tabId);

    try {
        chrome.action.setBadgeText({ text: "", tabId });
    } catch {
        // 忽略
    }

    try {
        chrome.tabs.sendMessage(tabId, { action: "STOP_REFRESH" }, () => {
            if (chrome.runtime.lastError) {
                // content script 可能未載入，忽略
            }
        });
    } catch {
        // 忽略
    }
}

// 監聽訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = message.tabId ?? sender.tab?.id;

    if (message.action === "GET_TAB_CONFIG") {
        if (!tabId) {
            sendResponse({ success: false, error: "No tabId" });
            return true;
        }
        getTabConfig(tabId, sender.tab?.url || "").then((config) => {
            sendResponse({ success: true, config });
        });
        return true;
    }

    if (message.action === "START_REFRESH") {
        if (!tabId) return false;
        getTabConfig(tabId, message.url || "").then(async (prev) => {
            const nextInt = computeNextInterval(message.config.interval ?? prev.interval, message.config.randomJitter ?? prev.randomJitter);
            const newConfig: TabRefreshConfig = {
                ...prev,
                ...message.config,
                tabId,
                enabled: true,
                actualInterval: nextInt,
                nextRefreshTimestamp: Date.now() + nextInt * 1000
            };
            await saveTabConfig(newConfig);
            setupAlarm(tabId, nextInt + 2);

            chrome.action.setBadgeText({ text: `${nextInt}s`, tabId });
            chrome.action.setBadgeBackgroundColor({ color: "#10B981", tabId });

            // 通知 content script 開始倒數計時
            chrome.tabs.sendMessage(tabId, { action: "START_REFRESH", config: newConfig }, () => {
                if (chrome.runtime.lastError) {
                    // 忽略 content script 未注入時的錯誤
                }
            });

            sendResponse({ success: true, config: newConfig });
        });
        return true;
    }

    if (message.action === "STOP_REFRESH") {
        if (!tabId) return false;
        stopRefresh(tabId).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.action === "TRIGGER_IMMEDIATE_REFRESH") {
        if (!tabId) return false;
        chrome.tabs.reload(tabId, { bypassCache: message.hardReload ?? false });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === "COUNTDOWN_TICK") {
        if (tabId && typeof message.remainingSeconds === "number") {
            const text = message.remainingSeconds > 0 ? `${message.remainingSeconds}s` : "...";
            try {
                chrome.action.setBadgeText({ text, tabId });
                chrome.action.setBadgeBackgroundColor({ color: "#10B981", tabId });
            } catch {
                // 忽略
            }
        }
        sendResponse({ success: true });
        return true;
    }

    if (message.action === "RELOAD_REQUESTED") {
        if (tabId) {
            executeReload(tabId).then(() => {
                sendResponse({ success: true });
            });
            return true;
        }
        return false;
    }

    if (message.action === "TOGGLE_FLOATING_BADGE") {
        if (tabId) {
            getTabConfig(tabId).then(async (config) => {
                config.showFloatingBadge = message.show;
                await saveTabConfig(config);
                chrome.tabs.sendMessage(tabId, { action: "TOGGLE_FLOATING_BADGE", show: message.show }, () => {
                    if (chrome.runtime.lastError) {
                        // 忽略
                    }
                });
                sendResponse({ success: true });
            });
            return true;
        }
        return false;
    }

    return false;
});
