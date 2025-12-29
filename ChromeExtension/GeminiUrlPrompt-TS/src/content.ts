/**
 * 🚀 Gemini URL Prompt Content Script - TypeScript 版本
 * 自動讀取網址參數 p 並填入 Gemini 對話框
 *
 * 核心功能：
 * - 提取 URL 參數 ?p= 作為提示詞內容
 * - 使用 XPath 查詢定位 Gemini SPA 的輸入框
 * - 使用輪詢機制等待異步 DOM 渲染完成
 * - 觸發 InputEvent 通知 Angular 模型變更
 * - 自動送出提示詞
 */

import { waitForXPath } from "./utils/xpath";
import { INPUT_XPATH, SEND_BUTTON_XPATH, XPATH_TIMEOUT, SEND_DELAY } from "./utils/constants";

/**
 * ================================
 * 🔗 1️⃣ 取得網址參數 p
 * ================================
 */
function getPromptFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get("p");
}

/**
 * ================================
 * ✍️ 2️⃣ 寫入文字並送出
 * ================================
 */
async function fillAndSendPrompt(message: string): Promise<void> {
    try {
        // 等待輸入框出現
        const inputElement = (await waitForXPath(
            INPUT_XPATH,
            XPATH_TIMEOUT
        )) as HTMLElement;

        // 等待送出按鈕出現
        const sendButton = (await waitForXPath(
            SEND_BUTTON_XPATH,
            XPATH_TIMEOUT
        )) as HTMLButtonElement;

        // ✍️ 寫入網址參數內容
        inputElement.textContent = message;

        // 🔑 觸發 input 事件，讓 Angular 感知變更
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

/**
 * ================================
 * 3️⃣ 主入口
 * ================================
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
