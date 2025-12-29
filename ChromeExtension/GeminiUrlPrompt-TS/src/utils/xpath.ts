/**
 * XPath 工具函式集合
 * 用於 Gemini SPA 的 DOM 查詢和等待
 */

/**
 * 使用 XPath 表達式取得首個元素
 * @param xpath - XPath 字串
 * @returns 匹配的元素或 null
 */
export function getElementByXPath(xpath: string): Element | null {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

/**
 * 等待 XPath 節點出現（帶超時機制）
 * 適用於 SPA/Angular 非同步渲染的場景
 * @param xpath - 目標 XPath
 * @param timeout - 超時時間（毫秒）
 * @returns 返回 Promise，解決後得到找到的元素
 */
export function waitForXPath(xpath: string, timeout: number = 10000): Promise<Element> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = 300; // 每 300ms 檢查一次

        const timer = setInterval(() => {
            const element = getElementByXPath(xpath);

            if (element) {
                clearInterval(timer);
                resolve(element);
                return;
            }

            if (Date.now() - startTime > timeout) {
                clearInterval(timer);
                reject(new Error(`Timeout waiting for XPath: ${xpath}`));
            }
        }, checkInterval);
    });
}
