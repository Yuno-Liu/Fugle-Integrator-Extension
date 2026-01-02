/**
 * ============================================================================
 * 🏷️ 富果整合器 - TypeScript 類型定義
 * ============================================================================
 *
 * 本模組集中定義所有 TypeScript 介面和類型，提供：
 * - API 回應的結構化類型
 * - 本地資料庫的資料結構
 * - UI 狀態相關類型
 * - Chrome Runtime 訊息格式
 *
 * 📌 命名慣例：
 * - Interface: 使用 PascalCase
 * - Type Alias: 使用 PascalCase
 * - 屬性: 使用 camelCase 或配合 API 回應格式
 *
 * 📌 組織結構：
 * 1. API 回應類型 - 外部 API 返回的資料結構
 * 2. 本地資料庫類型 - stock-data.json 的資料結構
 * 3. UI 狀態類型 - 使用者介面相關狀態
 * 4. Chrome Runtime 類型 - 訊息傳遞格式
 * 5. API URL 類型 - API 函式簽名
 */

// ============================================================================
// 🌐 API 回應類型 - 外部 API 返回的資料結構
// ============================================================================

/**
 * EsunResultSet - 玉山證券 API 標準回應結構
 *
 * 大多數玉山 API 使用此格式包裝回應資料。
 *
 *
 *
 * 📌 典型 API 回應結構：
 * ```json
 * [
 *   "ResultSet": {
 *     "Result": [
 *       { "V1": "台積電", "V2": "2330", ... },
 *       ...
 *     ]
 *   },
 *   "ResultSet": {
 *     "Result": [
 *       { "V1": "台積電", "V2": "2330", ... },
 *       ...
 *     ]
 *   },
 * ]
 * ```
 */
export interface EsunResultSet<T> {
    ResultSet: {
        Result: T[];
    };
}

/**
 * ResultItem - 單一結果項目
 *
 * 玉山 API 使用 V1, V2, V3... 作為欄位名稱的通用結構。
 * 每個 API 的欄位意義不同，需參照 API 文檔。
 *
 * 📌 常見欄位對應：
 * - 基本資料: V1=名稱, V3=股本, V5=營收, V16=日期
 * - 市場清單: V1=股票代碼, V2=數值
 */
export interface ResultItem {
    V1: string; // 通常為識別符或名稱
    V2: string; // 通常為主要數值
    V3?: string;
    V4?: string;
    V5?: string;
    V6?: string;
    V7?: string;
    V8?: string;
    V9?: string;
    V10?: string;
    V11?: string;
    V12?: string;
    V13?: string;
    V14?: string;
    V15?: string;
    V16?: string;
}

/**
 * StockBasicInfo - 股票基本資料
 *
 * 來自 Stock-Basic0001 API 的回應結構。
 *
 * 📌 欄位對應：
 * - V1: 股票名稱（例如 "台積電"）
 * - V2: 股票代碼（部分 API 可能省略）
 * - V3: 股本（千股）
 * - V5: 營收資訊
 * - V16: 資料日期
 */
export interface StockBasicInfo {
    V1: string; // 股票名稱
    V2?: string; // 股票代碼
    V3: string; // 股本（千股）
    V4?: string;
    V5: string; // 營收
    V6?: string;
    V7?: string;
    V8?: string;
    V9?: string;
    V10?: string;
    V11?: string;
    V12?: string;
    V13?: string;
    V14?: string;
    V15?: string;
    V16: string; // 日期
}

/**
 * RelationItem - 關係企業項目
 *
 * 表示一家關係企業（供應商、客戶、對手等）的資料。
 */
export interface RelationItem {
    /** 股票代碼（可能帶 .TW 後綴） */
    id: string;
    /** 公司名稱 */
    name: string;
}

/**
 * RatingItem - 機構評等項目
 *
 * 來自 Stock-others0001 API 的回應結構。
 *
 * 📌 欄位對應：
 * - V1: 評等日期（例如 "2024/01/15"）
 * - V2: 機構名稱（例如 "凱基"）
 * - V3: 評等結果（例如 "買進"）
 * - V4: 目標價（例如 "1000"）
 */
export interface RatingItem {
    V1: string; // 日期
    V2: string; // 機構名稱
    V3: string; // 評等
    V4: string; // 目標價
}

/**
 * ETFHoldingItem - ETF 持股項目
 *
 * 來自 findbillion API 的回應結構。
 * 表示某檔 ETF 對特定股票的持股資訊。
 */
export interface ETFHoldingItem {
    /** ETF 代碼（例如 "0050"） */
    symbol: string;
    /** ETF 名稱（例如 "元大台灣50"） */
    name?: string;
    /** 該股票在 ETF 中的權重比例 (%) */
    stock_holding_ratio?: number;
    /** 持有股數 */
    stock_holding_stocknum?: number;
}

/**
 * CapacityItem - 產能分析項目
 *
 * 來自 Stock-Basic0008-1 API 的回應結構。
 * 描述公司的生產設施資訊。
 */
export interface CapacityItem {
    V1: string; // 位置（例如 "台南廠"）
    V2: string; // 規格（例如 "12 吋晶圓"）
    V3: string; // 數量
    V4: string; // 單位（例如 "萬片/月"）
}

/**
 * MajorBuySellItem - 主力買賣項目
 *
 * 來自 stock-chip0002-4 API 的回應結構。
 * 描述單一券商的買賣資訊。
 *
 * 📌 欄位對應：
 * - V1: 日期（YYYY/MM/DD 格式）
 * - V2: 券商代碼
 * - V3: 券商名稱
 * - V4: 買進股數
 * - V5: 賣出股數
 * - V6: LotSize（每張數量，通常為 1000）
 * - V7: 當日交易總股數
 */
export interface MajorBuySellItem {
    V1?: string; // 日期（YYYY/MM/DD）
    V2?: string; // 券商代碼
    V3?: string; // 券商名稱
    V4: string; // 買進股數
    V5: string; // 賣出股數
    V6?: string; // LotSize（通常 1000）
    V7?: string; // 當日交易總股數
}

/**
 * TradingVolumeItem - 成交量項目
 *
 * 來自 finmindtrade API 的回應結構。
 * 表示單日的成交量資料。
 *
 * 📌 日期欄位可能有多種格式：
 * - date, Date, TradeDate, tradeDate 等
 * 處理時需逐一檢查
 */
export interface TradingVolumeItem {
    date?: string; // 日期格式 1
    Date?: string; // 日期格式 2
    TradeDate?: string; // 日期格式 3
    V1?: string; // 日期格式 4
    tradeDate?: string; // 日期格式 5
    Trading_Volume: number; // 成交量（股數）
}

// ============================================================================
// 📚 本地資料庫類型 - stock-data.json 的資料結構
// ============================================================================

/**
 * StockDatabase - 股票資料庫
 *
 * 本地 JSON 資料庫的根結構。
 */
export interface StockDatabase {
    /** 股票基本資料列表 */
    basicInfo: StockBasicInfoDb[];
    /** 股票分類列表 */
    categories: StockCategoryDb[];
}

/**
 * StockBasicInfoDb - 股票基本資料 (本地資料庫格式)
 *
 * 📌 使用中文屬性名稱以配合資料來源格式
 */
export interface StockBasicInfoDb {
    /** 股票代碼（例如 "2330"） */
    股票代碼: string;
    /** 股票名稱（例如 "台積電"） */
    股票名稱: string;
    /** 股本（億元），用於排序 */
    股本_億元?: number;
}

/**
 * StockCategoryDb - 股票分類 (本地資料庫格式)
 *
 * 表示股票與分類的對應關係。
 * 一支股票可能屬於多個分類。
 */
export interface StockCategoryDb {
    /** 股票代碼 */
    股票代碼: string;
    /** 分類類型 */
    分類類型: CategoryType;
    /** 分類名稱（例如 "AI"、"半導體"） */
    分類名稱: string;
}

/**
 * CategoryType - 分類類型
 *
 * 定義股票可歸屬的三種分類維度。
 */
export type CategoryType = "概念" | "產業" | "集團";

/**
 * RelatedStock - 相關股票
 *
 * 用於顯示同分類股票的簡化結構。
 */
export interface RelatedStock {
    /** 股票代碼 */
    code: string;
    /** 股票名稱 */
    name: string;
    /** 股本（億元），用於排序 */
    capital: number;
}

// ============================================================================
// 🎨 UI 狀態類型 - 使用者介面相關狀態
// ============================================================================

/**
 * CardPosition - 卡片位置選項
 *
 * 資訊卡的三種顯示位置：
 * - default: 嵌入頁面內（隨頁面捲動）
 * - left: 固定在左側
 * - right: 固定在右側
 */
export type CardPosition = "default" | "left" | "right";

/**
 * SectionState - 區塊折疊狀態
 *
 * 記錄資訊卡中各區塊的展開/折疊狀態。
 * 用於 localStorage 持久化。
 */
export interface SectionState {
    basic: boolean; // 基本資料
    major: boolean; // 主力買賣
    relation: boolean; // 關係企業
    invest: boolean; // 投資佈局
    rating: boolean; // 機構評等
    etf: boolean; // ETF 持股
    finance: boolean; // 財務指標
    related: boolean; // 相關個股
    capacity: boolean; // 產能分析
}

// ============================================================================
// 💼 主力買賣比率類型
// ============================================================================

/**
 * MajorRatioResult - 主力買賣比率計算結果
 *
 * calculateMajorRatio() 函式的返回類型。
 */
export interface MajorRatioResult {
    /** 日期 */
    date: string;
    /** 主力買賣占成交量比率 (%)，正為買超、負為賣超 */
    majorRatio: number;
    /** 總買進股數 */
    totalBuyStocks: number;
    /** 總賣出股數 */
    totalSellStocks: number;
    /** 區間總成交量 */
    totalVolume: number;
}

// ============================================================================
// 📡 Chrome Runtime 訊息類型
// ============================================================================

/**
 * FetchRequestMessage - Fetch 請求訊息
 *
 * Content Script 發送給 Background Script 的訊息格式。
 */
export interface FetchRequestMessage {
    /** 操作類型識別符，必須為 "fetch" */
    action: "fetch";
    /** 目標 API URL */
    url: string;
    /** 可選的 HTTP 請求標頭（例如 Authorization） */
    headers?: Record<string, string>;
}

/**
 * FetchResponseMessage - Fetch 回應訊息
 *
 * Background Script 返回給 Content Script 的訊息格式。
 */
export interface FetchResponseMessage {
    /** 請求是否成功 */
    success: boolean;
    /** 成功時的回應資料（純文字） */
    data?: string;
    /** 失敗時的錯誤訊息 */
    error?: string;
}

// ============================================================================
// 🔗 API URL 函式類型
// ============================================================================

/**
 * ApiUrls - API URL 建構器集合
 *
 * 定義 constants.ts 中 API_URLS 物件的類型。
 * 包含動態 URL 建構函式和靜態 URL 字串。
 */
export interface ApiUrls {
    // 股票分類 API
    industry: (id: string) => string;
    concept: (id: string) => string;
    group: (id: string) => string;

    // 基本資料 API
    basic: (id: string) => string;

    // 關係企業 API
    relation: (id: string, type: number) => string;

    // 機構評等 API
    ratings: (id: string) => string;

    // 全市場財務指標 API (靜態 URL)
    netValueList: string;
    pbRatioList: string;
    epsList: string;
    peRatioList: string;
    yieldList: string;
    marginList: string;
    roeList: string;
    roaList: string;

    // ETF 持股 API
    etfHolding: (id: string) => string;

    // 產能分析 API
    capacity: (id: string) => string;

    // 主力買賣 API
    majorBuySell1: (id: string) => string;
    majorBuySell3: (id: string) => string;
    majorBuySell5: (id: string) => string;
    majorBuySell10: (id: string) => string;
    majorBuySell20: (id: string) => string;

    // 成交量 API
    tradingVolume: (id: string) => string;
}

// ============================================================================
// 📦 全域市場數據緩存類型
// ============================================================================

/**
 * MarketDataCache - 市場數據緩存
 *
 * 儲存全市場財務指標的快取結構。
 * 用於避免重複請求大量靜態數據。
 */
export interface MarketDataCache {
    /** 每股淨值排行 */
    allNetValues: ResultItem[];
    /** 股價淨值比排行 */
    allPBs: ResultItem[];
    /** 每股盈餘排行 */
    allEPS: ResultItem[];
    /** 本益比排行 */
    allPEs: ResultItem[];
    /** 殖利率排行 */
    allYields: ResultItem[];
    /** 毛利率排行 */
    allMargins: ResultItem[];
    /** ROE 排行 */
    allROEs: ResultItem[];
    /** ROA 排行 */
    allROAs: ResultItem[];
}
