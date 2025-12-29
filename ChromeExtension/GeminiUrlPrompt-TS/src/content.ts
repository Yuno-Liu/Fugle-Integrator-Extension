/**
 * ============================================================================
 * 🚀 Gemini URL Prompt Content Script - TypeScript 版本
 * ============================================================================
 *
 * 本模組是 GeminiUrlPrompt Chrome 擴充功能的核心內容腳本。
 * 用於自動讀取網址參數並填入 Google Gemini 對話框。
 *
 * 📌 核心功能：
 * 1. 提取 URL 參數 ?p= 作為提示詞內容
 * 2. 使用 XPath 查詢定位 Gemini SPA 的輸入框
 * 3. 使用輪詢機制等待異步 DOM 渲染完成
 * 4. 觸發 InputEvent 通知 Angular 模型變更
 * 5. 自動送出提示詞
 *
 * 📌 使用場景：
 * 當用戶訪問 https://gemini.google.com/?p=提示詞 時，
 * 本腳本會自動將「提示詞」填入輸入框並送出。
 *
 * 📌 技術挑戰：
 * - Gemini 是 Angular SPA，DOM 非同步渲染
 * - 需使用 XPath（非 CSS 選擇器）定位元素
 * - 需觸發 InputEvent 讓 Angular 感知輸入變更
 *
 * 📌 相關檔案：
 * - utils/xpath.ts: XPath 查詢和等待工具
 * - utils/constants.ts: XPath 表達式和常量定義
 */

import { waitForXPath } from "./utils/xpath";
import { INPUT_XPATH, SEND_BUTTON_XPATH, XPATH_TIMEOUT, SEND_DELAY } from "./utils/constants";

// ============================================================================
// 🔗 URL 參數處理
// ============================================================================

/**
 * getPromptFromUrl - 從 URL 取得提示詞參數
 *
 * 解析當前頁面 URL 的查詢參數，提取 p 參數值。
 *
 * @returns p 參數值，或 null（若不存在）
 *
 * 📌 URL 格式範例：
 * https://gemini.google.com/?p=台積電(2330)基本面分析
 * => 返回 "台積電(2330)基本面分析"
 */
function getPromptFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get("p");
}

// ============================================================================
// ✍️ 自動填入與送出
// ============================================================================

/**
 * fillAndSendPrompt - 寫入文字並自動送出
 *
 * 找到 Gemini 的輸入框，填入訊息，然後點擊送出按鈕。
 *
 * @param message - 要填入的提示詞訊息
 *
 * 📌 執行流程：
 * 1. 等待輸入框 DOM 元素出現
 * 2. 等待送出按鈕 DOM 元素出現
 * 3. 設定輸入框的 textContent
 * 4. 觸發 InputEvent（讓 Angular 感知變更）
 * 5. 延遲後點擊送出按鈕
 *
 * 📌 為什麼需要 InputEvent：
 * Angular 透過事件監聽來更新資料綁定。
 * 單純修改 textContent 不會觸發 Angular 的變更偵測。
 * 必須手動 dispatch InputEvent 才能讓表單狀態同步。
 *
 * 📌 為什麼需要延遲：
 * 填入文字後，送出按鈕需要時間從 disabled 變為 enabled。
 * 延遲確保按鈕可被點擊。
 */
async function fillAndSendPrompt(message: string): Promise<void> {
    try {
        // 等待輸入框出現（使用 XPath 輪詢）
        const inputElement = (await waitForXPath(INPUT_XPATH, XPATH_TIMEOUT)) as HTMLElement;

        // 等待送出按鈕出現
        const sendButton = (await waitForXPath(SEND_BUTTON_XPATH, XPATH_TIMEOUT)) as HTMLButtonElement;

        // ✍️ 寫入網址參數內容
        inputElement.textContent = message;

        // 🔑 觸發 input 事件，讓 Angular 感知變更
        // 必須設定 bubbles: true 讓事件向上冒泡
        inputElement.dispatchEvent(
            new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                // @ts-ignore - inputType 不是標準 InputEventInit 屬性，但 Gemini 需要
                inputType: "insertText",
                data: message,
            })
        );

        // ⏱️ 延遲確保送出按鈕已啟用
        setTimeout(() => {
            sendButton.click();
            console.log("[Gemini Extension] XPath 自動填入並送出完成");
        }, SEND_DELAY);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[Gemini Extension] 腳本執行失敗:", errorMessage);
    }
}

// ============================================================================
// 🏁 主入口（IIFE）
// ============================================================================

/**
 * 主入口 - 立即執行的異步函式
 *
 * 腳本載入時自動執行，檢查 URL 參數並觸發自動填入。
 *
 * 📌 執行條件：
 * - 頁面 URL 必須包含 ?p= 參數
 * - 若無參數則靜默跳過
 */
(async (): Promise<void> => {
    const message = getPromptFromUrl();

    if (!message) {
        console.log("[Gemini Extension] 未找到 URL 參數 p，跳過");
        return;
    }

    console.log("[Gemini Extension] 發現提示詞:", message);
    await fillAndSendPrompt(message);
})();
