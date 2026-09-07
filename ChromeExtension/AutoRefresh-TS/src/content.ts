import { formatSecondsToTime, type TabRefreshConfig } from "./types";

let currentConfig: TabRefreshConfig | null = null;
let timerIntervalId: number | null = null;
let badgeContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;

// 初始化 Content Script
function init() {
    chrome.runtime.sendMessage({ action: "GET_TAB_CONFIG" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.success && response.config) {
            const config = response.config as TabRefreshConfig;
            currentConfig = config;
            if (config.enabled) {
                startLocalTimer(config);
            }
        }
    });
}

// 啟動本地倒數計時器
function startLocalTimer(config: TabRefreshConfig) {
    stopLocalTimer();
    currentConfig = config;

    if (config.showFloatingBadge) {
        renderFloatingBadge();
    }

    updateTick();
    timerIntervalId = window.setInterval(updateTick, 1000);
}

// 停止本地倒數計時器
function stopLocalTimer() {
    if (timerIntervalId !== null) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
    }
    removeFloatingBadge();
}

// 每秒計時運算
function updateTick() {
    if (!currentConfig || !currentConfig.enabled) {
        stopLocalTimer();
        return;
    }

    const now = Date.now();
    const remainingMs = currentConfig.nextRefreshTimestamp - now;
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));

    // 更新網頁上的懸浮小工具
    if (currentConfig.showFloatingBadge) {
        updateFloatingBadge(remainingSec, currentConfig.actualInterval, currentConfig.refreshCount);
    }

    // 更新瀏覽器擴充功能圖示 Badge
    chrome.runtime.sendMessage({
        action: "COUNTDOWN_TICK",
        tabId: currentConfig.tabId,
        remainingSeconds: remainingSec
    }, () => {
        if (chrome.runtime.lastError) {
            // 忽略
        }
    });

    // 倒數結束，要求重新整理
    if (remainingSec <= 0) {
        stopLocalTimer();
        chrome.runtime.sendMessage({
            action: "RELOAD_REQUESTED",
            tabId: currentConfig.tabId,
            hardReload: currentConfig.hardReload
        }, () => {
            if (chrome.runtime.lastError) {
                // 如果背景連線失敗，直接本機重整備援
                window.location.reload();
            }
        });
    }
}

// 建立懸浮小工具（使用 Shadow DOM 隔離樣式）
function renderFloatingBadge() {
    if (badgeContainer) return;

    badgeContainer = document.createElement("div");
    badgeContainer.id = "autorefresh-floating-host";
    badgeContainer.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        right: 20px;
        top: 20px;
        user-select: none;
    `;

    // 讀取上次拖曳位置
    try {
        const savedPos = sessionStorage.getItem("autorefresh_badge_pos");
        if (savedPos) {
            const { top, left } = JSON.parse(savedPos);
            if (top && left) {
                badgeContainer.style.top = top;
                badgeContainer.style.left = left;
                badgeContainer.style.right = "auto";
            }
        }
    } catch {
        // 忽略
    }

    shadowRoot = badgeContainer.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
        .badge-box {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(15, 23, 42, 0.88);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #f8fafc;
            padding: 6px 12px;
            border-radius: 9999px;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            font-weight: 500;
            cursor: move;
            transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .badge-box:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
        }
        .spinner {
            width: 14px;
            height: 14px;
            border: 2px solid rgba(16, 185, 129, 0.3);
            border-top-color: #10b981;
            border-radius: 50%;
            animation: spin 1.2s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .time-text {
            color: #34d399;
            font-variant-numeric: tabular-nums;
            font-weight: 700;
        }
        .count-pill {
            background: rgba(255, 255, 255, 0.12);
            color: #94a3b8;
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 6px;
        }
        .btn-stop {
            background: transparent;
            border: none;
            color: #ef4444;
            cursor: pointer;
            padding: 2px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            opacity: 0.8;
            transition: opacity 0.2s, background 0.2s;
        }
        .btn-stop:hover {
            opacity: 1;
            background: rgba(239, 68, 68, 0.2);
        }
    `;

    const widget = document.createElement("div");
    widget.className = "badge-box";
    widget.innerHTML = `
        <div class="spinner"></div>
        <span>刷新倒數</span>
        <span class="time-text" id="time-val">--</span>
        <span class="count-pill" id="count-val">#0</span>
        <button class="btn-stop" id="stop-btn" title="停止自動刷新">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2"></rect>
            </svg>
        </button>
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(widget);
    document.body.appendChild(badgeContainer);

    // 拖曳事件綁定
    setupDragging(widget, badgeContainer);

    // 停止按鈕點擊事件
    const stopBtn = shadowRoot.getElementById("stop-btn");
    stopBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentConfig) {
            chrome.runtime.sendMessage({
                action: "STOP_REFRESH",
                tabId: currentConfig.tabId
            });
            stopLocalTimer();
        }
    });
}

// 支援拖曳小工具
function setupDragging(dragHandle: HTMLElement, container: HTMLElement) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    dragHandle.addEventListener("mousedown", (e) => {
        if ((e.target as HTMLElement).closest(".btn-stop")) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = container.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newLeft = Math.max(10, Math.min(window.innerWidth - 180, origLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - 50, origTop + dy));

        container.style.left = `${newLeft}px`;
        container.style.top = `${newTop}px`;
        container.style.right = "auto";
    });

    window.addEventListener("mouseup", () => {
        if (isDragging) {
            isDragging = false;
            try {
                sessionStorage.setItem(
                    "autorefresh_badge_pos",
                    JSON.stringify({ top: container.style.top, left: container.style.left })
                );
            } catch {
                // 忽略
            }
        }
    });
}

// 更新懸浮小工具內容
function updateFloatingBadge(remainingSec: number, _totalSec: number, count: number) {
    if (!shadowRoot) return;
    const timeEl = shadowRoot.getElementById("time-val");
    const countEl = shadowRoot.getElementById("count-val");
    if (timeEl) timeEl.textContent = formatSecondsToTime(remainingSec);
    if (countEl) countEl.textContent = `#${count}`;
}

// 移除懸浮小工具
function removeFloatingBadge() {
    if (badgeContainer) {
        badgeContainer.remove();
        badgeContainer = null;
        shadowRoot = null;
    }
}

// 監聽訊息
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "START_REFRESH") {
        startLocalTimer(message.config);
    } else if (message.action === "STOP_REFRESH") {
        stopLocalTimer();
    } else if (message.action === "TOGGLE_FLOATING_BADGE") {
        if (message.show) {
            renderFloatingBadge();
        } else {
            removeFloatingBadge();
        }
    }
});

init();
