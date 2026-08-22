/**
 * ============================================================================
 * 🚀 富果整合器 Content Script - TypeScript 版本
 * ============================================================================
 *
 * 本模組是富果整合器的主入口點，負責增強富果 (Fugle) 股票分析網站的功能。
 *
 * 📌 核心功能：
 * - 自動偵測當前瀏覽的股票並抓取額外財務數據
 * - 顯示機構評等、ETF 持股、主力買賣、產能分析等資訊
 * - 提供快捷按鈕連結至其他分析網站
 * - 支援資訊卡的位置調整、折疊、彈出視窗等互動功能
 *
 * 📌 SPA 處理模式：
 * 富果基於 Angular 的 SPA (單頁應用程式)，股票頁面透過 URL 導航載入，
 * 而非傳統的頁面重新整理。本模組使用以下技術偵測頁面變化：
 * - URL 輪詢 (lastUrl 追蹤)
 * - popstate 事件監聽
 * - visibility 變化監聽
 *
 * 📌 資料流程：
 * 1. 偵測頁面轉換 → 2. 提取股票代碼 → 3. 並行請求多個 API
 * 4. 處理回應資料 → 5. 渲染資訊卡 UI → 6. 綁定互動事件
 *
 * 📌 模組相依：
 * - types/index.ts: TypeScript 類型定義
 * - config/constants.ts: API URL 和常數配置
 * - utils/helpers.ts: 工具函式與網路請求
 * - services/database.ts: 本地股票資料庫
 * - ui/styles.ts: CSS 樣式注入
 * - ui/components.ts: UI 元件建構器
 * - ui/modals.ts: 彈出視窗與搜尋功能
 */

import type { StockBasicInfo, RatingItem, CapacityItem, ResultItem, MarketDataCache, CardPosition } from "./types/index";
import { API_URLS, DEBOUNCE_DELAY, CACHE_TTL, FOCUS_INPUT_SHORTCUT_KEY, DEFAULT_FOCUS_INPUT_SHORTCUT } from "./config/constants";
import { debounce, cleanNum, formatCurrency, findVal, fetchV2, fetchResult, fetchStockRelation, fetchETFHolding, fetchTradingVolume, fetchMajorBuySell, calculateMajorRatio, getFormattedDate, findStockInList } from "./utils/helpers";
import { loadStockDatabase, getStockCategories, getRelatedStocks } from "./services/database";
import { injectStyles, injectChainStyles } from "./ui/styles";
import { createLine, createSection, createLinkList, createRelatedStocksHtml, createETFHoldingHtml, createCapacityHtml, createRatingHtml, createMajorContent, createContinuousTradingHtml } from "./ui/components";
import { createTokenSettingModal, handleSearch } from "./ui/modals";

// ============================================================================
// 🔄 狀態變數 - 全域狀態管理
// ============================================================================
// 📌 這些變數追蹤應用程式的當前狀態，用於：
// - 防止重複請求 (isFetching)
// - 偵測頁面變化 (lastUrl, lastStockId)
// - 管理彈出視窗 (popupWindow)
// - 快取市場數據 (marketDataCache, cacheTimestamp)

/** 上一次處理的 URL，用於偵測 SPA 頁面轉換 */
let lastUrl: string = location.href;

/** 上一次處理的股票代碼，用於避免重複渲染同一股票 */
let lastStockId: string | null = null;

/** 是否正在抓取資料的鎖定標誌，防止並行重複請求 */
let isFetching: boolean = false;

/** 彈出視窗的參考，用於更新已開啟的獨立視窗內容 */
let popupWindow: Window | null = null;

/** 防抖動計時器 (目前未使用，保留供未來擴充) */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 全市場財務數據快取，避免頻繁重複請求靜態數據 */
let marketDataCache: MarketDataCache | null = null;

/** 快取時間戳記，用於判斷快取是否過期 */
let cacheTimestamp: number = 0;

/** 日期時間顯示是否已初始化的標誌 */
let isDateTimeInitialized: boolean = false;

/** 快速定位輸入框目前使用的快捷鍵 */
let focusInputShortcut: string = DEFAULT_FOCUS_INPUT_SHORTCUT;

// ============================================================================
// ⌨️ 快速定位輸入框快捷鍵
// ============================================================================

/**
 * 將 KeyboardEvent 轉換為標準化快捷鍵字串（例如 Alt+Q）
 */
function formatShortcut(event: KeyboardEvent): string | null {
    if (event.repeat) return null;
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const ignoredKeys = new Set(["Alt", "Control", "Shift", "Meta"]);
    if (ignoredKeys.has(key)) return null;

    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    if (parts.length === 0) return null;

    parts.push(key);
    return parts.join("+");
}

/**
 * 聚焦並定位到目標輸入框（HTML id = ember14）
 */
function focusEmber14Input(): void {
    const target = document.getElementById("ember14");
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        console.warn("Target input #ember14 not found.");
        return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    target.focus();
    target.select();
}

/**
 * 從 chrome.storage.sync 載入快捷鍵設定
 */
async function loadFocusInputShortcut(): Promise<void> {
    try {
        const result = await chrome.storage.sync.get(FOCUS_INPUT_SHORTCUT_KEY);
        const value = result[FOCUS_INPUT_SHORTCUT_KEY];
        focusInputShortcut = typeof value === "string" && value.trim() ? value : DEFAULT_FOCUS_INPUT_SHORTCUT;
    } catch (error) {
        console.warn("Failed to load shortcut settings:", error);
        focusInputShortcut = DEFAULT_FOCUS_INPUT_SHORTCUT;
    }
}

// ============================================================================
// 🔧 狀態設定器 - 封裝狀態更新邏輯
// ============================================================================
// 📌 這些函式提供給其他模組 (如 modals.ts) 更新全域狀態

/**
 * 更新上一次 URL 狀態
 * @param url - 新的 URL 值
 */
function setLastUrl(url: string): void {
    lastUrl = url;
}

/**
 * 更新上一次股票代碼狀態
 * @param id - 新的股票代碼，或 null 表示清除
 */
function setLastStockId(id: string | null): void {
    lastStockId = id;
}

// ============================================================================
// 🕐 日期時間顯示功能
// ============================================================================

/**
 * initDateTimeDisplay - 初始化日期時間顯示元件
 *
 * 在富果頁面的市場區域旁新增一個即時更新的時鐘元件。
 * 支援滑鼠懸停展開完整日期資訊。
 *
 * 📌 功能特色：
 * - 每秒更新時間顯示
 * - hover 時展開顯示完整年月日與星期
 * - 使用等寬字體確保數字對齊
 * - 漸層背景與動態過渡效果
 *
 * 📌 DOM 結構：
 * 找到 .tw-market 元素後，在其父容器內新增時間顯示元件
 */
function initDateTimeDisplay(): void {
    // 避免重複初始化
    if (isDateTimeInitialized) return;

    // 尋找富果市場資訊區塊作為插入點參考
    const marketEl = document.querySelector(".tw-market");
    if (!marketEl) return;

    // 檢查是否已存在時間顯示元件，避免重複建立
    let dateTimeContainer = marketEl.nextElementSibling as HTMLElement | null;
    if (!dateTimeContainer || !dateTimeContainer.id?.startsWith("datetime-display")) {
        // 建立新的時間顯示容器
        dateTimeContainer = document.createElement("div");
        dateTimeContainer.id = "datetime-display-" + Date.now(); // 使用時間戳記確保唯一性
        // 設定容器樣式：漸層背景、左側裝飾線、等寬字體
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

        // 將容器加入市場元素的父容器
        marketEl.parentElement?.appendChild(dateTimeContainer);
    }

    /** 控制是否顯示完整日期 (hover 時為 true) */
    let showFullDate = false;

    /**
     * 更新時間顯示內容
     * 根據 showFullDate 狀態決定顯示精簡或完整格式
     */
    const updateDateTime = (): void => {
        if (!dateTimeContainer) return;

        // 取得當前時間的各個部分
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const hour = String(now.getHours()).padStart(2, "0");
        const minute = String(now.getMinutes()).padStart(2, "0");
        const second = String(now.getSeconds()).padStart(2, "0");

        // 星期幾的中文表示
        const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        const weekday = weekdays[now.getDay()];

        if (showFullDate) {
            // 完整模式：顯示年月日、星期、時分秒
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
            // 精簡模式：只顯示時分秒
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

    // 滑鼠進入時展開完整日期
    dateTimeContainer.addEventListener("mouseenter", () => {
        showFullDate = true;
        if (dateTimeContainer) {
            // 加強背景透明度並微調位置
            dateTimeContainer.style.background = "linear-gradient(135deg, rgba(255, 159, 67, 0.12), rgba(52, 152, 219, 0.12))";
            dateTimeContainer.style.transform = "translateX(2px)";
        }
        updateDateTime();
    });

    // 滑鼠離開時恢復精簡模式
    dateTimeContainer.addEventListener("mouseleave", () => {
        showFullDate = false;
        if (dateTimeContainer) {
            dateTimeContainer.style.background = "linear-gradient(135deg, rgba(255, 159, 67, 0.08), rgba(52, 152, 219, 0.08))";
            dateTimeContainer.style.transform = "translateX(0)";
        }
        updateDateTime();
    });

    // 初始更新並啟動每秒更新的計時器
    updateDateTime();
    setInterval(updateDateTime, 1000);
    isDateTimeInitialized = true;
}

// ============================================================================
// 📊 預估量計算功能
// ============================================================================

/**
 * getVolumeMultiplier - 取得當前時間的預估成交量乘數
 *
 * 根據台股盤中時間 (09:00-13:30) 計算成交量的預估乘數。
 * 早盤時乘數較高（成交量累積較少），接近收盤時乘數趨近於 1。
 *
 * 📌 計算邏輯：
 * - 假設成交量在盤中時間內均勻分布
 * - 乘數 = 總交易時間 / 已過交易時間
 * - 實際上成交量集中於開盤和收盤，此處使用經驗調整值
 *
 * 📌 時間對應表 (概略)：
 * - 09:15 → 乘數 8 (才過 15 分鐘，乘以 8 預估全日量)
 * - 10:00 → 乘數 3 (過了 1 小時)
 * - 12:00 → 乘數 1.4 (接近收盤)
 * - 13:30 → 乘數 1 (收盤後)
 *
 * @returns number - 預估成交量乘數
 */
function getVolumeMultiplier(): number {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 定義各時段的乘數對照表
    const multipliers: Record<number, { threshold: number; value: number }[]> = {
        9: [
            { threshold: 15, value: 8 },
            { threshold: 20, value: 7.5 },
            { threshold: 25, value: 7 },
            { threshold: 30, value: 5 },
            { threshold: 35, value: 4.75 },
            { threshold: 40, value: 4.5 },
            { threshold: 45, value: 4 },
            { threshold: 50, value: 3.75 },
            { threshold: 60, value: 3.5 },
        ],
        10: [
            { threshold: 5, value: 3 },
            { threshold: 10, value: 2.9 },
            { threshold: 15, value: 2.8 },
            { threshold: 20, value: 2.5 },
            { threshold: 25, value: 2.4 },
            { threshold: 30, value: 2.3 },
            { threshold: 35, value: 2.2 },
            { threshold: 40, value: 2.1 },
            { threshold: 45, value: 2 },
            { threshold: 50, value: 1.95 },
            { threshold: 55, value: 1.9 },
            { threshold: 60, value: 1.85 },
        ],
        11: [
            { threshold: 5, value: 1.8 },
            { threshold: 10, value: 1.75 },
            { threshold: 15, value: 1.7 },
            { threshold: 20, value: 1.68 },
            { threshold: 25, value: 1.66 },
            { threshold: 30, value: 1.64 },
            { threshold: 35, value: 1.6 },
            { threshold: 40, value: 1.58 },
            { threshold: 45, value: 1.55 },
            { threshold: 50, value: 1.52 },
            { threshold: 55, value: 1.5 },
            { threshold: 60, value: 1.48 },
        ],
        12: [
            { threshold: 5, value: 1.45 },
            { threshold: 10, value: 1.42 },
            { threshold: 15, value: 1.38 },
            { threshold: 20, value: 1.36 },
            { threshold: 25, value: 1.34 },
            { threshold: 30, value: 1.32 },
            { threshold: 35, value: 1.3 },
            { threshold: 40, value: 1.28 },
            { threshold: 45, value: 1.25 },
            { threshold: 50, value: 1.23 },
            { threshold: 55, value: 1.22 },
            { threshold: 60, value: 1.2 },
        ],
        13: [
            { threshold: 5, value: 1.18 },
            { threshold: 10, value: 1.16 },
            { threshold: 15, value: 1.13 },
            { threshold: 20, value: 1.12 },
            { threshold: 25, value: 1.11 },
            { threshold: 30, value: 1.1 },
            { threshold: 60, value: 1 },
        ],
    };

    const hourData = multipliers[hour];
    if (hourData) {
        const match = hourData.find((d) => minute < d.threshold);
        if (match) return match.value;
    }

    // 非交易時間返回 1 (不進行預估)
    return 1;
}

// ============================================================================
// 🔘 按鈕選單功能
// ============================================================================

/**
 * insertButtonMenu - 插入功能按鈕選單
 *
 * 在富果股票頁面的標題區域插入一組功能按鈕，提供：
 * - 預估成交量顯示
 * - 外部網站快捷連結 (WantGoo, CMoney, TradingView 等)
 * - 資訊卡位置切換
 * - 彈出視窗功能
 * - Token 設置
 * - 資訊卡顯示/隱藏開關
 *
 * @param container - 按鈕容器的父元素
 * @param stockId - 當前股票代碼
 * @param market - 市場類型 (上市/上櫃)
 * @param stockName - 股票名稱
 *
 * 📌 插入位置：.card-group-header__upper-left 元素內
 * 📌 避免重複：透過 #custom-btn-group ID 檢查防止重複插入
 */
function insertButtonMenu(container: Element | null, stockId: string, market: string | undefined, stockName: string | undefined): void {
    // 避免重複插入
    if (!container || document.querySelector("#custom-btn-group")) return;

    // 建立按鈕容器
    const btnContainer = document.createElement("div");
    btnContainer.id = "custom-btn-group";
    btnContainer.style.cssText = `display: flex; align-items: center; gap: 6px; margin-left: 12px; flex-wrap: wrap;`;

    // ========================================
    // 📊 預估成交量顯示
    // ========================================
    const estimateSpan = document.createElement("span");
    estimateSpan.id = "estimated-volume";
    estimateSpan.style.cssText = "font-size: 13px; color: #f1c40f; margin-left: 8px; font-weight: bold; background: rgba(241, 196, 15, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(241, 196, 15, 0.3);";

    /**
     * 更新預估成交量顯示
     * 從頁面讀取當前成交量，乘以時間係數得出預估全日量
     */
    const updateEstimate = (): void => {
        // 從 DOM 讀取當前成交量
        const volumeEl = document.querySelector(".card-group-header__volume span:nth-child(2)");
        if (!volumeEl) return;

        // 解析成交量數值 (移除逗號和單位)
        const currentVolume = Number.parseFloat(volumeEl.textContent?.replaceAll(",", "").replace("張", "").trim() || "0");
        if (Number.isNaN(currentVolume)) return;

        // 計算預估量 = 當前量 × 乘數
        const multiplier = getVolumeMultiplier();
        const estimatedVolume = Math.floor(currentVolume * multiplier);
        estimateSpan.textContent = `預估量: ${estimatedVolume.toLocaleString()} 張`;
    };

    // 初始更新
    updateEstimate();

    // 每秒更新預估量 (因為當前成交量會變動)
    const intervalId = setInterval(() => {
        // 當元素不在 DOM 中時停止更新 (頁面切換時)
        if (!document.body.contains(estimateSpan)) {
            clearInterval(intervalId);
            return;
        }
        updateEstimate();
    }, 1000);

    // 將預估量加入成交量區域
    const volumeTimeContainer = document.querySelector(".card-group-header__volume-and-time");
    if (volumeTimeContainer) {
        volumeTimeContainer.appendChild(estimateSpan);
    } else {
        btnContainer.appendChild(estimateSpan);
    }

    // ========================================
    // 🔗 外部網站快捷按鈕清單
    // ========================================
    const links = [
        { name: "🔍 搜尋", val: "search" }, // 內部搜尋功能
        { name: "📈 WantGoo", val: "wantgoo" }, // WantGoo 股票分析
        { name: "💬 CMoney", val: "cmoney" }, // CMoney 討論區
        { name: "⚔︎ 處置", val: "dispose" }, // 處置神器
        { name: "📊 TV", val: "tvse" }, // TradingView 圖表
        { name: "🏛️ 法人", val: "fubon" }, // 富邦法人進出
        { name: "👤 主力", val: "major" }, // 主力進出明細
        { name: "🤖 Gemini", val: "Gemini" }, // Google Gemini AI 分析
        { name: "🤖 ChatGPT", val: "chatgpt" }, // ChatGPT AI 分析
    ];

    // 為每個連結建立按鈕
    links.forEach((link) => {
        const btn = document.createElement("button");
        btn.textContent = link.name;
        btn.className = "custom-analysis-btn";
        btn.onclick = () => {
            // 搜尋按鈕使用內部搜尋功能
            if (link.val === "search") {
                handleSearch(lastUrl, setLastUrl, setLastStockId, initIntegration);
                return;
            }

            // 根據按鈕類型建構對應 URL
            let url = "";
            if (link.val === "wantgoo") url = `https://www.wantgoo.com/stock/${stockId}`;
            if (link.val === "cmoney") url = `https://www.cmoney.tw/forum/stock/${stockId}`;
            if (link.val === "dispose") url = `https://warrantlb8888.cmoney.tw/DispositionGod/stock/${stockId}`;
            // TradingView 需要區分上市 (TWSE) 和上櫃 (TPEX)
            if (link.val === "tvse") url = `https://tw.tradingview.com/chart/GTx3hMzq/?symbol=${market === "上市" ? "TWSE" : "TPEX"}:${stockId}`;
            if (link.val === "fubon") url = `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl.djhtm?a=${stockId}&b=3`;
            if (link.val === "major") url = `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zco/zco_${stockId}.djhtm`;
            // Gemini 帶入股票代碼和名稱作為提示詞
            if (link.val === "Gemini") url = `https://gemini.google.com/gem/1QUXOXLuTZt54GwWAClfuBcs7Q4LlFRsc?usp=sharing&p=${stockId}%20${stockName}`;
            // ChatGPT 帶入股票代碼和名稱作為提示詞
            if (link.val === "chatgpt") url = `https://chatgpt.com/g/g-p-6a7bd905e76c8191845afc2c828aec0f/project?prompt=${stockId}%20${stockName}`;
            // 開啟新分頁
            if (url) window.open(url, "_blank");
        };
        btnContainer.appendChild(btn);
    });

    // ========================================
    // 📍 位置切換按鈕
    // ========================================
    const currentPos = (localStorage.getItem("fugle-info-position") || "right") as CardPosition;
    const posBtn = document.createElement("button");

    /** 根據位置取得按鈕標籤 */
    const getLabel = (p: CardPosition): string => {
        if (p === "right") return "➡️ 靠右";
        if (p === "left") return "⬅️ 靠左";
        return "⬇️ 預設";
    };

    posBtn.textContent = getLabel(currentPos);
    posBtn.className = "custom-analysis-btn";
    posBtn.style.marginLeft = "6px";
    posBtn.title = "切換資訊卡顯示位置";
    posBtn.onclick = () => {
        const card = document.querySelector("#stock-info-card");
        const curr = (localStorage.getItem("fugle-info-position") || "right") as CardPosition;

        // 循環切換位置: right → left → default → right
        let next: CardPosition;
        if (curr === "right") {
            next = "left";
        } else if (curr === "left") {
            next = "default";
        } else {
            next = "right";
        }

        // 儲存新位置到 localStorage
        localStorage.setItem("fugle-info-position", next);
        posBtn.textContent = getLabel(next);

        // 更新卡片樣式和位置
        if (card instanceof HTMLElement) {
            card.classList.remove("fixed-mode");
            card.style.left = "";
            card.style.right = "";

            if (next === "default") {
                // 預設模式：嵌入頁面內
                const targetHeader = document.querySelector(".card-group-header");
                if (targetHeader) targetHeader.appendChild(card);
            } else {
                // 浮動模式：固定定位
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

    // ========================================
    // ❐ 彈出視窗按鈕
    // ========================================
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

        // 如果已有彈出視窗，聚焦到該視窗；否則建立新視窗
        if (!popupWindow || popupWindow.closed) {
            popupWindow = globalThis.open("", "StockInfoCard", "width=600,height=955,scrollbars=yes,resizable=yes");
        } else {
            popupWindow.focus();
        }

        if (!popupWindow) {
            alert("請允許彈出視窗以使用此功能");
            return;
        }

        // 渲染內容到彈出視窗
        renderPopupContent(popupWindow, card as HTMLElement, stockName || "", stockId);
    };
    btnContainer.appendChild(popoutBtn);

    // ========================================
    // 🔑 Token 設置按鈕
    // ========================================
    const tokenBtn = document.createElement("button");
    tokenBtn.textContent = "🔑 Token";
    tokenBtn.className = "custom-analysis-btn";
    tokenBtn.style.marginLeft = "6px";
    tokenBtn.title = "設置成交量 API Token";
    tokenBtn.onclick = createTokenSettingModal;
    btnContainer.appendChild(tokenBtn);

    // ========================================
    // 🔘 顯示/隱藏開關
    // ========================================
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

    // 延遲綁定開關事件 (確保 DOM 已插入)
    setTimeout(() => {
        const checkbox = toggleWrapper.querySelector("#info-card-toggle");
        if (checkbox instanceof HTMLInputElement) {
            checkbox.addEventListener("change", (e) => {
                const checked = (e.target as HTMLInputElement).checked;
                localStorage.setItem("fugle-info-visible", String(checked));
                const card = document.querySelector("#stock-info-card");
                if (card instanceof HTMLElement) card.style.display = checked ? "block" : "none";
            });
        }
    }, 0);

    // 將按鈕容器加入頁面
    container.appendChild(btnContainer);

    // 注入按鈕樣式
    injectStyles();
}

// ============================================================================
// 🪟 彈出視窗渲染功能
// ============================================================================

/**
 * renderPopupContent - 將資訊卡內容渲染到彈出視窗
 *
 * 複製主頁面的資訊卡內容到獨立彈出視窗，並重新綁定互動事件。
 * 彈出視窗提供更大的閱讀空間，且不會隨主頁面捲動而移動。
 *
 * @param w - 目標彈出視窗的 Window 物件
 * @param card - 來源資訊卡 DOM 元素
 * @param stockName - 股票名稱 (用於視窗標題)
 * @param stockId - 股票代碼 (用於視窗標題)
 *
 * 📌 處理項目：
 * - 複製主頁面的 CSS 樣式到彈出視窗
 * - 調整卡片樣式以適應獨立視窗
 * - 重新綁定區塊折疊事件
 * - 重新綁定股票連結點擊事件
 */
function renderPopupContent(w: Window, card: HTMLElement, stockName: string, stockId: string): void {
    if (!w || !card) return;

    // 從主頁面取得樣式內容
    const styles = document.querySelector("#custom-analysis-style")?.textContent || "";
    const chainStyles = document.querySelector("#chain-link-style")?.textContent || "";

    // 寫入彈出視窗的 HTML 結構
    w.document.documentElement.innerHTML = `
        <head>
            <title>${stockName} (${stockId}) - 資訊卡</title>
            <style>
                /* 視窗基本樣式 */
                body { background-color: #252526; margin: 0; padding: 0; color: #d4d4d4; }
                /* 注入主頁面樣式 */
                ${styles}
                ${chainStyles}
                /* 覆蓋卡片樣式以適應獨立視窗 */
                #stock-info-card { 
                    position: static !important; 
                    width: auto !important; 
                    box-shadow: none !important; 
                    border: none !important;
                    margin: 0 !important;
                    max-height: none !important;
                    padding: 16px;
                }
                /* 隱藏收合圖示 (彈出視窗永遠展開) */
                #toggle-icon { display: none !important; }
                #info-body { display: block !important; }
                #info-summary { display: none !important; }
                /* 固定標題欄 */
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
                /* 區塊標題固定 */
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
    `;

    // ========================================
    // 綁定區塊折疊事件
    // ========================================
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
            // 儲存折疊狀態到 localStorage
            localStorage.setItem(`fugle-section-${sectionId}`, String(!isOpen));
        });
    });

    // ========================================
    // 綁定股票連結點擊事件
    // ========================================
    // 📌 點擊彈出視窗中的股票連結時，導航主頁面並更新資訊
    w.document.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const link = target.closest(".sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .concept-link, .industry-link, .group-link");
        if (link instanceof HTMLAnchorElement) {
            e.preventDefault();
            const href = link.getAttribute("href");
            if (href) {
                // 在主頁面導航
                history.pushState({}, "", href);
                globalThis.dispatchEvent(new PopStateEvent("popstate"));
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    setTimeout(initIntegration, 500);
                }
                // 聚焦回主頁面
                globalThis.focus();
            }
        }
    });
}

// ============================================================================
// 🎯 核心渲染邏輯 - 主要資料抓取與 UI 渲染
// ============================================================================

/**
 * fetchAndRenderInfo - 抓取股票資料並渲染資訊卡
 *
 * 這是整合器的核心函式，負責：
 * 1. 載入本地股票資料庫
 * 2. 並行請求多個外部 API
 * 3. 處理和轉換回應資料
 * 4. 建構並渲染資訊卡 UI
 * 5. 綁定互動事件
 *
 * @param stockId - 股票代碼 (例如: "2330")
 * @param market - 市場類型 (上市/上櫃)
 * @param price - 當前股價
 * @param stockName - 股票名稱
 *
 * 📌 API 請求策略：
 * - 使用 Promise.all() 並行請求所有 API，提升效能
 * - 第一批請求：基本資料、評等、ETF、產能、主力買賣
 * - 第二批請求：關係企業 (供應商、客戶、對手等)
 * - 全市場數據使用 30 分鐘快取，避免重複請求
 *
 * 📌 競態條件處理：
 * - 使用 isFetching 鎖定防止並行請求
 * - 每次 API 回應後檢查當前股票代碼，避免顯示錯誤資料
 */
async function fetchAndRenderInfo(stockId: string, market: string | undefined, price: string | undefined, stockName: string | undefined): Promise<void> {
    // 防止並行請求
    if (isFetching) return;
    isFetching = true;

    try {
        // 確保本地股票資料庫已載入
        await loadStockDatabase();

        console.log("🔵 開始請求 API 數據，股票代碼:", stockId);

        // ========================================
        // 第一批 API 請求：基本資料與專項數據
        // ========================================
        // 📌 使用 Promise.all 並行請求，大幅減少總等待時間
        const [industries, concepts, groups, basicData, ratingData, etfHoldingData, capacityData, majorBuySell1Data, majorBuySell3Data, majorBuySell5Data, majorBuySell10Data, majorBuySell20Data, tradingVolumeData] = await Promise.all([
            fetchV2(API_URLS.industry(stockId)), // 產業分類
            fetchV2(API_URLS.concept(stockId)), // 概念股分類
            fetchV2(API_URLS.group(stockId)), // 集團分類
            fetchResult<StockBasicInfo>(API_URLS.basic(stockId)), // 基本資料
            fetchResult<RatingItem>(API_URLS.ratings(stockId)), // 機構評等
            fetchETFHolding(API_URLS.etfHolding(stockId)), // ETF 持股
            fetchResult<CapacityItem>(API_URLS.capacity(stockId)), // 產能分析
            fetchMajorBuySell(API_URLS.majorBuySell1(stockId)), // 主力買賣 1 日
            fetchMajorBuySell(API_URLS.majorBuySell3(stockId)), // 主力買賣 3 日
            fetchMajorBuySell(API_URLS.majorBuySell5(stockId)), // 主力買賣 5 日
            fetchMajorBuySell(API_URLS.majorBuySell10(stockId)), // 主力買賣 10 日
            fetchMajorBuySell(API_URLS.majorBuySell20(stockId)), // 主力買賣 20 日
            fetchTradingVolume(API_URLS.tradingVolume(stockId)), // 成交量歷史
        ]);
        console.log("✅ 所有 API 請求完成");

        // 競態條件檢查：確認使用者仍在查看同一支股票
        const currentStockId = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
        if (currentStockId !== stockId) {
            isFetching = false;
            return;
        }

        // ========================================
        // 第二批 API 請求：關係企業數據
        // ========================================
        // 📌 b 參數定義關係類型: 0=供應商, 1=客戶, 2=對手, 3=策略聯盟, 4=轉投資, 5=被投資
        const [suppliers, customers, rivals, alliances, investOuts, investIns] = await Promise.all([
            fetchStockRelation(API_URLS.relation(stockId, 0)), // 供應商
            fetchStockRelation(API_URLS.relation(stockId, 1)), // 客戶
            fetchStockRelation(API_URLS.relation(stockId, 2)), // 競爭對手
            fetchStockRelation(API_URLS.relation(stockId, 3)), // 策略聯盟
            fetchStockRelation(API_URLS.relation(stockId, 4)), // 轉投資
            fetchStockRelation(API_URLS.relation(stockId, 5)), // 被投資
        ]);

        // 再次進行競態條件檢查
        const currentStockId2 = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
        if (currentStockId2 !== stockId) {
            isFetching = false;
            return;
        }

        // ========================================
        // 全市場數據 (使用緩存機制)
        // ========================================
        // 📌 這些是全市場的財務指標排行，資料量大但更新頻率低
        // 📌 使用 30 分鐘快取避免重複請求
        let allNetValues: ResultItem[], allPBs: ResultItem[], allEPS: ResultItem[], allPEs: ResultItem[], allYields: ResultItem[], allMargins: ResultItem[], allROEs: ResultItem[], allROAs: ResultItem[];
        let allTrustBuys: ResultItem[], allTrustSells: ResultItem[], allForeignBuys: ResultItem[], allForeignSells: ResultItem[];
        let allTrustShareholdings: ResultItem[], allForeignShareholdings: ResultItem[];

        const now = Date.now();
        const today = getFormattedDate();

        if (marketDataCache && now - cacheTimestamp < CACHE_TTL) {
            // 使用快取資料
            ({ allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs, allTrustBuys, allTrustSells, allForeignBuys, allForeignSells, allTrustShareholdings, allForeignShareholdings } = marketDataCache);
        } else {
            // 快取過期或不存在，重新請求
            [allNetValues, allPBs, allEPS, allPEs, allYields, allMargins, allROEs, allROAs, allTrustBuys, allTrustSells, allForeignBuys, allForeignSells, allTrustShareholdings, allForeignShareholdings] = await Promise.all([
                fetchResult(API_URLS.netValueList),
                fetchResult(API_URLS.pbRatioList),
                fetchResult(API_URLS.epsList),
                fetchResult(API_URLS.peRatioList),
                fetchResult(API_URLS.yieldList),
                fetchResult(API_URLS.marginList),
                fetchResult(API_URLS.roeList),
                fetchResult(API_URLS.roaList),
                fetchResult(API_URLS.trustBuyList(today)),
                fetchResult(API_URLS.trustSellList(today)),
                fetchResult(API_URLS.foreignBuyList(today)),
                fetchResult(API_URLS.foreignSellList(today)),
                fetchResult(API_URLS.trustShareholdingList(today)),
                fetchResult(API_URLS.foreignShareholdingList(today)),
            ]);
            // 更新快取
            marketDataCache = {
                allNetValues,
                allPBs,
                allEPS,
                allPEs,
                allYields,
                allMargins,
                allROEs,
                allROAs,
                allTrustBuys,
                allTrustSells,
                allForeignBuys,
                allForeignSells,
                allTrustShareholdings,
                allForeignShareholdings,
            };
            cacheTimestamp = now;
        }

        // 驗證必要資料存在
        const targetHeader = document.querySelector(".card-group-header");
        if (!targetHeader || !basicData.length) {
            isFetching = false;
            return;
        }

        // 取得基本資料的第一筆記錄
        const info = basicData[0];
        const targetSymbol = `AS${stockId}`; // 全市場清單中的識別符格式

        // ========================================
        // 從全市場清單中提取當前股票的財務指標
        // ========================================
        const nav = findVal(allNetValues, targetSymbol); // 每股淨值 (BVPS)
        const pb = findVal(allPBs, targetSymbol); // 股價淨值比 (PB)
        const eps = findVal(allEPS, targetSymbol); // 每股盈餘 (EPS)
        const pe = findVal(allPEs, targetSymbol); // 本益比 (PE)
        const dy = findVal(allYields, targetSymbol); // 殖利率
        const margin = findVal(allMargins, targetSymbol); // 毛利率
        const roe = findVal(allROEs, targetSymbol); // 股東權益報酬率 (ROE)
        const roa = findVal(allROAs, targetSymbol); // 資產報酬率 (ROA)

        // 取得連續買賣超資料
        const trustBuy = findStockInList(allTrustBuys, targetSymbol);
        const trustSell = findStockInList(allTrustSells, targetSymbol);
        const foreignBuy = findStockInList(allForeignBuys, targetSymbol);
        const foreignSell = findStockInList(allForeignSells, targetSymbol);

        // 取得持股比資料
        const trustShareholding = findStockInList(allTrustShareholdings, targetSymbol);
        const foreignShareholding = findStockInList(allForeignShareholdings, targetSymbol);
        const trustRatio = trustShareholding?.V8 || null;
        const foreignRatio = foreignShareholding?.V8 || null;

        // 讀取使用者的 UI 狀態偏好
        const isCollapsed = localStorage.getItem("fugle-info-collapsed") === "true";
        const currPrice = cleanNum(price);

        // ========================================
        // 生成各區塊的 HTML 內容
        // ========================================

        // 機構評等區塊
        const { ratingHtml } = createRatingHtml(ratingData, currPrice);

        // 關係企業連結列表
        const supplierHtml = createLinkList(suppliers, "sup-link");
        const customerHtml = createLinkList(customers, "cus-link");
        const rivalHtml = createLinkList(rivals, "riv-link");
        const allianceHtml = createLinkList(alliances, "all-link");
        const outHtml = createLinkList(investOuts, "out-link");
        const inHtml = createLinkList(investIns, "in-link");

        // ETF 持股區塊
        const etfHoldingHtml = createETFHoldingHtml(etfHoldingData);

        // 產能分析區塊
        const capacityHtml = createCapacityHtml(capacityData);

        // ========================================
        // 計算主力買賣比率
        // ========================================
        const major1Ratio = calculateMajorRatio(majorBuySell1Data, tradingVolumeData, 1);
        const major3Ratio = calculateMajorRatio(majorBuySell3Data, tradingVolumeData, 3);
        const major5Ratio = calculateMajorRatio(majorBuySell5Data, tradingVolumeData, 5);
        const major10Ratio = calculateMajorRatio(majorBuySell10Data, tradingVolumeData, 10);
        const major20Ratio = calculateMajorRatio(majorBuySell20Data, tradingVolumeData, 20);

        // ========================================
        // 格式化財務數據
        // ========================================
        // 計算市值 = 股價 × 股本（張數）× 1000 / 億
        const marketCap = cleanNum(price) > 0 && cleanNum(info.V3) > 0 ? formatCurrency((cleanNum(price) * cleanNum(info.V3)) / 100000) : "計算中...";

        // 股本轉換為億元單位
        const rawCapital = Number.parseFloat(info.V3.replaceAll(",", ""));
        const formattedCapital = Number.isNaN(rawCapital) ? info.V3 : (rawCapital / 10000).toFixed(2) + " 億";

        // ========================================
        // 建立資訊卡容器
        // ========================================
        const infoDiv = document.createElement("div");
        infoDiv.id = "stock-info-card";

        // 根據使用者偏好設定顯示狀態
        const isCardVisible = localStorage.getItem("fugle-info-visible") !== "false";
        if (!isCardVisible) infoDiv.style.display = "none";

        // 根據使用者偏好設定位置
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

        // ========================================
        // 組合各區塊內容
        // ========================================

        // 機構評等內容
        const ratingContent = ratingHtml ? `<div class="info-row"><div class="info-content">${ratingHtml}</div></div>` : null;

        // 主力買賣內容
        const majorContent = createMajorContent(major1Ratio, major3Ratio, major5Ratio, major10Ratio, major20Ratio);

        // 連續買賣超內容
        const continuousTradingHtml = createContinuousTradingHtml(trustBuy, trustSell, foreignBuy, foreignSell, trustRatio, foreignRatio);
        const continuousTradingTitle = `連續買賣超 ${trustRatio ? `(投信 ${trustRatio}%)` : ""} ${foreignRatio ? `(外資 ${foreignRatio}%)` : ""}`.trim();
        const continuousTradingContent = continuousTradingHtml ? `<div class="info-row"><div class="info-content" style="width: 100%;">${continuousTradingHtml}</div></div>` : null;

        // 財務指標內容 (使用 Grid 佈局)
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

        // 關係企業內容
        const relationContent = [createLine("🤝", "集團", groups.join(" ｜ "), "#ec3b61", true), createLine("💎", "策略", allianceHtml, "#f78fb3", true), createLine("🚚", "供應商", supplierHtml, "#45aaf2"), createLine("🛒", "客戶", customerHtml, "#a55eea"), createLine("⚔️", "對手", rivalHtml, "#fc5c65")].filter(Boolean).join("") || null;

        // 投資佈局內容
        const investContent = [createLine("💸", "轉投資", outHtml, "#ff9f43", true), createLine("🛡️", "被投資", inHtml, "#4ecdc4", true)].filter(Boolean).join("") || null;

        // ETF 持股內容
        const etfContent = etfHoldingHtml ? `<div class="info-row"><div class="info-content" style="color: #7289da; font-weight: 600;">${etfHoldingHtml}</div></div>` : null;

        // ========================================
        // 從本地資料庫查詢相關股票
        // ========================================
        // 📌 結合 API 回傳的分類與本地資料庫，取得更完整的分類資訊
        const dbConceptCategories = getStockCategories(stockId, "概念");
        const dbIndustryCategories = getStockCategories(stockId, "產業");
        const dbGroupCategories = getStockCategories(stockId, "集團");

        // 合併 API 與本地資料庫的分類，去除重複
        const allConceptCategories = [...new Set([...dbConceptCategories, ...concepts])];
        const allIndustryCategories = [...new Set([...dbIndustryCategories, ...industries])];
        const allGroupCategories = [...new Set([...dbGroupCategories, ...groups])];

        // 為每個分類生成相關股票連結
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

        // 相關個股區塊
        const relatedContent = [createLine("🔗", "同概念", relatedConceptHtml), createLine("🏭", "同產業", relatedIndustryHtml), createLine("🤝", "同集團", relatedGroupHtml)].filter(Boolean).join("") || null;

        // 基本資料區塊
        const basicContent = [createLine("💵", "營收", info.V5, "#a17de0ff", true), createLine("🏢", "產業", industries.join(" ｜ "), "#76a1fc"), createLine("💡", "概念", concepts.toSorted((a: string, b: string) => a.localeCompare(b, "zh-Hant")).join(" ｜ "), "#67ccac")].filter(Boolean).join("") || null;

        // 產能分析區塊
        const capacityContent = capacityHtml ? `<div class="info-row"><div class="info-content" style="color: #e67e22; font-weight: 600;">${capacityHtml}</div></div>` : null;

        // ========================================
        // 組合完整卡片 HTML
        // ========================================
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
                ${createSection("continuous", continuousTradingTitle, "🏛️", continuousTradingContent, true)}
                ${createSection("relation", "關係企業", "🔗", relationContent, true)}
                ${createSection("invest", "投資佈局", "💼", investContent, false)}
                ${createSection("rating", "機構評等", "🎯", ratingContent, true)}
                ${createSection("etf", "ETF 持股", "📦", etfContent, false)}
                ${createSection("finance", "財務指標", "💹", financeContent, true)}
                ${createSection("related", "相關個股", "🔍", relatedContent, true)}
                ${createSection("capacity", "產能分析", "🏭", capacityContent, false)}
            </div>
        `;

        // ========================================
        // 插入卡片到頁面
        // ========================================
        // 移除舊卡片
        document.querySelectorAll("#stock-info-card").forEach((el) => el.remove());

        // 根據位置設定插入適當位置
        if (cardPosition === "default") {
            targetHeader.appendChild(infoDiv);
        } else {
            document.body.appendChild(infoDiv);
        }

        // ========================================
        // 綁定卡片互動事件
        // ========================================

        // 標題區點擊：展開/收合整個卡片
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

        // 各區塊標題點擊：展開/收合該區塊
        infoDiv.querySelectorAll(".collapsible-section").forEach((section) => {
            const sectionHeader = section.querySelector(".section-header") as HTMLElement;
            const sectionBody = section.querySelector(".section-body") as HTMLElement;
            const sectionToggle = section.querySelector(".section-toggle") as HTMLElement;
            const sectionId = (section as HTMLElement).dataset.sectionId;

            sectionHeader.addEventListener("click", (e) => {
                e.stopPropagation(); // 防止觸發父層事件
                const isOpen = sectionBody.style.display !== "none";
                sectionBody.style.display = isOpen ? "none" : "block";
                sectionHeader.style.marginBottom = isOpen ? "0" : "8px";
                sectionToggle.textContent = isOpen ? "▽" : "△";
                // 儲存區塊折疊狀態
                localStorage.setItem(`fugle-section-${sectionId}`, String(!isOpen));
            });
        });

        // 注入連結樣式
        injectChainStyles();

        // 如果彈出視窗已開啟，同步更新其內容
        if (popupWindow && !popupWindow.closed) {
            renderPopupContent(popupWindow, infoDiv, stockName || "", stockId);
        }
    } catch (e) {
        // 錯誤處理：顯示警告並記錄錯誤
        alert("Fugle Integrator Error: " + (e as Error).message);
        console.error("Fugle Integrator Error:", e);
    } finally {
        // 確保釋放鎖定，無論成功或失敗
        isFetching = false;
    }
}

// ============================================================================
// 🚀 初始化函式
// ============================================================================

/**
 * initIntegration - 整合器主要初始化函式
 *
 * 檢查當前頁面狀態，決定是否需要重新抓取資料並渲染 UI。
 * 這個函式會在以下情況被呼叫：
 * - 首次載入頁面
 * - 頁面 URL 變化 (SPA 導航)
 * - 使用者手動觸發重新整理
 *
 * @param forceRefresh - 是否強制重新整理，忽略快取和狀態檢查
 *
 * 📌 處理流程：
 * 1. 從 DOM 提取股票資訊
 * 2. 初始化日期時間顯示
 * 3. 檢查是否需要更新 (避免重複渲染)
 * 4. 清理舊的 UI 元素
 * 5. 插入按鈕選單
 * 6. 抓取並渲染資訊卡
 */
function initIntegration(forceRefresh: boolean = false): void {
    // ========================================
    // 從 DOM 提取股票資訊
    // ========================================
    // 📌 使用富果頁面的特定 CSS 選擇器定位元素
    const stockId = document.querySelector(".card-group-header__info__symbol")?.textContent?.trim();
    const price = document.querySelector(".card-group-header__price__price")?.textContent?.trim();
    const market = document.querySelector(".card-group-header__info__market")?.textContent?.trim();
    const stockName = document.querySelector(".stock-name")?.textContent?.trim();
    const container = document.querySelector(".card-group-header__upper-left");

    // 初始化日期時間顯示 (只執行一次)
    initDateTimeDisplay();

    // 如果找不到股票代碼，代表不在股票頁面，直接返回
    if (!stockId) return;

    // ========================================
    // 檢查是否需要更新
    // ========================================
    // 如果是同一支股票且資訊卡已存在，且非強制更新，則跳過
    if (stockId === lastStockId && !forceRefresh && document.querySelector("#stock-info-card")) return;

    // 如果正在抓取中，使用防抖動延遲重試
    if (isFetching) {
        debounce(() => initIntegration(forceRefresh), DEBOUNCE_DELAY)();
        return;
    }

    // 更新狀態
    lastStockId = stockId;

    // ========================================
    // 清理舊的 UI 元素
    // ========================================
    document.querySelectorAll("#custom-btn-group").forEach((el) => el.remove());
    document.querySelectorAll("#estimated-volume").forEach((el) => el.remove());

    // ========================================
    // 插入按鈕選單並開始抓取資料
    // ========================================
    insertButtonMenu(container, stockId, market, stockName);
    fetchAndRenderInfo(stockId, market, price, stockName);
}

// ============================================================================
// 📡 事件監聽 - SPA 頁面變化偵測
// ============================================================================
// 📌 富果是 Angular SPA，需要監聽多種事件來偵測頁面變化

/** 建立防抖動版本的初始化函式 */
const debouncedInit = debounce(initIntegration, DEBOUNCE_DELAY);

/**
 * 文件點擊事件監聽
 * 攔截股票連結點擊，使用 SPA 導航而非頁面跳轉
 */
document.addEventListener("click", (e) => {
    // 檢查點擊目標是否為股票連結
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const link = target.closest(".sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .relation-link, .concept-link, .industry-link, .group-link");
    if (link instanceof HTMLAnchorElement) {
        e.preventDefault(); // 阻止預設的頁面跳轉
        const href = link.getAttribute("href");
        if (href) {
            // 使用 History API 進行 SPA 導航
            history.pushState({}, "", href);
            globalThis.dispatchEvent(new PopStateEvent("popstate"));
            // 如果 URL 變化，觸發重新初始化
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastStockId = null;
                debouncedInit();
            }
        }
    }
});

/**
 * 鍵盤快捷鍵監聽
 * 預設 Alt+Q，可於擴充功能設定頁自訂
 */
document.addEventListener("keydown", (event: KeyboardEvent) => {
    const shortcut = formatShortcut(event);
    if (!shortcut || shortcut !== focusInputShortcut) return;
    event.preventDefault();
    focusEmber14Input();
});

/**
 * 監聽快捷鍵設定變更（options page 更新後即時生效）
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !(FOCUS_INPUT_SHORTCUT_KEY in changes)) return;
    const newValue = changes[FOCUS_INPUT_SHORTCUT_KEY]?.newValue;
    focusInputShortcut = typeof newValue === "string" && newValue.trim() ? newValue : DEFAULT_FOCUS_INPUT_SHORTCUT;
});

/**
 * URL 輪詢機制
 * 每秒檢查 URL 是否變化，用於偵測某些情況下的 SPA 導航
 */
let urlCheckInterval: ReturnType<typeof setInterval> | null = null;

/** 啟動 URL 輪詢 */
const startUrlCheck = (): void => {
    if (urlCheckInterval) return; // 避免重複啟動
    urlCheckInterval = setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            lastStockId = null;
            debouncedInit();
        }
    }, 1000);
};

/**
 * popstate 事件監聽
 * 當使用者點擊瀏覽器的前進/後退按鈕時觸發
 */
globalThis.addEventListener("popstate", () => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastStockId = null;
        debouncedInit();
    }
});

/**
 * 頁面可見性變化監聽
 * 當使用者切換標籤頁時，暫停/恢復 URL 輪詢
 * 這可以節省資源並在返回時確保狀態同步
 */
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        // 頁面隱藏時停止輪詢
        if (urlCheckInterval) {
            clearInterval(urlCheckInterval);
            urlCheckInterval = null;
        }
    } else {
        // 頁面顯示時恢復輪詢並檢查狀態
        startUrlCheck();
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            lastStockId = null;
            debouncedInit();
        }
    }
});

// ============================================================================
// 🎬 首次載入執行
// ============================================================================
// 📌 啟動 URL 輪詢並在 800ms 後執行首次初始化
// 📌 延遲是為了確保富果頁面的 Angular 渲染完成

startUrlCheck();
void loadFocusInputShortcut();
setTimeout(initIntegration, 800);
