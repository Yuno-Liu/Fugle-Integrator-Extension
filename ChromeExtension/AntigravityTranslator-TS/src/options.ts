/**
 * ============================================================================
 * ⚙️ Antigravity Translator - 自訂設定中心控制器 (Options Controller)
 * ============================================================================
 *
 * 全面管理擴充套件之 Antigravity CLI 橋接服務、模型推理深度、雙語排版即時預覽、
 * 專屬術語表 (Glossary)、鍵盤快捷鍵錄製、網域過濾與設定匯入/匯出。
 */

import type {
    BridgeHealthResponse,
    CacheStats,
    DisplayMode,
    EffortLevel,
    GlossaryEntry,
    HighlightStyle,
    HoverTriggerKey,
    RuntimeMessage,
    TranslationStyle,
    TranslatorConfig
} from "./types/index.js";
import {
    AVAILABLE_MODELS,
    DEFAULT_CONFIG,
    DEFAULT_GLOSSARY,
    getConfig,
    saveConfig,
    STORAGE_KEYS,
    STYLE_PRESETS,
    SUPPORTED_LANGUAGES
} from "./config/constants.js";

// 內建常用範本庫
const FINANCIAL_GLOSSARY_TEMPLATE: GlossaryEntry[] = [
    { id: "fin-1", source: "EPS", target: "每股盈餘 (EPS)", enabled: true, caseSensitive: true },
    { id: "fin-2", source: "YoY", target: "年增率 (YoY)", enabled: true, caseSensitive: false },
    { id: "fin-3", source: "MoM", target: "月增率 (MoM)", enabled: true, caseSensitive: false },
    { id: "fin-4", source: "Revenue", target: "營業收入 (營收)", enabled: true, caseSensitive: false },
    { id: "fin-5", source: "Bull Market", target: "牛市 (多頭市場)", enabled: true, caseSensitive: false },
    { id: "fin-6", source: "Bear Market", target: "熊市 (空頭市場)", enabled: true, caseSensitive: false },
    { id: "fin-7", source: "Market Cap", target: "市場總市值", enabled: true, caseSensitive: false },
    { id: "fin-8", source: "Dividend Yield", target: "現金殖利率", enabled: true, caseSensitive: false },
    { id: "fin-9", source: "ROE", target: "股東權益報酬率 (ROE)", enabled: true, caseSensitive: true },
    { id: "fin-10", source: "ROA", target: "資產報酬率 (ROA)", enabled: true, caseSensitive: true },
    { id: "fin-11", source: "P/E Ratio", target: "本益比 (P/E)", enabled: true, caseSensitive: false },
    { id: "fin-12", source: "P/B Ratio", target: "股價淨值比 (P/B)", enabled: true, caseSensitive: false },
    { id: "fin-13", source: "Operating Margin", target: "營業利益率", enabled: true, caseSensitive: false },
    { id: "fin-14", source: "ETF", target: "指數股票型基金 (ETF)", enabled: true, caseSensitive: true }
];

const TECH_GLOSSARY_TEMPLATE: GlossaryEntry[] = [
    { id: "tech-1", source: "LLM", target: "大型語言模型 (LLM)", enabled: true, caseSensitive: true },
    { id: "tech-2", source: "Prompt", target: "提示詞 (Prompt)", enabled: true, caseSensitive: false },
    { id: "tech-3", source: "Token", target: "標記 / 符元 (Token)", enabled: true, caseSensitive: false },
    { id: "tech-4", source: "Agent", target: "智慧代理 (Agent)", enabled: true, caseSensitive: false },
    { id: "tech-5", source: "Fine-tuning", target: "微調 (Fine-tuning)", enabled: true, caseSensitive: false },
    { id: "tech-6", source: "Embeddings", target: "嵌入向量 (Embeddings)", enabled: true, caseSensitive: false },
    { id: "tech-7", source: "Zero-shot", target: "零樣本學習 (Zero-shot)", enabled: true, caseSensitive: false },
    { id: "tech-8", source: "Inference", target: "模型推論 (Inference)", enabled: true, caseSensitive: false },
    { id: "tech-9", source: "Open-source", target: "開源 (Open-source)", enabled: true, caseSensitive: false },
    { id: "tech-10", source: "Latency", target: "延遲 (Latency)", enabled: true, caseSensitive: false },
    { id: "tech-11", source: "Throughput", target: "吞吐量 (Throughput)", enabled: true, caseSensitive: false },
    { id: "tech-12", source: "RAG", target: "檢索增強生成 (RAG)", enabled: true, caseSensitive: true },
    { id: "tech-13", source: "Context Window", target: "上下文視窗", enabled: true, caseSensitive: false },
    { id: "tech-14", source: "Transformer", target: "Transformer 架構", enabled: true, caseSensitive: false }
];

// 當前設定狀態記憶體快照
let config: TranslatorConfig = { ...DEFAULT_CONFIG };
let isRecordingShortcut: HTMLInputElement | null = null;

// DOM 元素快取物件
const ui = {
    // 側邊欄與分頁導覽
    navItems: document.querySelectorAll<HTMLDivElement>(".nav-item"),
    tabPanes: document.querySelectorAll<HTMLElement>(".tab-pane"),
    sidebarBridgePill: document.getElementById("sidebar-bridge-pill") as HTMLSpanElement,
    sidebarBridgeText: document.getElementById("sidebar-bridge-text") as HTMLSpanElement,
    btnSaveAll: document.getElementById("btn-save-all") as HTMLButtonElement,
    toast: document.getElementById("toast") as HTMLDivElement,

    // TAB 1: CLI & Model
    inputBridgeUrl: document.getElementById("input-bridge-url") as HTMLInputElement,
    btnTestBridge: document.getElementById("btn-test-bridge") as HTMLButtonElement,
    bridgeTestResult: document.getElementById("bridge-test-result") as HTMLDivElement,
    bridgeTestMessage: document.getElementById("bridge-test-message") as HTMLDivElement,
    inputCliPath: document.getElementById("input-cli-path") as HTMLInputElement,
    inputExtraFlags: document.getElementById("input-extra-flags") as HTMLInputElement,
    selectModel: document.getElementById("select-model") as HTMLSelectElement,
    inputCustomModel: document.getElementById("input-custom-model") as HTMLInputElement,
    effortCards: document.getElementById("effort-cards") as HTMLDivElement,
    currentEffortBadge: document.getElementById("current-effort-badge") as HTMLSpanElement,
    toggleSingleBatch: document.getElementById("toggle-single-batch") as HTMLInputElement,
    sliderBatchSize: document.getElementById("slider-batch-size") as HTMLInputElement,
    valBatchSize: document.getElementById("val-batch-size") as HTMLSpanElement,
    sliderMaxChars: document.getElementById("slider-max-chars") as HTMLInputElement,
    valMaxChars: document.getElementById("val-max-chars") as HTMLSpanElement,
    sliderConcurrency: document.getElementById("slider-concurrency") as HTMLInputElement,
    valConcurrency: document.getElementById("val-concurrency") as HTMLSpanElement,
    sliderTimeoutSec: document.getElementById("slider-timeout-sec") as HTMLInputElement,
    valTimeoutSec: document.getElementById("val-timeout-sec") as HTMLSpanElement,

    // TAB 2: Language & Style
    selectSourceLang: document.getElementById("select-source-lang") as HTMLSelectElement,
    selectTargetLang: document.getElementById("select-target-lang") as HTMLSelectElement,
    styleCards: document.getElementById("style-cards") as HTMLDivElement,
    styleDescText: document.getElementById("style-description-text") as HTMLDivElement,
    textareaCustomPrompt: document.getElementById("textarea-custom-prompt") as HTMLTextAreaElement,
    togglePreserveFormatting: document.getElementById("toggle-preserve-formatting") as HTMLInputElement,
    toggleSkipNumbers: document.getElementById("toggle-skip-numbers") as HTMLInputElement,
    toggleTranslateAttributes: document.getElementById("toggle-translate-attributes") as HTMLInputElement,

    // TAB 3: Glossary
    inputGlossarySearch: document.getElementById("input-glossary-search") as HTMLInputElement,
    glossaryTbody: document.getElementById("glossary-tbody") as HTMLTableSectionElement,
    newGlossarySource: document.getElementById("new-glossary-source") as HTMLInputElement,
    newGlossaryTarget: document.getElementById("new-glossary-target") as HTMLInputElement,
    newGlossaryCase: document.getElementById("new-glossary-case") as HTMLInputElement,
    btnSaveNewGlossary: document.getElementById("btn-save-new-glossary") as HTMLButtonElement,
    btnLoadFinancial: document.getElementById("btn-load-financial") as HTMLButtonElement,
    btnLoadTech: document.getElementById("btn-load-tech") as HTMLButtonElement,

    // TAB 4: Visual & Preview
    previewModeTag: document.getElementById("preview-mode-tag") as HTMLSpanElement,
    previewContentBox: document.getElementById("preview-content-box") as HTMLDivElement,
    previewOriginalText: document.getElementById("preview-original-text") as HTMLDivElement,
    previewTranslatedText: document.getElementById("preview-translated-text") as HTMLDivElement,
    displayModeCards: document.getElementById("display-mode-cards") as HTMLDivElement,
    highlightCards: document.getElementById("highlight-cards") as HTMLDivElement,
    sliderFontScale: document.getElementById("slider-font-scale") as HTMLInputElement,
    valFontScale: document.getElementById("val-font-scale") as HTMLSpanElement,
    sliderSpacing: document.getElementById("slider-spacing") as HTMLInputElement,
    valSpacing: document.getElementById("val-spacing") as HTMLSpanElement,
    inputTextColor: document.getElementById("input-text-color") as HTMLInputElement,
    inputTextColorHex: document.getElementById("input-text-color-hex") as HTMLInputElement,
    btnResetColor: document.getElementById("btn-reset-color") as HTMLButtonElement,
    toggleDimOriginal: document.getElementById("toggle-dim-original") as HTMLInputElement,
    toggleFloatingBall: document.getElementById("toggle-floating-ball") as HTMLInputElement,
    radioBallPositions: document.querySelectorAll<HTMLInputElement>('input[name="ball-pos"]'),

    // TAB 5: Shortcuts & Interaction
    toggleSelectionTranslate: document.getElementById("toggle-selection-translate") as HTMLInputElement,
    toggleHoverTranslate: document.getElementById("toggle-hover-translate") as HTMLInputElement,
    radioHoverKeys: document.querySelectorAll<HTMLInputElement>('input[name="hover-key"]'),
    inputShortcutTogglePage: document.getElementById("input-shortcut-toggle-page") as HTMLInputElement,
    inputShortcutToggleMode: document.getElementById("input-shortcut-toggle-mode") as HTMLInputElement,
    inputShortcutSelection: document.getElementById("input-shortcut-selection") as HTMLInputElement,

    // TAB 6: Domains, Cache & Backup
    textareaAutoDomains: document.getElementById("textarea-auto-domains") as HTMLTextAreaElement,
    textareaExcludedDomains: document.getElementById("textarea-excluded-domains") as HTMLTextAreaElement,
    inputExcludedSelectors: document.getElementById("input-excluded-selectors") as HTMLInputElement,
    toggleDynamicMutation: document.getElementById("toggle-dynamic-mutation") as HTMLInputElement,
    toggleViewportPriority: document.getElementById("toggle-viewport-priority") as HTMLInputElement,
    toggleEnableCache: document.getElementById("toggle-enable-cache") as HTMLInputElement,
    inputMaxCacheEntries: document.getElementById("input-max-cache-entries") as HTMLInputElement,
    cacheStatsDisplay: document.getElementById("cache-stats-display") as HTMLDivElement,
    btnClearCacheFull: document.getElementById("btn-clear-cache-full") as HTMLButtonElement,
    btnExportConfig: document.getElementById("btn-export-config") as HTMLButtonElement,
    fileImportConfig: document.getElementById("file-import-config") as HTMLInputElement,
    btnResetDefaults: document.getElementById("btn-reset-defaults") as HTMLButtonElement
};

/**
 * 彈出 Toast 提示
 */
function showToast(message: string, durationMs = 2500): void {
    if (!ui.toast) return;
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    setTimeout(() => {
        ui.toast.classList.remove("show");
    }, durationMs);
}

/**
 * 側邊欄切換分頁
 */
function setupTabNavigation(): void {
    ui.navItems.forEach((item) => {
        item.addEventListener("click", () => {
            const tabId = item.dataset.tab;
            if (!tabId) return;

            ui.navItems.forEach((nav) => nav.classList.remove("active"));
            item.classList.add("active");

            ui.tabPanes.forEach((pane) => {
                if (pane.id === tabId) {
                    pane.classList.remove("hidden");
                } else {
                    pane.classList.add("hidden");
                }
            });
        });
    });
}

/**
 * 測試本機 Antigravity CLI Bridge 伺服器健康度
 */
async function testBridgeConnection(): Promise<void> {
    const bridgeUrl = (ui.inputBridgeUrl.value || config.bridgeUrl || "http://127.0.0.1:18765").replace(/\/+$/, "");
    ui.btnTestBridge.disabled = true;
    ui.btnTestBridge.textContent = "連線中...";
    ui.bridgeTestResult.classList.remove("hidden");
    ui.bridgeTestMessage.innerHTML = "正在連線本地橋接伺服器並偵測 Antigravity CLI...";

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const resp = await fetch(`${bridgeUrl}/health`, { signal: controller.signal });
        clearTimeout(timer);

        if (resp.ok) {
            const data = (await resp.json()) as BridgeHealthResponse;
            ui.sidebarBridgePill.className = "status-pill online";
            ui.sidebarBridgeText.textContent = "已連線";
            ui.bridgeTestMessage.innerHTML = `
        <div style="color: #34d399; font-weight: 700; margin-bottom: 4px;">✅ Bridge 連線成功！Antigravity CLI 一切正常</div>
        <div>• CLI 執行路徑: <code>${data.cliPath || "agy"}</code></div>
        <div>• 預設模型: <code>${data.defaultModel || config.model}</code> (推理深度: <code>${data.defaultEffort || config.effort}</code>)</div>
        ${data.version ? `<div>• 版本號: <code>${data.version}</code></div>` : ""}
      `;
            showToast("Antigravity CLI 連線成功！");
        } else {
            throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        ui.sidebarBridgePill.className = "status-pill offline";
        ui.sidebarBridgeText.textContent = "未連線";
        ui.bridgeTestMessage.innerHTML = `
      <div style="color: #fb7185; font-weight: 700; margin-bottom: 4px;">⚠️ 連線失敗：無法連線至 ${bridgeUrl}</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">錯誤訊息: ${errorMsg}</div>
      <div style="font-size: 12px;">請確認已於專案根目錄開啟終端機並執行啟動指令：</div>
      <div style="background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #38bdf8; margin-top: 4px;">
        npm run bridge <span style="color: var(--text-dim);">(或 node bridge/server.mjs)</span>
      </div>
    `;
        showToast("Bridge 未啟動或連線逾時");
    } finally {
        ui.btnTestBridge.disabled = false;
        ui.btnTestBridge.textContent = "🔌 測試 CLI 連線";
    }
}

/**
 * 更新即時視覺預覽卡片 (Live Preview Box)
 */
function updateLivePreview(): void {
    const { displayMode, highlightStyle, fontSizeScale, bilingualSpacing, textColor, dimOriginal } = config;

    // 1. 呈現模式
    if (displayMode === "bilingual") {
        ui.previewModeTag.textContent = "雙語對照模式";
        ui.previewOriginalText.style.display = "block";
        ui.previewTranslatedText.style.display = "block";
    } else if (displayMode === "replace") {
        ui.previewModeTag.textContent = "直接替換模式";
        ui.previewOriginalText.style.display = "none";
        ui.previewTranslatedText.style.display = "block";
    } else {
        ui.previewModeTag.textContent = "懸停對照模式 (Hover)";
        ui.previewOriginalText.style.display = "block";
        ui.previewTranslatedText.style.display = "block";
    }

    // 2. 原文淡化
    if (dimOriginal) {
        ui.previewOriginalText.classList.add("dimmed");
    } else {
        ui.previewOriginalText.classList.remove("dimmed");
    }

    // 3. 高亮樣式 class
    ui.previewTranslatedText.className = "preview-translated";
    if (highlightStyle && highlightStyle !== "none") {
        ui.previewTranslatedText.classList.add(`style-${highlightStyle}`);
    } else {
        ui.previewTranslatedText.classList.add("style-none");
    }

    // 4. 字體比例縮放
    const baseFontSize = 14;
    ui.previewTranslatedText.style.fontSize = `${Math.round(baseFontSize * fontSizeScale)}px`;

    // 5. 段落間距
    ui.previewTranslatedText.style.marginTop = `${bilingualSpacing}px`;

    // 6. 字體色彩
    if (textColor) {
        ui.previewTranslatedText.style.color = textColor;
    }
}

/**
 * 將目前 config 填入所有 UI 表單控制項
 */
function populateUI(cfg: TranslatorConfig): void {
    // TAB 1: CLI
    ui.inputBridgeUrl.value = cfg.bridgeUrl;
    ui.inputCliPath.value = cfg.cliPath;
    ui.inputExtraFlags.value = cfg.extraCliFlags;

    const matchedModel = AVAILABLE_MODELS.some((m) => m.id === cfg.model);
    if (matchedModel) {
        ui.selectModel.value = cfg.model;
        ui.inputCustomModel.classList.add("hidden");
    } else {
        ui.selectModel.value = "custom";
        ui.inputCustomModel.value = cfg.model;
        ui.inputCustomModel.classList.remove("hidden");
    }

    // Effort Cards
    ui.effortCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        if (card.dataset.effort === cfg.effort) {
            card.classList.add("selected");
        } else {
            card.classList.remove("selected");
        }
    });
    ui.currentEffortBadge.textContent = cfg.effort;

    // Batch Sliders & Single Batch Toggle
    if (ui.toggleSingleBatch) {
        ui.toggleSingleBatch.checked = cfg.singleBatchMode !== false;
    }
    ui.sliderBatchSize.value = String(cfg.batchSize);
    ui.valBatchSize.textContent = String(cfg.batchSize);
    ui.sliderMaxChars.value = String(cfg.maxCharsPerBatch);
    ui.valMaxChars.textContent = String(cfg.maxCharsPerBatch);
    ui.sliderConcurrency.value = String(cfg.concurrency);
    ui.valConcurrency.textContent = String(cfg.concurrency);
    ui.sliderTimeoutSec.value = String(cfg.timeoutSec);
    ui.valTimeoutSec.textContent = `${cfg.timeoutSec}s`;

    // TAB 2: Language & Style
    ui.selectSourceLang.value = cfg.sourceLang;
    ui.selectTargetLang.value = cfg.targetLang;

    ui.styleCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        if (card.dataset.style === cfg.translationStyle) {
            card.classList.add("selected");
        } else {
            card.classList.remove("selected");
        }
    });
    updateStyleDescription(cfg.translationStyle);

    ui.textareaCustomPrompt.value = cfg.customPrompt || "";
    ui.togglePreserveFormatting.checked = cfg.preserveFormatting;
    ui.toggleSkipNumbers.checked = cfg.skipNumbersAndCodes;
    ui.toggleTranslateAttributes.checked = cfg.translateAttributes;

    // TAB 3: Glossary
    renderGlossaryTable();

    // TAB 4: Visual & Preview
    ui.displayModeCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        if (card.dataset.mode === cfg.displayMode) {
            card.classList.add("selected");
        } else {
            card.classList.remove("selected");
        }
    });

    ui.highlightCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        if (card.dataset.highlight === cfg.highlightStyle) {
            card.classList.add("selected");
        } else {
            card.classList.remove("selected");
        }
    });

    ui.sliderFontScale.value = String(cfg.fontSizeScale);
    ui.valFontScale.textContent = `${Math.round(cfg.fontSizeScale * 100)}%`;
    ui.sliderSpacing.value = String(cfg.bilingualSpacing);
    ui.valSpacing.textContent = `${cfg.bilingualSpacing}px`;

    ui.inputTextColor.value = cfg.textColor || "#2563EB";
    ui.inputTextColorHex.value = cfg.textColor || "#2563EB";
    ui.toggleDimOriginal.checked = cfg.dimOriginal;
    ui.toggleFloatingBall.checked = cfg.showFloatingBall;

    ui.radioBallPositions.forEach((radio) => {
        radio.checked = radio.value === cfg.floatingBallPosition;
    });

    // TAB 5: Shortcuts & Interaction
    ui.toggleSelectionTranslate.checked = cfg.enableSelectionTranslate;
    ui.toggleHoverTranslate.checked = cfg.enableHoverTranslate;
    ui.radioHoverKeys.forEach((radio) => {
        radio.checked = radio.value === cfg.hoverTriggerKey;
    });
    ui.inputShortcutTogglePage.value = cfg.shortcutTogglePage;
    ui.inputShortcutToggleMode.value = cfg.shortcutToggleMode;
    ui.inputShortcutSelection.value = cfg.shortcutTranslateSelection;

    // TAB 6: Domains & Cache
    ui.textareaAutoDomains.value = cfg.autoTranslateDomains.join("\n");
    ui.textareaExcludedDomains.value = cfg.excludedDomains.join("\n");
    ui.inputExcludedSelectors.value = cfg.excludedSelectors.join(", ");
    ui.toggleDynamicMutation.checked = cfg.dynamicMutationObserve;
    ui.toggleViewportPriority.checked = cfg.viewportPriorityOnly;
    ui.toggleEnableCache.checked = cfg.enableCache;
    ui.inputMaxCacheEntries.value = String(cfg.maxCacheEntries);

    updateLivePreview();
}

/**
 * 更新風格說明文字
 */
function updateStyleDescription(style: TranslationStyle): void {
    const preset = STYLE_PRESETS[style];
    if (preset && ui.styleDescText) {
        ui.styleDescText.textContent = `${preset.label}：${preset.description}`;
    }
}

/**
 * 渲染專屬術語表
 */
function renderGlossaryTable(filterText = ""): void {
    const tbody = ui.glossaryTbody;
    tbody.innerHTML = "";

    const query = filterText.trim().toLowerCase();
    const list = config.glossary.filter((item) => {
        if (!query) return true;
        return item.source.toLowerCase().includes(query) || item.target.toLowerCase().includes(query);
    });

    if (list.length === 0) {
        const emptyRow = document.createElement("tr");
        emptyRow.innerHTML = `
      <td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">
        ${query ? "找不到相符的術語規則" : "目前尚未建立術語，可點選上方範本快速載入或自行新增"}
      </td>
    `;
        tbody.appendChild(emptyRow);
        return;
    }

    list.forEach((entry) => {
        const row = document.createElement("tr");
        row.innerHTML = `
      <td><strong>${escapeHtml(entry.source)}</strong></td>
      <td><span style="color: var(--accent-cyan);">${escapeHtml(entry.target)}</span></td>
      <td>
        <span style="font-size: 11px; color: ${entry.caseSensitive ? "#34d399" : "var(--text-dim)"};">
          ${entry.caseSensitive ? "是 (嚴格)" : "否 (忽略)"}
        </span>
      </td>
      <td>
        <label class="switch" style="width: 32px; height: 18px;">
          <input type="checkbox" class="toggle-glossary-entry" data-id="${entry.id}" ${entry.enabled ? "checked" : ""}>
          <span class="slider-round" style="border-radius: 18px;"></span>
        </label>
      </td>
      <td style="text-align: center;">
        <button class="btn btn-danger btn-sm btn-delete-glossary" data-id="${entry.id}" title="刪除此術語">🗑️</button>
      </td>
    `;
        tbody.appendChild(row);
    });

    // 綁定行內開關與刪除事件
    tbody.querySelectorAll<HTMLInputElement>(".toggle-glossary-entry").forEach((chk) => {
        chk.addEventListener("change", () => {
            const id = chk.dataset.id;
            const target = config.glossary.find((g) => g.id === id);
            if (target) {
                target.enabled = chk.checked;
                saveSettings(false);
            }
        });
    });

    tbody.querySelectorAll<HTMLButtonElement>(".btn-delete-glossary").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            config.glossary = config.glossary.filter((g) => g.id !== id);
            renderGlossaryTable(ui.inputGlossarySearch.value);
            saveSettings(false);
            showToast("已刪除術語");
        });
    });
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 查詢並顯示快取統計資訊
 */
async function refreshCacheStats(): Promise<void> {
    try {
        const stats = await chrome.runtime.sendMessage<RuntimeMessage, CacheStats>({
            action: "GET_CACHE_STATS"
        });
        if (stats && typeof stats.count === "number") {
            const kb = (stats.estimatedBytes / 1024).toFixed(1);
            ui.cacheStatsDisplay.textContent = `${stats.count} 筆 (~${kb} KB)`;
            return;
        }
    } catch {
        // 退回讀取 storage
    }

    try {
        const res = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
        const map = res[STORAGE_KEYS.CACHE] as Record<string, unknown> | undefined;
        const count = map ? Object.keys(map).length : 0;
        ui.cacheStatsDisplay.textContent = `${count} 筆`;
    } catch {
        ui.cacheStatsDisplay.textContent = "0 筆";
    }
}

/**
 * 從表單收集所有設定並儲存
 */
async function saveSettings(showFeedback = true): Promise<void> {
    // TAB 1
    config.bridgeUrl = ui.inputBridgeUrl.value.trim() || DEFAULT_CONFIG.bridgeUrl;
    config.cliPath = ui.inputCliPath.value.trim() || DEFAULT_CONFIG.cliPath;
    config.extraCliFlags = ui.inputExtraFlags.value.trim();

    if (ui.selectModel.value === "custom") {
        config.model = ui.inputCustomModel.value.trim() || DEFAULT_CONFIG.model;
    } else {
        config.model = ui.selectModel.value;
    }

    if (ui.toggleSingleBatch) {
        config.singleBatchMode = ui.toggleSingleBatch.checked;
    }
    config.batchSize = parseInt(ui.sliderBatchSize.value, 10);
    config.maxCharsPerBatch = parseInt(ui.sliderMaxChars.value, 10);
    config.concurrency = parseInt(ui.sliderConcurrency.value, 10);
    config.timeoutSec = parseInt(ui.sliderTimeoutSec.value, 10);

    // TAB 2
    config.sourceLang = ui.selectSourceLang.value;
    config.targetLang = ui.selectTargetLang.value;
    config.customPrompt = ui.textareaCustomPrompt.value.trim();
    config.preserveFormatting = ui.togglePreserveFormatting.checked;
    config.skipNumbersAndCodes = ui.toggleSkipNumbers.checked;
    config.translateAttributes = ui.toggleTranslateAttributes.checked;

    // TAB 4
    config.fontSizeScale = parseFloat(ui.sliderFontScale.value);
    config.bilingualSpacing = parseInt(ui.sliderSpacing.value, 10);
    config.textColor = ui.inputTextColor.value;
    config.dimOriginal = ui.toggleDimOriginal.checked;
    config.showFloatingBall = ui.toggleFloatingBall.checked;

    ui.radioBallPositions.forEach((radio) => {
        if (radio.checked) {
            config.floatingBallPosition = radio.value as "right" | "left";
        }
    });

    // TAB 5
    config.enableSelectionTranslate = ui.toggleSelectionTranslate.checked;
    config.enableHoverTranslate = ui.toggleHoverTranslate.checked;
    ui.radioHoverKeys.forEach((radio) => {
        if (radio.checked) {
            config.hoverTriggerKey = radio.value as HoverTriggerKey;
        }
    });
    config.shortcutTogglePage = ui.inputShortcutTogglePage.value;
    config.shortcutToggleMode = ui.inputShortcutToggleMode.value;
    config.shortcutTranslateSelection = ui.inputShortcutSelection.value;

    // TAB 6
    config.autoTranslateDomains = ui.textareaAutoDomains.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    config.excludedDomains = ui.textareaExcludedDomains.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    config.excludedSelectors = ui.inputExcludedSelectors.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    config.dynamicMutationObserve = ui.toggleDynamicMutation.checked;
    config.viewportPriorityOnly = ui.toggleViewportPriority.checked;
    config.enableCache = ui.toggleEnableCache.checked;
    config.maxCacheEntries = parseInt(ui.inputMaxCacheEntries.value, 10) || 5000;

    // 儲存至 Storage
    await saveConfig(config);

    // 廣播設定已更新給背景與所有分頁
    try {
        await chrome.runtime.sendMessage<RuntimeMessage<TranslatorConfig>>({
            action: "CONFIG_UPDATED",
            payload: config
        });
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs.sendMessage<RuntimeMessage<TranslatorConfig>>(tab.id, {
                    action: "CONFIG_UPDATED",
                    payload: config
                }).catch(() => {});
            }
        }
    } catch {
        // Ignored
    }

    updateLivePreview();

    if (showFeedback) {
        showToast("✅ 所有設定已成功儲存！");
    }
}

/**
 * 綁定快捷鍵錄製器
 */
function setupShortcutRecorders(): void {
    const recorders = [
        ui.inputShortcutTogglePage,
        ui.inputShortcutToggleMode,
        ui.inputShortcutSelection
    ];

    recorders.forEach((input) => {
        input.addEventListener("focus", () => {
            isRecordingShortcut = input;
            input.classList.add("recording");
            input.value = "請按下快捷鍵組合...";
        });

        input.addEventListener("blur", () => {
            if (isRecordingShortcut === input) {
                isRecordingShortcut = null;
                input.classList.remove("recording");
                // 恢復原設定值
                if (input === ui.inputShortcutTogglePage) input.value = config.shortcutTogglePage;
                if (input === ui.inputShortcutToggleMode) input.value = config.shortcutToggleMode;
                if (input === ui.inputShortcutSelection) input.value = config.shortcutTranslateSelection;
            }
        });

        input.addEventListener("keydown", (e: KeyboardEvent) => {
            if (isRecordingShortcut !== input) return;
            e.preventDefault();
            e.stopPropagation();

            // 忽略單獨的修飾鍵按下
            if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
                return;
            }

            // Escape 取消錄製
            if (e.key === "Escape") {
                input.blur();
                return;
            }

            const parts: string[] = [];
            if (e.ctrlKey) parts.push("Ctrl");
            if (e.altKey) parts.push("Alt");
            if (e.shiftKey) parts.push("Shift");
            if (e.metaKey) parts.push("Command");

            const keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            parts.push(keyName);

            const combo = parts.join("+");
            input.value = combo;
            input.blur();

            saveSettings(true);
            showToast(`快捷鍵已設定為：${combo}`);
        });
    });
}

/**
 * 綁定所有表單與操作事件
 */
function setupEventListeners(): void {
    // 側邊欄與儲存按鈕
    ui.btnSaveAll.addEventListener("click", () => saveSettings(true));

    // TAB 1: 測試連線
    ui.btnTestBridge.addEventListener("click", testBridgeConnection);

    // 模型切換
    ui.selectModel.addEventListener("change", () => {
        if (ui.selectModel.value === "custom") {
            ui.inputCustomModel.classList.remove("hidden");
            ui.inputCustomModel.focus();
        } else {
            ui.inputCustomModel.classList.add("hidden");
            config.model = ui.selectModel.value;
            saveSettings(false);
        }
    });

    // Effort Cards 點選
    ui.effortCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        card.addEventListener("click", () => {
            const effort = card.dataset.effort as EffortLevel;
            if (!effort) return;
            ui.effortCards.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
            card.classList.add("selected");
            ui.currentEffortBadge.textContent = effort;
            config.effort = effort;
            saveSettings(false);
            showToast(`推理深度已更新為: ${effort}`);
        });
    });

    // 單次最大 Token 直出模式開關與滑桿即時數字連動
    if (ui.toggleSingleBatch) {
        ui.toggleSingleBatch.addEventListener("change", () => {
            saveSettings(false);
            showToast(
                ui.toggleSingleBatch.checked
                    ? "⚡ 已開啟「單次最大 Token 全頁直出」極速模式"
                    : "已切換為標準分批翻譯模式"
            );
        });
    }
    ui.sliderBatchSize.addEventListener("input", () => {
        ui.valBatchSize.textContent = ui.sliderBatchSize.value;
    });
    ui.sliderBatchSize.addEventListener("change", () => saveSettings(false));

    ui.sliderMaxChars.addEventListener("input", () => {
        ui.valMaxChars.textContent = ui.sliderMaxChars.value;
    });
    ui.sliderMaxChars.addEventListener("change", () => saveSettings(false));

    ui.sliderConcurrency.addEventListener("input", () => {
        ui.valConcurrency.textContent = ui.sliderConcurrency.value;
    });
    ui.sliderConcurrency.addEventListener("change", () => saveSettings(false));

    ui.sliderTimeoutSec.addEventListener("input", () => {
        ui.valTimeoutSec.textContent = `${ui.sliderTimeoutSec.value}s`;
    });
    ui.sliderTimeoutSec.addEventListener("change", () => saveSettings(false));

    // TAB 2: Style Cards 點選
    ui.styleCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        card.addEventListener("click", () => {
            const style = card.dataset.style as TranslationStyle;
            if (!style) return;
            ui.styleCards.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
            card.classList.add("selected");
            config.translationStyle = style;
            updateStyleDescription(style);
            saveSettings(false);
        });
    });

    // TAB 3: Glossary 新增與範本載入
    ui.inputGlossarySearch.addEventListener("input", () => {
        renderGlossaryTable(ui.inputGlossarySearch.value);
    });

    ui.btnSaveNewGlossary.addEventListener("click", () => {
        const source = ui.newGlossarySource.value.trim();
        const target = ui.newGlossaryTarget.value.trim();
        const caseSensitive = ui.newGlossaryCase.checked;

        if (!source || !target) {
            showToast("請輸入完整的原文與指定譯文");
            return;
        }

        const newEntry: GlossaryEntry = {
            id: `custom-${Date.now()}`,
            source,
            target,
            enabled: true,
            caseSensitive
        };

        config.glossary.unshift(newEntry);
        ui.newGlossarySource.value = "";
        ui.newGlossaryTarget.value = "";
        ui.newGlossaryCase.checked = false;

        renderGlossaryTable(ui.inputGlossarySearch.value);
        saveSettings(false);
        showToast(`已新增術語「${source}」`);
    });

    // 一鍵載入台美股財經術語範本
    ui.btnLoadFinancial.addEventListener("click", () => {
        let addedCount = 0;
        const currentSources = new Set(config.glossary.map((g) => g.source.toLowerCase()));

        FINANCIAL_GLOSSARY_TEMPLATE.forEach((item) => {
            if (!currentSources.has(item.source.toLowerCase())) {
                config.glossary.push({ ...item, id: `fin-${Date.now()}-${Math.random().toString(36).substring(2, 6)}` });
                addedCount++;
            }
        });

        renderGlossaryTable();
        saveSettings(false);
        showToast(`已成功載入 ${addedCount} 筆台美股財經常用術語！`);
    });

    // 一鍵載入 AI 與軟體工程術語範本
    ui.btnLoadTech.addEventListener("click", () => {
        let addedCount = 0;
        const currentSources = new Set(config.glossary.map((g) => g.source.toLowerCase()));

        TECH_GLOSSARY_TEMPLATE.forEach((item) => {
            if (!currentSources.has(item.source.toLowerCase())) {
                config.glossary.push({ ...item, id: `tech-${Date.now()}-${Math.random().toString(36).substring(2, 6)}` });
                addedCount++;
            }
        });

        renderGlossaryTable();
        saveSettings(false);
        showToast(`已成功載入 ${addedCount} 筆 AI 與軟體工程常用術語！`);
    });

    // TAB 4: 視覺設定與預覽互動
    ui.displayModeCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        card.addEventListener("click", () => {
            const mode = card.dataset.mode as DisplayMode;
            if (!mode) return;
            ui.displayModeCards.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
            card.classList.add("selected");
            config.displayMode = mode;
            updateLivePreview();
            saveSettings(false);
        });
    });

    ui.highlightCards.querySelectorAll<HTMLDivElement>(".option-card").forEach((card) => {
        card.addEventListener("click", () => {
            const highlight = card.dataset.highlight as HighlightStyle;
            if (!highlight) return;
            ui.highlightCards.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
            card.classList.add("selected");
            config.highlightStyle = highlight;
            updateLivePreview();
            saveSettings(false);
        });
    });

    ui.sliderFontScale.addEventListener("input", () => {
        const val = parseFloat(ui.sliderFontScale.value);
        ui.valFontScale.textContent = `${Math.round(val * 100)}%`;
        config.fontSizeScale = val;
        updateLivePreview();
    });
    ui.sliderFontScale.addEventListener("change", () => saveSettings(false));

    ui.sliderSpacing.addEventListener("input", () => {
        const val = parseInt(ui.sliderSpacing.value, 10);
        ui.valSpacing.textContent = `${val}px`;
        config.bilingualSpacing = val;
        updateLivePreview();
    });
    ui.sliderSpacing.addEventListener("change", () => saveSettings(false));

    ui.inputTextColor.addEventListener("input", () => {
        const color = ui.inputTextColor.value;
        ui.inputTextColorHex.value = color;
        config.textColor = color;
        updateLivePreview();
    });
    ui.inputTextColor.addEventListener("change", () => saveSettings(false));

    ui.inputTextColorHex.addEventListener("change", () => {
        const color = ui.inputTextColorHex.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
            ui.inputTextColor.value = color;
            config.textColor = color;
            updateLivePreview();
            saveSettings(false);
        }
    });

    ui.btnResetColor.addEventListener("click", () => {
        const defaultColor = DEFAULT_CONFIG.textColor;
        ui.inputTextColor.value = defaultColor;
        ui.inputTextColorHex.value = defaultColor;
        config.textColor = defaultColor;
        updateLivePreview();
        saveSettings(false);
        showToast("譯文顏色已重設為預設藍色");
    });

    ui.toggleDimOriginal.addEventListener("change", () => {
        config.dimOriginal = ui.toggleDimOriginal.checked;
        updateLivePreview();
        saveSettings(false);
    });

    // 快捷鍵錄製綁定
    setupShortcutRecorders();

    // TAB 6: 清除快取
    ui.btnClearCacheFull.addEventListener("click", async () => {
        if (!confirm("確定要清除所有本地已儲存的翻譯快取嗎？")) return;
        try {
            await chrome.runtime.sendMessage<RuntimeMessage>({ action: "CLEAR_CACHE" });
        } catch {
            await chrome.storage.local.remove(STORAGE_KEYS.CACHE);
        }
        await refreshCacheStats();
        showToast("已成功清除所有翻譯快取！");
    });

    // 匯出設定 JSON
    ui.btnExportConfig.addEventListener("click", () => {
        const json = JSON.stringify(config, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `antigravity-translator-config-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("已匯出設定 JSON 檔案");
    });

    // 匯入設定 JSON
    ui.fileImportConfig.addEventListener("change", (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const parsed = JSON.parse(reader.result as string) as Partial<TranslatorConfig>;
                if (typeof parsed !== "object" || parsed === null) {
                    throw new Error("無效的 JSON 結構");
                }

                config = {
                    ...DEFAULT_CONFIG,
                    ...parsed
                };

                await saveConfig(config);
                populateUI(config);
                showToast("✅ 設定 JSON 匯入成功！");
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                alert(`設定檔匯入失敗：${errorMsg}`);
            }
        };
        reader.readAsText(file);
    });

    // 恢復出廠預設值
    ui.btnResetDefaults.addEventListener("click", async () => {
        if (!confirm("⚠️ 確定要恢復為出廠預設設定嗎？自訂的術語庫與網域規則將會被重設！")) {
            return;
        }

        config = {
            ...DEFAULT_CONFIG,
            glossary: [...DEFAULT_GLOSSARY]
        };

        await saveConfig(config);
        populateUI(config);
        showToast("已恢復為出廠預設值");
    });
}

/**
 * 初始化入口
 */
async function initOptions(): Promise<void> {
    try {
        // 1. 讀取設定
        config = await getConfig();

        // 2. 初始化導覽與 UI 渲染
        setupTabNavigation();
        populateUI(config);

        // 3. 綁定事件監聽器
        setupEventListeners();

        // 4. 背景檢查 Bridge 健康度與快取統計
        testBridgeConnection().catch(() => {});
        refreshCacheStats().catch(() => {});
    } catch (err) {
        console.error("[Antigravity Translator] Options 頁面初始化異常:", err);
    }
}

// 啟動控制器
document.addEventListener("DOMContentLoaded", initOptions);
