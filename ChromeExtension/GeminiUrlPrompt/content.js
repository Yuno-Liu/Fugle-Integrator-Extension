(() => {
    "use strict";

    /* ================================
     * 🔗 1️⃣ 取得網址參數 p
     * ================================ */
    const params = new URLSearchParams(window.location.search);
    const message = params.get("p"); // ?p=xxx

    if (!message) {
        return;
    }

    /* ================================
     * 🧭 2️⃣ XPath 定義
     * ================================ */

    // ✍️ 輸入框 <p>
    const INPUT_XPATH = `/html/body/chat-app/main/side-navigation-v2/bard-sidenav-container/bard-sidenav-content/div[2]/div/div[2]/bots-chat-window/chat-window/div/input-container/div/input-area-v2/div/div/div[1]/div/div/rich-textarea/div[1]/p`;

    // 🚀 送出按鈕 <button>
    const SEND_BUTTON_XPATH = `/html/body/chat-app/main/side-navigation-v2/bard-sidenav-container/bard-sidenav-content/div[2]/div/div[2]/bots-chat-window/chat-window/div/input-container/div/input-area-v2/div/div/div[3]/div[2]/div[2]/button`;

    /* ================================
     * 🧰 3️⃣ XPath 工具方法
     * ================================ */
    const getElementByXPath = (xpath) => {
        return document.evaluate(
            xpath, // XPath 字串
            document, // 查詢根節點
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue; // 回傳第一個節點
    };

    /* ================================
     * ⏳ 4️⃣ 等待 XPath 節點出現（SPA / Angular 必備）
     * ================================ */
    const waitForXPath = (xpath, timeout = 10000) => {
        return new Promise((resolve, reject) => {
            const start = Date.now();

            const timer = setInterval(() => {
                const el = getElementByXPath(xpath);
                if (el) {
                    clearInterval(timer);
                    resolve(el);
                } else if (Date.now() - start > timeout) {
                    clearInterval(timer);
                    reject(new Error(`Timeout waiting for XPath: ${xpath}`));
                }
            }, 300);
        });
    };

    /* ================================
     * ✍️ 5️⃣ 寫入文字並送出
     * ================================ */
    (async () => {
        try {
            const inputP = await waitForXPath(INPUT_XPATH);
            const sendBtn = await waitForXPath(SEND_BUTTON_XPATH);

            // ✍️ 寫入網址參數內容
            inputP.textContent = message;

            // 🔑 觸發 input 事件，讓 Angular 感知變更
            inputP.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    inputType: "insertText",
                    data: message,
                })
            );

            // ⏱️ 稍微延遲，確保送出按鈕已啟用
            setTimeout(() => {
                sendBtn.click(); // 🚀 自動送出
                console.log("[Extension] XPath 自動填入並送出完成");
            }, 500);
        } catch (err) {
            console.error("[Extension] 腳本執行失敗:", err);
        }
    })();
})();
