// ==UserScript==
// @name         富果整合器 - 產業鏈全視圖
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  整合富果頁面，自動抓取產業鏈、機構評等、財務指標等外部數據並優化 UI 顯示
// @author       Yuno.liu
// @match        https://www.fugle.tw/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=fugle.tw
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    "use strict";

    // 儲存最後一次的 URL，用於偵測頁面跳轉（富果是 SPA）
    let lastUrl = location.href;
    // 儲存最後處理的股票代碼，避免重複渲染相同股票
    let lastStockId = null;
    // 渲染鎖定開關，防止重複觸發 API 請求
    let isFetching = false;
    // 儲存彈出視窗引用
    let popupWindow = null;
    // 防抖動計時器
    let debounceTimer = null;
    // 請求超時時間 (毫秒)
    const FETCH_TIMEOUT = 8000;
    // 防抖動延遲 (毫秒)
    const DEBOUNCE_DELAY = 500;
    // 全市場數據緩存 (避免重複請求大量數據)
    let marketDataCache = null;
    // 緩存過期時間 (30 分鐘)
    const CACHE_TTL = 30 * 60 * 1000;
    let cacheTimestamp = 0;
    // 本地 JSON 資料庫（概念股、產業、集團）
    let stockDatabase = null;
    // 日期時間顯示已初始化標誌
    let isDateTimeInitialized = false;

    /**
     * 🔧 防抖動函式：避免短時間內重複觸發
     */
    const debounce = (fn, delay) => {
        return (...args) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => fn(...args), delay);
        };
    };

    /**
     * 📚 初始化本地 JSON 資料庫（來自 stock-data.js）
     */
    function loadStockDatabase() {
        if (!stockDatabase && typeof STOCK_DATA !== "undefined") {
            stockDatabase = STOCK_DATA;
            console.log("✅ Stock database loaded:", stockDatabase.basicInfo.length, "stocks,", stockDatabase.categories.length, "categories");
        }
        return stockDatabase;
    }

    /**
     * 🔍 查詢該股票所屬的概念股/產業/集團
     * @param {string} stockId - 股票代碼
     * @param {string} categoryType - 查詢類型: "概念", "產業", "集團"
     * @returns {string[]} 相關分類清單
     */
    function getStockCategories(stockId, categoryType) {
        if (!stockDatabase) return [];

        const categories = stockDatabase.categories || [];
        const matching = categories.filter((cat) => cat.股票代碼 === stockId && cat.分類類型 === categoryType);

        return matching.map((cat) => cat.分類名稱).filter((v, i, a) => a.indexOf(v) === i); // 去重
    }

    /**
     * 🔍 查詢同分類的相關股票
     * @param {string} categoryName - 分類名稱 (如 "AI", "半導體" 等)
     * @param {string} categoryType - 分類類型: "概念", "產業", "集團"
     * @param {number} limit - 最多返回幾筆記錄 (可選)
     * @returns {Object[]} 相關股票清單 [{code, name}]
     */
    function getRelatedStocks(categoryName, categoryType, limit = null) {
        if (!stockDatabase) return [];

        const categories = stockDatabase.categories || [];
        const basicInfo = stockDatabase.basicInfo || [];

        const stockIds = categories.filter((cat) => cat.分類類型 === categoryType && cat.分類名稱 === categoryName).map((cat) => cat.股票代碼);

        // 去重
        let unique = [...new Set(stockIds)];

        // 取得股票名稱與股本
        let stocks = unique
            .map((id) => {
                const info = basicInfo.find((b) => b.股票代碼 === id);
                return {
                    code: id,
                    name: info?.股票名稱 || "未知",
                    capital: info?.["股本_億元"] || 0,
                };
            })
            .filter((v) => v.name !== "未知");

        // 依股本由大到小排序
        stocks.sort((a, b) => b.capital - a.capital);

        // 限制數量
        if (limit) stocks = stocks.slice(0, limit);

        return stocks;
    }

    /**
     * 🏢 生成可點擊的相關股票 HTML
     */
    function createRelatedStocksHtml(stocks, className = "relation-link") {
        if (!stocks || stocks.length === 0) return "";

        return stocks.map((stock) => `<a class="${className}" href="/ai/${stock.code}">${stock.name}(${stock.code})</a>`).join('<span style="color: #444; margin: 0 4px;">•</span>');
    }

    // --- 🛠️ API 配置：定義外部數據源路徑 ---
    const API_URLS = {
        // 產業分類數據
        industry: (id) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/12/d4/7f/twstockdata.xdjjson?x=Stock-Basic0006-1&a=AS${id}`,
        // 概念股數據
        concept: (id) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/d3/2e/ee/twstockdata.xdjjson?x=Stock-Basic0006-2&a=AS${id}&b=XQ`,
        // 集團數據
        group: (id) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/7a/00/dd/twstockdata.xdjjson?x=Stock-Basic0006-3&a=AS${id}&b=XQ`,
        // 股票基本資料（含股本、營收等）
        basic: (id) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b8/58/f9/twstockdata.xdjjson?x=Stock-Basic0001&a=AS${id}`,

        // 📊 公司互動關係系列 (b 參數定義關係類型)
        // 0:供應商, 1:客戶, 2:對手, 3:策略聯盟, 4:轉投資, 5:被投資
        relation: (id, type) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/default/twstockdata.xdjjson?x=Stock-Basic0007&a=${id}.TW&b=${type}`,

        // 🎯 機構評等數據 (包含日期、機構、評等、目標價)
        ratings: (id) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/cf/9a/42/twstockdata.xdjjson?x=Stock-others0001&a=AS${id}`,

        // 全市場財務指標清單 API (用於比對當前個股在市場中的位置)
        netValueList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/fe/5f/27/twstockdata.xdjjson?x=stock-basic0001a&a=2`, // 每股淨值
        pbRatioList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/67/25/75/twstockdata.xdjjson?x=stock-basic0001a&a=1`, // 股價淨值比
        epsList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/ec/64/28/twstockdata.xdjjson?x=stock-basic0001a&a=4`, // EPS
        peRatioList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/6f/4c/4a/twstockdata.xdjjson?x=stock-basic0001a&a=3`, // 本益比
        yieldList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/dd/6c/c1/twstockdata.xdjjson?x=stock-basic0001a&a=9`, // 殖利率
        marginList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/94/36/d5/twstockdata.xdjjson?x=stock-basic0001a&a=5`, // 毛利率
        roeList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/4f/88/14/twstockdata.xdjjson?x=stock-basic0001a&a=7`, // ROE
        roaList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/5b/b4/ce/twstockdata.xdjjson?x=stock-basic0001a&a=6`, // ROA

        // 📦 ETF 持股數據 (findbillion)
        etfHolding: (id) => `https://www.findbillion.com/api/strategy/v2/strategy/etf_hold_reverse/?stock_country=tw&stock_symbol=${id}`,

        // 🏭 產能分析數據 (工廠位置、規格、數量、單位)
        capacity: (id) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/28/97/4b/twstockdata.xdjjson?x=Stock-Basic0008-1&a=${id}.TW`,
    };

    /**
     * � 初始化日期時間更新
     */
    const initDateTimeDisplay = () => {
        // 防止重複初始化定時器
        if (isDateTimeInitialized) return;

        const marketEl = document.querySelector(".tw-market");
        if (!marketEl) return;

        // 檢查是否已經添加過日期時間顯示
        let dateTimeContainer = marketEl.nextElementSibling;
        if (!dateTimeContainer || !dateTimeContainer.id?.startsWith("datetime-display")) {
            // 創建日期時間容器
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

        // 是否顯示完整日期
        let showFullDate = false;

        // 更新日期時間
        const updateDateTime = () => {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const day = String(now.getDate()).padStart(2, "0");
            const hour = String(now.getHours()).padStart(2, "0");
            const minute = String(now.getMinutes()).padStart(2, "0");
            const second = String(now.getSeconds()).padStart(2, "0");

            // 獲取星期幾
            const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
            const weekday = weekdays[now.getDay()];

            if (showFullDate) {
                // 懸停時顯示完整日期
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
                // 默認只顯示時分秒
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

        // 添加懸停事件：顯示完整日期
        dateTimeContainer.addEventListener("mouseenter", () => {
            showFullDate = true;
            dateTimeContainer.style.background = "linear-gradient(135deg, rgba(255, 159, 67, 0.12), rgba(52, 152, 219, 0.12))";
            dateTimeContainer.style.transform = "translateX(2px)";
            updateDateTime();
        });
        dateTimeContainer.addEventListener("mouseleave", () => {
            showFullDate = false;
            dateTimeContainer.style.background = "linear-gradient(135deg, rgba(255, 159, 67, 0.08), rgba(52, 152, 219, 0.08))";
            dateTimeContainer.style.transform = "translateX(0)";
            updateDateTime();
        });

        updateDateTime();
        // 每秒更新一次（僅初始化一次）
        setInterval(updateDateTime, 1000);
        isDateTimeInitialized = true;
    };

    /**
     * 🚀 初始化整合器：從富果頁面 DOM 抓取當前股票資訊並觸發渲染
     */
    const initIntegration = (forceRefresh = false) => {
        // 抓取股票代號、價格、市場類型、名稱等資訊
        const stockId = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
        const price = document.querySelector(".card-group-header__price__price")?.textContent?.trim();
        const market = document.querySelector(".card-group-header__info__market")?.textContent?.trim();
        const stockName = document.querySelector(".stock-name")?.textContent?.trim();
        const container = document.querySelector(".card-group-header__upper-left");

        // 初始化日期時間顯示
        initDateTimeDisplay();

        // 如果沒抓到代號則跳過
        if (!stockId) return;

        // 如果股票代碼相同且非強制刷新，則跳過（避免重複渲染）
        if (stockId === lastStockId && !forceRefresh && document.querySelector("#stock-info-card")) return;

        // 如果正在請求中，設定防抖動延遲後重試
        if (isFetching) {
            debounce(() => initIntegration(forceRefresh), DEBOUNCE_DELAY)();
            return;
        }

        // 更新最後處理的股票代碼
        lastStockId = stockId;

        // 清除舊有的 UI 元素，避免重複顯示
        document.querySelectorAll("#custom-btn-group").forEach((el) => el.remove());
        document.querySelectorAll("#estimated-volume").forEach((el) => el.remove());

        // 插入自定義按鈕選單與渲染詳細資訊卡片
        insertButtonMenu(container, stockId, market, stockName);
        fetchAndRenderInfo(stockId, market, price, stockName);
    };

    /**
     * 🌐 核心邏輯：併行請求所有外部數據並生成專業 UI 卡片
     */
    async function fetchAndRenderInfo(stockId, market, price, stockName) {
        // 防止重複請求
        if (isFetching) return;
        isFetching = true;

        try {
            // 加載本地 JSON 資料庫（概念股、產業、集團）
            loadStockDatabase();

            // 第一批：個股相關數據（較小、較快）
            const [industries, concepts, groups, basicData, ratingData, etfHoldingData, capacityData] = await Promise.all([fetchV2(API_URLS.industry(stockId)), fetchV2(API_URLS.concept(stockId)), fetchV2(API_URLS.group(stockId)), fetchResult(API_URLS.basic(stockId)), fetchResult(API_URLS.ratings(stockId)), fetchETFHolding(API_URLS.etfHolding(stockId)), fetchResult(API_URLS.capacity(stockId))]);

            // 檢查頁面是否已切換（避免渲染過時數據）
            const currentStockId = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
            if (currentStockId !== stockId) {
                isFetching = false;
                return;
            }

            // 第二批：關係企業數據
            const [suppliers, customers, rivals, alliances, investOuts, investIns] = await Promise.all([
                fetchStockRelation(API_URLS.relation(stockId, 0)),
                fetchStockRelation(API_URLS.relation(stockId, 1)),
                fetchStockRelation(API_URLS.relation(stockId, 2)),
                fetchStockRelation(API_URLS.relation(stockId, 3)),
                fetchStockRelation(API_URLS.relation(stockId, 4)),
                fetchStockRelation(API_URLS.relation(stockId, 5)),
            ]);

            // 再次檢查頁面是否已切換
            const currentStockId2 = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
            if (currentStockId2 !== stockId) {
                isFetching = false;
                return;
            }

            // 第三批：全市場數據（使用緩存）
            let allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs;

            const now = Date.now();
            if (marketDataCache && now - cacheTimestamp < CACHE_TTL) {
                // 使用緩存
                ({ allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs } = marketDataCache);
            } else {
                // 重新請求並緩存
                [allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs] = await Promise.all([fetchResult(API_URLS.netValueList), fetchResult(API_URLS.pbRatioList), fetchResult(API_URLS.epsList), fetchResult(API_URLS.peRatioList), fetchResult(API_URLS.yieldList), fetchResult(API_URLS.marginList), fetchResult(API_URLS.roeList), fetchResult(API_URLS.roaList)]);
                marketDataCache = { allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs };
                cacheTimestamp = now;
            }

            const targetHeader = document.querySelector(".card-group-header");
            if (!targetHeader || !basicData.length) {
                isFetching = false;
                return;
            }

            // --- 🔧 資料處理與過濾 ---
            const info = basicData[0];
            const targetSymbol = `AS${stockId}`;

            // 輔助函式：數值清理與格式化
            const cleanNum = (val) => parseFloat(String(val).replace(/,/g, "")) || 0;

            // 輔助函式：從全市場清單中找出當前個股的數值
            const findVal = (list) => {
                const item = list.find((i) => i.V1 === targetSymbol);
                return item ? parseFloat(item.V2.replace(/,/g, "")) : null;
            };

            // 提取各項財務指標
            const nav = findVal(allNetValues),
                pb = findVal(allPBs),
                eps = findVal(allEPS),
                pe = findVal(allPEs),
                dy = findVal(allYields),
                margin = findVal(allMargins),
                roe = findVal(allROEs),
                roa = findVal(allROAs);

            // 讀取使用者偏好的卡片收合狀態
            const isCollapsed = localStorage.getItem("fugle-info-collapsed") === "true";

            // 🎯 機構評等處理：僅顯示近 6 個月內的數據
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

            const recentRatings = ratingData.filter((r) => {
                const d = new Date(r.V1);
                return !isNaN(d) && d >= sixMonthsAgo;
            });

            // 計算目標價統計資訊
            const prices = recentRatings.map((r) => parseFloat(String(r.V4).replace(/,/g, ""))).filter((p) => !isNaN(p));
            const currPrice = cleanNum(price);

            const getDiff = (target) => {
                if (!currPrice) return "";
                const diff = (((target - currPrice) / currPrice) * 100).toFixed(1);
                const color = diff >= 0 ? "#ff4d4f" : "#52c41a"; // 正值紅色，負值綠色
                return `<span style="color: ${color}; font-size: 12px; margin-left: 2px; font-weight: bold;">(${diff >= 0 ? "+" : ""}${diff}%)</span>`;
            };

            const maxP = prices.length > 0 ? Math.max(...prices) : 0;
            const minP = prices.length > 0 ? Math.min(...prices) : 0;
            const avgP = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

            const ratingSummary =
                prices.length > 0
                    ? `<div style="margin-bottom: 8px; padding: 8px; background: rgba(255, 159, 67, 0.1); border-radius: 6px; border: 1px dashed var(--fugle-accent);">
                    <span style="color: var(--fugle-accent); font-weight: bold;">📊 近 6 個月目標價統計：<br/></span>
                    最高 <span style="color: #fff;">${maxP}</span>${getDiff(maxP)} ｜
                    最低 <span style="color: #fff;">${minP}</span>${getDiff(minP)} ｜
                    平均 <span style="color: #fff;">${avgP.toFixed(2)}</span>${getDiff(avgP)}
                   </div>`
                    : "";

            // 生成評等標籤 HTML
            const ratingHtml =
                recentRatings.length > 0
                    ? ratingSummary +
                      `<div style="display: flex; flex-wrap: wrap;">` +
                      recentRatings
                          .slice(0, 20)
                          .map(
                              (r, i) => `
                    <span class="rating-tag">
                        <span style="color: #888;">${r.V1}</span> ${r.V2}
                        <span style="color: var(--fugle-accent); font-weight: bold;">${r.V3}</span>
                        <span style="color: #fff;">(${r.V4})</span>
                    </span>`
                          )
                          .join("") +
                      `</div>`
                    : null;

            /**
             * 🔗 生成連結列表 (Helper)：將關係企業轉換為可點擊的富果連結
             */
            const createLinkList = (list, className) => {
                if (!list || list.length === 0) return null;
                return list
                    .map((item) => {
                        const isTW = /(.TW|.TE|.TT)$/.test(item.id);
                        const cleanId = item.id.replace(/\.(TW|TE|TT)/, "");
                        // 如果是台股則生成連結，否則僅顯示文字
                        return isTW ? `<a href="/ai/${cleanId}" class="${className}">${item.name}(${cleanId})</a>` : `<span style="opacity: 0.8;">${item.name}(${cleanId})</span>`;
                    })
                    .join('<span style="color: #444; margin: 0 4px;">•</span>');
            };

            const supplierHtml = createLinkList(suppliers, "sup-link");
            const customerHtml = createLinkList(customers, "cus-link");
            const rivalHtml = createLinkList(rivals, "riv-link");
            const allianceHtml = createLinkList(alliances, "all-link");
            const outHtml = createLinkList(investOuts, "out-link");
            const inHtml = createLinkList(investIns, "in-link");

            /**
             * 📦 生成 ETF 持股列表 HTML
             */
            const createETFHoldingHtml = (etfList) => {
                if (!etfList || etfList.length === 0) return null;

                // 按持股數量排序（由大到小）
                const sortedList = [...etfList].sort((a, b) => (b.stock_holding_stocknum || 0) - (a.stock_holding_stocknum || 0));

                // 計算總持股數量和總占比
                const totalHolding = sortedList.reduce((sum, etf) => sum + (etf.stock_holding_stocknum || 0), 0);
                const totalRatio = sortedList.reduce((sum, etf) => sum + (etf.stock_holding_ratio || 0), 0);

                // 格式化持股張數（1張 = 1000股）
                const formatShares = (num) => {
                    const shares = num / 1000; // 轉換為張數
                    if (shares >= 10000) return (shares / 10000).toFixed(2) + " 萬張";
                    if (shares >= 1) return shares.toFixed(0).toLocaleString() + " 張";
                    return "< 1 張";
                };

                // 統計摘要
                const summary = `<div style="margin-bottom: 8px; padding: 8px; background: rgba(114, 137, 218, 0.1); border-radius: 6px; border: 1px dashed #7289da;">
                    <span style="color: #7289da; font-weight: bold;">📦 共 ${sortedList.length} 檔 ETF 持股：</span>
                    <span style="color: #fff;">合計 ${formatShares(totalHolding)}</span>
                    <span style="color: #7289da;">(占比加總 ${totalRatio.toFixed(2)}%)</span>
                </div>`;

                // 生成 ETF 持股列表
                const etfItems = sortedList
                    .slice(0, 15) // 最多顯示 15 筆
                    .map((etf) => {
                        const symbol = etf.symbol;
                        const name = etf.name || symbol;
                        const ratio = etf.stock_holding_ratio?.toFixed(2) || "0.00";
                        const shares = formatShares(etf.stock_holding_stocknum || 0);

                        return `<a href="/ai/${symbol}" class="etf-link"><span style="font-weight: 600;">${symbol}</span> ${name} <span style="color: #7289da;">${ratio}%</span> <span style="color: #888; font-size: 11px;">${shares}</span></a>`;
                    })
                    .join('<span style="color: #444; margin: 0 4px;">•</span>');

                return summary + `<div style="display: flex; flex-wrap: wrap; gap: 4px;">${etfItems}</div>` + (sortedList.length > 15 ? `<div style="color: #888; font-size: 11px; margin-top: 4px;">...還有 ${sortedList.length - 15} 檔 ETF</div>` : "");
            };

            const etfHoldingHtml = createETFHoldingHtml(etfHoldingData);

            /**
             * 🏭 生成產能分析 HTML
             */
            const createCapacityHtml = (capacityList) => {
                if (!capacityList || capacityList.length === 0) return null;

                // 生成產能表格
                const capacityRows = capacityList
                    .map((item) => {
                        const location = item.V1 || "-";
                        const spec = item.V2 || "-";
                        const quantity = item.V3 || "-";
                        const unit = item.V4 || "";

                        return `<tr style="border-bottom: 1px dashed #333; font-size: 14px;">
                            <td style="color: #e67e22; padding: 4px 8px 4px 0;">${location}</td>
                            <td style="color: #fff; padding: 4px 8px;">${spec}</td>
                            <td style="color: #3498db; font-weight: 600; padding: 4px 8px; text-align: right;">${quantity}</td>
                            <td style="color: #888; padding: 4px 0 4px 8px;">${unit}</td>
                        </tr>`;
                    })
                    .join("");

                return `<table style="margin-top: 4px; border-collapse: collapse; width: 100%;">
                    <thead>
                        <tr style="border-bottom: 1px solid #444; font-size: 11px; color: #666;">
                            <th style="padding: 4px 8px 4px 0; text-align: left; font-weight: normal;">📍 位置</th>
                            <th style="padding: 4px 8px; text-align: left; font-weight: normal;">📋 規格</th>
                            <th style="padding: 4px 8px; text-align: right; font-weight: normal;">📊 數量</th>
                            <th style="padding: 4px 0 4px 8px; text-align: left; font-weight: normal;">📐 單位</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${capacityRows}
                    </tbody>
                </table>`;
            };

            const capacityHtml = createCapacityHtml(capacityData);

            // --- 💰 財務數據格式化 ---

            // 格式化金額為「億」或「兆」
            const formatCurrency = (val100M) => {
                const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return val100M >= 10000 ? fmt.format(val100M / 10000) + " 兆" : fmt.format(val100M) + " 億";
            };

            // 計算市值 (股價 * 股本)
            const marketCap = cleanNum(price) > 0 && cleanNum(info.V3) > 0 ? formatCurrency((cleanNum(price) * cleanNum(info.V3)) / 100000) : "計算中...";

            // 格式化股本
            const rawCapital = parseFloat(info.V3.replace(/,/g, ""));
            const formattedCapital = !isNaN(rawCapital) ? (rawCapital / 10000).toFixed(2) + " 億" : info.V3;

            // --- 🎨 UI 元件構建 ---
            const infoDiv = document.createElement("div");
            infoDiv.id = "stock-info-card";

            // 讀取顯示狀態設定 (預設開啟)
            const isCardVisible = localStorage.getItem("fugle-info-visible") !== "false";
            if (!isCardVisible) infoDiv.style.display = "none";

            // 讀取位置設定 (預設靠右)
            const cardPosition = localStorage.getItem("fugle-info-position") || "right";
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

            // 輔助函式：生成單行資訊 HTML
            const createLine = (emoji, label, content, color = "inherit", isBold = false) => {
                if (!content) return "";
                return `
                    <div class="info-row">
                        <div class="info-label"><span>${emoji}</span>${label}</div>
                        <div class="info-content" style="color: ${color}; ${isBold ? "font-weight: 600;" : ""}">${content}</div>
                    </div>`;
            };

            // 讀取各區塊的折疊狀態
            const getSectionState = (key) => localStorage.getItem(`fugle-section-${key}`) !== "false";

            // 輔助函式：生成可折疊區塊 HTML
            const createSection = (id, title, emoji, content, defaultOpen = true) => {
                if (!content) return "";
                const storedState = localStorage.getItem(`fugle-section-${id}`);
                const actualOpen = storedState === null ? defaultOpen : storedState !== "false";
                return `
                    <div class="info-section collapsible-section" data-section-id="${id}">
                        <div class="section-header" style="cursor: pointer; display: flex; align-items: center; margin-bottom: ${actualOpen ? "8px" : "0"};">
                            <span style="font-weight: 600; color: #aaa;">${emoji} ${title}</span>
                            <span class="section-toggle" style="margin-left: auto; font-size: 10px; color: #666; transition: 0.2s;">${actualOpen ? "△" : "▽"}</span>
                        </div>
                        <div class="section-body" style="display: ${actualOpen ? "block" : "none"};">
                            ${content}
                        </div>
                    </div>`;
            };

            // 組合各區塊內容
            const ratingContent = ratingHtml ? `<div class="info-row"><div class="info-content">${ratingHtml}</div></div>` : null;

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

            // 📚 從本地資料庫查詢相關股票
            const dbConceptCategories = getStockCategories(stockId, "概念");
            const dbIndustryCategories = getStockCategories(stockId, "產業");
            const dbGroupCategories = getStockCategories(stockId, "集團");

            // 合併 API 抓取的分類與本地資料庫的分類
            const allConceptCategories = [...new Set([...dbConceptCategories, ...concepts])];
            const allIndustryCategories = [...new Set([...dbIndustryCategories, ...industries])];
            const allGroupCategories = [...new Set([...dbGroupCategories, ...groups])];

            // 生成相關股票 HTML
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

            const basicContent = [createLine("💵", "營收", info.V5, "#a17de0ff", true), createLine("🏢", "產業", industries.join(" ｜ "), "#76a1fc"), createLine("💡", "概念", concepts.join(" ｜ "), "#67ccac")].filter(Boolean).join("") || null;

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
                <div id="info-summary" style="display: ${isCollapsed ? "block" : "none"};">
                    ${ratingSummary || ""}
                    ${financeContent || ""}
                </div>
                <div id="info-body" style="display: ${isCollapsed ? "none" : "block"};">
                    ${createSection("basic", "基本資料", "📝", basicContent, true)}
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
            const header = infoDiv.querySelector("#info-header");
            const body = infoDiv.querySelector("#info-body");
            const summary = infoDiv.querySelector("#info-summary");
            const icon = infoDiv.querySelector("#toggle-icon");

            header.addEventListener("click", () => {
                const currentlyCollapsed = body.style.display === "none";
                // 切換顯示狀態
                if (currentlyCollapsed) {
                    // 展開：顯示完整內容，隱藏摘要
                    body.style.display = "block";
                    summary.style.display = "none";
                    icon.textContent = "收起詳情 △";
                    localStorage.setItem("fugle-info-collapsed", "false");
                } else {
                    // 收起：隱藏完整內容，顯示摘要
                    body.style.display = "none";
                    summary.style.display = "block";
                    icon.textContent = "展開詳情 ▽";
                    localStorage.setItem("fugle-info-collapsed", "true");
                }
            });

            // 綁定各區塊的折疊事件
            infoDiv.querySelectorAll(".collapsible-section").forEach((section) => {
                const sectionHeader = section.querySelector(".section-header");
                const sectionBody = section.querySelector(".section-body");
                const sectionToggle = section.querySelector(".section-toggle");
                const sectionId = section.dataset.sectionId;

                sectionHeader.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const isOpen = sectionBody.style.display !== "none";
                    sectionBody.style.display = isOpen ? "none" : "block";
                    sectionHeader.style.marginBottom = isOpen ? "0" : "8px";
                    sectionToggle.textContent = isOpen ? "▽" : "△";
                    localStorage.setItem(`fugle-section-${sectionId}`, !isOpen);
                });
            });

            // 注入關係鏈樣式
            injectChainStyles();

            // 如果彈出視窗存在且未關閉，則更新內容
            if (popupWindow && !popupWindow.closed) {
                renderPopupContent(popupWindow, infoDiv, stockName, stockId);
            }
        } catch (e) {
            console.error("Fugle Integrator Error:", e);
        } finally {
            isFetching = false; // 釋放請求鎖定
        }
    }

    // --- ⚙️ 工具函式 ---

    /**
     * 🌐 網路請求封裝 (V2)：處理 esunsec 的 JSONP/JSON 格式，僅返回 V2 欄位清單
     * 加入超時機制避免請求永久掛起
     */
    function fetchV2(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: FETCH_TIMEOUT,
                onload: (res) => {
                    try {
                        resolve(JSON.parse(res.responseText).ResultSet.Result.map((i) => i.V2));
                    } catch {
                        resolve([]);
                    }
                },
                onerror: () => resolve([]),
                ontimeout: () => {
                    console.warn("Fetch timeout for:", url);
                    resolve([]);
                },
            });
        });
    }

    /**
     * 🤝 網路請求封裝 (關係企業)：處理特定的關係鏈數據，返回去重後的 {id, name} 物件
     * 加入超時機制避免請求永久掛起
     */
    function fetchStockRelation(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: FETCH_TIMEOUT,
                onload: (res) => {
                    try {
                        const raw = JSON.parse(res.responseText).ResultSet.Result;
                        const unique = [];
                        const seen = new Set();
                        raw.forEach((item) => {
                            if (!seen.has(item.V6)) {
                                seen.add(item.V6);
                                unique.push({ id: item.V6, name: item.V7 });
                            }
                        });
                        resolve(unique);
                    } catch {
                        resolve([]);
                    }
                },
                onerror: () => resolve([]),
                ontimeout: () => {
                    console.warn("Fetch timeout for:", url);
                    resolve([]);
                },
            });
        });
    }

    /**
     * 📄 網路請求封裝 (原始結果)：直接返回 API 的 Result 陣列
     * 加入超時機制避免請求永久掛起
     */
    function fetchResult(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: FETCH_TIMEOUT,
                onload: (res) => {
                    try {
                        resolve(JSON.parse(res.responseText).ResultSet.Result);
                    } catch {
                        resolve([]);
                    }
                },
                onerror: () => resolve([]),
                ontimeout: () => {
                    console.warn("Fetch timeout for:", url);
                    resolve([]);
                },
            });
        });
    }

    /**
     * 📦 網路請求封裝 (ETF 持股)：處理 findbillion API，返回 ETF 持股清單
     * 加入超時機制避免請求永久掛起
     */
    function fetchETFHolding(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: FETCH_TIMEOUT,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        // findbillion 直接返回陣列
                        resolve(Array.isArray(data) ? data : []);
                    } catch {
                        resolve([]);
                    }
                },
                onerror: () => resolve([]),
                ontimeout: () => {
                    console.warn("Fetch timeout for:", url);
                    resolve([]);
                },
            });
        });
    }

    /**
     * � 處理搜尋功能
     */
    function handleSearch() {
        // 確保資料庫已加載
        loadStockDatabase();

        if (!stockDatabase) {
            alert("資料庫尚未載入，請稍後再試或檢查 stock-data.js 是否已安裝");
            return;
        }
        createSearchModal();
    }

    /**
     * 🪟 建立搜尋視窗
     */
    function createSearchModal() {
        // 如果已存在則移除
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

        // 綁定關閉事件
        modal.querySelector(".close-btn").onclick = () => modal.remove();
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        const input = modal.querySelector("#category-search-input");
        const resultsContainer = modal.querySelector("#search-results");

        // 自動聚焦
        setTimeout(() => input.focus(), 100);

        // 搜尋邏輯
        input.addEventListener("input", (e) => {
            const keyword = e.target.value.trim().toLowerCase();
            if (!keyword) {
                resultsContainer.innerHTML = "";
                return;
            }

            const categories = stockDatabase?.categories || [];
            const basicInfo = stockDatabase?.basicInfo || [];

            // 1. 搜尋分類
            const matchedCategories = categories
                .filter((c) => c.分類名稱.toLowerCase().includes(keyword))
                .reduce((acc, curr) => {
                    const key = `${curr.分類類型}-${curr.分類名稱}`;
                    if (!acc.has(key)) {
                        acc.set(key, { type: curr.分類類型, name: curr.分類名稱, kind: "category" });
                    }
                    return acc;
                }, new Map());

            // 2. 搜尋個股
            const matchedStocks = basicInfo
                .filter((s) => s.股票代碼.includes(keyword) || s.股票名稱.toLowerCase().includes(keyword))
                .sort((a, b) => (b["股本_億元"] || 0) - (a["股本_億元"] || 0))
                .slice(0, 20) // 限制顯示數量
                .map((s) => ({
                    type: "個股",
                    name: `${s.股票名稱} (${s.股票代碼})`,
                    code: s.股票代碼,
                    kind: "stock",
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

            // 綁定分類點擊事件
            resultsContainer.querySelectorAll(".category-item").forEach((item) => {
                item.addEventListener("click", () => {
                    const type = item.dataset.type;
                    const name = item.dataset.name;
                    showCategoryStocksInModal(type, name, resultsContainer);
                });
            });

            // 綁定個股點擊事件
            resultsContainer.querySelectorAll(".stock-item").forEach((item) => {
                item.addEventListener("click", () => {
                    const code = item.dataset.code;
                    // 跳轉到個股頁面
                    const href = `/ai/${code}`;
                    history.pushState({}, "", href);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                    document.getElementById("fugle-search-modal").remove(); // 關閉視窗

                    // 觸發更新
                    if (location.href !== lastUrl) {
                        lastUrl = location.href;
                        lastStockId = null;
                        setTimeout(initIntegration, 500);
                    }
                });
            });
        });
    }

    /**
     * 📋 在搜尋視窗中顯示分類股票
     */
    function showCategoryStocksInModal(type, name, container) {
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

        // 保存當前的搜尋結果 HTML 以便返回
        const input = document.getElementById("category-search-input");

        container.innerHTML = html;

        // 綁定返回按鈕
        container.querySelector(".back-btn").addEventListener("click", () => {
            // 觸發 input 事件以重新渲染搜尋結果
            input.dispatchEvent(new Event("input"));
        });

        // 綁定股票點擊 (SPA 跳轉)
        container.querySelectorAll(".stock-chip").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const href = link.getAttribute("href");
                history.pushState({}, "", href);
                window.dispatchEvent(new PopStateEvent("popstate"));
                document.getElementById("fugle-search-modal").remove(); // 關閉視窗

                // 觸發更新
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    lastStockId = null;
                    setTimeout(initIntegration, 500);
                }
            });
        });
    }

    /**
     * �🛠️ 輔助工具：生成外部分析工具按鈕組
     */
    function insertButtonMenu(container, stockId, market, stockName) {
        if (!container || document.querySelector("#custom-btn-group")) return;
        const btnContainer = document.createElement("div");
        btnContainer.id = "custom-btn-group";
        btnContainer.style.cssText = `display: flex; align-items: center; gap: 6px; margin-left: 12px; flex-wrap: wrap;`;

        // 新增：預估成交量
        const estimateSpan = document.createElement("span");
        estimateSpan.id = "estimated-volume";
        estimateSpan.style.cssText = "font-size: 13px; color: #f1c40f; margin-left: 8px; font-weight: bold; background: rgba(241, 196, 15, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(241, 196, 15, 0.3);";

        const updateEstimate = () => {
            const volumeEl = document.querySelector(".card-group-header__volume span:nth-child(2)");
            if (!volumeEl) return;

            const currentVolume = parseFloat(volumeEl.textContent.replace(/,/g, "").replace("張", "").trim());
            if (isNaN(currentVolume)) return;

            const now = new Date();
            const hour = now.getHours();
            const minute = now.getMinutes();
            let multiplier = 1;

            // Time-based multiplier logic
            if (hour === 9) {
                if (minute >= 15 && minute < 20) multiplier = 8;
                else if (minute >= 20 && minute < 25) multiplier = 7.5;
                else if (minute >= 25 && minute < 30) multiplier = 7;
                else if (minute >= 30 && minute < 35) multiplier = 5;
                else if (minute >= 35 && minute < 40) multiplier = 4.75;
                else if (minute >= 40 && minute < 45) multiplier = 4.5;
                else if (minute >= 45 && minute < 50) multiplier = 4;
                else if (minute >= 50 && minute < 55) multiplier = 3.75;
                else if (minute >= 55) multiplier = 3.5;
            } else if (hour === 10) {
                if (minute < 5) multiplier = 3;
                else if (minute < 10) multiplier = 2.9;
                else if (minute < 15) multiplier = 2.8;
                else if (minute < 20) multiplier = 2.5;
                else if (minute < 25) multiplier = 2.4;
                else if (minute < 30) multiplier = 2.3;
                else if (minute < 35) multiplier = 2.2;
                else if (minute < 40) multiplier = 2.1;
                else if (minute < 45) multiplier = 2;
                else if (minute < 50) multiplier = 1.95;
                else if (minute < 55) multiplier = 1.9;
                else multiplier = 1.85;
            } else if (hour === 11) {
                if (minute < 5) multiplier = 1.8;
                else if (minute < 10) multiplier = 1.75;
                else if (minute < 15) multiplier = 1.7;
                else if (minute < 20) multiplier = 1.68;
                else if (minute < 25) multiplier = 1.66;
                else if (minute < 30) multiplier = 1.64;
                else if (minute < 35) multiplier = 1.6;
                else if (minute < 40) multiplier = 1.58;
                else if (minute < 45) multiplier = 1.55;
                else if (minute < 50) multiplier = 1.52;
                else if (minute < 55) multiplier = 1.5;
                else multiplier = 1.48;
            } else if (hour === 12) {
                if (minute < 5) multiplier = 1.45;
                else if (minute < 10) multiplier = 1.42;
                else if (minute < 15) multiplier = 1.38;
                else if (minute < 20) multiplier = 1.36;
                else if (minute < 25) multiplier = 1.34;
                else if (minute < 30) multiplier = 1.32;
                else if (minute < 35) multiplier = 1.3;
                else if (minute < 40) multiplier = 1.28;
                else if (minute < 45) multiplier = 1.25;
                else if (minute < 50) multiplier = 1.23;
                else if (minute < 55) multiplier = 1.22;
                else multiplier = 1.2;
            } else if (hour === 13) {
                if (minute < 5) multiplier = 1.18;
                else if (minute < 10) multiplier = 1.16;
                else if (minute < 15) multiplier = 1.13;
                else if (minute < 20) multiplier = 1.12;
                else if (minute < 25) multiplier = 1.11;
                else if (minute < 30) multiplier = 1.1;
                else multiplier = 1;
            } else {
                multiplier = 1;
            }

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

        // 嘗試將預估量放入 card-group-header__volume-and-time
        const volumeTimeContainer = document.querySelector(".card-group-header__volume-and-time");
        if (volumeTimeContainer) {
            volumeTimeContainer.appendChild(estimateSpan);
        } else {
            btnContainer.appendChild(estimateSpan);
        }

        // 定義按鈕清單與對應的 URL 生成邏輯
        const links = [
            { name: "� 搜尋", val: "search" },
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
                    handleSearch();
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

        // 新增：位置切換按鈕
        const currentPos = localStorage.getItem("fugle-info-position") || "right";
        const posBtn = document.createElement("button");
        const getLabel = (p) => (p === "right" ? "➡️ 靠右" : p === "left" ? "⬅️ 靠左" : "⬇️ 預設");
        posBtn.textContent = getLabel(currentPos);
        posBtn.className = "custom-analysis-btn";
        posBtn.style.marginLeft = "6px";
        posBtn.title = "切換資訊卡顯示位置";
        posBtn.onclick = () => {
            const card = document.querySelector("#stock-info-card");
            const curr = localStorage.getItem("fugle-info-position") || "right";
            let next = "right";
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

        // 新增：獨立視窗按鈕
        const popoutBtn = document.createElement("button");
        popoutBtn.textContent = "❐ 彈出";
        popoutBtn.className = "custom-analysis-btn";
        popoutBtn.style.marginLeft = "6px";
        popoutBtn.title = "在獨立視窗開啟資訊卡";
        popoutBtn.onclick = () => {
            const card = document.querySelector("#stock-info-card");
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

            renderPopupContent(popupWindow, card, stockName, stockId);
        };
        btnContainer.appendChild(popoutBtn);

        // 新增：顯示/隱藏資訊卡片的滑動開關
        const isVisible = localStorage.getItem("fugle-info-visible") !== "false";
        const toggleWrapper = document.createElement("div");
        toggleWrapper.style.cssText = "display: flex; align-items: center; margin-left: 8px;";
        toggleWrapper.innerHTML = `
            <label class="switch" style="margin-bottom: 0;">
                <input type="checkbox" id="info-card-toggle" ${isVisible ? "checked" : ""}>
                <span class="slider round"></span>
            </label>
            <span style="margin-left: 6px; font-size: 12px; color: #ccc; cursor: pointer;" onclick="document.getElementById('info-card-toggle').click()">資訊卡</span>
        `;
        btnContainer.appendChild(toggleWrapper);

        // 綁定開關事件
        setTimeout(() => {
            const checkbox = toggleWrapper.querySelector("#info-card-toggle");
            if (checkbox) {
                checkbox.addEventListener("change", (e) => {
                    const checked = e.target.checked;
                    localStorage.setItem("fugle-info-visible", checked);
                    const card = document.querySelector("#stock-info-card");
                    if (card) card.style.display = checked ? "block" : "none";
                });
            }
        }, 0);

        container.appendChild(btnContainer);
        injectStyles(); // 注入按鈕樣式
    }

    /**
     * 🪟 渲染彈出視窗內容
     */
    function renderPopupContent(w, card, stockName, stockId) {
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
                    /* Force expand and hide toggle in popup */
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

        // 綁定彈出視窗中各區塊的折疊事件
        w.document.querySelectorAll(".collapsible-section").forEach((section) => {
            const sectionHeader = section.querySelector(".section-header");
            const sectionBody = section.querySelector(".section-body");
            const sectionToggle = section.querySelector(".section-toggle");
            const sectionId = section.dataset.sectionId;

            sectionHeader.addEventListener("click", (e) => {
                e.stopPropagation();
                const isOpen = sectionBody.style.display !== "none";
                sectionBody.style.display = isOpen ? "none" : "block";
                sectionHeader.style.marginBottom = isOpen ? "0" : "8px";
                sectionToggle.textContent = isOpen ? "▽" : "△";
                // 同步到父視窗的 localStorage
                localStorage.setItem(`fugle-section-${sectionId}`, !isOpen);
            });
        });

        // 從父視窗綁定子視窗的點擊事件（繞過 CSP 限制）
        w.document.addEventListener("click", (e) => {
            const link = e.target.closest(".sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .concept-link, .industry-link, .group-link");
            if (link && link.tagName === "A") {
                e.preventDefault();
                const href = link.getAttribute("href");
                if (href) {
                    // 透過父視窗執行 SPA 導航
                    history.pushState({}, "", href);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                    // 更新 lastUrl 並觸發重新渲染
                    if (location.href !== lastUrl) {
                        lastUrl = location.href;
                        setTimeout(initIntegration, 500);
                    }
                    window.focus();
                }
            }
        });
    }

    /**
     * 🎨 注入全域樣式 (CSS-in-JS)
     */
    function injectStyles() {
        if (document.querySelector("#custom-analysis-style")) return;
        const style = document.createElement("style");
        style.id = "custom-analysis-style";
        style.textContent = `
            :root {
                --fugle-bg: #1e1e1e;
                --fugle-card-bg: #252526;
                --fugle-border: #333333;
                --fugle-primary: #6366f1;
                --fugle-text: #d4d4d4;
                --fugle-text-muted: #808080;
                --fugle-accent: #ff9f43;
            }
            #stock-info-card {
                background: var(--fugle-card-bg);
                border: 1px solid var(--fugle-border);
                border-left: 4px solid var(--fugle-primary);
                padding: 16px;
                margin: 12px 0;
                font-family: "Inter", "Segoe UI", "Microsoft JhengHei", sans-serif;
                font-size: 14px;
                border-radius: 8px;
                color: var(--fugle-text);
                box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                line-height: 1.6;
            }
            #stock-info-card.fixed-mode {
                position: fixed;
                top: 100px;
                width: 500px;
                z-index: 9999;
                max-height: 80vh;
                overflow-y: auto;
                margin: 0;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            }
            #stock-info-card.fixed-mode::-webkit-scrollbar { width: 6px; }
            #stock-info-card.fixed-mode::-webkit-scrollbar-track { background: #1e1e1e; }
            #stock-info-card.fixed-mode::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
            #stock-info-card.fixed-mode::-webkit-scrollbar-thumb:hover { background: #555; }
            .info-section {
                margin-bottom: 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid #333;
            }
            .info-section:last-child {
                margin-bottom: 0;
                padding-bottom: 0;
                border-bottom: none;
            }
            .info-row {
                display: flex;
                align-items: flex-start;
                margin-bottom: 6px;
            }
            .info-label {
                width: 70px;
                min-width: 70px;
                color: var(--fugle-text-muted);
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .info-content {
                flex: 1;
                word-break: break-all;
            }
            .rating-tag {
                display: inline-block;
                background: #2d2d2d;
                padding: 2px 8px;
                border-radius: 4px;
                margin-right: 6px;
                margin-bottom: 4px;
                border: 1px solid #444;
                font-size: 12px;
                transition: all 0.2s;
            }
            .rating-tag:hover {
                border-color: var(--fugle-primary);
                background: #333;
            }
            .custom-analysis-btn {
                background: #2d2d2d;
                color: #ccc;
                border: 1px solid #444;
                padding: 5px 12px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                white-space: nowrap;
            }
            .custom-analysis-btn:hover {
                background: var(--fugle-primary);
                border-color: var(--fugle-primary);
                color: #fff;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
            }
            
            /* Toggle Switch Styles */
            .switch { position: relative; display: inline-block; width: 34px; height: 18px; }
            .switch input { opacity: 0; width: 0; height: 0; }
            .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .4s; border-radius: 34px; }
            .slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
            input:checked + .slider { background-color: var(--fugle-primary); }
            input:checked + .slider:before { transform: translateX(16px); }

            /* Search Modal Styles */
            #fugle-search-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 10000;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                padding-top: 100px;
                backdrop-filter: blur(2px);
            }
            .search-modal-content {
                background: #252526;
                width: 500px;
                max-width: 90%;
                border-radius: 8px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                border: 1px solid #444;
                display: flex;
                flex-direction: column;
                max-height: 80vh;
            }
            .search-header {
                padding: 16px;
                border-bottom: 1px solid #333;
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: #fff;
            }
            .close-btn {
                font-size: 24px;
                cursor: pointer;
                color: #888;
                transition: color 0.2s;
            }
            .close-btn:hover { color: #fff; }
            .search-body {
                padding: 16px;
                overflow-y: auto;
            }
            #category-search-input {
                width: 100%;
                padding: 10px;
                background: #1e1e1e;
                border: 1px solid #444;
                border-radius: 4px;
                color: #fff;
                font-size: 16px;
                margin-bottom: 16px;
                box-sizing: border-box;
            }
            #category-search-input:focus {
                outline: none;
                border-color: var(--fugle-primary);
            }
            .search-result-item {
                padding: 10px;
                border-bottom: 1px solid #333;
                cursor: pointer;
                display: flex;
                align-items: center;
                transition: background 0.2s;
            }
            .search-result-item:hover {
                background: #333;
            }
            .result-tag {
                font-size: 12px;
                padding: 2px 6px;
                border-radius: 4px;
                margin-right: 10px;
                font-weight: bold;
                white-space: nowrap;
            }
            .tag-concept { background: rgba(82, 196, 26, 0.2); color: #52c41a; }
            .tag-industry { background: rgba(69, 170, 242, 0.2); color: #45aaf2; }
            .tag-group { background: rgba(236, 59, 97, 0.2); color: #ec3b61; }
            .tag-stock { background: rgba(255, 255, 255, 0.1); color: #fff; border: 1px solid #555; }
            .result-name {
                color: #d4d4d4;
                font-size: 14px;
            }
            .stock-chip {
                display: inline-block;
                background: #333;
                color: #d4d4d4;
                padding: 6px 12px;
                border-radius: 20px;
                text-decoration: none;
                font-size: 13px;
                border: 1px solid #444;
                transition: all 0.2s;
            }
            .stock-chip:hover {
                background: var(--fugle-primary);
                color: #fff;
                border-color: var(--fugle-primary);
                transform: translateY(-1px);
            }

            /* Sticky Headers for Fixed Mode (Ported from Popup) */
            #stock-info-card.fixed-mode #info-header {
                position: sticky;
                top: 0;
                background-color: var(--fugle-card-bg);
                z-index: 20;
                margin-top: -16px;
                padding-top: 16px;
                border-bottom: 1px solid var(--fugle-border);
            }
            #stock-info-card.fixed-mode .section-header {
                position: sticky;
                top: 74px;
                background-color: var(--fugle-card-bg);
                z-index: 15;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 🔗 注入關係鏈連結樣式
     */
    function injectChainStyles() {
        if (document.querySelector("#chain-link-style")) return;
        const style = document.createElement("style");
        style.id = "chain-link-style";
        style.textContent = `
            .sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .relation-link, .concept-link, .industry-link, .group-link { text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; transition: 0.2s; }
            .sup-link { color: #45aaf2; } .sup-link:hover { color: #2d98da; text-decoration-style: solid; }
            .cus-link { color: #a55eea; } .cus-link:hover { color: #8854d0; text-decoration-style: solid; }
            .riv-link { color: #fc5c65; } .riv-link:hover { color: #eb3b5a; text-decoration-style: solid; }
            .all-link { color: #f78fb3; } .all-link:hover { color: #cf6a87; text-decoration-style: solid; }
            .out-link { color: #ff9f43; } .out-link:hover { color: #f7b731; text-decoration-style: solid; }
            .in-link { color: #4ecdc4; } .in-link:hover { color: #26dead; text-decoration-style: solid; }
            .etf-link { color: #7289da; } .etf-link:hover { color: #5b6eae; text-decoration-style: solid; }
            .relation-link { color: #52c41a; } .relation-link:hover { color: #389e0d; text-decoration-style: solid; }
            .concept-link { color: #52c41a; } .concept-link:hover { color: #389e0d; text-decoration-style: solid; }
            .industry-link { color: #45aaf2; } .industry-link:hover { color: #2d98da; text-decoration-style: solid; }
            .group-link { color: #f78fb3; } .group-link:hover { color: #cf6a87; text-decoration-style: solid; }
        `;
        document.head.appendChild(style);
    }

    // --- 🚀 初始化監聽器 ---

    // 監聽點擊事件以實現 SPA 轉跳
    document.addEventListener("click", (e) => {
        const link = e.target.closest(".sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .relation-link, .concept-link, .industry-link, .group-link");
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

    // 使用防抖動的初始化
    const debouncedInit = debounce(initIntegration, DEBOUNCE_DELAY);

    // 定期檢查 URL 變化（使用較長間隔減少 CPU 使用）
    let urlCheckInterval = null;
    const startUrlCheck = () => {
        if (urlCheckInterval) return;
        urlCheckInterval = setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastStockId = null;
                debouncedInit();
            }
        }, 1000);
    };

    // 監聽 popstate 事件以處理瀏覽器的返回/前進按鈕
    window.addEventListener("popstate", () => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            lastStockId = null;
            debouncedInit();
        }
    });

    // 監聽頁面可見性變化，暫停/恢復 URL 檢查
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            if (urlCheckInterval) {
                clearInterval(urlCheckInterval);
                urlCheckInterval = null;
            }
        } else {
            startUrlCheck();
            // 頁面重新可見時檢查一次
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
})();
