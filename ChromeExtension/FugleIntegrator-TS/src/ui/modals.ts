/**
 * 🔐 Token 與搜尋 Modal 模組 - TypeScript 版本
 */

import { VOLUME_API_TOKEN_KEY, DEFAULT_VOLUME_TOKEN } from "../config/constants";
import { setVolumeApiToken } from "../utils/helpers";
import { getStockDatabase, getRelatedStocks, loadStockDatabase } from "../services/database";

/** 用於觸發重新渲染的回調 */
type InitCallback = () => void;

/**
 * 🔐 創建 Token 設置彈出窗口
 */
export function createTokenSettingModal(): void {
    const existing = document.getElementById("fugle-token-modal");
    if (existing) existing.remove();

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

    const closeBtn = modal.querySelector(".close-btn") as HTMLElement;
    const saveBtn = modal.querySelector("#save-token-btn") as HTMLButtonElement;
    const resetBtn = modal.querySelector("#reset-token-btn") as HTMLButtonElement;
    const cancelBtn = modal.querySelector("#cancel-token-btn") as HTMLButtonElement;
    const tokenInput = modal.querySelector("#token-input") as HTMLInputElement;
    const tokenStatus = modal.querySelector("#token-status") as HTMLElement;

    const currentToken = localStorage.getItem(VOLUME_API_TOKEN_KEY);
    if (currentToken) {
        tokenInput.value = currentToken;
    }

    closeBtn.addEventListener("click", () => modal.remove());
    cancelBtn.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.remove();
    });

    saveBtn.addEventListener("click", () => {
        const token = tokenInput.value.trim();
        if (!token) {
            tokenStatus.textContent = "❌ Token 不能為空";
            tokenStatus.style.display = "block";
            return;
        }
        setVolumeApiToken(token);
        tokenStatus.textContent = "✅ Token 已保存成功";
        tokenStatus.style.display = "block";
        setTimeout(() => modal.remove(), 1500);
    });

    resetBtn.addEventListener("click", () => {
        localStorage.removeItem(VOLUME_API_TOKEN_KEY);
        tokenInput.value = DEFAULT_VOLUME_TOKEN;
        tokenStatus.textContent = "✅ 已重置為默認 Token";
        tokenStatus.style.display = "block";
        setTimeout(() => modal.remove(), 1500);
    });
}

/**
 * 🔍 處理搜尋功能
 */
export async function handleSearch(lastUrl: string, setLastUrl: (url: string) => void, setLastStockId: (id: string | null) => void, initCallback: InitCallback): Promise<void> {
    const db = getStockDatabase();
    if (!db) {
        await loadStockDatabase();
    }
    createSearchModal(lastUrl, setLastUrl, setLastStockId, initCallback);
}

/**
 * 🪟 建立搜尋視窗
 */
function createSearchModal(lastUrl: string, setLastUrl: (url: string) => void, setLastStockId: (id: string | null) => void, initCallback: InitCallback): void {
    const existing = document.getElementById("fugle-search-modal");
    if (existing) existing.remove();

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

    const closeBtnEl = modal.querySelector(".close-btn") as HTMLElement;
    closeBtnEl.onclick = () => modal.remove();
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    const input = modal.querySelector("#category-search-input") as HTMLInputElement;
    const resultsContainer = modal.querySelector("#search-results") as HTMLElement;

    setTimeout(() => input.focus(), 100);

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

        const categoryResults = Array.from(matchedCategories.values());
        const allResults = [...matchedStocks, ...categoryResults];

        if (allResults.length === 0) {
            resultsContainer.innerHTML = `<div style="padding: 10px; color: #888;">找不到相關結果</div>`;
            return;
        }

        resultsContainer.innerHTML = allResults
            .map((r) => {
                if (r.kind === "stock") {
                    return `
                        <div class="search-result-item stock-item" data-code="${r.code}">
                            <span class="result-tag tag-stock">個股</span>
                            <span class="result-name">${r.name}</span>
                        </div>
                    `;
                } else {
                    return `
                        <div class="search-result-item category-item" data-type="${r.type}" data-name="${r.name}">
                            <span class="result-tag ${r.type === "概念" ? "tag-concept" : r.type === "產業" ? "tag-industry" : "tag-group"}">${r.type}</span>
                            <span class="result-name">${r.name}</span>
                        </div>
                    `;
                }
            })
            .join("");

        resultsContainer.querySelectorAll<HTMLElement>(".category-item").forEach((item) => {
            item.addEventListener("click", () => {
                const type = item.dataset.type as "概念" | "產業" | "集團";
                const name = item.dataset.name || "";
                showCategoryStocksInModal(type, name, resultsContainer, input, lastUrl, setLastUrl, setLastStockId, initCallback);
            });
        });

        resultsContainer.querySelectorAll<HTMLElement>(".stock-item").forEach((item) => {
            item.addEventListener("click", () => {
                const code = item.dataset.code;
                const href = `/ai/${code}`;
                history.pushState({}, "", href);
                window.dispatchEvent(new PopStateEvent("popstate"));
                modal.remove();

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
 * 📋 在搜尋視窗中顯示分類股票
 */
function showCategoryStocksInModal(type: "概念" | "產業" | "集團", name: string, container: HTMLElement, input: HTMLInputElement, lastUrl: string, setLastUrl: (url: string) => void, setLastStockId: (id: string | null) => void, initCallback: InitCallback): void {
    const stocks = getRelatedStocks(name, type);

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

    container.querySelector(".back-btn")?.addEventListener("click", () => {
        input.dispatchEvent(new Event("input"));
    });

    container.querySelectorAll<HTMLAnchorElement>(".stock-chip").forEach((link) => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const href = link.getAttribute("href");
            if (href) {
                history.pushState({}, "", href);
                window.dispatchEvent(new PopStateEvent("popstate"));
                document.getElementById("fugle-search-modal")?.remove();

                if (location.href !== lastUrl) {
                    setLastUrl(location.href);
                    setLastStockId(null);
                    setTimeout(initCallback, 500);
                }
            }
        });
    });
}
