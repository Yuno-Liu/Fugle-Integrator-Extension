import { PANEL_ID } from "../config/constants.js";
/**
 * 從指定容器中查找指定 CSS 選擇器的元素，若未找到則拋出錯誤
 *
 * @param panel - 容器元素
 * @param selector - CSS 選擇器字串
 * @returns 匹配的 DOM 元素
 * @throws {Error} 當找不到對應選擇器的元素時
 */
function requireElement(panel, selector) {
    const element = panel.querySelector(selector);
    if (!element) {
        throw new Error(`Missing required element: ${selector}`);
    }
    return element;
}
/**
 * 建立統計面板的完整 DOM 節點結構
 * 包含標題列、散戶/大戶門檻下拉選單、結果卡片、進度條以及狀態列
 *
 * @param doc - DOM Document 物件 (預設為全域 document)
 * @returns 建立完成的面板 HTMLDivElement
 */
export function createPanel(doc = document) {
    const panel = doc.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
        <div class="stk-header" id="stk-header">
            <div class="stk-title-wrapper">
                <div class="stk-icon">📊</div>
                <div>
                    <div class="stk-title">持股比例統計</div>
                    <div class="stk-status" id="stk-status">等待 TDCC 資料...</div>
                </div>
            </div>
            <div class="stk-toggle" id="stk-toggle">▼</div>
        </div>
        <div class="stk-body" id="stk-content">
            <div class="stk-row">
                <label class="stk-label">
                    <span>👥 散戶定義</span>
                    <span class="stk-label-hint">≤ 該級距</span>
                </label>
                <select id="retail-lvl" class="stk-select"></select>
            </div>
            <div class="stk-row">
                <label class="stk-label">
                    <span>🏦 大戶定義</span>
                    <span class="stk-label-hint">≥ 該級距</span>
                </label>
                <select id="whale-lvl" class="stk-select"></select>
            </div>
            <div class="stk-result">
                <div class="stk-result-card stk-retail">
                    <div class="stk-result-header">
                        <span class="stk-result-label">👥 散戶合計</span>
                        <span id="res-retail" class="stk-val-num">-- %</span>
                    </div>
                    <div class="stk-progress">
                        <div id="progress-retail" class="stk-progress-bar"></div>
                    </div>
                </div>
                <div class="stk-result-card stk-whale">
                    <div class="stk-result-header">
                        <span class="stk-result-label">🏦 大戶合計</span>
                        <span id="res-whale" class="stk-val-num">-- %</span>
                    </div>
                    <div class="stk-progress">
                        <div id="progress-whale" class="stk-progress-bar"></div>
                    </div>
                </div>
            </div>
            <div class="stk-footer">
                <span id="stk-data-status" class="stk-data-status">尚未取得資料</span>
                <button id="stk-refresh" class="stk-refresh" type="button">↻ 重新計算</button>
            </div>
        </div>
    `;
    return panel;
}
/**
 * 移除畫面上既有的統計面板 (若存在)
 * 用於重新載入或重複初始化時避免畫面出現多個面板
 *
 * @param doc - DOM Document 物件 (預設為全域 document)
 */
export function removeExistingPanel(doc = document) {
    doc.getElementById(PANEL_ID)?.remove();
}
/**
 * 取得並快取面板內部的所有子元素節點參照
 * 方便後續進行事件綁定與數值更新
 *
 * @param panel - 面板容器 DOM
 * @returns 包含所有內部控制項與顯示元件的 PanelElements 物件
 */
export function getPanelElements(panel) {
    return {
        panel,
        header: requireElement(panel, "#stk-header"),
        retailSelect: requireElement(panel, "#retail-lvl"),
        whaleSelect: requireElement(panel, "#whale-lvl"),
        retailResult: requireElement(panel, "#res-retail"),
        whaleResult: requireElement(panel, "#res-whale"),
        retailProgress: requireElement(panel, "#progress-retail"),
        whaleProgress: requireElement(panel, "#progress-whale"),
        status: requireElement(panel, "#stk-status"),
        dataStatus: requireElement(panel, "#stk-data-status"),
        refreshButton: requireElement(panel, "#stk-refresh"),
    };
}
