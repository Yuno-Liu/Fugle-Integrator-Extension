/**
 * 🚀 富果整合器 Content Script - TypeScript 版本
 * 主入口點
 */

import type { StockBasicInfo, RatingItem, ETFHoldingItem, CapacityItem, TradingVolumeItem, ResultItem, MarketDataCache, CardPosition } from "./types/index";
import { API_URLS, DEBOUNCE_DELAY, CACHE_TTL } from "./config/constants";
import { debounce, cleanNum, formatCurrency, findVal, fetchV2, fetchResult, fetchStockRelation, fetchETFHolding, fetchTradingVolume, fetchMajorBuySell, calculateMajorRatio } from "./utils/helpers";
import { loadStockDatabase, getStockCategories, getRelatedStocks } from "./services/database";
import { injectStyles, injectChainStyles } from "./ui/styles";
import { createLine, createSection, createLinkList, createRelatedStocksHtml, createETFHoldingHtml, createCapacityHtml, createRatingHtml, createMajorContent } from "./ui/components";
import { createTokenSettingModal, handleSearch } from "./ui/modals";

// ==================== 狀態變數 ====================

let lastUrl: string = location.href;
let lastStockId: string | null = null;
let isFetching: boolean = false;
let popupWindow: Window | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let marketDataCache: MarketDataCache | null = null;
let cacheTimestamp: number = 0;
let isDateTimeInitialized: boolean = false;

// ==================== 狀態設定器 ====================

function setLastUrl(url: string): void {
    lastUrl = url;
}

function setLastStockId(id: string | null): void {
    lastStockId = id;
}

// ==================== 日期時間顯示 ====================

function initDateTimeDisplay(): void {
    if (isDateTimeInitialized) return;

    const marketEl = document.querySelector(".tw-market");
    if (!marketEl) return;

    let dateTimeContainer = marketEl.nextElementSibling as HTMLElement | null;
    if (!dateTimeContainer || !dateTimeContainer.id?.startsWith("datetime-display")) {
        dateTimeContainer = document.createElement("div");
        dateTimeContainer.id = "datetime-display-" + Date.now();
        dateTimeContainer.style.cssText = `
            margin-top: 6px;
            padding: 6px 12px;
            background: linear-gradient(135deg, rgba(255, 159, 67, 0.08), rgba(52, 152, 219, 0.08));
            border-left: 3px solid var(--fugle-accent, #ff9f43);
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #aaa;
            font-family: "SF Mono", "Monaco", "Consolas", "Courier New", monospace;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        marketEl.parentElement?.appendChild(dateTimeContainer);
    }

    let showFullDate = false;

    const updateDateTime = (): void => {
        if (!dateTimeContainer) return;
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const hour = String(now.getHours()).padStart(2, "0");
        const minute = String(now.getMinutes()).padStart(2, "0");
        const second = String(now.getSeconds()).padStart(2, "0");

        const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        const weekday = weekdays[now.getDay()];

        if (showFullDate) {
            dateTimeContainer.innerHTML = `
                <span style="color: #ff9f43; font-weight: 600; margin-right: 4px;">📅</span>
                <span style="color: #ddd; font-weight: 600;">${year}</span>
                <span style="color: #888;">-</span>
                <span style="color: #ddd;">${month}</span>
                <span style="color: #888;">-</span>
                <span style="color: #ddd;">${day}</span>
                <span style="color: #888; margin: 0 6px;">|</span>
                <span style="color: #aaa; font-size: 11px;">週${weekday}</span>
                <span style="color: #888; margin: 0 6px;">|</span>
                <span style="color: #ff9f43; font-weight: 600; margin-right: 2px;">🕐</span>
                <span style="color: #ddd; font-weight: 600;">${hour}</span>
                <span style="color: #888;">:</span>
                <span style="color: #ddd; font-weight: 600;">${minute}</span>
                <span style="color: #888;">:</span>
                <span style="color: #ddd;">${second}</span>
            `;
        } else {
            dateTimeContainer.innerHTML = `
                <span style="color: #ff9f43; font-weight: 600; margin-right: 2px;">🕐</span>
                <span style="color: #ddd; font-weight: 600;">${hour}</span>
                <span style="color: #888;">:</span>
                <span style="color: #ddd; font-weight: 600;">${minute}</span>
                <span style="color: #888;">:</span>
                <span style="color: #ddd;">${second}</span>
            `;
        }
    };

    dateTimeContainer.addEventListener("mouseenter", () => {
        showFullDate = true;
        if (dateTimeContainer) {
            dateTimeContainer.style.background = "linear-gradient(135deg, rgba(255, 159, 67, 0.12), rgba(52, 152, 219, 0.12))";
            dateTimeContainer.style.transform = "translateX(2px)";
        }
        updateDateTime();
    });
    dateTimeContainer.addEventListener("mouseleave", () => {
        showFullDate = false;
        if (dateTimeContainer) {
            dateTimeContainer.style.background = "linear-gradient(135deg, rgba(255, 159, 67, 0.08), rgba(52, 152, 219, 0.08))";
            dateTimeContainer.style.transform = "translateX(0)";
        }
        updateDateTime();
    });

    updateDateTime();
    setInterval(updateDateTime, 1000);
    isDateTimeInitialized = true;
}

// ==================== 預估量計算 ====================

function getVolumeMultiplier(): number {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    if (hour === 9) {
        if (minute >= 15 && minute < 20) return 8;
        if (minute >= 20 && minute < 25) return 7.5;
        if (minute >= 25 && minute < 30) return 7;
        if (minute >= 30 && minute < 35) return 5;
        if (minute >= 35 && minute < 40) return 4.75;
        if (minute >= 40 && minute < 45) return 4.5;
        if (minute >= 45 && minute < 50) return 4;
        if (minute >= 50 && minute < 55) return 3.75;
        if (minute >= 55) return 3.5;
    } else if (hour === 10) {
        if (minute < 5) return 3;
        if (minute < 10) return 2.9;
        if (minute < 15) return 2.8;
        if (minute < 20) return 2.5;
        if (minute < 25) return 2.4;
        if (minute < 30) return 2.3;
        if (minute < 35) return 2.2;
        if (minute < 40) return 2.1;
        if (minute < 45) return 2;
        if (minute < 50) return 1.95;
        if (minute < 55) return 1.9;
        return 1.85;
    } else if (hour === 11) {
        if (minute < 5) return 1.8;
        if (minute < 10) return 1.75;
        if (minute < 15) return 1.7;
        if (minute < 20) return 1.68;
        if (minute < 25) return 1.66;
        if (minute < 30) return 1.64;
        if (minute < 35) return 1.6;
        if (minute < 40) return 1.58;
        if (minute < 45) return 1.55;
        if (minute < 50) return 1.52;
        if (minute < 55) return 1.5;
        return 1.48;
    } else if (hour === 12) {
        if (minute < 5) return 1.45;
        if (minute < 10) return 1.42;
        if (minute < 15) return 1.38;
        if (minute < 20) return 1.36;
        if (minute < 25) return 1.34;
        if (minute < 30) return 1.32;
        if (minute < 35) return 1.3;
        if (minute < 40) return 1.28;
        if (minute < 45) return 1.25;
        if (minute < 50) return 1.23;
        if (minute < 55) return 1.22;
        return 1.2;
    } else if (hour === 13) {
        if (minute < 5) return 1.18;
        if (minute < 10) return 1.16;
        if (minute < 15) return 1.13;
        if (minute < 20) return 1.12;
        if (minute < 25) return 1.11;
        if (minute < 30) return 1.1;
        return 1;
    }
    return 1;
}

// ==================== 按鈕選單 ====================

function insertButtonMenu(container: Element | null, stockId: string, market: string | undefined, stockName: string | undefined): void {
    if (!container || document.querySelector("#custom-btn-group")) return;

    const btnContainer = document.createElement("div");
    btnContainer.id = "custom-btn-group";
    btnContainer.style.cssText = `display: flex; align-items: center; gap: 6px; margin-left: 12px; flex-wrap: wrap;`;

    // 預估成交量
    const estimateSpan = document.createElement("span");
    estimateSpan.id = "estimated-volume";
    estimateSpan.style.cssText = "font-size: 13px; color: #f1c40f; margin-left: 8px; font-weight: bold; background: rgba(241, 196, 15, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(241, 196, 15, 0.3);";

    const updateEstimate = (): void => {
        const volumeEl = document.querySelector(".card-group-header__volume span:nth-child(2)");
        if (!volumeEl) return;

        const currentVolume = parseFloat(volumeEl.textContent?.replace(/,/g, "").replace("張", "").trim() || "0");
        if (isNaN(currentVolume)) return;

        const multiplier = getVolumeMultiplier();
        const estimatedVolume = Math.floor(currentVolume * multiplier);
        estimateSpan.textContent = `預估量: ${estimatedVolume.toLocaleString()} 張`;
    };

    updateEstimate();
    const intervalId = setInterval(() => {
        if (!document.body.contains(estimateSpan)) {
            clearInterval(intervalId);
            return;
        }
        updateEstimate();
    }, 1000);

    const volumeTimeContainer = document.querySelector(".card-group-header__volume-and-time");
    if (volumeTimeContainer) {
        volumeTimeContainer.appendChild(estimateSpan);
    } else {
        btnContainer.appendChild(estimateSpan);
    }

    // 按鈕清單
    const links = [
        { name: "🔍 搜尋", val: "search" },
        { name: "📈 WantGoo", val: "wantgoo" },
        { name: "💬 CMoney", val: "cmoney" },
        { name: "📊 TV", val: "tvse" },
        { name: "🏛️ 法人", val: "fubon" },
        { name: "👤 主力", val: "major" },
        { name: "🤖 Gemini", val: "Gemini" },
    ];

    links.forEach((link) => {
        const btn = document.createElement("button");
        btn.textContent = link.name;
        btn.className = "custom-analysis-btn";
        btn.onclick = () => {
            if (link.val === "search") {
                handleSearch(lastUrl, setLastUrl, setLastStockId, initIntegration);
                return;
            }
            let url = "";
            if (link.val === "wantgoo") url = `https://www.wantgoo.com/stock/${stockId}`;
            if (link.val === "cmoney") url = `https://www.cmoney.tw/forum/stock/${stockId}`;
            if (link.val === "tvse") url = `https://tw.tradingview.com/chart/GTx3hMzq/?symbol=${market === "上市" ? "TWSE" : "TPEX"}:${stockId}`;
            if (link.val === "fubon") url = `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl.djhtm?a=${stockId}&b=3`;
            if (link.val === "major") url = `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zco/zco_${stockId}.djhtm`;
            if (link.val === "Gemini") url = `https://gemini.google.com/gem/1QUXOXLuTZt54GwWAClfuBcs7Q4LlFRsc?usp=sharing&p=${stockId}%20${stockName}`;
            if (url) window.open(url, "_blank");
        };
        btnContainer.appendChild(btn);
    });

    // 位置切換按鈕
    const currentPos = (localStorage.getItem("fugle-info-position") || "right") as CardPosition;
    const posBtn = document.createElement("button");
    const getLabel = (p: CardPosition): string => (p === "right" ? "➡️ 靠右" : p === "left" ? "⬅️ 靠左" : "⬇️ 預設");
    posBtn.textContent = getLabel(currentPos);
    posBtn.className = "custom-analysis-btn";
    posBtn.style.marginLeft = "6px";
    posBtn.title = "切換資訊卡顯示位置";
    posBtn.onclick = () => {
        const card = document.querySelector("#stock-info-card") as HTMLElement | null;
        const curr = (localStorage.getItem("fugle-info-position") || "right") as CardPosition;
        let next: CardPosition = "right";
        if (curr === "right") next = "left";
        else if (curr === "left") next = "default";
        else next = "right";

        localStorage.setItem("fugle-info-position", next);
        posBtn.textContent = getLabel(next);

        if (card) {
            card.classList.remove("fixed-mode");
            card.style.left = "";
            card.style.right = "";

            if (next === "default") {
                const targetHeader = document.querySelector(".card-group-header");
                if (targetHeader) targetHeader.appendChild(card);
            } else {
                card.classList.add("fixed-mode");
                if (next === "left") {
                    card.style.left = "20px";
                    card.style.right = "auto";
                } else {
                    card.style.right = "20px";
                    card.style.left = "auto";
                }
                document.body.appendChild(card);
            }
        }
    };
    btnContainer.appendChild(posBtn);

    // 彈出視窗按鈕
    const popoutBtn = document.createElement("button");
    popoutBtn.textContent = "❐ 彈出";
    popoutBtn.className = "custom-analysis-btn";
    popoutBtn.style.marginLeft = "6px";
    popoutBtn.title = "在獨立視窗開啟資訊卡";
    popoutBtn.onclick = () => {
        const card = document.querySelector("#stock-info-card") as HTMLElement | null;
        if (!card) {
            alert("資訊卡尚未載入");
            return;
        }

        if (!popupWindow || popupWindow.closed) {
            popupWindow = window.open("", "StockInfoCard", "width=600,height=955,scrollbars=yes,resizable=yes");
        } else {
            popupWindow.focus();
        }

        if (!popupWindow) {
            alert("請允許彈出視窗以使用此功能");
            return;
        }

        renderPopupContent(popupWindow, card, stockName || "", stockId);
    };
    btnContainer.appendChild(popoutBtn);

    // Token 設置按鈕
    const tokenBtn = document.createElement("button");
    tokenBtn.textContent = "🔑 Token";
    tokenBtn.className = "custom-analysis-btn";
    tokenBtn.style.marginLeft = "6px";
    tokenBtn.title = "設置成交量 API Token";
    tokenBtn.onclick = createTokenSettingModal;
    btnContainer.appendChild(tokenBtn);

    // 顯示/隱藏開關
    const isVisible = localStorage.getItem("fugle-info-visible") !== "false";
    const toggleWrapper = document.createElement("div");
    toggleWrapper.style.cssText = "display: flex; align-items: center; margin-left: 8px;";
    toggleWrapper.innerHTML = `
        <label class="switch" style="margin-bottom: 0;">
            <input type="checkbox" id="info-card-toggle" ${isVisible ? "checked" : ""}>
            <span class="slider round"></span>
        </label>
        <span style="margin-left: 6px; font-size: 12px; color: #ccc; cursor: pointer;" onclick="document.getElementById('info-card-toggle')?.click()">資訊卡</span>
    `;
    btnContainer.appendChild(toggleWrapper);

    setTimeout(() => {
        const checkbox = toggleWrapper.querySelector("#info-card-toggle") as HTMLInputElement | null;
        if (checkbox) {
            checkbox.addEventListener("change", (e) => {
                const checked = (e.target as HTMLInputElement).checked;
                localStorage.setItem("fugle-info-visible", String(checked));
                const card = document.querySelector("#stock-info-card") as HTMLElement | null;
                if (card) card.style.display = checked ? "block" : "none";
            });
        }
    }, 0);

    container.appendChild(btnContainer);
    injectStyles();
}

// ==================== 彈出視窗渲染 ====================

function renderPopupContent(w: Window, card: HTMLElement, stockName: string, stockId: string): void {
    if (!w || !card) return;
    const styles = document.querySelector("#custom-analysis-style")?.textContent || "";
    const chainStyles = document.querySelector("#chain-link-style")?.textContent || "";

    w.document.open();
    w.document.write(`
        <html>
        <head>
            <title>${stockName} (${stockId}) - 資訊卡</title>
            <style>
                body { background-color: #252526; margin: 0; padding: 0; color: #d4d4d4; }
                ${styles}
                ${chainStyles}
                #stock-info-card { 
                    position: static !important; 
                    width: auto !important; 
                    box-shadow: none !important; 
                    border: none !important;
                    margin: 0 !important;
                    max-height: none !important;
                    padding: 16px;
                }
                #toggle-icon { display: none !important; }
                #info-body { display: block !important; }
                #info-summary { display: none !important; }
                #info-header { 
                    pointer-events: none; 
                    border-bottom: 1px solid #333 !important; 
                    padding-bottom: 10px !important; 
                    margin-bottom: 12px !important;
                    position: sticky !important;
                    top: 0;
                    background-color: #252526;
                    z-index: 999;
                    margin-top: -16px !important;
                    padding-top: 16px !important;
                }
                .section-header { 
                    cursor: pointer;
                    position: sticky;
                    top: 75px;
                    background-color: #252526;
                    z-index: 998;
                    padding: 8px 0;
                    border-bottom: 1px solid #333;
                }
            </style>
        </head>
        <body>
            <div id="stock-info-card">
                ${card.innerHTML}
            </div>
        </body>
        </html>
    `);
    w.document.close();

    // 綁定區塊折疊事件
    w.document.querySelectorAll(".collapsible-section").forEach((section) => {
        const sectionHeader = section.querySelector(".section-header") as HTMLElement;
        const sectionBody = section.querySelector(".section-body") as HTMLElement;
        const sectionToggle = section.querySelector(".section-toggle") as HTMLElement;
        const sectionId = (section as HTMLElement).dataset.sectionId;

        sectionHeader?.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = sectionBody.style.display !== "none";
            sectionBody.style.display = isOpen ? "none" : "block";
            sectionHeader.style.marginBottom = isOpen ? "0" : "8px";
            sectionToggle.textContent = isOpen ? "▽" : "△";
            localStorage.setItem(`fugle-section-${sectionId}`, String(!isOpen));
        });
    });

    // 綁定連結點擊事件
    w.document.addEventListener("click", (e) => {
        const link = (e.target as HTMLElement).closest(".sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .concept-link, .industry-link, .group-link") as HTMLAnchorElement | null;
        if (link?.tagName === "A") {
            e.preventDefault();
            const href = link.getAttribute("href");
            if (href) {
                history.pushState({}, "", href);
                window.dispatchEvent(new PopStateEvent("popstate"));
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    setTimeout(initIntegration, 500);
                }
                window.focus();
            }
        }
    });
}

// ==================== 核心渲染邏輯 ====================

async function fetchAndRenderInfo(stockId: string, market: string | undefined, price: string | undefined, stockName: string | undefined): Promise<void> {
    if (isFetching) return;
    isFetching = true;

    try {
        await loadStockDatabase();

        console.log("🔵 開始請求 API 數據，股票代碼:", stockId);
        const [industries, concepts, groups, basicData, ratingData, etfHoldingData, capacityData, majorBuySell1Data, majorBuySell5Data, majorBuySell10Data, majorBuySell20Data, tradingVolumeData] = await Promise.all([
            fetchV2(API_URLS.industry(stockId)),
            fetchV2(API_URLS.concept(stockId)),
            fetchV2(API_URLS.group(stockId)),
            fetchResult<StockBasicInfo>(API_URLS.basic(stockId)),
            fetchResult<RatingItem>(API_URLS.ratings(stockId)),
            fetchETFHolding(API_URLS.etfHolding(stockId)),
            fetchResult<CapacityItem>(API_URLS.capacity(stockId)),
            fetchMajorBuySell(API_URLS.majorBuySell1(stockId)),
            fetchMajorBuySell(API_URLS.majorBuySell5(stockId)),
            fetchMajorBuySell(API_URLS.majorBuySell10(stockId)),
            fetchMajorBuySell(API_URLS.majorBuySell20(stockId)),
            fetchTradingVolume(API_URLS.tradingVolume(stockId)),
        ]);
        console.log("✅ 所有 API 請求完成");

        const currentStockId = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
        if (currentStockId !== stockId) {
            isFetching = false;
            return;
        }

        // 關係企業數據
        const [suppliers, customers, rivals, alliances, investOuts, investIns] = await Promise.all([
            fetchStockRelation(API_URLS.relation(stockId, 0)),
            fetchStockRelation(API_URLS.relation(stockId, 1)),
            fetchStockRelation(API_URLS.relation(stockId, 2)),
            fetchStockRelation(API_URLS.relation(stockId, 3)),
            fetchStockRelation(API_URLS.relation(stockId, 4)),
            fetchStockRelation(API_URLS.relation(stockId, 5)),
        ]);

        const currentStockId2 = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
        if (currentStockId2 !== stockId) {
            isFetching = false;
            return;
        }

        // 全市場數據 (使用緩存)
        let allNetValues: ResultItem[], allPBs: ResultItem[], allEPS: ResultItem[], allPEs: ResultItem[], allYields: ResultItem[], allMargins: ResultItem[], allROEs: ResultItem[], allROAs: ResultItem[];

        const now = Date.now();
        if (marketDataCache && now - cacheTimestamp < CACHE_TTL) {
            ({ allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs } = marketDataCache);
        } else {
            [allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs] = await Promise.all([fetchResult(API_URLS.netValueList), fetchResult(API_URLS.pbRatioList), fetchResult(API_URLS.epsList), fetchResult(API_URLS.peRatioList), fetchResult(API_URLS.yieldList), fetchResult(API_URLS.marginList), fetchResult(API_URLS.roeList), fetchResult(API_URLS.roaList)]);
            marketDataCache = {
                allNetValues,
                allPBs,
                allEPS,
                allPEs,
                allYields,
                allMargins,
                allROEs,
                allROAs,
            };
            cacheTimestamp = now;
        }

        const targetHeader = document.querySelector(".card-group-header");
        if (!targetHeader || !basicData.length) {
            isFetching = false;
            return;
        }

        const info = basicData[0];
        const targetSymbol = `AS${stockId}`;

        // 提取財務指標
        const nav = findVal(allNetValues, targetSymbol);
        const pb = findVal(allPBs, targetSymbol);
        const eps = findVal(allEPS, targetSymbol);
        const pe = findVal(allPEs, targetSymbol);
        const dy = findVal(allYields, targetSymbol);
        const margin = findVal(allMargins, targetSymbol);
        const roe = findVal(allROEs, targetSymbol);
        const roa = findVal(allROAs, targetSymbol);

        const isCollapsed = localStorage.getItem("fugle-info-collapsed") === "true";
        const currPrice = cleanNum(price);

        // 機構評等
        const { ratingHtml } = createRatingHtml(ratingData, currPrice);

        // 關係連結
        const supplierHtml = createLinkList(suppliers, "sup-link");
        const customerHtml = createLinkList(customers, "cus-link");
        const rivalHtml = createLinkList(rivals, "riv-link");
        const allianceHtml = createLinkList(alliances, "all-link");
        const outHtml = createLinkList(investOuts, "out-link");
        const inHtml = createLinkList(investIns, "in-link");

        // ETF 持股
        const etfHoldingHtml = createETFHoldingHtml(etfHoldingData);

        // 產能分析
        const capacityHtml = createCapacityHtml(capacityData);

        // 主力買賣
        const major1Ratio = calculateMajorRatio(majorBuySell1Data, tradingVolumeData, 1);
        const major5Ratio = calculateMajorRatio(majorBuySell5Data, tradingVolumeData, 5);
        const major10Ratio = calculateMajorRatio(majorBuySell10Data, tradingVolumeData, 10);
        const major20Ratio = calculateMajorRatio(majorBuySell20Data, tradingVolumeData, 20);

        // 格式化財務數據
        const marketCap = cleanNum(price) > 0 && cleanNum(info.V3) > 0 ? formatCurrency((cleanNum(price) * cleanNum(info.V3)) / 100000) : "計算中...";

        const rawCapital = parseFloat(info.V3.replace(/,/g, ""));
        const formattedCapital = !isNaN(rawCapital) ? (rawCapital / 10000).toFixed(2) + " 億" : info.V3;

        // 建立卡片
        const infoDiv = document.createElement("div");
        infoDiv.id = "stock-info-card";

        const isCardVisible = localStorage.getItem("fugle-info-visible") !== "false";
        if (!isCardVisible) infoDiv.style.display = "none";

        const cardPosition = (localStorage.getItem("fugle-info-position") || "right") as CardPosition;
        if (cardPosition !== "default") {
            infoDiv.classList.add("fixed-mode");
            if (cardPosition === "left") {
                infoDiv.style.left = "20px";
                infoDiv.style.right = "auto";
            } else {
                infoDiv.style.right = "20px";
                infoDiv.style.left = "auto";
            }
        }

        // 組合內容
        const ratingContent = ratingHtml ? `<div class="info-row"><div class="info-content">${ratingHtml}</div></div>` : null;

        const majorContent = createMajorContent(major1Ratio, major5Ratio, major10Ratio, major20Ratio);

        const financeContent = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                    ${createLine("🏗️", "估值", `BVPS ${nav?.toFixed(2)} ｜ PB ${pb?.toFixed(2)}<br>EPS ${eps?.toFixed(2)} ｜ PE ${pe?.toFixed(2)}`, "#2ecc71", true)}
                    ${createLine("💰", "股利", `殖利率 ${dy?.toFixed(2)}%`, "#ff7f50", true)}
                </div>
                <div>
                    ${createLine("📈", "股本", formattedCapital, "#d4b38c", true)}
                    ${createLine("🪙", "市值", marketCap, "#ffd700", true)}
                </div>
                <div>
                    ${createLine("📊", "獲利", `毛利 ${margin?.toFixed(2)}% <br> ROE ${roe?.toFixed(2)}% ｜ ROA ${roa?.toFixed(2)}%`, "#f1c40f", true)}
                </div>
            </div>`;

        const relationContent = [createLine("🤝", "集團", groups.join(" ｜ "), "#ec3b61", true), createLine("💎", "策略", allianceHtml, "#f78fb3", true), createLine("🚚", "供應商", supplierHtml, "#45aaf2"), createLine("🛒", "客戶", customerHtml, "#a55eea"), createLine("⚔️", "對手", rivalHtml, "#fc5c65")].filter(Boolean).join("") || null;

        const investContent = [createLine("💸", "轉投資", outHtml, "#ff9f43", true), createLine("🛡️", "被投資", inHtml, "#4ecdc4", true)].filter(Boolean).join("") || null;

        const etfContent = etfHoldingHtml ? `<div class="info-row"><div class="info-content" style="color: #7289da; font-weight: 600;">${etfHoldingHtml}</div></div>` : null;

        // 從本地資料庫查詢相關股票
        const dbConceptCategories = getStockCategories(stockId, "概念");
        const dbIndustryCategories = getStockCategories(stockId, "產業");
        const dbGroupCategories = getStockCategories(stockId, "集團");

        const allConceptCategories = [...new Set([...dbConceptCategories, ...concepts])];
        const allIndustryCategories = [...new Set([...dbIndustryCategories, ...industries])];
        const allGroupCategories = [...new Set([...dbGroupCategories, ...groups])];

        let relatedConceptHtml = "";
        let relatedIndustryHtml = "";
        let relatedGroupHtml = "";

        if (allConceptCategories.length > 0) {
            relatedConceptHtml = allConceptCategories.map((cat) => `<div><span style="color: #67ccac; font-weight: 600;">${cat}</span>：${createRelatedStocksHtml(getRelatedStocks(cat, "概念"), "concept-link")}</div>`).join("");
        }

        if (allIndustryCategories.length > 0) {
            relatedIndustryHtml = allIndustryCategories.map((cat) => `<div><span style="color: #76a1fc; font-weight: 600;">${cat}</span>：${createRelatedStocksHtml(getRelatedStocks(cat, "產業"), "industry-link")}</div>`).join("");
        }

        if (allGroupCategories.length > 0) {
            relatedGroupHtml = allGroupCategories.map((cat) => `<div><span style="color: #ec3b61; font-weight: 600;">${cat}</span>：${createRelatedStocksHtml(getRelatedStocks(cat, "集團"), "group-link")}</div>`).join("");
        }

        const relatedContent = [createLine("🔗", "同概念", relatedConceptHtml), createLine("🏭", "同產業", relatedIndustryHtml), createLine("🤝", "同集團", relatedGroupHtml)].filter(Boolean).join("") || null;

        const basicContent = [createLine("💵", "營收", info.V5, "#a17de0ff", true), createLine("🏢", "產業", industries.join(" ｜ "), "#76a1fc"), createLine("💡", "概念", concepts.sort().join(" ｜ "), "#67ccac")].filter(Boolean).join("") || null;

        const capacityContent = capacityHtml ? `<div class="info-row"><div class="info-content" style="color: #e67e22; font-weight: 600;">${capacityHtml}</div></div>` : null;

        // 組合卡片 HTML
        infoDiv.innerHTML = `
            <div id="info-header" style="cursor: pointer; margin-bottom: 12px; border-bottom: 1px solid #333; padding-bottom: 10px; display: flex; align-items: center;">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 16px; font-weight: bold; color: #fff;">${info.V1}</span>
                    <span style="color: var(--fugle-text-muted); font-size: 12px;">📅 ${info.V16} ｜ ${market}</span>
                </div>
                <span id="toggle-icon" style="margin-left: auto; font-size: 12px; color: var(--fugle-primary); background: #2d2d2d; padding: 4px 10px; border-radius: 20px; border: 1px solid #444; transition: 0.2s;">${isCollapsed ? "展開詳情 ▽" : "收起詳情 △"}</span>
            </div>
            <div id="info-body" style="display: ${isCollapsed ? "none" : "block"};">
                ${createSection("basic", "基本資料", "📝", basicContent, true)}
                ${createSection("major", "主力買賣", "💼", majorContent, true)}
                ${createSection("relation", "關係企業", "🔗", relationContent, true)}
                ${createSection("invest", "投資佈局", "💼", investContent, false)}
                ${createSection("rating", "機構評等", "🎯", ratingContent, true)}
                ${createSection("etf", "ETF 持股", "📦", etfContent, false)}
                ${createSection("finance", "財務指標", "💹", financeContent, true)}
                ${createSection("related", "相關個股", "🔍", relatedContent, true)}
                ${createSection("capacity", "產能分析", "🏭", capacityContent, false)}
            </div>
        `;

        // 移除舊卡片並插入新卡片
        document.querySelectorAll("#stock-info-card").forEach((el) => el.remove());
        if (cardPosition === "default") {
            targetHeader.appendChild(infoDiv);
        } else {
            document.body.appendChild(infoDiv);
        }

        // 綁定收合事件
        const header = infoDiv.querySelector("#info-header") as HTMLElement;
        const body = infoDiv.querySelector("#info-body") as HTMLElement;
        const icon = infoDiv.querySelector("#toggle-icon") as HTMLElement;

        header.addEventListener("click", () => {
            const currentlyCollapsed = body.style.display === "none";
            if (currentlyCollapsed) {
                body.style.display = "block";
                icon.textContent = "收起詳情 △";
                localStorage.setItem("fugle-info-collapsed", "false");
            } else {
                body.style.display = "none";
                icon.textContent = "展開詳情 ▽";
                localStorage.setItem("fugle-info-collapsed", "true");
            }
        });

        // 綁定各區塊的折疊事件
        infoDiv.querySelectorAll(".collapsible-section").forEach((section) => {
            const sectionHeader = section.querySelector(".section-header") as HTMLElement;
            const sectionBody = section.querySelector(".section-body") as HTMLElement;
            const sectionToggle = section.querySelector(".section-toggle") as HTMLElement;
            const sectionId = (section as HTMLElement).dataset.sectionId;

            sectionHeader.addEventListener("click", (e) => {
                e.stopPropagation();
                const isOpen = sectionBody.style.display !== "none";
                sectionBody.style.display = isOpen ? "none" : "block";
                sectionHeader.style.marginBottom = isOpen ? "0" : "8px";
                sectionToggle.textContent = isOpen ? "▽" : "△";
                localStorage.setItem(`fugle-section-${sectionId}`, String(!isOpen));
            });
        });

        injectChainStyles();

        if (popupWindow && !popupWindow.closed) {
            renderPopupContent(popupWindow, infoDiv, stockName || "", stockId);
        }
    } catch (e) {
        alert("Fugle Integrator Error: " + (e as Error).message);
        console.error("Fugle Integrator Error:", e);
    } finally {
        isFetching = false;
    }
}

// ==================== 初始化 ====================

function initIntegration(forceRefresh: boolean = false): void {
    const stockId = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
    const price = document.querySelector(".card-group-header__price__price")?.textContent?.trim();
    const market = document.querySelector(".card-group-header__info__market")?.textContent?.trim();
    const stockName = document.querySelector(".stock-name")?.textContent?.trim();
    const container = document.querySelector(".card-group-header__upper-left");

    initDateTimeDisplay();

    if (!stockId) return;

    if (stockId === lastStockId && !forceRefresh && document.querySelector("#stock-info-card")) return;

    if (isFetching) {
        debounce(() => initIntegration(forceRefresh), DEBOUNCE_DELAY)();
        return;
    }

    lastStockId = stockId;

    document.querySelectorAll("#custom-btn-group").forEach((el) => el.remove());
    document.querySelectorAll("#estimated-volume").forEach((el) => el.remove());

    insertButtonMenu(container, stockId, market, stockName);
    fetchAndRenderInfo(stockId, market, price, stockName);
}

// ==================== 事件監聽 ====================

const debouncedInit = debounce(initIntegration, DEBOUNCE_DELAY);

document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest(".sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .relation-link, .concept-link, .industry-link, .group-link") as HTMLAnchorElement | null;
    if (link?.tagName === "A") {
        e.preventDefault();
        const href = link.getAttribute("href");
        if (href) {
            history.pushState({}, "", href);
            window.dispatchEvent(new PopStateEvent("popstate"));
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastStockId = null;
                debouncedInit();
            }
        }
    }
});

let urlCheckInterval: ReturnType<typeof setInterval> | null = null;
const startUrlCheck = (): void => {
    if (urlCheckInterval) return;
    urlCheckInterval = setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            lastStockId = null;
            debouncedInit();
        }
    }, 1000);
};

window.addEventListener("popstate", () => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastStockId = null;
        debouncedInit();
    }
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        if (urlCheckInterval) {
            clearInterval(urlCheckInterval);
            urlCheckInterval = null;
        }
    } else {
        startUrlCheck();
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            lastStockId = null;
            debouncedInit();
        }
    }
});

// 首次載入執行
startUrlCheck();
setTimeout(initIntegration, 800);
