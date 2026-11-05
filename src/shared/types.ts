/**
 * ============================================================================
 * 🏷️ 共用型別定義
 * ============================================================================
 *
 * 分為四類：
 * 1. 外部 API 原始資料（玉山證券 V1..Vn 欄位、FindBillion、FinMind）
 * 2. 正規化後的資料模型（background 解析後傳給 content script）
 * 3. 本地股票資料庫（stock-data.json）
 * 4. UI 設定
 */

// ============================================================================
// 🌐 外部 API 原始資料
// ============================================================================

/** 玉山 API 的單列資料：欄位名稱為 V1、V2 ... Vn，值一律為字串 */
export type EsunRow = Partial<Record<`V${number}`, string>>;

/** 玉山 API 標準外層結構 */
export interface EsunResultSet {
    ResultSet?: {
        Result?: EsunRow[];
        ExpireTime?: string;
        Comment?: string;
    };
}

// ============================================================================
// 📦 正規化資料模型
// ============================================================================

/** 個股基本資料（Stock-Basic0001） */
export interface BasicInfo {
    /** 公司全名（V1） */
    fullName: string;
    /** 公司簡稱（V17） */
    shortName: string;
    /** 實收資本額，單位千元（V2）；股本（億元）= V2 / 100000 */
    capitalThousand: number | null;
    /** 發行股數，單位千股（V3）；市值 = 股價 × V3 × 1000 */
    sharesThousand: number | null;
    /** 每股面額（V4，元） */
    parValue: number | null;
    /** 市場別（V18：TSE / OTC …） */
    marketCode: string;
    /** 營收比重說明（V5） */
    revenueMix: string;
    /** 董事長（V6） */
    chairman: string;
    /** 總經理（V7） */
    president: string;
    /** 成立日期（V15） */
    foundedDate: string;
    /** 上市（櫃）日期（V16） */
    listedDate: string;
    /** 公司網站（V12），僅保留 http(s) */
    website: string;
}

/** 公司互動關係中的一家企業 */
export interface RelationItem {
    /** 去除交易所後綴的代號，例如 "1560" 或 "AAPL" */
    code: string;
    /** 公司名稱 */
    name: string;
    /** 交易所後綴（TW/TE/TT/US/JP...），沒有則為空字串 */
    exchange: string;
    /** 是否為台股（可連結至富果頁面） */
    isTaiwan: boolean;
}

/** 六種公司互動關係 */
export interface Relations {
    suppliers: RelationItem[];
    customers: RelationItem[];
    rivals: RelationItem[];
    alliances: RelationItem[];
    investOuts: RelationItem[];
    investIns: RelationItem[];
    /** 載入失敗的關係類型數量（0 表示全部成功） */
    failed: number;
}

/** 機構評等 */
export interface RatingItem {
    date: string;
    broker: string;
    rating: string;
    /** 目標價；無法解析時為 null */
    target: number | null;
    /** 前次評等 */
    previous: string;
}

/** 產能資料 */
export interface CapacityItem {
    location: string;
    spec: string;
    quantity: string;
    unit: string;
}

/** ETF 持股（FindBillion） */
export interface EtfHolding {
    symbol: string;
    name: string;
    /** 權重（%） */
    ratio: number;
    /** 持有股數 */
    shares: number;
}

/** 單一區間的主力買賣結果 */
export interface MajorPeriod {
    /** 區間天數（1/3/5/10/20） */
    days: number;
    /** 資料日期（YYYY/MM/DD） */
    date: string;
    /** 前 15 大買超分點的淨買超股數（≥ 0） */
    netBuy: number;
    /** 前 15 大賣超分點的淨賣超股數（≤ 0） */
    netSell: number;
    /** 區間成交股數（分母） */
    volume: number;
    /** 主力買賣超占成交量比率（%），正為買超 */
    ratio: number;
    /** 成交量來源：esun = 玉山 V7 欄位；finmind = FinMind 備援 */
    volumeSource: "esun" | "finmind";
}

/** 主力買賣：五個區間（缺資料者為 null） */
export interface MajorSummary {
    periods: Array<MajorPeriod | null>;
}

/**
 * 法人連續買賣超（rank-chip0017-1 投信 / rank-chip0007-1 外資）
 *
 * 原始欄位：V10 = 目前連續天數（買為正、賣為負），V11 = 前一日的連續天數（同樣帶正負號），
 * V6 = 當日淨買賣張數，V9 = 當日淨買賣金額（千元）。
 * 📌 V11 與 V10 同號代表延續；異號才是「轉向」（例如 V10=1、V11=-5 → 由賣轉買，前連賣 5 天）。
 */
export interface ContinuousItem {
    date: string;
    direction: "buy" | "sell";
    /** 目前連續天數（絕對值） */
    days: number;
    /** 是否剛由反方向轉過來 */
    turned: boolean;
    /** 轉向前的反方向連續天數（turned 為 false 時為 0） */
    previousDays: number;
    /** 當日淨買賣張數（帶正負號） */
    lots: number;
    /** 當日淨買賣金額，千元（帶正負號） */
    amountThousand: number;
}

/** 帶資料日期的指標 */
export interface MetricValue {
    value: number | null;
    /** 資料日期（每日指標為交易日；季指標為季別日期，如 2026/06/01 = 2026Q2） */
    date: string | null;
}

/** 全市場清單中擷取出的個股快照 */
export interface MarketSnapshot {
    /** 每股淨值（季） */
    nav: MetricValue;
    /** 股價淨值比（日） */
    pb: MetricValue;
    /** 每股盈餘（單季） */
    eps: MetricValue;
    /** 本益比（日） */
    pe: MetricValue;
    /** 殖利率（日） */
    dividendYield: MetricValue;
    /** 毛利率（單季） */
    grossMargin: MetricValue;
    /** ROE（單季） */
    roe: MetricValue;
    /** ROA（單季） */
    roa: MetricValue;
    /** 投信連續買賣超（不在排行中則為 null） */
    trust: ContinuousItem | null;
    /** 外資連續買賣超 */
    foreign: ContinuousItem | null;
    /** 投信持股比（%） */
    trustHoldPct: number | null;
    /** 外資持股比（%） */
    foreignHoldPct: number | null;
    /** 載入失敗的清單數量 */
    failed: number;
    /** 載入失敗的清單 id（用來區分「載入失敗」與「不在排行中」） */
    unavailable: string[];
}

// ============================================================================
// 📚 本地股票資料庫（stock-data.json）
// ============================================================================

export type CategoryType = "概念" | "產業" | "集團";

export const CATEGORY_TYPES: readonly CategoryType[] = ["概念", "產業", "集團"];

export interface StockBasicInfoDb {
    股票代碼: string;
    股票名稱: string;
    股本_億元?: number;
    董事長?: string;
    總經理?: string;
    營收?: string;
    上市日期?: string;
    工廠?: string;
}

export interface StockCategoryDb {
    股票代碼: string;
    分類類型: CategoryType;
    分類名稱: string;
}

export interface StockDatabase {
    basicInfo: StockBasicInfoDb[];
    categories: StockCategoryDb[];
}

/** 相關個股 */
export interface RelatedStock {
    code: string;
    name: string;
    /** 股本（億元），用於排序 */
    capital: number;
}

/** 某一分類與其成員（已排除目前個股） */
export interface RelatedCategory {
    type: CategoryType;
    name: string;
    /** 成員總數（不含目前個股） */
    total: number;
    /** 依股本排序的前 N 檔 */
    stocks: RelatedStock[];
}

export type RelatedGroups = Record<CategoryType, RelatedCategory[]>;

/** 搜尋結果 */
export interface SearchResults {
    stocks: RelatedStock[];
    categories: Array<{ type: CategoryType; name: string; count: number }>;
}

// ============================================================================
// 🎨 UI 設定
// ============================================================================

/** 資訊卡位置：right/left = 浮動固定；default = 嵌入頁面 */
export type CardPosition = "right" | "left" | "default";

/** 主題偏好：auto = 跟隨富果 */
export type ThemePreference = "auto" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";

export interface UiSettings {
    position: CardPosition;
    visible: boolean;
    collapsed: boolean;
    /** 各區塊展開狀態（key = 區塊 id） */
    sections: Record<string, boolean>;
    theme: ThemePreference;
    /** 快速定位搜尋框的快捷鍵，例如 "Alt+Q" */
    shortcut: string;
    /** 工具列中要隱藏的外部連結 id */
    hiddenLinks: string[];
}
