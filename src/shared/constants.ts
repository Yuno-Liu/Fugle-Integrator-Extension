/**
 * ============================================================================
 * 🔧 常數與設定
 * ============================================================================
 *
 * 集中管理：API 端點、快取策略、富果頁面選擇器、儲存鍵、UI 上限。
 */

import type { CardPosition, ThemePreference } from "./types";

// ============================================================================
// ⏱️ 時間 / 快取策略
// ============================================================================

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** background 對外部 API 的單次請求逾時 */
export const FETCH_TIMEOUT_MS = 10_000;

/** content script 等待 background 回應的逾時（需大於 FETCH_TIMEOUT_MS） */
export const MESSAGE_TIMEOUT_MS = 25_000;

/**
 * 各類資料的快取有效時間（TTL）。
 * 📌 盤後籌碼資料每日更新一次，但更新時間不固定，因此採較短 TTL；
 *    公司基本資料、產業分類等變動很少，採較長 TTL。
 */
export const TTL = {
    profile: 12 * HOUR, // 基本資料、產業/概念/集團、關係企業、產能
    ratings: 6 * HOUR,
    etf: 12 * HOUR,
    chip: 20 * MINUTE, // 主力買賣、連續買賣超、持股比
    fundamentals: 6 * HOUR, // 全市場財務指標
    finmind: 30 * MINUTE,
    stockDb: 24 * HOUR,
} as const;

/** 網路失敗時，允許回傳過期快取的最長時間 */
export const STALE_IF_ERROR_MS = 7 * 24 * HOUR;

/** 持久快取中超過此時間的項目會在啟動時清除 */
export const CACHE_PURGE_AGE_MS = 8 * 24 * HOUR;

/** Cache Storage 名稱（格式變更時遞增版本即可整批失效） */
export const CACHE_NAME = "fugle-integrator-v2";

/** 記憶體快取最多保留的項目數 */
export const MEMORY_CACHE_LIMIT = 300;

// ============================================================================
// 🌐 API 端點
// ============================================================================

const ESUN = "https://sjis.esunsec.com.tw/b2brwdCommon/jsondata";

/** 股票代碼格式（上市櫃、ETF、特別股，例如 2330、00878、2881A、00632R） */
export const STOCK_ID_PATTERN = /^[0-9A-Z]{2,8}$/;

const id = (stockId: string): string => encodeURIComponent(stockId);

/** 公司互動關係類型（b 參數） */
export const RELATION_TYPES = {
    suppliers: 0,
    customers: 1,
    rivals: 2,
    alliances: 3,
    investOuts: 4,
    investIns: 5,
} as const;

export type RelationKey = keyof typeof RELATION_TYPES;

/** 主力買賣統計區間（天） */
export const MAJOR_PERIODS = [1, 3, 5, 10, 20] as const;

export const API = {
    industry: (s: string) => `${ESUN}/12/d4/7f/twstockdata.xdjjson?x=Stock-Basic0006-1&a=AS${id(s)}`,
    concept: (s: string) => `${ESUN}/d3/2e/ee/twstockdata.xdjjson?x=Stock-Basic0006-2&a=AS${id(s)}&b=XQ`,
    group: (s: string) => `${ESUN}/7a/00/dd/twstockdata.xdjjson?x=Stock-Basic0006-3&a=AS${id(s)}&b=XQ`,
    basic: (s: string) => `${ESUN}/b8/58/f9/twstockdata.xdjjson?x=Stock-Basic0001&a=AS${id(s)}`,
    /** 📌 上市與上櫃一律使用 .TW 後綴（實測 .TE 回傳資料較少） */
    relation: (s: string, type: number) => `${ESUN}/default/twstockdata.xdjjson?x=Stock-Basic0007&a=${id(s)}.TW&b=${type}`,
    ratings: (s: string) => `${ESUN}/cf/9a/42/twstockdata.xdjjson?x=Stock-others0001&a=AS${id(s)}`,
    capacity: (s: string) => `${ESUN}/28/97/4b/twstockdata.xdjjson?x=Stock-Basic0008-1&a=${id(s)}.TW`,
    major: (s: string, days: number) => `${ESUN}/b5/2d/d5/twstockdata.xdjjson?a=${id(s)}&x=stock-chip0002-4&f=${days}`,
    etfHolding: (s: string) => `https://www.findbillion.com/api/strategy/v2/strategy/etf_hold_reverse/?stock_country=tw&stock_symbol=${id(s)}`,
    /** FinMind 每日成交量（僅在玉山資料缺少區間成交量時作為備援） */
    finmindVolume: (s: string, startDate: string, endDate: string) => `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${id(s)}&start_date=${startDate}&end_date=${endDate}`,
} as const;

interface MarketListDef {
    /** 建立網址；date 為台北日期 YYYY/MM/DD（不需要日期的清單忽略此參數） */
    url: (date: string) => string;
    /** 以哪個欄位作為股票識別（值為 "AS2330" 格式） */
    keyField: "V1" | "V2";
    ttl: number;
}

/**
 * 全市場清單。
 * 📌 帶日期參數的清單：API 會回傳「該日或之前最近一個交易日」的資料，
 *    因此假日、盤前帶入今天日期也能取得最新資料。
 */
export const MARKET_LISTS = {
    nav: { url: () => `${ESUN}/fe/5f/27/twstockdata.xdjjson?x=stock-basic0001a&a=2`, keyField: "V1", ttl: TTL.fundamentals },
    pb: { url: () => `${ESUN}/67/25/75/twstockdata.xdjjson?x=stock-basic0001a&a=1`, keyField: "V1", ttl: TTL.fundamentals },
    eps: { url: () => `${ESUN}/ec/64/28/twstockdata.xdjjson?x=stock-basic0001a&a=4`, keyField: "V1", ttl: TTL.fundamentals },
    pe: { url: () => `${ESUN}/6f/4c/4a/twstockdata.xdjjson?x=stock-basic0001a&a=3`, keyField: "V1", ttl: TTL.fundamentals },
    dividendYield: { url: () => `${ESUN}/dd/6c/c1/twstockdata.xdjjson?x=stock-basic0001a&a=9`, keyField: "V1", ttl: TTL.fundamentals },
    grossMargin: { url: () => `${ESUN}/94/36/d5/twstockdata.xdjjson?x=stock-basic0001a&a=5`, keyField: "V1", ttl: TTL.fundamentals },
    roe: { url: () => `${ESUN}/4f/88/14/twstockdata.xdjjson?x=stock-basic0001a&a=7`, keyField: "V1", ttl: TTL.fundamentals },
    roa: { url: () => `${ESUN}/5b/b4/ce/twstockdata.xdjjson?x=stock-basic0001a&a=6`, keyField: "V1", ttl: TTL.fundamentals },
    trustBuy: { url: (d) => `${ESUN}/c8/64/c0/twstockdata.xdjjson?x=rank-chip0017-1&b=B&d=5000&a=B&e=${d}`, keyField: "V2", ttl: TTL.chip },
    trustSell: { url: (d) => `${ESUN}/3d/e5/3e/twstockdata.xdjjson?x=rank-chip0017-1&b=S&d=5000&a=B&e=${d}`, keyField: "V2", ttl: TTL.chip },
    foreignBuy: { url: (d) => `${ESUN}/a8/fa/2b/twstockdata.xdjjson?x=rank-chip0007-1&b=B&d=5000&a=B&e=${d}`, keyField: "V2", ttl: TTL.chip },
    foreignSell: { url: (d) => `${ESUN}/aa/45/7f/twstockdata.xdjjson?x=rank-chip0007-1&b=S&d=5000&a=B&e=${d}`, keyField: "V2", ttl: TTL.chip },
    trustHold: { url: (d) => `${ESUN}/57/de/e7/twstockdata.xdjjson?x=rank-chip0021&a=2&b=5000&c=B&d=${d}`, keyField: "V2", ttl: TTL.chip },
    foreignHold: { url: (d) => `${ESUN}/0a/a9/3c/twstockdata.xdjjson?x=rank-chip0011&a=2&b=5000&c=B&d=${d}`, keyField: "V2", ttl: TTL.chip },
} satisfies Record<string, MarketListDef>;

export type MarketListId = keyof typeof MARKET_LISTS;

/** 股票資料庫：遠端最新版（GitHub）與擴充功能內建版 */
export const STOCK_DB_REMOTE_URL = "https://raw.githubusercontent.com/Yuno-Liu/Fugle-Integrator-Extension/refs/heads/main/stock-data.json";
export const STOCK_DB_BUNDLED_PATH = "stock-data.json";

/** background 允許連線的主機（防止被當成任意網址代理） */
export const ALLOWED_HOSTS: readonly string[] = ["sjis.esunsec.com.tw", "www.findbillion.com", "api.finmindtrade.com", "raw.githubusercontent.com"];

// ============================================================================
// 🧭 富果頁面選擇器
// ============================================================================

export const FUGLE = {
    symbol: ".card-group-header__info__symbol",
    price: ".card-group-header__price__price",
    market: ".card-group-header__info__market",
    name: ".stock-name",
    header: ".card-group-header",
    toolbarHost: ".card-group-header__upper-left",
    volume: ".card-group-header__volume span:nth-child(2)",
    volumeHost: ".card-group-header__volume-and-time",
    time: ".card-group-header__time span:nth-child(2)",
    twMarket: ".tw-market",
    /**
     * 頁首股票搜尋框候選選擇器（依序嘗試）。
     * 📌 Ember 自動產生的 id（如 #ember13 / #ember14）會隨登入狀態位移，
     *    因此 #ember14 只在它確實是輸入框時才採用（相容舊版行為）。
     */
    searchInputs: ["#ember14", ".header__search input.search-bar__input", "input.search-bar__input", "header input[type='search']"],
    /**
     * 深色模式標記（舊版 CSS 使用 .body.dark-theme，Tailwind 使用 .tw-dark-theme）。
     * 📌 只檢查 html / body / .body 這些全域容器，避免頁面上局部元件帶有同名 class 時誤判。
     */
    darkMarkers: "html.dark-theme, body.dark-theme, .body.dark-theme, html.tw-dark-theme, body.tw-dark-theme, .body.tw-dark-theme, html[data-theme='dark'], body[data-theme='dark']",
} as const;

/** 股票頁面路徑 */
export const stockPath = (code: string): string => `/ai/${encodeURIComponent(code)}`;

/** FindBillion「持有此股的 ETF」頁面（API 被 Cloudflare 擋下時提供給使用者） */
export const findBillionEtfPage = (code: string): string => `https://www.findbillion.com/twstock/${encodeURIComponent(code)}/etf`;

// ============================================================================
// 🔑 儲存鍵
// ============================================================================

/** chrome.storage.sync（沿用舊版 key，確保既有設定不遺失） */
export const SYNC_KEYS = {
    shortcut: "fugle-focus-input-shortcut",
} as const;

/** chrome.storage.local */
export const LOCAL_KEYS = {
    position: "fi.position",
    visible: "fi.visible",
    collapsed: "fi.collapsed",
    sections: "fi.sections",
    theme: "fi.theme",
    hiddenLinks: "fi.hiddenLinks",
    finmindToken: "fi.finmindToken",
    migrated: "fi.migratedFromLocalStorage",
} as const;

/** 舊版存放於富果網域 localStorage 的鍵（僅供一次性搬移） */
export const LEGACY_LOCAL_STORAGE = {
    position: "fugle-info-position",
    visible: "fugle-info-visible",
    collapsed: "fugle-info-collapsed",
    sectionPrefix: "fugle-section-",
    token: "fugle-volume-api-token",
} as const;

export const DEFAULT_SHORTCUT = "Alt+Q";
export const DEFAULT_POSITION: CardPosition = "right";
export const DEFAULT_THEME: ThemePreference = "auto";

// ============================================================================
// 📏 UI 上限
// ============================================================================

export const LIMITS = {
    /** 晶片清單（概念、關係企業…）預設顯示數量 */
    chips: 12,
    /** 每個相關分類預設顯示的個股數 */
    relatedPerCategory: 10,
    /** 機構評等預設顯示筆數 */
    ratings: 8,
    /** 機構評等統計區間（月） */
    ratingMonths: 6,
    /** ETF 預設顯示檔數 */
    etf: 15,
    /** 搜尋：個股與分類最多筆數 */
    searchStocks: 20,
    searchCategories: 30,
} as const;

/** 監看富果頁面變化的輪詢間隔 */
export const WATCH_INTERVAL_MS = 400;

/** 找不到股票資訊連續多久後視為離開個股頁並移除 UI */
export const UNMOUNT_GRACE_MS = 1500;

// ============================================================================
// 📊 盤中預估量乘數
// ============================================================================

/**
 * [小時, 分鐘上限（不含）, 乘數]，依台北時間查表。
 * 📌 經驗值：開盤初期成交量累積少，乘數高；越接近收盤越趨近 1。
 */
export const VOLUME_MULTIPLIERS: ReadonlyArray<readonly [number, number, number]> = [
    [9, 15, 8], [9, 20, 7.5], [9, 25, 7], [9, 30, 5], [9, 35, 4.75], [9, 40, 4.5], [9, 45, 4], [9, 50, 3.75], [9, 60, 3.5],
    [10, 5, 3], [10, 10, 2.9], [10, 15, 2.8], [10, 20, 2.5], [10, 25, 2.4], [10, 30, 2.3], [10, 35, 2.2], [10, 40, 2.1], [10, 45, 2], [10, 50, 1.95], [10, 55, 1.9], [10, 60, 1.85],
    [11, 5, 1.8], [11, 10, 1.75], [11, 15, 1.7], [11, 20, 1.68], [11, 25, 1.66], [11, 30, 1.64], [11, 35, 1.6], [11, 40, 1.58], [11, 45, 1.55], [11, 50, 1.52], [11, 55, 1.5], [11, 60, 1.48],
    [12, 5, 1.45], [12, 10, 1.42], [12, 15, 1.38], [12, 20, 1.36], [12, 25, 1.34], [12, 30, 1.32], [12, 35, 1.3], [12, 40, 1.28], [12, 45, 1.25], [12, 50, 1.23], [12, 55, 1.22], [12, 60, 1.2],
    [13, 5, 1.18], [13, 10, 1.16], [13, 15, 1.13], [13, 20, 1.12], [13, 25, 1.11], [13, 30, 1.1], [13, 60, 1],
];
