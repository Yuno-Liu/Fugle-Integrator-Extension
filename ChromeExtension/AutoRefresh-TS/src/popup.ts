import { DEFAULT_CONFIG, formatSecondsToTime, formatTime, type TabRefreshConfig } from "./types";

document.addEventListener("DOMContentLoaded", async () => {
    // DOM 元素選取
    const statusBadge = document.getElementById("statusBadge") as HTMLElement;
    const statusText = document.getElementById("statusText") as HTMLElement;
    const tabTitle = document.getElementById("tabTitle") as HTMLElement;
    const tabUrl = document.getElementById("tabUrl") as HTMLElement;
    const timerCard = document.getElementById("timerCard") as HTMLElement;
    const timerDigits = document.getElementById("timerDigits") as HTMLElement;
    const statCount = document.getElementById("statCount") as HTMLElement;
    const statLastTime = document.getElementById("statLastTime") as HTMLElement;
    const progressBar = document.getElementById("progressBar") as HTMLElement;

    const intervalInput = document.getElementById("intervalInput") as HTMLInputElement;
    const stepMinus5 = document.getElementById("stepMinus5") as HTMLButtonElement;
    const stepMinus1 = document.getElementById("stepMinus1") as HTMLButtonElement;
    const stepPlus1 = document.getElementById("stepPlus1") as HTMLButtonElement;
    const stepPlus5 = document.getElementById("stepPlus5") as HTMLButtonElement;
    const presetChips = document.querySelectorAll(".preset-chip") as NodeListOf<HTMLButtonElement>;

    const toggleBtn = document.getElementById("toggleBtn") as HTMLButtonElement;
    const reloadNowBtn = document.getElementById("reloadNowBtn") as HTMLButtonElement;

    const toggleFloatingBadge = document.getElementById("toggleFloatingBadge") as HTMLInputElement;
    const toggleHardReload = document.getElementById("toggleHardReload") as HTMLInputElement;
    const jitterInput = document.getElementById("jitterInput") as HTMLInputElement;

    let currentTab: chrome.tabs.Tab | null = null;
    let currentConfig: TabRefreshConfig = { ...DEFAULT_CONFIG, tabId: 0, url: "" };
    let tickerIntervalId: number | null = null;

    // 取得當前分頁
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = activeTab || null;
    } catch (e) {
        console.error("無法取得當前分頁:", e);
    }

    if (!currentTab || !currentTab.id) {
        tabTitle.textContent = "無法偵測到當前分頁";
        disableAllControls("無法取得分頁資訊");
        return;
    }

    const tabId = currentTab.id;
    const url = currentTab.url || "";

    // 檢查是否為受保護或不支援的頁面 (例如 chrome://, edge://, file://, chrome-extension://)
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        tabTitle.textContent = currentTab.title || "系統頁面";
        tabUrl.textContent = url;
        disableAllControls("⚠️ 此系統保護頁面不支援自動刷新");
        return;
    }

    // 顯示分頁資訊
    tabTitle.textContent = currentTab.title || "未命名分頁";
    try {
        const parsedUrl = new URL(url);
        tabUrl.textContent = parsedUrl.hostname;
    } catch {
        tabUrl.textContent = url;
    }

    // 載入該分頁設定
    await loadTabState();

    // 綁定儲存變更事件監聽
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[`tab_${tabId}`]) {
            const updated = changes[`tab_${tabId}`].newValue as TabRefreshConfig | undefined;
            if (updated) {
                currentConfig = updated;
                updateUIState();
            }
        }
    });

    // 禁用所有操作並提示訊息
    function disableAllControls(reason: string) {
        statusBadge.className = "status-badge";
        statusText.textContent = "不支援";
        timerDigits.textContent = "--:--";
        statCount.textContent = reason;
        statLastTime.textContent = "";
        toggleBtn.disabled = true;
        toggleBtn.style.opacity = "0.5";
        toggleBtn.style.cursor = "not-allowed";
        reloadNowBtn.disabled = true;
        reloadNowBtn.style.opacity = "0.5";
        intervalInput.disabled = true;
    }

    // 載入當前狀態
    async function loadTabState() {
        const key = `tab_${tabId}`;
        const data = await chrome.storage.local.get(key);
        if (data[key]) {
            currentConfig = data[key] as TabRefreshConfig;
        } else {
            currentConfig = {
                ...DEFAULT_CONFIG,
                tabId,
                url
            };
        }

        // 同步輸入框數值
        intervalInput.value = String(currentConfig.interval);
        toggleFloatingBadge.checked = currentConfig.showFloatingBadge;
        toggleHardReload.checked = currentConfig.hardReload;
        jitterInput.value = String(currentConfig.randomJitter);

        highlightPreset(currentConfig.interval);
        updateUIState();
    }

    // 更新 UI 狀態與文字
    function updateUIState() {
        statCount.textContent = `累計次數: ${currentConfig.refreshCount}`;
        statLastTime.textContent = `上次刷新: ${formatTime(currentConfig.lastRefreshedAt)}`;

        if (currentConfig.enabled) {
            statusBadge.className = "status-badge active";
            statusText.textContent = "運作中";
            timerCard.className = "timer-card active";

            toggleBtn.className = "btn btn-stop";
            toggleBtn.innerHTML = `<span>⏹ 停止自動刷新</span>`;

            startTicker();
        } else {
            statusBadge.className = "status-badge";
            statusText.textContent = "已暫停";
            timerCard.className = "timer-card";

            toggleBtn.className = "btn btn-start";
            toggleBtn.innerHTML = `<span>▶ 開始自動刷新</span>`;

            stopTicker();
            timerDigits.textContent = formatSecondsToTime(currentConfig.interval);
            progressBar.style.width = "100%";
        }
    }

    // 啟動彈跳視窗內的每 100ms 平滑倒數更新
    function startTicker() {
        stopTicker();
        tick();
        tickerIntervalId = window.setInterval(tick, 100);
    }

    function stopTicker() {
        if (tickerIntervalId !== null) {
            clearInterval(tickerIntervalId);
            tickerIntervalId = null;
        }
    }

    function tick() {
        if (!currentConfig.enabled) return;
        const now = Date.now();
        const diffMs = currentConfig.nextRefreshTimestamp - now;
        const remainingSec = Math.max(0, Math.ceil(diffMs / 1000));
        timerDigits.textContent = formatSecondsToTime(remainingSec);

        const totalSec = currentConfig.actualInterval || currentConfig.interval;
        const percent = Math.min(100, Math.max(0, (diffMs / (totalSec * 1000)) * 100));
        progressBar.style.width = `${percent}%`;
    }

    // 高亮預設秒數膠囊
    function highlightPreset(sec: number) {
        presetChips.forEach((chip) => {
            const chipSec = parseInt(chip.getAttribute("data-sec") || "0", 10);
            if (chipSec === sec) {
                chip.classList.add("selected");
            } else {
                chip.classList.remove("selected");
            }
        });
    }

    // 處理秒數變更
    function handleIntervalChange(newSec: number) {
        const clampedSec = Math.max(1, Math.min(86400, newSec));
        intervalInput.value = String(clampedSec);
        currentConfig.interval = clampedSec;
        highlightPreset(clampedSec);

        if (!currentConfig.enabled) {
            timerDigits.textContent = formatSecondsToTime(clampedSec);
        } else {
            // 若正在運作中，即時更新時間
            startRefreshAction();
        }
    }

    // 綁定步進按鈕
    stepMinus5.addEventListener("click", () => {
        handleIntervalChange(parseInt(intervalInput.value, 10) - 5);
    });
    stepMinus1.addEventListener("click", () => {
        handleIntervalChange(parseInt(intervalInput.value, 10) - 1);
    });
    stepPlus1.addEventListener("click", () => {
        handleIntervalChange(parseInt(intervalInput.value, 10) + 1);
    });
    stepPlus5.addEventListener("click", () => {
        handleIntervalChange(parseInt(intervalInput.value, 10) + 5);
    });

    // 綁定輸入框直接輸入
    intervalInput.addEventListener("change", () => {
        const val = parseInt(intervalInput.value, 10);
        handleIntervalChange(isNaN(val) ? 10 : val);
    });

    // 綁定預設膠囊點擊
    presetChips.forEach((chip) => {
        chip.addEventListener("click", () => {
            const sec = parseInt(chip.getAttribute("data-sec") || "10", 10);
            handleIntervalChange(sec);
        });
    });

    // 啟動刷新邏輯
    function startRefreshAction() {
        const interval = Math.max(1, parseInt(intervalInput.value, 10) || 10);
        const hardReload = toggleHardReload.checked;
        const showFloatingBadge = toggleFloatingBadge.checked;
        const randomJitter = Math.max(0, parseInt(jitterInput.value, 10) || 0);

        chrome.runtime.sendMessage(
            {
                action: "START_REFRESH",
                tabId,
                url,
                config: {
                    interval,
                    hardReload,
                    showFloatingBadge,
                    randomJitter
                }
            },
            (response) => {
                if (response && response.success) {
                    currentConfig = response.config;
                    updateUIState();
                }
            }
        );
    }

    // 停止刷新邏輯
    function stopRefreshAction() {
        chrome.runtime.sendMessage(
            {
                action: "STOP_REFRESH",
                tabId
            },
            (response) => {
                if (response && response.success) {
                    currentConfig.enabled = false;
                    updateUIState();
                }
            }
        );
    }

    // 開始 / 停止 按鈕切換
    toggleBtn.addEventListener("click", () => {
        if (currentConfig.enabled) {
            stopRefreshAction();
        } else {
            startRefreshAction();
        }
    });

    // 立即刷新按鈕
    reloadNowBtn.addEventListener("click", () => {
        const hardReload = toggleHardReload.checked;
        chrome.runtime.sendMessage({
            action: "TRIGGER_IMMEDIATE_REFRESH",
            tabId,
            hardReload
        });
    });

    // 進階選項變更
    toggleFloatingBadge.addEventListener("change", () => {
        const show = toggleFloatingBadge.checked;
        currentConfig.showFloatingBadge = show;
        chrome.runtime.sendMessage({
            action: "TOGGLE_FLOATING_BADGE",
            tabId,
            show
        });
    });

    toggleHardReload.addEventListener("change", () => {
        currentConfig.hardReload = toggleHardReload.checked;
        if (currentConfig.enabled) {
            startRefreshAction();
        }
    });

    jitterInput.addEventListener("change", () => {
        const val = Math.max(0, parseInt(jitterInput.value, 10) || 0);
        jitterInput.value = String(val);
        currentConfig.randomJitter = val;
        if (currentConfig.enabled) {
            startRefreshAction();
        }
    });
});
