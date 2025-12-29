/**
 * Gemini XPath 常數定義
 * 用於定位 Gemini 對話框的輸入框和送出按鈕
 */

/**
 * Gemini 輸入框 XPath
 * 定位到包含使用者輸入提示詞的 <p> 元素
 */
export const INPUT_XPATH = `/html/body/chat-app/main/side-navigation-v2/bard-sidenav-container/bard-sidenav-content/div[2]/div/div[2]/bots-chat-window/chat-window/div/input-container/div/input-area-v2/div/div/div[1]/div/div/rich-textarea/div[1]/p`;

/**
 * Gemini 送出按鈕 XPath
 * 定位到送出訊息的 <button> 元素
 */
export const SEND_BUTTON_XPATH = `/html/body/chat-app/main/side-navigation-v2/bard-sidenav-container/bard-sidenav-content/div[2]/div/div[2]/bots-chat-window/chat-window/div/input-container/div/input-area-v2/div/div/div[3]/div[2]/div[2]/button`;

/**
 * 等待 XPath 元素的超時時間（毫秒）
 */
export const XPATH_TIMEOUT = 10000;

/**
 * 寫入文字後延遲送出的時間（毫秒）
 * 確保送出按鈕狀態已更新
 */
export const SEND_DELAY = 500;
