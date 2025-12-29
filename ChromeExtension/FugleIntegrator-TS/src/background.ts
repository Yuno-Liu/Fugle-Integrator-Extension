/**
 * 🔧 Background Service Worker - TypeScript 版本
 * 處理來自 content script 的 fetch 請求
 */

import type { FetchRequestMessage, FetchResponseMessage } from "./types/index";

/**
 * 執行 fetch 請求
 */
async function fetchData(url: string, headers: Record<string, string> = {}): Promise<string> {
    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        return text;
    } catch (error) {
        console.error("Fetch error:", error);
        throw error;
    }
}

/**
 * 監聽來自 content script 的訊息
 */
chrome.runtime.onMessage.addListener((request: FetchRequestMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: FetchResponseMessage) => void): boolean => {
    if (request.action === "fetch") {
        fetchData(request.url, request.headers)
            .then((data) => sendResponse({ success: true, data }))
            .catch((error: Error) => sendResponse({ success: false, error: error.toString() }));

        // 返回 true 表示我們會非同步發送回應
        return true;
    }
    return false;
});
