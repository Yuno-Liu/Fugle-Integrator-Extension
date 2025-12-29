/**
 * ============================================================================
 * 🔧 Background Service Worker - TypeScript 版本
 * ============================================================================
 *
 * 本模組作為 Chrome 擴充功能的背景服務工作者 (Service Worker)，
 * 負責處理來自 Content Script 的網路請求。
 *
 * 📌 設計原因：
 * - Content Script 受到 CORS (跨來源資源共享) 限制，無法直接請求外部 API
 * - Background Script 以擴充功能的權限執行，可繞過 CORS 限制
 * - 透過 Chrome 訊息傳遞機制，Content Script 可委託 Background Script 代為請求
 *
 * 📌 架構模式：
 * [Content Script] --訊息--> [Background Script] --fetch--> [外部 API]
 *                 <--回應--                     <--資料--
 *
 * 📌 相關設定：
 * - manifest.json 中的 host_permissions 需包含目標 API 網域
 * - manifest.json 中的 background.service_worker 指向本檔案編譯後的 JS
 */

import type { FetchRequestMessage, FetchResponseMessage } from "./types/index";

/**
 * ============================================================================
 * 🌐 fetchData - 執行 HTTP GET 請求
 * ============================================================================
 *
 * 使用 Fetch API 向指定 URL 發送 GET 請求，並返回回應文字內容。
 *
 * @param url - 目標 API 的完整 URL
 * @param headers - 可選的 HTTP 請求標頭 (例如 Authorization Token)
 * @returns Promise<string> - 回應的純文字內容
 * @throws Error - 當 HTTP 狀態碼非 2xx 或網路錯誤時拋出例外
 *
 * 📌 注意事項：
 * - 回應以純文字返回，JSON 解析由 Content Script 負責
 * - 這種責任分離使錯誤處理更加集中且可控
 *
 * @example
 * ```typescript
 * const data = await fetchData("https://api.example.com/stock/2330");
 * const json = JSON.parse(data);
 * ```
 */
async function fetchData(url: string, headers: Record<string, string> = {}): Promise<string> {
    try {
        // 發送 GET 請求，附帶可選的自訂標頭
        const response = await fetch(url, { headers });

        // 檢查 HTTP 狀態碼，非 2xx 視為錯誤
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 讀取回應內容為純文字
        // 📌 不在此處解析 JSON，讓 Content Script 保有完整控制權
        const text = await response.text();
        return text;
    } catch (error) {
        // 記錄錯誤以便除錯，然後重新拋出
        console.error("Fetch error:", error);
        throw error;
    }
}

/**
 * ============================================================================
 * 📡 Chrome Runtime 訊息監聽器
 * ============================================================================
 *
 * 監聽來自 Content Script 的訊息，處理 "fetch" 類型的請求。
 *
 * 📌 訊息格式 (FetchRequestMessage)：
 * {
 *   action: "fetch",        // 操作類型識別符
 *   url: string,            // 目標 API URL
 *   headers?: object        // 可選的 HTTP 標頭
 * }
 *
 * 📌 回應格式 (FetchResponseMessage)：
 * 成功時: { success: true, data: "..." }
 * 失敗時: { success: false, error: "..." }
 *
 * 📌 非同步處理：
 * - 返回 true 表示我們將非同步發送回應
 * - Chrome 會保持訊息通道開啟，直到呼叫 sendResponse
 * - 返回 false 或 undefined 會立即關閉通道
 *
 * @param request - 來自 Content Script 的請求訊息
 * @param _sender - 訊息發送者資訊 (未使用，故以底線前綴標記)
 * @param sendResponse - 回應函式，用於將結果傳回 Content Script
 * @returns boolean - true 表示非同步回應，false 表示不處理此訊息
 */
chrome.runtime.onMessage.addListener((request: FetchRequestMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: FetchResponseMessage) => void): boolean => {
    // 檢查訊息類型是否為 "fetch" 請求
    if (request.action === "fetch") {
        // 執行非同步 fetch 操作
        fetchData(request.url, request.headers)
            .then((data) => {
                // 成功時，回傳包含資料的成功回應
                sendResponse({ success: true, data });
            })
            .catch((error: Error) => {
                // 失敗時，回傳包含錯誤訊息的失敗回應
                // 📌 使用 toString() 確保錯誤物件能被序列化傳遞
                sendResponse({ success: false, error: error.toString() });
            });

        // 📌 關鍵：返回 true 告知 Chrome 我們會非同步發送回應
        // 若不返回 true，Chrome 會立即關閉訊息通道，導致 Content Script 收不到回應
        return true;
    }

    // 不處理非 "fetch" 類型的訊息
    return false;
});
