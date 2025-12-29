/**
 * 🏷️ 富果整合器 - TypeScript 類型定義
 */

// ==================== API 回應類型 ====================

/** 玉山 API 標準回應結構 */
export interface EsunResultSet<T = Record<string, string>> {
    ResultSet: {
        Result: T[];
    };
}

/** 單一結果項目 (V1, V2, ... 欄位格式) */
export interface ResultItem {
    V1: string;
    V2: string;
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

/** 股票基本資料 */
export interface StockBasicInfo {
    V1: string; // 股票名稱
    V2?: string; // 股票代碼
    V3: string; // 股本
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

/** 關係企業項目 */
export interface RelationItem {
    id: string;
    name: string;
}

/** 機構評等項目 */
export interface RatingItem {
    V1: string; // 日期
    V2: string; // 機構名稱
    V3: string; // 評等
    V4: string; // 目標價
}

/** ETF 持股項目 */
export interface ETFHoldingItem {
    symbol: string;
    name?: string;
    stock_holding_ratio?: number;
    stock_holding_stocknum?: number;
}

/** 產能分析項目 */
export interface CapacityItem {
    V1: string; // 位置
    V2: string; // 規格
    V3: string; // 數量
    V4: string; // 單位
}

/** 主力買賣項目 */
export interface MajorBuySellItem {
    V1?: string; // 日期
    V2?: string;
    V3?: string;
    V4: string; // 買進
    V5: string; // 賣出
}

/** 成交量項目 (finmindtrade API) */
export interface TradingVolumeItem {
    date?: string;
    Date?: string;
    TradeDate?: string;
    V1?: string;
    tradeDate?: string;
    Trading_Volume: number;
}

// ==================== 本地資料庫類型 ====================

/** 股票資料庫 */
export interface StockDatabase {
    basicInfo: StockBasicInfoDb[];
    categories: StockCategoryDb[];
}

/** 股票基本資料 (本地資料庫) */
export interface StockBasicInfoDb {
    股票代碼: string;
    股票名稱: string;
    股本_億元?: number;
}

/** 股票分類 (本地資料庫) */
export interface StockCategoryDb {
    股票代碼: string;
    分類類型: CategoryType;
    分類名稱: string;
}

/** 分類類型 */
export type CategoryType = "概念" | "產業" | "集團";

/** 相關股票 */
export interface RelatedStock {
    code: string;
    name: string;
    capital: number;
}

// ==================== UI 狀態類型 ====================

/** 卡片位置選項 */
export type CardPosition = "default" | "left" | "right";

/** 區塊折疊狀態 */
export interface SectionState {
    basic: boolean;
    major: boolean;
    relation: boolean;
    invest: boolean;
    rating: boolean;
    etf: boolean;
    finance: boolean;
    related: boolean;
    capacity: boolean;
}

// ==================== 主力買賣比率類型 ====================

/** 主力買賣比率計算結果 */
export interface MajorRatioResult {
    majorRatio: number;
    totalBuyStocks: number;
    totalSellStocks: number;
    totalVolume: number;
}

// ==================== Chrome Runtime 訊息類型 ====================

/** Fetch 請求訊息 */
export interface FetchRequestMessage {
    action: "fetch";
    url: string;
    headers?: Record<string, string>;
}

/** Fetch 回應訊息 */
export interface FetchResponseMessage {
    success: boolean;
    data?: string;
    error?: string;
}

// ==================== API URL 函式類型 ====================

/** API URL 建構器 */
export interface ApiUrls {
    industry: (id: string) => string;
    concept: (id: string) => string;
    group: (id: string) => string;
    basic: (id: string) => string;
    relation: (id: string, type: number) => string;
    ratings: (id: string) => string;
    netValueList: string;
    pbRatioList: string;
    epsList: string;
    peRatioList: string;
    yieldList: string;
    marginList: string;
    roeList: string;
    roaList: string;
    etfHolding: (id: string) => string;
    capacity: (id: string) => string;
    majorBuySell1: (id: string) => string;
    majorBuySell5: (id: string) => string;
    majorBuySell10: (id: string) => string;
    majorBuySell20: (id: string) => string;
    tradingVolume: (id: string) => string;
}

// ==================== 全域市場數據緩存 ====================

/** 市場數據緩存 */
export interface MarketDataCache {
    allNetValues: ResultItem[];
    allPBs: ResultItem[];
    allEPS: ResultItem[];
    allPEs: ResultItem[];
    allYields: ResultItem[];
    allMargins: ResultItem[];
    allROEs: ResultItem[];
    allROAs: ResultItem[];
}
