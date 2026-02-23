/**
 * ============================================================================
 * 🔧 Gemini XPath 常數定義
 * ============================================================================
 *
 * 本模組定義 GeminiUrlPrompt 擴充功能所需的所有常量。
 * 包含 XPath 表達式和時間相關設定。
 *
 * 📌 XPath 說明：
 * Google Gemini 使用 Angular 框架建構，DOM 結構複雜且動態生成。
 * 使用完整的 XPath 路徑而非 CSS 選擇器，是因為：
 * 1. Gemini 的 CSS 類名可能會隨版本更新而變動
 * 2. 元素層級深，CSS 選擇器難以精確定位
 * 3. XPath 可以更精確地描述元素路徑
 *
 * ⚠️ 注意事項：
 * - 這些 XPath 可能會隨 Gemini UI 更新而失效
 * - 若擴充功能失效，需重新檢視並更新這些路徑
 * - 可使用瀏覽器開發者工具的「複製完整 XPath」功能取得新路徑
 */

// ============================================================================
// 📍 XPath 表達式
// ============================================================================

/**
 * INPUT_XPATH - Gemini 輸入框 XPath
 *
 * 定位到包含使用者輸入提示詞的 <p> 元素。
 * 這是 Gemini 對話輸入區域的核心元素。
 *
 * 📌 DOM 結構說明：
 * - chat-app: 主應用容器
 * - side-navigation-v2: 側邊導航容器
 * - bard-sidenav-content: 主內容區
 * - bots-chat-window: 聊天視窗
 * - input-area-v2: 輸入區域
 * - rich-textarea: 富文本輸入框
 * - p: 實際的輸入文字區塊
 */
export const INPUT_XPATH = `/html/body/chat-app/main/side-navigation-v2/bard-sidenav-container/bard-sidenav-content/div[2]/div/div[2]/bots-chat-window/chat-window/div/input-container/fieldset/input-area-v2/div/div/div[1]/div/div/rich-textarea/div[1]/p`;

/**
 * SEND_BUTTON_XPATH - Gemini 送出按鈕 XPath
 *
 * 定位到送出訊息的 <button> 元素。
 * 點擊此按鈕將提交輸入的提示詞。
 *
 * 📌 按鈕狀態：
 * - 當輸入框為空時，按鈕為 disabled
 * - 填入文字後，按鈕變為 enabled
 */
export const SEND_BUTTON_XPATH = `/html/body/chat-app/main/side-navigation-v2/bard-sidenav-container/bard-sidenav-content/div[2]/div/div[2]/bots-chat-window/chat-window/div/input-container/fieldset/input-area-v2/div/div/div[3]/div[2]/div[2]/button`;

// ============================================================================
// ⏱️ 時間相關常量
// ============================================================================

/**
 * XPATH_TIMEOUT - 等待 XPath 元素的超時時間（毫秒）
 *
 * XPath 輪詢的最大等待時間。
 * 若超過此時間仍找不到元素，將拋出錯誤。
 *
 * 📌 設定考量：
 * - Gemini 頁面載入較慢，需要足夠的等待時間
 * - 10 秒足以涵蓋大部分網路環境
 */
export const XPATH_TIMEOUT = 10000;

/**
 * SEND_DELAY - 寫入文字後延遲送出的時間（毫秒）
 *
 * 填入文字到點擊送出按鈕之間的等待時間。
 *
 * 📌 延遲原因：
 * - Angular 需要時間處理 InputEvent
 * - 送出按鈕需要從 disabled 變為 enabled
 * - 過短的延遲可能導致按鈕點擊失敗
 */
export const SEND_DELAY = 500;
