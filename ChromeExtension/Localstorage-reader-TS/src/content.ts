// 💡 監聽來自 Popup 的訊息
interface GetLocalStorageRequest {
    action: "GET_LOCAL_STORAGE";
    key: string;
}

interface GetLocalStorageResponse {
    success: boolean;
    value?: string | null;
    error?: string;
}

chrome.runtime.onMessage.addListener(
    (
        request: GetLocalStorageRequest,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: GetLocalStorageResponse) => void
    ): boolean => {
        if (request.action === "GET_LOCAL_STORAGE") {
            try {
                // 取得目標 Key 的 Value
                const targetValue = window.localStorage.getItem(request.key);

                // 回傳結果
                sendResponse({
                    success: true,
                    value: targetValue,
                });
            } catch (error: any) {
                // 處理跨域或 Storage 被禁用的異常情況
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return true; // 保持通道開啟以支援非同步回傳
    }
);
