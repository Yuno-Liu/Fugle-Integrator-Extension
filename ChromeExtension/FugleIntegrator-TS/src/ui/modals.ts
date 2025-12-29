/**
 * ============================================================================
 * 🔐 Token 與搜尋 Modal 模組 - TypeScript 版本
 * ============================================================================
 *
 * 本模組負責創建和管理彈出式視窗（Modal）元件：
 * 1. Token 設置 Modal - 設定 finmindtrade API Token
 * 2. 搜尋 Modal - 搜尋概念股/產業/集團/個股
 *
 * 📌 設計模式：
 * - 單例模式：同一時間只允許一個 Modal 存在
 * - 動態創建：Modal 在需要時才創建 DOM
 * - 事件委派：統一處理點擊事件
 *
 * 📌 使用情境：
 * - Token Modal: 從資訊卡選單開啟
 * - 搜尋 Modal: 從資訊卡選單開啟
 *
 * 📌 依賴：
 * - constants.ts: Token 相關常量
 * - helpers.ts: setVolumeApiToken 函式
 * - database.ts: 股票資料庫查詢
 */

import { VOLUME_API_TOKEN_KEY, DEFAULT_VOLUME_TOKEN } from "../config/constants";
import { setVolumeApiToken } from "../utils/helpers";
import { getStockDatabase, getRelatedStocks, loadStockDatabase } from "../services/database";

/**
 * InitCallback - 初始化回調類型
 *
 * 用於在搜尋結果點擊後觸發頁面重新渲染。
 * 通常傳入 content.ts 的 initInfoCard 函式。
 */
type InitCallback = () => void;

// ============================================================================
// 🔑 Token 設置 Modal
// ============================================================================

/**
 * createTokenSettingModal - 創建 Token 設置彈出窗口
 *
 * 顯示一個模態視窗，讓用戶輸入或重置 finmindtrade API Token。
 * Token 用於查詢成交量數據。
 *
 * 📌 功能：
 * 1. 顯示當前已設定的 Token（若有）
 * 2. 保存新的 Token 到 localStorage
 * 3. 重置為預設 Token
 * 4. 取消操作
 *
 * 📌 DOM 結構：
 * - #fugle-token-modal: 遮罩層
 * - .token-modal-content: 內容容器
 * - #token-input: Token 輸入框
 * - #token-status: 狀態訊息區
 *
 * 📌 事件處理：
 * - 點擊遮罩層關閉 Modal
 * - 點擊關閉按鈕關閉 Modal
 * - 保存成功後自動關閉
 */
export function createTokenSettingModal(): void {
    // 移除已存在的 Modal（確保單例）
    const existing = document.getElementById("fugle-token-modal");
    if (existing) existing.remove();

    // 創建 Modal DOM 結構
    const modal = document.createElement("div");
    modal.id = "fugle-token-modal";
    modal.innerHTML = `
        <div class="token-modal-content">
            <div class="token-modal-header">
                <span style="font-size: 18px; font-weight: bold;">🔑 設定成交量 API Token</span>
                <span class="close-btn" style="cursor: pointer; font-size: 24px;">×</span>
            </div>
            <div class="token-modal-body">
                <div style="margin-bottom: 12px; font-size: 12px; color: #aaa;">
                    <p>成交量數據需要使用 finmindtrade API Token。你可以在 <a href="https://finmindtrade.com/" target="_blank" style="color: #6366f1; text-decoration: underline;">finmindtrade.com</a> 申請免費帳戶並獲取 Token。</p>
                </div>
                <input type="password" id="token-input" placeholder="輸入你的 finmindtrade API Token..." style="width: 100%; padding: 10px; margin-bottom: 12px; background: #1e1e1e; border: 1px solid #444; border-radius: 4px; color: #fff; box-sizing: border-box;">
                <div style="display: flex; gap: 8px;">
                    <button id="save-token-btn" style="flex: 1; padding: 8px; background: #6366f1; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">保存 Token</button>
                    <button id="reset-token-btn" style="flex: 1; padding: 8px; background: #444; color: #aaa; border: none; border-radius: 4px; cursor: pointer;">使用默認</button>
                    <button id="cancel-token-btn" style="flex: 1; padding: 8px; background: #333; color: #aaa; border: 1px solid #444; border-radius: 4px; cursor: pointer;">取消</button>
                </div>
                <div id="token-status" style="margin-top: 12px; padding: 8px; border-radius: 4px; background: rgba(99, 102, 241, 0.1); color: #6366f1; font-size: 12px; display: none;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 取得各元素的參照
    const closeBtn = modal.querySelector(".close-btn") as HTMLElement;
    const saveBtn = modal.querySelector("#save-token-btn") as HTMLButtonElement;
    const resetBtn = modal.querySelector("#reset-token-btn") as HTMLButtonElement;
    const cancelBtn = modal.querySelector("#cancel-token-btn") as HTMLButtonElement;
    const tokenInput = modal.querySelector("#token-input") as HTMLInputElement;
    const tokenStatus = modal.querySelector("#token-status") as HTMLElement;

    // 如果已有 Token，預填到輸入框
    const currentToken = localStorage.getItem(VOLUME_API_TOKEN_KEY);
    if (currentToken) {
        tokenInput.value = currentToken;
    }

    // === 事件監聽器 ===

    // 關閉 Modal
    closeBtn.addEventListener("click", () => modal.remove());
    cancelBtn.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.remove(); // 點擊遮罩層關閉
    });

    // 保存 Token
    saveBtn.addEventListener("click", () => {
        const token = tokenInput.value.trim();
        if (!token) {
            tokenStatus.textContent = "❌ Token 不能為空";
            tokenStatus.style.display = "block";
            return;
        }
        setVolumeApiToken(token); // 儲存到 localStorage
        tokenStatus.textContent = "✅ Token 已保存成功";
        tokenStatus.style.display = "block";
        setTimeout(() => modal.remove(), 1500); // 延遲關閉
    });

    // 重置為預設 Token
    resetBtn.addEventListener("click", () => {
        localStorage.removeItem(VOLUME_API_TOKEN_KEY);
        tokenInput.value = DEFAULT_VOLUME_TOKEN;
        tokenStatus.textContent = "✅ 已重置為默認 Token";
        tokenStatus.style.display = "block";
        setTimeout(() => modal.remove(), 1500);
    });
}

// ============================================================================
// 🔍 搜尋 Modal
// ============================================================================

/**
 * handleSearch - 處理搜尋功能的入口
 *
 * 確保股票資料庫已載入，然後創建搜尋視窗。
 *
 * @param lastUrl - 當前頁面 URL（用於判斷是否需要重新渲染）
 * @param setLastUrl - 設定 lastUrl 的函式
 * @param setLastStockId - 設定 lastStockId 的函式
 * @param initCallback - 重新渲染的回調函式
 *
 * 📌 流程：
 * 1. 檢查資料庫是否已載入
 * 2. 若未載入，執行載入
 * 3. 創建搜尋 Modal
 */
export async function handleSearch(lastUrl: string, setLastUrl: (url: string) => void, setLastStockId: (id: string | null) => void, initCallback: InitCallback): Promise<void> {
    const db = getStockDatabase();
    if (!db) {
        await loadStockDatabase(); // 確保資料庫已載入
    }
    createSearchModal(lastUrl, setLastUrl, setLastStockId, initCallback);
}

/**
 * createSearchModal - 創建搜尋視窗
 *
 * 顯示一個模態視窗，讓用戶搜尋概念股、產業、集團或個股。
 * 支援即時搜尋和結果導航。
 *
 * @param lastUrl - 當前頁面 URL
 * @param setLastUrl - 設定 lastUrl 的函式
 * @param setLastStockId - 設定 lastStockId 的函式
 * @param initCallback - 重新渲染的回調函式
 *
 * 📌 搜尋邏輯：
 * 1. 個股：匹配股票代碼或名稱
 * 2. 分類：匹配概念/產業/集團名稱
 * 3. 結果依股本排序（大到小）
 *
 * 📌 結果類型標籤：
 * - 個股：藍色標籤
 * - 概念：紫色標籤
 * - 產業：橙色標籤
 * - 集團：綠色標籤
 */
function createSearchModal(lastUrl: string, setLastUrl: (url: string) => void, setLastStockId: (id: string | null) => void, initCallback: InitCallback): void {
    // 移除已存在的 Modal
    const existing = document.getElementById("fugle-search-modal");
    if (existing) existing.remove();

    // 創建 Modal DOM 結構
    const modal = document.createElement("div");
    modal.id = "fugle-search-modal";
    modal.innerHTML = `
        <div class="search-modal-content">
            <div class="search-header">
                <span style="font-size: 18px; font-weight: bold;">🔍 搜尋概念股/產業/集團</span>
                <span class="close-btn" style="cursor: pointer; font-size: 24px;">×</span>
            </div>
            <div class="search-body">
                <input type="text" id="category-search-input" placeholder="輸入關鍵字 (例如: AI, 半導體, 台積電集團)..." autofocus>
                <div id="search-results"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 關閉按鈕事件
    const closeBtnEl = modal.querySelector(".close-btn") as HTMLElement;
    closeBtnEl.onclick = () => modal.remove();
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove(); // 點擊遮罩層關閉
    };

    // 取得輸入框和結果容器
    const input = modal.querySelector("#category-search-input") as HTMLInputElement;
    const resultsContainer = modal.querySelector("#search-results") as HTMLElement;

    // 自動聚焦輸入框
    setTimeout(() => input.focus(), 100);

    // 即時搜尋：輸入時觸發
    input.addEventListener("input", () => {
        const keyword = input.value.trim().toLowerCase();
        if (!keyword) {
            resultsContainer.innerHTML = "";
            return;
        }

        const stockDatabase = getStockDatabase();
        if (!stockDatabase) return;

        const categories = stockDatabase.categories || [];
        const basicInfo = stockDatabase.basicInfo || [];

        // === 搜尋分類（去重） ===
        const matchedCategories = categories
            .filter((c) => c.分類名稱.toLowerCase().includes(keyword))
            .reduce((acc, curr) => {
                const key = `${curr.分類類型}-${curr.分類名稱}`;
                if (!acc.has(key)) {
                    acc.set(key, {
                        type: curr.分類類型,
                        name: curr.分類名稱,
                        kind: "category" as const,
                    });
                }
                return acc;
            }, new Map<string, { type: string; name: string; kind: "category" }>());

        // === 搜尋個股（依股本排序，最多 20 筆） ===
        const matchedStocks = basicInfo
            .filter((s) => s.股票代碼.includes(keyword) || s.股票名稱.toLowerCase().includes(keyword))
            .sort((a, b) => (b["股本_億元"] || 0) - (a["股本_億元"] || 0))
            .slice(0, 20)
            .map((s) => ({
                type: "個股",
                name: `${s.股票名稱} (${s.股票代碼})`,
                code: s.股票代碼,
                kind: "stock" as const,
            }));

        // 合併結果：個股優先顯示
        const categoryResults = Array.from(matchedCategories.values());
        const allResults = [...matchedStocks, ...categoryResults];

        // 無結果時顯示提示
        if (allResults.length === 0) {
            resultsContainer.innerHTML = `<div style="padding: 10px; color: #888;">找不到相關結果</div>`;
            return;
        }

        // 渲染搜尋結果列表
        resultsContainer.innerHTML = allResults
            .map((r) => {
                if (r.kind === "stock") {
                    // 個股項目：點擊後導航到股票頁面
                    return `
                        <div class="search-result-item stock-item" data-code="${r.code}">
                            <span class="result-tag tag-stock">個股</span>
                            <span class="result-name">${r.name}</span>
                        </div>
                    `;
                } else {
                    // 分類項目：點擊後顯示該分類的所有股票
                    return `
                        <div class="search-result-item category-item" data-type="${r.type}" data-name="${r.name}">
                            <span class="result-tag ${r.type === "概念" ? "tag-concept" : r.type === "產業" ? "tag-industry" : "tag-group"}">${r.type}</span>
                            <span class="result-name">${r.name}</span>
                        </div>
                    `;
                }
            })
            .join("");

        // === 分類項目點擊事件 ===
        resultsContainer.querySelectorAll<HTMLElement>(".category-item").forEach((item) => {
            item.addEventListener("click", () => {
                const type = item.dataset.type as "概念" | "產業" | "集團";
                const name = item.dataset.name || "";
                showCategoryStocksInModal(type, name, resultsContainer, input, lastUrl, setLastUrl, setLastStockId, initCallback);
            });
        });

        // === 個股項目點擊事件 ===
        resultsContainer.querySelectorAll<HTMLElement>(".stock-item").forEach((item) => {
            item.addEventListener("click", () => {
                const code = item.dataset.code;
                const href = `/ai/${code}`;
                // 使用 History API 導航（SPA 模式）
                history.pushState({}, "", href);
                window.dispatchEvent(new PopStateEvent("popstate"));
                modal.remove();

                // 觸發頁面重新渲染
                if (location.href !== lastUrl) {
                    setLastUrl(location.href);
                    setLastStockId(null);
                    setTimeout(initCallback, 500);
                }
            });
        });
    });
}

/**
 * showCategoryStocksInModal - 在搜尋視窗中顯示分類股票
 *
 * 當用戶點擊分類結果時，顯示該分類下的所有股票。
 * 支援返回搜尋結果和導航到股票頁面。
 *
 * @param type - 分類類型（概念/產業/集團）
 * @param name - 分類名稱
 * @param container - 結果容器元素
 * @param input - 搜尋輸入框（用於返回時重新觸發搜尋）
 * @param lastUrl - 當前頁面 URL
 * @param setLastUrl - 設定 lastUrl 的函式
 * @param setLastStockId - 設定 lastStockId 的函式
 * @param initCallback - 重新渲染的回調函式
 *
 * 📌 顯示內容：
 * - 分類標題和股票數量
 * - 股票列表（可點擊導航）
 * - 返回按鈕
 */
function showCategoryStocksInModal(type: "概念" | "產業" | "集團", name: string, container: HTMLElement, input: HTMLInputElement, lastUrl: string, setLastUrl: (url: string) => void, setLastStockId: (id: string | null) => void, initCallback: InitCallback): void {
    // 從資料庫取得該分類的相關股票
    const stocks = getRelatedStocks(name, type);

    // 渲染分類詳細頁
    const html = `
        <div style="margin-bottom: 10px;">
            <button class="back-btn" style="background:none; border:none; color:#aaa; cursor:pointer; padding:0; margin-bottom:8px; font-size: 14px;">← 返回搜尋結果</button>
            <div style="font-size: 16px; font-weight: bold; color: #fff; display: flex; align-items: center;">
                <span class="result-tag ${type === "概念" ? "tag-concept" : type === "產業" ? "tag-industry" : "tag-group"}" style="margin-right: 8px;">${type}</span>
                ${name} (${stocks.length})
            </div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; max-height: 400px; overflow-y: auto; padding-right: 4px;">
            ${stocks
                .map(
                    (s) => `
                <a href="/ai/${s.code}" class="stock-chip">
                    <span style="font-weight:bold;">${s.code}</span> ${s.name}
                </a>
            `
                )
                .join("")}
        </div>
    `;

    container.innerHTML = html;

    // 返回按鈕：重新觸發搜尋以顯示之前的結果
    container.querySelector(".back-btn")?.addEventListener("click", () => {
        input.dispatchEvent(new Event("input"));
    });

    // 股票連結點擊事件
    container.querySelectorAll<HTMLAnchorElement>(".stock-chip").forEach((link) => {
        link.addEventListener("click", (e) => {
            e.preventDefault(); // 阻止預設連結行為
            const href = link.getAttribute("href");
            if (href) {
                // 使用 History API 導航
                history.pushState({}, "", href);
                window.dispatchEvent(new PopStateEvent("popstate"));
                document.getElementById("fugle-search-modal")?.remove();

                // 觸發頁面重新渲染
                if (location.href !== lastUrl) {
                    setLastUrl(location.href);
                    setLastStockId(null);
                    setTimeout(initCallback, 500);
                }
            }
        });
    });
}
