/**
 * ============================================================================
 * 🎨 Antigravity Translator - 網頁譯文呈現與視覺樣式管理 (Page Styles)
 * ============================================================================
 *
 * 本模組負責：
 * 1. 注入全站譯文排版 CSS 與 CSS 變數定義 (CSS Variables)
 * 2. 提供 5 種視覺高亮標記風格 (Highlight Styles)
 * 3. 支援原文淡化模式 (Dim Original) 與骨架屏載入動效 (Translating Shimmer)
 * 4. 支援動態更新字體大小、譯文顏色與行間距變數，無須重新載入頁面
 */

import type { TranslatorConfig } from "../types/index.js";

/**
 * 注入至頁面 DOM 的全域樣式標籤 ID
 */
export const TRANSLATOR_STYLE_ID = "agy-translator-page-styles";

/**
 * 產生核心翻譯樣式 CSS 字串
 *
 * @param config - 擴充套件全域設定物件
 * @returns 完整的 CSS 規則字串
 */
function buildCssRules(config: TranslatorConfig): string {
    const fontScale = config.fontSizeScale ?? 0.95;
    const textColor = config.textColor || "#2563EB";
    const spacing = config.bilingualSpacing ?? 4;

    return `
:root {
    --agy-font-scale: ${fontScale};
    --agy-text-color: ${textColor};
    --agy-spacing: ${spacing}px;
}

/* 雙語對照譯文容器區塊 */
.agy-translated-block {
    display: block;
    margin-top: var(--agy-spacing, 4px);
    font-size: calc(1em * var(--agy-font-scale, 0.95));
    color: var(--agy-text-color, #2563EB);
    line-height: 1.5;
    letter-spacing: normal;
    text-align: inherit;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft JhengHei", sans-serif;
    transition: background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
    user-select: text;
}

/* 行內元素的譯文容器 */
span.agy-translated-block,
a.agy-translated-block,
button.agy-translated-block,
label.agy-translated-block {
    display: inline-block;
    vertical-align: baseline;
    margin-left: 4px;
    margin-top: 0;
}

/* 1. 無高亮底色 (None) */
.agy-hl-none {
    background-color: transparent !important;
    border: none !important;
}

/* 2. 微妙半透明柔和底色 (Subtle Background) - 深淺主題自適應 */
.agy-hl-subtle-bg {
    background-color: rgba(99, 102, 241, 0.08);
    border-radius: 4px;
    padding: 2px 6px;
}
@media (prefers-color-scheme: dark) {
    .agy-hl-subtle-bg {
        background-color: rgba(129, 140, 248, 0.16);
    }
}

/* 3. 左側精緻紫色漸層強調邊線 (Left Border) */
.agy-hl-left-border {
    border-left: 3px solid #6366f1;
    padding-left: 8px;
    border-radius: 0 4px 4px 0;
    background-color: rgba(99, 102, 241, 0.03);
}
@media (prefers-color-scheme: dark) {
    .agy-hl-left-border {
        border-left-color: #818cf8;
        background-color: rgba(129, 140, 248, 0.06);
    }
}

/* 4. 虛線底線 (Dashed Underline) */
.agy-hl-dashed-underline {
    text-decoration: underline dashed #6366f1;
    text-underline-offset: 4px;
    text-decoration-thickness: 1.5px;
}
@media (prefers-color-scheme: dark) {
    .agy-hl-dashed-underline {
        text-decoration-color: #818cf8;
    }
}

/* 5. 獨立圓角微卡片框 (Card) */
.agy-hl-card {
    background: #ffffff;
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 6px;
    padding: 6px 10px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}
@media (prefers-color-scheme: dark) {
    .agy-hl-card {
        background: #18181b;
        border-color: rgba(129, 140, 248, 0.25);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
}

/* 原文淡化樣式 (Dim Original) */
.agy-dim-original {
    opacity: 0.62;
    transition: opacity 0.2s ease;
}
.agy-dim-original:hover {
    opacity: 1 !important;
}

/* 懸停模式氣泡容器與浮窗 (Hover Mode) */
.agy-mode-hover-wrapper {
    position: relative;
    cursor: help;
    text-decoration: underline dotted #6366f1;
    text-underline-offset: 3px;
}
.agy-mode-hover-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    background: rgba(15, 23, 42, 0.94);
    backdrop-filter: blur(8px);
    color: #f8fafc;
    font-size: 13px;
    line-height: 1.45;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    white-space: pre-wrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
    z-index: 9999999;
    max-width: 360px;
    width: max-content;
}
.agy-mode-hover-wrapper:hover .agy-mode-hover-tooltip {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(-50%) translateY(0);
}

/* 段落翻譯載入中骨架屏呼吸微光動效 */
@keyframes agy-shimmer {
    0% {
        opacity: 0.35;
        filter: grayscale(80%);
    }
    50% {
        opacity: 0.9;
        filter: grayscale(0%);
    }
    100% {
        opacity: 0.35;
        filter: grayscale(80%);
    }
}
.agy-translating-shimmer {
    animation: agy-shimmer 1.4s infinite ease-in-out !important;
    color: #6366f1 !important;
}

/* 懸停段落選取即時高亮輪廓 */
.agy-hover-inspect-target {
    outline: 2px dashed #6366f1 !important;
    outline-offset: 3px !important;
    cursor: pointer !important;
}
`;
}

/**
 * 注入或更新全站翻譯樣式至目前網頁 head
 *
 * @param config - 擴充套件全域設定物件
 */
export function injectTranslatorStyles(config: TranslatorConfig): void {
    if (typeof document === "undefined") {
        return;
    }

    let styleElement = document.getElementById(TRANSLATOR_STYLE_ID) as HTMLStyleElement | null;
    if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = TRANSLATOR_STYLE_ID;
        (document.head || document.documentElement).appendChild(styleElement);
    }

    styleElement.textContent = buildCssRules(config);
}

/**
 * 動態更新頁面上的 CSS 變數（字體縮放、顏色、間距）
 *
 * 避免整份樣式表重新解析造成畫面閃爍。
 *
 * @param config - 擴充套件全域設定物件
 */
export function updateTranslatorStyleVariables(config: TranslatorConfig): void {
    if (typeof document === "undefined" || !document.documentElement) {
        return;
    }

    const rootStyle = document.documentElement.style;
    if (config.fontSizeScale !== undefined) {
        rootStyle.setProperty("--agy-font-scale", String(config.fontSizeScale));
    }
    if (config.textColor) {
        rootStyle.setProperty("--agy-text-color", config.textColor);
    }
    if (config.bilingualSpacing !== undefined) {
        rootStyle.setProperty("--agy-spacing", `${config.bilingualSpacing}px`);
    }

    // 同步更新 style 標籤以防 CSS 重置
    injectTranslatorStyles(config);
}
