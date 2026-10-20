/**
 * ============================================================================
 * 🌐 Antigravity Translator - 彈窗控制面板 (Popup Controller)
 * ============================================================================
 *
 * 提供快速切換翻譯目標語言、顯示模式、領域風格與 Antigravity CLI 模型推理深度，
 * 支援一鍵全頁翻譯/原文還原、網域自動規則開關，以及即時連線健康狀態檢測。
 */

import type {
    BridgeHealthResponse,
    CacheStats,
    DisplayMode,
    EffortLevel,
    PageTranslationState,
    RuntimeMessage,
    TranslationStyle,
    TranslatorConfig
} from "./types/index.js";
import {
    AVAILABLE_MODELS,
    DEFAULT_CONFIG,
    getConfig,
    saveConfig,
    STORAGE_KEYS,
    SUPPORTED_LANGUAGES
} from "./config/constants.js";

// DOM 元素參考
const elements = {
    // Header
    bridgeBadge: document.getElementById("bridge-badge") as HTMLDivElement,
    bridgeBadgeText: document.getElementById("bridge-badge-text") as HTMLSpanElement,
    btnOptions: document.getElementById("btn-options") as HTMLButtonElement,

    // CLI Alert
    cliAlertBox: document.getElementById("cli-alert-box") as HTMLDivElement,
    cliCmdText: document.getElementById("cli-cmd-text") as HTMLSpanElement,
    btnCopyCmd: document.getElementById("btn-copy-cmd") as HTMLButtonElement,

    // Hero Action
    btnTranslateToggle: document.getElementById("btn-translate-toggle") as HTMLButtonElement,
    btnTranslateText: document.getElementById("btn-translate-text") as HTMLSpanElement,
    btnTranslateIcon: document.getElementById("btn-translate-icon") as HTMLSpanElement,
    btnSpinner: document.getElementById("btn-spinner") as HTMLSpanElement,
    progressFill: document.getElementById("progress-fill") as HTMLDivElement,
    statNodes: document.getElementById("stat-nodes") as HTMLElement,
    statCached: document.getElementById("stat-cached") as HTMLElement,
    statStatus: document.getElementById("stat-status") as HTMLElement,

    // Quick Settings
    selectTargetLang: document.getElementById("select-target-lang") as HTMLSelectElement,
    modeSegmented: document.getElementById("mode-segmented") as HTMLDivElement,
    modeLabelText: document.getElementById("mode-label-text") as HTMLSpanElement,
    selectStyle: document.getElementById("select-style") as HTMLSelectElement,
    selectModel: document.getElementById("select-model") as HTMLSelectElement,
    selectEffort: document.getElementById("select-effort") as HTMLSelectElement,

    // Domain & Speed Toggles
    toggleSingleBatch: document.getElementById("toggle-single-batch") as HTMLInputElement,
    autoDomainDesc: document.getElementById("auto-domain-desc") as HTMLSpanElement,
    toggleAutoDomain: document.getElementById("toggle-auto-domain") as HTMLInputElement,
    toggleExcludeDomain: document.getElementById("toggle-exclude-domain") as HTMLInputElement,

    // Footer
    cacheStatsText: document.getElementById("cache-stats-text") as HTMLSpanElement,
    btnClearCache: document.getElementById("btn-clear-cache") as HTMLButtonElement,
    toast: document.getElementById("toast") as HTMLDivElement
};

// 狀態變數
let currentConfig: TranslatorConfig = { ...DEFAULT_CONFIG };
let currentTab: chrome.tabs.Tab | null = null;
let currentHostname = "";
let isCurrentPageTranslatable = true;
let isTranslating = false;
let isTranslated = false;
let refreshInterval: number | null = null;

/**
 * 顯示快顯提示 (Toast)
 */
function showToast(message: string, durationMs = 2000): void {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    setTimeout(() => {
        elements.toast.classList.remove("show");
    }, durationMs);
}

/**
 * 取得當前作用中分頁 (Active Tab)
 */
async function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0] || null;
    } catch (err) {
        console.warn("[Antigravity Translator] 無法取得 Active Tab:", err);
        return null;
    }
}

/**
 * 解析網域名稱 (Hostname)
 */
function extractHostname(url?: string): string {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return parsed.hostname;
        }
    } catch {
        // 非標準 URL
    }
    return "";
}

/**
 * 檢查本地 CLI Bridge 伺服器健康狀態
 */
async function checkBridgeHealth(): Promise<BridgeHealthResponse> {
    elements.bridgeBadge.className = "bridge-badge bridge-checking";
    elements.bridgeBadgeText.textContent = "檢測中...";

    // 1. 優先嘗試透過 Background 檢查
    try {
        const res = await chrome.runtime.sendMessage<RuntimeMessage, BridgeHealthResponse>({
            action: "CHECK_BRIDGE_HEALTH"
        });
        if (res && typeof res.ok === "boolean") {
            updateBridgeStatusUI(res);
            return res;
        }
    } catch {
        // Background 尚未就緒或逾時，退回前端直接 Fetch
    }

    // 2. 直接向 Bridge URL 發送請求
    try {
        const bridgeUrl = (currentConfig.bridgeUrl || "http://127.0.0.1:18765").replace(/\/+$/, "");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const resp = await fetch(`${bridgeUrl}/health`, { signal: controller.signal });
        clearTimeout(timeout);

        if (resp.ok) {
            const data = (await resp.json()) as BridgeHealthResponse;
            const health: BridgeHealthResponse = {
                ok: true,
                status: data.status || "ready",
                cliPath: data.cliPath || currentConfig.cliPath,
                defaultModel: data.defaultModel || currentConfig.model,
                defaultEffort: data.defaultEffort || currentConfig.effort,
                version: data.version
            };
            updateBridgeStatusUI(health);
            return health;
        }
    } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const failed: BridgeHealthResponse = {
            ok: false,
            status: "offline",
            cliPath: "",
            defaultModel: "",
            defaultEffort: "low",
            error: errMsg
        };
        updateBridgeStatusUI(failed);
        return failed;
    }

    const fallback: BridgeHealthResponse = {
        ok: false,
        status: "offline",
        cliPath: "",
        defaultModel: "",
        defaultEffort: "low"
    };
    updateBridgeStatusUI(fallback);
    return fallback;
}

/**
 * 更新 Bridge 狀態標籤 UI
 */
function updateBridgeStatusUI(health: BridgeHealthResponse): void {
    if (health.ok) {
        elements.bridgeBadge.className = "bridge-badge bridge-online";
        elements.bridgeBadgeText.textContent = "CLI 已連線";
        elements.bridgeBadge.title = `Antigravity CLI 已就緒 (${health.defaultModel || currentConfig.model} / ${health.defaultEffort || currentConfig.effort})\n點擊重新整理`;
        elements.cliAlertBox.classList.remove("visible");
    } else {
        elements.bridgeBadge.className = "bridge-badge bridge-offline";
        elements.bridgeBadgeText.textContent = "Bridge 未啟動";
        elements.bridgeBadge.title = "點擊查看啟動提示與重新連線";
    }
}

/**
 * 查詢分頁翻譯狀態
 */
async function queryPageState(): Promise<PageTranslationState | null> {
    if (!currentTab || !currentTab.id || !isCurrentPageTranslatable) {
        return null;
    }

    try {
        const state = await chrome.tabs.sendMessage<RuntimeMessage, PageTranslationState>(
            currentTab.id,
            { action: "GET_PAGE_STATE" }
        );
        if (state) {
            renderPageState(state);
            return state;
        }
    } catch {
        // Content script 可能尚未注入或使用者剛整理頁面
    }
    return null;
}

/**
 * 渲染分頁翻譯進度與按鈕狀態
 */
function renderPageState(state: PageTranslationState): void {
    isTranslated = state.isTranslated;
    isTranslating = state.isTranslating;

    if (isTranslating) {
        elements.btnTranslateToggle.disabled = true;
        elements.btnTranslateToggle.className = "btn-main btn-translate";
        elements.btnSpinner.classList.remove("hidden");
        elements.btnTranslateIcon.classList.add("hidden");
        elements.btnTranslateText.textContent = "網頁翻譯處理中...";
        elements.statStatus.textContent = "翻譯中";
        elements.statStatus.style.color = "#38bdf8";
    } else if (isTranslated) {
        elements.btnTranslateToggle.disabled = false;
        elements.btnTranslateToggle.className = "btn-main btn-restore";
        elements.btnSpinner.classList.add("hidden");
        elements.btnTranslateIcon.classList.remove("hidden");
        elements.btnTranslateIcon.textContent = "↩️";
        elements.btnTranslateText.textContent = "還原網頁原文";
        elements.statStatus.textContent = "已翻譯";
        elements.statStatus.style.color = "#34d399";
    } else {
        elements.btnTranslateToggle.disabled = false;
        elements.btnTranslateToggle.className = "btn-main btn-translate";
        elements.btnSpinner.classList.add("hidden");
        elements.btnTranslateIcon.classList.remove("hidden");
        elements.btnTranslateIcon.textContent = "🌐";
        elements.btnTranslateText.textContent = "立即翻譯當前網頁";
        elements.statStatus.textContent = "就緒";
        elements.statStatus.style.color = "#38bdf8";
    }

    // 進度條計算
    const total = state.totalNodes || 0;
    const translated = state.translatedNodes || 0;
    const cached = state.cachedNodes || 0;
    const percent = total > 0 ? Math.min(100, Math.round((translated / total) * 100)) : (isTranslated ? 100 : 0);

    elements.progressFill.style.width = `${percent}%`;
    elements.statNodes.textContent = `${translated} / ${total}`;
    elements.statCached.textContent = `${cached} 筆`;
}

/**
 * 查詢快取筆數統計
 */
async function queryCacheStats(): Promise<void> {
    try {
        const stats = await chrome.runtime.sendMessage<RuntimeMessage, CacheStats>({
            action: "GET_CACHE_STATS"
        });
        if (stats && typeof stats.count === "number") {
            elements.cacheStatsText.textContent = `快取: ${stats.count} 筆`;
            return;
        }
    } catch {
        // 退回直接讀取 storage
    }

    try {
        const res = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
        const cacheMap = res[STORAGE_KEYS.CACHE] as Record<string, unknown> | undefined;
        const count = cacheMap ? Object.keys(cacheMap).length : 0;
        elements.cacheStatsText.textContent = `快取: ${count} 筆`;
    } catch {
        elements.cacheStatsText.textContent = "快取: 0 筆";
    }
}

/**
 * 同步設定值到 UI 表單
 */
function syncConfigToUI(config: TranslatorConfig): void {
    // 目標語言
    elements.selectTargetLang.value = config.targetLang;

    // 顯示模式膠囊切換
    updateModePillUI(config.displayMode);

    // 翻譯風格
    elements.selectStyle.value = config.translationStyle;

    // 模型與推理深度
    elements.selectModel.value = config.model;
    elements.selectEffort.value = config.effort;

    // 單次最大 Token 直出模式開關
    if (elements.toggleSingleBatch) {
        elements.toggleSingleBatch.checked = config.singleBatchMode !== false;
    }

    // 網域開關
    if (currentHostname) {
        const isAuto = config.autoTranslateDomains.includes(currentHostname);
        const isExcluded = config.excludedDomains.includes(currentHostname);
        elements.toggleAutoDomain.checked = isAuto;
        elements.toggleExcludeDomain.checked = isExcluded;
    }
}

/**
 * 更新顯示模式三段式膠囊 UI
 */
function updateModePillUI(mode: DisplayMode): void {
    const buttons = elements.modeSegmented.querySelectorAll<HTMLButtonElement>(".segmented-btn");
    buttons.forEach((btn) => {
        if (btn.dataset.mode === mode) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    const modeLabels: Record<DisplayMode, string> = {
        bilingual: "雙語對照",
        replace: "直接替換",
        hover: "懸停對照"
    };
    elements.modeLabelText.textContent = modeLabels[mode] || mode;
}

/**
 * 向當前分頁發送訊息通知
 */
async function notifyActiveTab<T = unknown>(action: RuntimeMessage["action"], payload?: T): Promise<void> {
    if (!currentTab || !currentTab.id || !isCurrentPageTranslatable) return;
    try {
        await chrome.tabs.sendMessage<RuntimeMessage<T>>(currentTab.id, {
            action,
            payload
        });
    } catch {
        // Tab not responding or disconnected
    }
}

/**
 * 綁定所有使用者操作事件
 */
function setupEventListeners(): void {
    // ⚙️ 完整設定按鈕
    elements.btnOptions.addEventListener("click", () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL("options.html"));
        }
    });

    // 💡 CLI 連線狀態點擊 -> 重新檢測並切換啟動提示框
    elements.bridgeBadge.addEventListener("click", async () => {
        const health = await checkBridgeHealth();
        if (!health.ok) {
            elements.cliAlertBox.classList.toggle("visible");
        } else {
            elements.cliAlertBox.classList.remove("visible");
            showToast("Antigravity CLI 連線正常！");
        }
    });

    // 複製 CLI 啟動指令
    elements.btnCopyCmd.addEventListener("click", async () => {
        const cmd = elements.cliCmdText.textContent || "npm run bridge";
        try {
            await navigator.clipboard.writeText(cmd);
            elements.btnCopyCmd.textContent = "已複製！";
            setTimeout(() => {
                elements.btnCopyCmd.textContent = "複製指令";
            }, 2000);
            showToast("已複製啟動指令至剪貼簿");
        } catch {
            showToast("複製失敗，請手動複製");
        }
    });

    // 🌐 大型核心操作按鈕：立即翻譯 / 原文還原
    elements.btnTranslateToggle.addEventListener("click", async () => {
        if (!isCurrentPageTranslatable) {
            showToast("⚠️ 本頁面為瀏覽器內部頁面，無法執行翻譯");
            return;
        }

        if (isTranslating) return;

        if (isTranslated) {
            // 還原原文
            await notifyActiveTab("RESTORE_PAGE");
            isTranslated = false;
            renderPageState({
                isTranslated: false,
                isTranslating: false,
                totalNodes: 0,
                translatedNodes: 0,
                cachedNodes: 0,
                failedNodes: 0,
                displayMode: currentConfig.displayMode,
                model: currentConfig.model,
                effort: currentConfig.effort
            });
            showToast("已還原網頁原文");
        } else {
            // 觸發全頁翻譯
            elements.btnTranslateToggle.disabled = true;
            elements.btnSpinner.classList.remove("hidden");
            elements.btnTranslateIcon.classList.add("hidden");
            elements.btnTranslateText.textContent = "正在發起翻譯...";
            elements.statStatus.textContent = "啟動中";

            await notifyActiveTab("TOGGLE_PAGE_TRANSLATION");

            // 開始定時輪詢分頁進度
            setTimeout(queryPageState, 300);
        }
    });

    // 目標語言下拉變更
    elements.selectTargetLang.addEventListener("change", async () => {
        const targetLang = elements.selectTargetLang.value;
        currentConfig = await saveConfig({ targetLang });
        await notifyActiveTab("CONFIG_UPDATED", currentConfig);
        showToast(`目標語言已切換為：${elements.selectTargetLang.selectedOptions[0]?.text || targetLang}`);
    });

    // 顯示模式三段式按鈕變更
    elements.modeSegmented.addEventListener("click", async (e) => {
        const target = (e.target as HTMLElement).closest(".segmented-btn") as HTMLButtonElement | null;
        if (!target || !target.dataset.mode) return;

        const newMode = target.dataset.mode as DisplayMode;
        if (newMode === currentConfig.displayMode) return;

        updateModePillUI(newMode);
        currentConfig = await saveConfig({ displayMode: newMode });
        await notifyActiveTab("SWITCH_DISPLAY_MODE", { mode: newMode });
        await notifyActiveTab("CONFIG_UPDATED", currentConfig);
        showToast(`呈現模式已切換為：${elements.modeLabelText.textContent}`);
    });

    // 翻譯風格變更
    elements.selectStyle.addEventListener("change", async () => {
        const style = elements.selectStyle.value as TranslationStyle;
        currentConfig = await saveConfig({ translationStyle: style });
        await notifyActiveTab("CONFIG_UPDATED", currentConfig);
        showToast(`領域風格已套用：${elements.selectStyle.selectedOptions[0]?.text || style}`);
    });

    // 模型切換
    elements.selectModel.addEventListener("change", async () => {
        const model = elements.selectModel.value;
        currentConfig = await saveConfig({ model });
        await notifyActiveTab("CONFIG_UPDATED", currentConfig);
        showToast(`CLI 模型已設定：${model}`);
    });

    // 推理深度切換
    elements.selectEffort.addEventListener("change", async () => {
        const effort = elements.selectEffort.value as EffortLevel;
        currentConfig = await saveConfig({ effort });
        await notifyActiveTab("CONFIG_UPDATED", currentConfig);
        showToast(`推理深度 (Effort) 已設為：${effort}`);
    });

    // 單次最大 Token 直出模式切換
    if (elements.toggleSingleBatch) {
        elements.toggleSingleBatch.addEventListener("change", async () => {
            const singleBatchMode = elements.toggleSingleBatch.checked;
            currentConfig = await saveConfig({ singleBatchMode });
            await notifyActiveTab("CONFIG_UPDATED", currentConfig);
            showToast(singleBatchMode ? "⚡ 已啟用單次最大 Token 直出模式" : "已切換為標準分批模式");
        });
    }

    // 網域自動翻譯 Toggle
    elements.toggleAutoDomain.addEventListener("change", async () => {
        if (!currentHostname) return;
        const autoSet = new Set(currentConfig.autoTranslateDomains);
        const excludeSet = new Set(currentConfig.excludedDomains);

        if (elements.toggleAutoDomain.checked) {
            autoSet.add(currentHostname);
            excludeSet.delete(currentHostname);
            elements.toggleExcludeDomain.checked = false;
        } else {
            autoSet.delete(currentHostname);
        }

        currentConfig = await saveConfig({
            autoTranslateDomains: Array.from(autoSet),
            excludedDomains: Array.from(excludeSet)
        });
        showToast(elements.toggleAutoDomain.checked ? `已將 ${currentHostname} 加入自動翻譯` : `已取消自動翻譯`);
    });

    // 網域排除 Toggle
    elements.toggleExcludeDomain.addEventListener("change", async () => {
        if (!currentHostname) return;
        const autoSet = new Set(currentConfig.autoTranslateDomains);
        const excludeSet = new Set(currentConfig.excludedDomains);

        if (elements.toggleExcludeDomain.checked) {
            excludeSet.add(currentHostname);
            autoSet.delete(currentHostname);
            elements.toggleAutoDomain.checked = false;
        } else {
            excludeSet.delete(currentHostname);
        }

        currentConfig = await saveConfig({
            autoTranslateDomains: Array.from(autoSet),
            excludedDomains: Array.from(excludeSet)
        });
        showToast(elements.toggleExcludeDomain.checked ? `已將 ${currentHostname} 加入排除名單` : `已取消排除`);
    });

    // 🗑️ 清除快取小按鈕
    elements.btnClearCache.addEventListener("click", async () => {
        try {
            await chrome.runtime.sendMessage<RuntimeMessage>({ action: "CLEAR_CACHE" });
        } catch {
            await chrome.storage.local.remove(STORAGE_KEYS.CACHE);
        }
        elements.cacheStatsText.textContent = "快取: 0 筆";
        showToast("已清除本地翻譯快取");
    });
}

/**
 * 監聽來自 Content Script 的即時進度廣播
 */
function setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
        if (!message || !message.action) return;

        if (message.action === "GET_PAGE_STATE" && message.payload) {
            renderPageState(message.payload as PageTranslationState);
        }
    });
}

/**
 * 初始化入口
 */
async function initPopup(): Promise<void> {
    try {
        // 1. 讀取全域設定
        currentConfig = await getConfig();

        // 2. 取得目前作用中分頁與網域名稱
        currentTab = await queryActiveTab();
        if (currentTab && currentTab.url) {
            currentHostname = extractHostname(currentTab.url);
            if (!currentHostname || currentTab.url.startsWith("chrome://") || currentTab.url.startsWith("chrome-extension://")) {
                isCurrentPageTranslatable = false;
                elements.autoDomainDesc.textContent = "內部頁面不支援設定";
                elements.toggleAutoDomain.disabled = true;
                elements.toggleExcludeDomain.disabled = true;
                elements.btnTranslateToggle.disabled = true;
                elements.btnTranslateText.textContent = "⚠️ 當前頁面不支援翻譯";
            } else {
                elements.autoDomainDesc.textContent = `網站：${currentHostname}`;
            }
        }

        // 3. 同步設定值到 UI
        syncConfigToUI(currentConfig);

        // 4. 綁定操作事件與通訊監聽
        setupEventListeners();
        setupMessageListener();

        // 5. 異步檢測 Bridge 健康狀態
        checkBridgeHealth().catch(() => {});

        // 6. 查詢快取筆數與分頁目前狀態
        queryCacheStats().catch(() => {});
        queryPageState().catch(() => {});

        // 7. 每秒小幅輪詢分頁狀態（若彈窗維持開啟）
        refreshInterval = window.setInterval(() => {
            queryPageState().catch(() => {});
        }, 1200);

        window.addEventListener("unload", () => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        });
    } catch (err) {
        console.error("[Antigravity Translator] Popup 初始化異常:", err);
    }
}

// 啟動 Popup 控制器
document.addEventListener("DOMContentLoaded", initPopup);
