/**
 * ============================================================================
 * 🔍 XPath 工具函式模組
 * ============================================================================
 *
 * 本模組提供 XPath 相關的 DOM 查詢工具。
 * 專為 Gemini SPA 的異步 DOM 渲染設計。
 *
 * 📌 為什麼使用 XPath：
 * 1. Gemini 是 Angular SPA，DOM 結構複雜
 * 2. CSS 選擇器難以精確定位深層元素
 * 3. XPath 支援更複雜的路徑表達式
 *
 * 📌 模組功能：
 * 1. getElementByXPath - 同步 XPath 查詢
 * 2. waitForXPath - 異步 XPath 輪詢等待
 *
 * 📌 設計考量：
 * - 使用輪詢而非 MutationObserver，因為目標元素可能在多層嵌套中
 * - 提供超時機制避免無限等待
 */

// ============================================================================
// 🔍 XPath 查詢函式
// ============================================================================

/**
 * getElementByXPath - 使用 XPath 表達式取得首個元素
 *
 * 同步查詢 DOM，返回符合 XPath 的第一個元素。
 *
 * @param xpath - XPath 表達式字串
 * @returns 匹配的元素，或 null（若無匹配）
 *
 * 📌 XPath 評估說明：
 * - document.evaluate() 是原生的 XPath API
 * - FIRST_ORDERED_NODE_TYPE 返回第一個匹配的節點
 * - singleNodeValue 取得該節點的參照
 *
 * 📌 使用範例：
 * ```typescript
 * const input = getElementByXPath('//input[@type="text"]');
 * if (input) {
 *     (input as HTMLInputElement).value = 'Hello';
 * }
 * ```
 */
export function getElementByXPath(xpath: string): Element | null {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
}

// ============================================================================
// ⏳ 異步等待函式
// ============================================================================

/**
 * waitForXPath - 等待 XPath 節點出現（帶超時機制）
 *
 * 適用於 SPA/Angular 非同步渲染的場景。
 * 使用輪詢機制持續檢查元素是否存在。
 *
 * @param xpath - 目標 XPath 表達式
 * @param timeout - 超時時間（毫秒），預設 10000
 * @returns Promise<Element> - 解決後得到找到的元素
 * @throws Error - 超時時拋出錯誤
 *
 * 📌 輪詢機制說明：
 * - 每 300ms 執行一次 XPath 查詢
 * - 若找到元素，清除計時器並 resolve
 * - 若超時，清除計時器並 reject
 *
 * 📌 為什麼使用輪詢而非 MutationObserver：
 * - MutationObserver 需要指定觀察的父節點
 * - Gemini 的 DOM 結構深且動態，難以確定父節點
 * - 輪詢更簡單直接，對效能影響可接受
 *
 * 📌 使用範例：
 * ```typescript
 * try {
 *     const button = await waitForXPath('//button[@type="submit"]', 5000);
 *     (button as HTMLButtonElement).click();
 * } catch (error) {
 *     console.error('按鈕未出現');
 * }
 * ```
 */
export function waitForXPath(xpath: string, timeout: number = 10000): Promise<Element> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = 300; // 每 300ms 檢查一次

        const timer = setInterval(() => {
            // 嘗試查詢元素
            const element = getElementByXPath(xpath);

            // 找到元素，成功返回
            if (element) {
                clearInterval(timer);
                resolve(element);
                return;
            }

            // 超時處理
            if (Date.now() - startTime > timeout) {
                clearInterval(timer);
                reject(new Error(`Timeout waiting for XPath: ${xpath}`));
            }
        }, checkInterval);
    });
}
