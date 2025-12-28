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
    // 渲染鎖定開關，防止重複觸發 API 請求
    let isFetching = false;
    // 儲存彈出視窗引用
    let popupWindow = null;

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
    };

    /**
     * 🚀 初始化整合器：從富果頁面 DOM 抓取當前股票資訊並觸發渲染
     */
    const initIntegration = () => {
        // 抓取股票代號、價格、市場類型、名稱等資訊
        const stockId = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
        const price = document.querySelector(".card-group-header__price__price")?.textContent?.trim();
        const market = document.querySelector(".card-group-header__info__market")?.textContent?.trim();
        const stockName = document.querySelector(".stock-name")?.textContent?.trim();
        const container = document.querySelector(".card-group-header__upper-left");

        // 如果沒抓到代號或正在請求中，則跳過
        if (!stockId || isFetching) return;

        // 清除舊有的 UI 元素，避免重複顯示
        // document.querySelectorAll('#stock-info-card').forEach(el => el.remove());
        document.querySelectorAll("#custom-btn-group").forEach((el) => el.remove());

        // 插入自定義按鈕選單與渲染詳細資訊卡片
        insertButtonMenu(container, stockId, market, stockName);
        fetchAndRenderInfo(stockId, market, price, stockName);
    };

    /**
     * 🌐 核心邏輯：併行請求所有外部數據並生成專業 UI 卡片
     */
    async function fetchAndRenderInfo(stockId, market, price, stockName) {
        isFetching = true; // 開啟請求鎖定

        try {
            // ⚡ 使用 Promise.all 併行抓取所有需要的數據，提升載入速度
            const [industries, concepts, groups, basicData, suppliers, customers, rivals, alliances, ratingData, investOuts, investIns, allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs] = await Promise.all([
                fetchV2(API_URLS.industry(stockId)),
                fetchV2(API_URLS.concept(stockId)),
                fetchV2(API_URLS.group(stockId)),
                fetchResult(API_URLS.basic(stockId)),
                fetchStockRelation(API_URLS.relation(stockId, 0)),
                fetchStockRelation(API_URLS.relation(stockId, 1)),
                fetchStockRelation(API_URLS.relation(stockId, 2)),
                fetchStockRelation(API_URLS.relation(stockId, 3)),
                fetchResult(API_URLS.ratings(stockId)), // 🎯 機構評等
                fetchStockRelation(API_URLS.relation(stockId, 4)),
                fetchStockRelation(API_URLS.relation(stockId, 5)),
                fetchResult(API_URLS.netValueList),
                fetchResult(API_URLS.pbRatioList),
                fetchResult(API_URLS.epsList),
                fetchResult(API_URLS.peRatioList),
                fetchResult(API_URLS.yieldList),
                fetchResult(API_URLS.marginList),
                fetchResult(API_URLS.roeList),
                fetchResult(API_URLS.roaList),
            ]);

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

            // 組合卡片 HTML
            infoDiv.innerHTML = `
                <div id="info-header" style="cursor: pointer; margin-bottom: ${isCollapsed ? "0" : "12px"}; border-bottom: ${isCollapsed ? "none" : "1px solid #333"}; padding-bottom: ${isCollapsed ? "0" : "10px"}; display: flex; align-items: center;">
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-size: 16px; font-weight: bold; color: #fff;">${info.V1}</span>
                        <span style="color: var(--fugle-text-muted); font-size: 12px;">📅 ${info.V16} ｜ ${market}</span>
                    </div>
                    <span id="toggle-icon" style="margin-left: auto; font-size: 12px; color: var(--fugle-primary); background: #2d2d2d; padding: 4px 10px; border-radius: 20px; border: 1px solid #444; transition: 0.2s;">${isCollapsed ? "展開詳情 ▽" : "收起詳情 △"}</span>
                </div>
                <div id="info-body" style="display: ${isCollapsed ? "none" : "block"};">
                    <div class="info-section">
                        ${createLine("🎯", "機構評等", ratingHtml)}
                    </div>
                    <div class="info-section">
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
                        </div>
                    </div>
                    <div class="info-section">
                        ${createLine("🤝", "集團", groups.join(" ｜ "), "#ec3b61", true)}
                        ${createLine("💎", "策略", allianceHtml, "#f78fb3", true)}
                        ${createLine("🚚", "供應商", supplierHtml, "#45aaf2")}
                        ${createLine("🛒", "客戶", customerHtml, "#a55eea")}
                        ${createLine("⚔️", "對手", rivalHtml, "#fc5c65")}
                    </div>
                    <div class="info-section">
                        ${createLine("💸", "轉投資", outHtml, "#ff9f43", true)}
                        ${createLine("🛡️", "被投資", inHtml, "#4ecdc4", true)}
                    </div>
                    <div class="info-section" style="border-bottom: none;">
                        ${createLine("💵", "營收", info.V5, "#a17de0ff", true)}
                        ${createLine("🏢", "產業", industries.join(" ｜ "), "#76a1fc")}
                        ${createLine("💡", "概念", concepts.join(" ｜ "), "#67ccac")}
                    </div>
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
            const icon = infoDiv.querySelector("#toggle-icon");
            header.addEventListener("click", () => {
                const currentlyCollapsed = body.style.display === "none";
                body.style.display = currentlyCollapsed ? "block" : "none";
                header.style.borderBottom = currentlyCollapsed ? "1px solid #444" : "none";
                icon.textContent = currentlyCollapsed ? "收起 △" : "展開 ▽";
                localStorage.setItem("fugle-info-collapsed", !currentlyCollapsed);
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
     */
    function fetchV2(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (res) => {
                    try {
                        resolve(JSON.parse(res.responseText).ResultSet.Result.map((i) => i.V2));
                    } catch {
                        resolve([]);
                    }
                },
                onerror: () => resolve([]),
            });
        });
    }

    /**
     * 🤝 網路請求封裝 (關係企業)：處理特定的關係鏈數據，返回去重後的 {id, name} 物件
     */
    function fetchStockRelation(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
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
            });
        });
    }

    /**
     * 📄 網路請求封裝 (原始結果)：直接返回 API 的 Result 陣列
     */
    function fetchResult(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (res) => {
                    try {
                        resolve(JSON.parse(res.responseText).ResultSet.Result);
                    } catch {
                        resolve([]);
                    }
                },
                onerror: () => resolve([]),
            });
        });
    }

    /**
     * 🛠️ 輔助工具：生成外部分析工具按鈕組
     */
    function insertButtonMenu(container, stockId, market, stockName) {
        if (!container || document.querySelector("#custom-btn-group")) return;
        const btnContainer = document.createElement("div");
        btnContainer.id = "custom-btn-group";
        btnContainer.style.cssText = `display: flex; align-items: center; gap: 6px; margin-left: 12px; flex-wrap: wrap;`;

        // 定義按鈕清單與對應的 URL 生成邏輯
        const links = [
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
                    #info-header { pointer-events: none; border-bottom: 1px solid #333 !important; padding-bottom: 10px !important; margin-bottom: 12px !important; }
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
                top: 80px;
                width: 340px;
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
            .sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link { text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; transition: 0.2s; }
            .sup-link { color: #45aaf2; } .sup-link:hover { color: #2d98da; text-decoration-style: solid; }
            .cus-link { color: #a55eea; } .cus-link:hover { color: #8854d0; text-decoration-style: solid; }
            .riv-link { color: #fc5c65; } .riv-link:hover { color: #eb3b5a; text-decoration-style: solid; }
            .all-link { color: #f78fb3; } .all-link:hover { color: #cf6a87; text-decoration-style: solid; }
            .out-link { color: #ff9f43; } .out-link:hover { color: #f7b731; text-decoration-style: solid; }
            .in-link { color: #4ecdc4; } .in-link:hover { color: #26dead; text-decoration-style: solid; }
        `;
        document.head.appendChild(style);
    }

    // --- 🚀 初始化監聽器 ---

    // 監聽點擊事件以實現 SPA 轉跳
    document.addEventListener("click", (e) => {
        const link = e.target.closest(".sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link");
        if (link && link.tagName === "A") {
            e.preventDefault();
            const href = link.getAttribute("href");
            if (href) {
                // 使用 pushState 改變 URL 但不重新整理頁面
                history.pushState({}, "", href);
                // 觸發 popstate 事件讓 Angular 路由偵測到變化
                window.dispatchEvent(new PopStateEvent("popstate"));
                // 立即更新 lastUrl 並觸發重新渲染邏輯
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    setTimeout(initIntegration, 500);
                }
            }
        }
    });

    // 由於 Fugle 是 SPA (單頁應用)，使用定時器監控 URL 變化來觸發重新渲染
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // 延遲執行以確保 DOM 已加載
            setTimeout(initIntegration, 500);
        }
    }, 1000);

    // 首次載入執行
    setTimeout(initIntegration, 1500);
})();
