import { STYLE_ID } from "../config/constants.js";

/**
 * 統計面板的 CSS 樣式定義
 * 包含面板外觀、標題列漸層、下拉選單、進度條動畫及 RWD 響應式佈局
 */
const PANEL_STYLES = `
/* 浮動面板容器主體 */
#stk-helper-panel {
    position: fixed;
    top: 80px;
    right: 20px;
    z-index: 999999;
    width: 300px;
    background: #ffffff;
    border: 1px solid #d9e2f0;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft JhengHei", sans-serif;
    color: #263238;
    overflow: hidden;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
}

#stk-helper-panel:hover {
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16), 0 3px 8px rgba(0, 0, 0, 0.08);
}

/* 標題列區域 */
.stk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: linear-gradient(135deg, #30589c, #4078c5);
    color: #ffffff;
    cursor: pointer;
    user-select: none;
}

.stk-title-wrapper {
    display: flex;
    align-items: center;
    gap: 9px;
}

.stk-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 7px;
    font-size: 15px;
}

.stk-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.3px;
}

.stk-status {
    margin-top: 2px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.78);
}

/* 收合/展開箭頭按鈕 */
.stk-toggle {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    font-size: 13px;
    transition: transform 0.2s ease, background 0.2s ease;
}

.stk-header:hover .stk-toggle {
    background: rgba(255, 255, 255, 0.2);
}

/* 面板內容區域 */
.stk-body {
    padding: 16px;
}

/* 收合狀態樣式 */
#stk-helper-panel.stk-collapsed .stk-body {
    display: none;
}

#stk-helper-panel.stk-collapsed .stk-toggle {
    transform: rotate(-90deg);
}

/* 設定選項列 */
.stk-row {
    margin-bottom: 14px;
}

.stk-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #52616b;
}

.stk-label-hint {
    font-size: 10px;
    font-weight: normal;
    color: #9aa6b2;
}

.stk-select {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    background: #ffffff;
    border: 1px solid #d4dce7;
    border-radius: 7px;
    color: #263238;
    font-size: 13px;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.stk-select:hover {
    border-color: #9fb4d0;
}

.stk-select:focus {
    border-color: #4078c5;
    box-shadow: 0 0 0 3px rgba(64, 120, 197, 0.12);
}

/* 計算結果卡片區域 */
.stk-result {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid #edf0f4;
}

.stk-result-card {
    padding: 11px 10px;
    background: #f7f9fc;
    border: 1px solid #e9eef5;
    border-radius: 8px;
}

.stk-result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}

.stk-result-label {
    font-size: 11px;
    color: #77838f;
}

.stk-val-num {
    font-size: 18px;
    line-height: 1;
    font-weight: 700;
    color: #2077ad;
    transition: color 0.2s ease;
}

.stk-result-card.stk-whale .stk-val-num {
    color: #b45309;
}

/* 進度條外框與填滿條 */
.stk-progress {
    width: 100%;
    height: 7px;
    overflow: hidden;
    background: #e8edf3;
    border-radius: 999px;
}

.stk-progress-bar {
    width: 0%;
    height: 100%;
    border-radius: 999px;
    transform-origin: left center;
    transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
    background: linear-gradient(90deg, #4f8edc, #2077ad);
}

.stk-whale .stk-progress-bar {
    background: linear-gradient(90deg, #d97706, #b45309);
}

/* 進度條數值更新時的脈衝動畫 */
.stk-progress-bar.stk-updated {
    animation: stk-progress-pulse 0.45s ease;
}

@keyframes stk-progress-pulse {
    0% {
        opacity: 0.65;
    }

    50% {
        opacity: 1;
    }

    100% {
        opacity: 1;
    }
}

/* 面板底部列 */
.stk-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
}

.stk-data-status {
    font-size: 10px;
    color: #9aa6b2;
}

.stk-refresh {
    border: 0;
    padding: 6px 9px;
    background: #f0f4f9;
    border-radius: 6px;
    color: #52616b;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
}

.stk-refresh:hover {
    background: #e2eaf3;
}

.stk-refresh:active {
    transform: scale(0.96);
}

/* 小螢幕 RWD 支援 */
@media (max-width: 600px) {
    #stk-helper-panel {
        top: 10px;
        right: 10px;
        left: 10px;
        width: auto;
    }
}
`;

/**
 * 將面板專用樣式注入到頁面 `<head>` 中
 * 會自動檢查是否已注入過，避免重複加入樣式標籤
 * 
 * @param doc - DOM Document 物件 (預設為全域 document)
 */
export function injectStyles(doc: Document = document): void {
    if (doc.getElementById(STYLE_ID) || !doc.head) {
        return;
    }

    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = PANEL_STYLES;
    doc.head.appendChild(style);
}
