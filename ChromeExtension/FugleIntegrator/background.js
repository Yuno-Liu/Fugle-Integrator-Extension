// background.js

// 監聽來自 content script 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetch") {
        fetchData(request.url, request.headers)
            .then((data) => sendResponse({ success: true, data: data }))
            .catch((error) => sendResponse({ success: false, error: error.toString() }));

        // 返回 true 表示我們會非同步發送回應
        return true;
    }
});

async function fetchData(url, headers = {}) {
    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        // 這裡我們回傳 text，讓 content script 去做 JSON.parse，保持與原本邏輯一致
        const text = await response.text();
        return text;
    } catch (error) {
        console.error("Fetch error:", error);
        throw error;
    }
}
