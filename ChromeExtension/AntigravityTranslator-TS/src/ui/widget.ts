/**
 * ============================================================================
 * 🛸 Antigravity Translator - Shadow DOM 網頁懸浮介面元件 (Widget & Tooltip)
 * ============================================================================
 *
 * 本模組使用 Web Components 與 Shadow DOM (`attachShadow({ mode: 'open' })`)
 * 打造 100% 樣式隔離的兩大互動元件，完全不污染亦不被宿主網頁 CSS 干擾：
 * 1. `FloatingTranslatorWidget`：停靠於畫面邊緣之懸浮控制球與進度展開面板
 * 2. `SelectionTooltipWidget`：劃詞反白選取文字之即時翻譯氣泡與毛玻璃卡片
 */

import type {
    DisplayMode,
    PageTranslationState,
    TranslatorConfig
} from "../types/index.js";

/**
 * 懸浮球宿主元素 ID
 */
const FLOATING_WIDGET_HOST_ID = "agy-floating-widget-host";

/**
 * 選取文字氣泡宿主元素 ID
 */
const SELECTION_WIDGET_HOST_ID = "agy-selection-widget-host";

// ============================================================================
// 1. 懸浮控制球與進度膠囊 (FloatingTranslatorWidget)
// ============================================================================

/**
 * 懸浮翻譯控制元件
 */
export class FloatingTranslatorWidget {
    private host: HTMLElement;
    private shadow: ShadowRoot;
    private config: TranslatorConfig;
    private state: PageTranslationState;
    private isExpanded = false;

    // 拖曳狀態管理
    private isDragging = false;
    private startY = 0;
    private startBottom = 80;
    private currentBottom = 80;

    /** 點擊「翻譯 / 還原」回呼 */
    public onToggleTranslate?: () => void;
    /** 切換顯示模式回呼 */
    public onSwitchDisplayMode?: (mode: DisplayMode) => void;
    /** 還原頁面回呼 */
    public onRestorePage?: () => void;

    constructor(initialConfig: TranslatorConfig, initialState: PageTranslationState) {
        this.config = initialConfig;
        this.state = initialState;

        // 移除舊的宿主節點（若已存在）
        const existingHost = document.getElementById(FLOATING_WIDGET_HOST_ID);
        if (existingHost) {
            existingHost.remove();
        }

        // 建立新宿主
        this.host = document.createElement("div");
        this.host.id = FLOATING_WIDGET_HOST_ID;
        this.host.style.position = "fixed";
        this.host.style.zIndex = "2147483646";
        this.host.style.pointerEvents = "none"; // 讓外部透明區域不阻擋點擊

        this.shadow = this.host.attachShadow({ mode: "open" });
        this.render();

        (document.body || document.documentElement).appendChild(this.host);
        this.bindEvents();
    }

    /**
     * 更新翻譯狀態並重新繪製 UI
     */
    public updateState(newState: Partial<PageTranslationState>): void {
        this.state = { ...this.state, ...newState };
        this.render();
        this.bindEvents();
    }

    /**
     * 更新設定
     */
    public updateConfig(newConfig: TranslatorConfig): void {
        this.config = newConfig;
        this.render();
        this.bindEvents();
    }

    /**
     * 移除懸浮球元件
     */
    public destroy(): void {
        this.host.remove();
    }

    /**
     * 產生 Shadow DOM 樣式與 HTML 結構
     */
    private render(): void {
        if (!this.config.showFloatingBall) {
            this.host.style.display = "none";
            return;
        }
        this.host.style.display = "block";

        const isLeft = this.config.floatingBallPosition === "left";
        const positionStyle = isLeft
            ? `left: 20px; right: auto;`
            : `right: 20px; left: auto;`;

        // 計算百分比
        const percent =
            this.state.totalNodes > 0
                ? Math.min(
                      100,
                      Math.round((this.state.translatedNodes / this.state.totalNodes) * 100)
                  )
                : 0;

        // 狀態文字或圖示
        let badgeContent = "AGY";
        let ballClass = "agy-ball-idle";

        if (this.state.isTranslating) {
            badgeContent = `${percent}%`;
            ballClass = "agy-ball-translating";
        } else if (this.state.isTranslated) {
            badgeContent = "✓";
            ballClass = "agy-ball-completed";
        } else if (this.state.lastError) {
            badgeContent = "!";
            ballClass = "agy-ball-error";
        }

        const css = `
            :host {
                all: initial;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            }

            .agy-container {
                position: fixed;
                bottom: ${this.currentBottom}px;
                ${positionStyle}
                pointer-events: auto;
                user-select: none;
                display: flex;
                flex-direction: column;
                align-items: ${isLeft ? "flex-start" : "flex-end"};
                gap: 10px;
                z-index: 2147483647;
            }

            /* 懸浮控制球主體 */
            .agy-floating-ball {
                width: 48px;
                height: 48px;
                border-radius: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: grab;
                color: #ffffff;
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 0.5px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(99, 102, 241, 0.4);
                transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
                border: 2px solid rgba(255, 255, 255, 0.35);
            }

            .agy-floating-ball:hover {
                transform: scale(1.08);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(99, 102, 241, 0.6);
            }

            .agy-floating-ball:active {
                cursor: grabbing;
                transform: scale(0.96);
            }

            .agy-ball-idle {
                background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
            }

            .agy-ball-translating {
                background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
                animation: agy-pulse 1.4s infinite ease-in-out;
            }

            .agy-ball-completed {
                background: linear-gradient(135deg, #10b981 0%, #047857 100%);
            }

            .agy-ball-error {
                background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
            }

            @keyframes agy-pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.06); box-shadow: 0 0 18px rgba(59, 130, 246, 0.7); }
                100% { transform: scale(1); }
            }

            /* 展開之迷你控制卡片 */
            .agy-mini-panel {
                width: 260px;
                background: rgba(18, 20, 29, 0.94);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 14px;
                padding: 14px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.15);
                color: #f8fafc;
                display: ${this.isExpanded ? "flex" : "none"};
                flex-direction: column;
                gap: 12px;
                transform-origin: ${isLeft ? "bottom left" : "bottom right"};
                animation: agy-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes agy-pop {
                from { opacity: 0; transform: scale(0.88) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }

            .agy-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                padding-bottom: 8px;
            }

            .agy-panel-title {
                font-size: 13px;
                font-weight: 700;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .agy-model-badge {
                font-size: 10px;
                background: rgba(99, 102, 241, 0.25);
                color: #a5b4fc;
                padding: 2px 6px;
                border-radius: 4px;
                border: 1px solid rgba(165, 180, 252, 0.3);
            }

            .agy-close-btn {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 16px;
                cursor: pointer;
                line-height: 1;
                padding: 2px;
            }
            .agy-close-btn:hover {
                color: #ffffff;
            }

            /* 進度列 */
            .agy-progress-bar-container {
                width: 100%;
                height: 5px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                overflow: hidden;
            }
            .agy-progress-bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #6366f1, #38bdf8);
                width: ${percent}%;
                transition: width 0.3s ease;
            }

            .agy-stats-text {
                font-size: 11px;
                color: #94a3b8;
                display: flex;
                justify-content: space-between;
            }

            /* 模式切換器 */
            .agy-mode-selector {
                display: flex;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 8px;
                padding: 3px;
                gap: 2px;
            }

            .agy-mode-btn {
                flex: 1;
                padding: 5px 0;
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 11px;
                font-weight: 600;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.15s ease;
                text-align: center;
            }

            .agy-mode-btn.active {
                background: #6366f1;
                color: #ffffff;
                box-shadow: 0 2px 6px rgba(99, 102, 241, 0.4);
            }

            /* 主要動作按鈕 */
            .agy-action-btn {
                width: 100%;
                padding: 8px 12px;
                border: none;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: background 0.2s ease, transform 0.1s ease;
            }

            .agy-btn-primary {
                background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                color: #ffffff;
            }
            .agy-btn-primary:hover {
                background: linear-gradient(135deg, #7174f8 0%, #5950ee 100%);
            }

            .agy-btn-restore {
                background: rgba(239, 68, 68, 0.18);
                color: #fca5a5;
                border: 1px solid rgba(239, 68, 68, 0.35);
            }
            .agy-btn-restore:hover {
                background: rgba(239, 68, 68, 0.28);
                color: #ffffff;
            }

            .agy-error-message {
                font-size: 10px;
                color: #f87171;
                line-height: 1.3;
                background: rgba(239, 68, 68, 0.1);
                padding: 6px 8px;
                border-radius: 6px;
            }
        `;

        const isTranslated = this.state.isTranslated;
        const currentMode = this.state.displayMode || this.config.displayMode;

        this.shadow.innerHTML = `
            <style>${css}</style>
            <div class="agy-container">
                <div class="agy-mini-panel" id="agy-mini-panel">
                    <div class="agy-panel-header">
                        <div class="agy-panel-title">
                            <span>🛸 Antigravity 翻譯</span>
                            <span class="agy-model-badge">${this.config.model} (${this.config.effort})</span>
                        </div>
                        <button class="agy-close-btn" id="agy-btn-close-panel" title="收合面板">✕</button>
                    </div>

                    ${
                        this.state.isTranslating
                            ? `
                        <div class="agy-progress-bar-container">
                            <div class="agy-progress-bar-fill"></div>
                        </div>
                        <div class="agy-stats-text">
                            <span>翻譯進度：${percent}%</span>
                            <span>已翻譯 ${this.state.translatedNodes} / ${this.state.totalNodes}</span>
                        </div>
                    `
                            : `
                        <div class="agy-stats-text">
                            <span>${isTranslated ? "✓ 全頁已翻譯完成" : "💤 待命中"}</span>
                            <span>${this.state.translatedNodes}/${this.state.totalNodes} 節點</span>
                        </div>
                    `
                    }

                    ${
                        this.state.lastError
                            ? `<div class="agy-error-message">${this.state.lastError}</div>`
                            : ""
                    }

                    <div class="agy-mode-selector">
                        <button class="agy-mode-btn ${currentMode === "bilingual" ? "active" : ""}" data-mode="bilingual">雙語對照</button>
                        <button class="agy-mode-btn ${currentMode === "replace" ? "active" : ""}" data-mode="replace">直接替換</button>
                        <button class="agy-mode-btn ${currentMode === "hover" ? "active" : ""}" data-mode="hover">懸停提示</button>
                    </div>

                    ${
                        isTranslated
                            ? `<button class="agy-action-btn agy-btn-restore" id="agy-btn-toggle">↩️ 還原原始頁面</button>`
                            : `<button class="agy-action-btn agy-btn-primary" id="agy-btn-toggle">🌐 翻譯此頁面</button>`
                    }
                </div>

                <div class="agy-floating-ball ${ballClass}" id="agy-floating-ball" title="Antigravity 翻譯器 (點擊展開 / 拖曳調整位置)">
                    ${badgeContent}
                </div>
            </div>
        `;
    }

    /**
     * 綁定 Shadow DOM 內部元件之滑鼠與點擊事件
     */
    private bindEvents(): void {
        const ball = this.shadow.getElementById("agy-floating-ball");
        const closeBtn = this.shadow.getElementById("agy-btn-close-panel");
        const toggleBtn = this.shadow.getElementById("agy-btn-toggle");
        const modeButtons = this.shadow.querySelectorAll(".agy-mode-btn");

        if (ball) {
            // 滑鼠點擊與拖曳
            ball.addEventListener("mousedown", (e: MouseEvent) => {
                this.isDragging = false;
                this.startY = e.clientY;
                this.startBottom = this.currentBottom;

                const onMouseMove = (moveEvt: MouseEvent): void => {
                    const deltaY = this.startY - moveEvt.clientY;
                    if (Math.abs(deltaY) > 4) {
                        this.isDragging = true;
                        this.currentBottom = Math.max(20, Math.min(window.innerHeight - 80, this.startBottom + deltaY));
                        const container = this.shadow.querySelector(".agy-container") as HTMLElement | null;
                        if (container) {
                            container.style.bottom = `${this.currentBottom}px`;
                        }
                    }
                };

                const onMouseUp = (): void => {
                    window.removeEventListener("mousemove", onMouseMove);
                    window.removeEventListener("mouseup", onMouseUp);
                    if (!this.isDragging) {
                        this.isExpanded = !this.isExpanded;
                        this.render();
                        this.bindEvents();
                    }
                };

                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                this.isExpanded = false;
                this.render();
                this.bindEvents();
            });
        }

        if (toggleBtn) {
            toggleBtn.addEventListener("click", () => {
                if (this.onToggleTranslate) {
                    this.onToggleTranslate();
                }
            });
        }

        modeButtons.forEach((btn) => {
            btn.addEventListener("click", (e: Event) => {
                const target = e.currentTarget as HTMLElement;
                const mode = target.dataset.mode as DisplayMode;
                if (mode && this.onSwitchDisplayMode) {
                    this.onSwitchDisplayMode(mode);
                }
            });
        });
    }
}

// ============================================================================
// 2. 選取文字翻譯氣泡卡片 (SelectionTooltipWidget)
// ============================================================================

/**
 * 劃詞反白選取文字即時翻譯氣泡元件
 */
export class SelectionTooltipWidget {
    private host: HTMLElement;
    private shadow: ShadowRoot;
    private isVisible = false;
    private currentText = "";

    /** 請求翻譯單一文字的回呼 */
    public onTranslateRequested?: (text: string) => Promise<{ translation: string; error?: string }>;

    constructor() {
        const existingHost = document.getElementById(SELECTION_WIDGET_HOST_ID);
        if (existingHost) {
            existingHost.remove();
        }

        this.host = document.createElement("div");
        this.host.id = SELECTION_WIDGET_HOST_ID;
        this.host.style.position = "fixed";
        this.host.style.top = "0";
        this.host.style.left = "0";
        this.host.style.width = "0";
        this.host.style.height = "0";
        this.host.style.zIndex = "2147483647";
        this.host.style.pointerEvents = "none";

        this.shadow = this.host.attachShadow({ mode: "open" });
        (document.body || document.documentElement).appendChild(this.host);
    }

    /**
     * 在反白選取區域附近顯示「🚀 譯」觸發按鈕
     *
     * @param x - 視窗橫座標
     * @param y - 視窗縱座標
     * @param text - 選取的字串
     */
    public showTrigger(x: number, y: number, text: string): void {
        this.currentText = text;
        this.isVisible = true;

        const clampedX = Math.max(10, Math.min(window.innerWidth - 60, x + 8));
        const clampedY = Math.max(10, Math.min(window.innerHeight - 50, y - 36));

        const css = `
            .agy-trigger-btn {
                position: fixed;
                left: ${clampedX}px;
                top: ${clampedY}px;
                pointer-events: auto;
                background: #1e1b4b;
                color: #ffffff;
                border: 1px solid #6366f1;
                border-radius: 18px;
                padding: 4px 10px;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
                display: flex;
                align-items: center;
                gap: 4px;
                animation: agy-fade-in 0.15s ease-out;
                user-select: none;
                transition: transform 0.15s ease, background 0.15s ease;
            }
            .agy-trigger-btn:hover {
                background: #312e81;
                transform: scale(1.05);
            }
            @keyframes agy-fade-in {
                from { opacity: 0; transform: scale(0.8); }
                to { opacity: 1; transform: scale(1); }
            }
        `;

        this.shadow.innerHTML = `
            <style>${css}</style>
            <button class="agy-trigger-btn" id="agy-trigger-btn">
                <span>🚀 譯</span>
            </button>
        `;

        const btn = this.shadow.getElementById("agy-trigger-btn");
        if (btn) {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.showCard(x, y, text);
            });
        }
    }

    /**
     * 展開深色毛玻璃翻譯卡片並執行翻譯
     */
    public async showCard(x: number, y: number, text: string): Promise<void> {
        this.currentText = text;
        this.isVisible = true;

        const cardWidth = 320;
        const clampedX = Math.max(15, Math.min(window.innerWidth - cardWidth - 20, x - 20));
        const clampedY = Math.max(15, Math.min(window.innerHeight - 240, y + 10));

        const renderCard = (status: "loading" | "done" | "error", translationText = "", errorMsg = "") => {
            const css = `
                .agy-card-wrapper {
                    position: fixed;
                    left: ${clampedX}px;
                    top: ${clampedY}px;
                    width: ${cardWidth}px;
                    background: rgba(15, 17, 26, 0.95);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid rgba(99, 102, 241, 0.3);
                    border-radius: 12px;
                    padding: 12px 14px;
                    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08);
                    color: #f8fafc;
                    pointer-events: auto;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    animation: agy-card-pop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
                    user-select: text;
                }
                @keyframes agy-card-pop {
                    from { opacity: 0; transform: scale(0.92) translateY(6px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                .agy-card-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    padding-bottom: 8px;
                    margin-bottom: 10px;
                    user-select: none;
                }
                .agy-card-title {
                    font-size: 12px;
                    font-weight: 700;
                    color: #c7d2fe;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .agy-card-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .agy-icon-btn {
                    background: transparent;
                    border: none;
                    color: #94a3b8;
                    cursor: pointer;
                    font-size: 13px;
                    padding: 2px 4px;
                    border-radius: 4px;
                }
                .agy-icon-btn:hover {
                    color: #ffffff;
                    background: rgba(255, 255, 255, 0.1);
                }
                .agy-card-body {
                    font-size: 13px;
                    line-height: 1.5;
                    color: #e2e8f0;
                    max-height: 200px;
                    overflow-y: auto;
                    white-space: pre-wrap;
                }
                .agy-loading-box {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: #94a3b8;
                    font-size: 12px;
                }
                .agy-spinner {
                    width: 14px;
                    height: 14px;
                    border: 2px solid rgba(99, 102, 241, 0.2);
                    border-top-color: #6366f1;
                    border-radius: 50%;
                    animation: agy-spin 0.8s linear infinite;
                }
                @keyframes agy-spin {
                    to { transform: rotate(360deg); }
                }
                .agy-error-box {
                    color: #f87171;
                    font-size: 12px;
                    background: rgba(239, 68, 68, 0.1);
                    padding: 6px 8px;
                    border-radius: 6px;
                }
            `;

            this.shadow.innerHTML = `
                <style>${css}</style>
                <div class="agy-card-wrapper" id="agy-card-wrapper">
                    <div class="agy-card-header">
                        <div class="agy-card-title">
                            <span>🛸 Antigravity CLI 翻譯</span>
                        </div>
                        <div class="agy-card-actions">
                            ${
                                status === "done"
                                    ? `<button class="agy-icon-btn" id="agy-btn-copy" title="複製譯文">📋</button>`
                                    : ""
                            }
                            <button class="agy-icon-btn" id="agy-btn-close" title="關閉">✕</button>
                        </div>
                    </div>
                    <div class="agy-card-body">
                        ${
                            status === "loading"
                                ? `
                            <div class="agy-loading-box">
                                <div class="agy-spinner"></div>
                                <span>正在連線 Antigravity CLI 翻譯中...</span>
                            </div>
                        `
                                : status === "error"
                                ? `
                            <div class="agy-error-box">⚠️ ${errorMsg || "翻譯失敗"}</div>
                        `
                                : translationText
                        }
                    </div>
                </div>
            `;

            const closeBtn = this.shadow.getElementById("agy-btn-close");
            if (closeBtn) {
                closeBtn.addEventListener("click", () => this.hide());
            }

            const copyBtn = this.shadow.getElementById("agy-btn-copy");
            if (copyBtn) {
                copyBtn.addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(translationText);
                        copyBtn.textContent = "✓ 已複製";
                        setTimeout(() => {
                            if (copyBtn) copyBtn.textContent = "📋";
                        }, 1800);
                    } catch {
                        // 忽略複製錯誤
                    }
                });
            }
        };

        // 1. 呈現載入狀態
        renderCard("loading");

        // 2. 觸發翻譯回呼
        if (this.onTranslateRequested) {
            try {
                const res = await this.onTranslateRequested(text);
                if (res.translation) {
                    renderCard("done", res.translation);
                } else {
                    renderCard("error", "", res.error || "未能取得翻譯結果");
                }
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                renderCard("error", "", errMsg);
            }
        }
    }

    /**
     * 隱藏氣泡與卡片
     */
    public hide(): void {
        this.isVisible = false;
        this.shadow.innerHTML = "";
    }

    /**
     * 銷毀宿主節點
     */
    public destroy(): void {
        this.host.remove();
    }
}
