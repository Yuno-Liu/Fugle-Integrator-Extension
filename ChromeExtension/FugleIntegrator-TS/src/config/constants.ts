/**
 * ============================================================================
 * 🔧 常數與配置 - TypeScript 版本
 * ============================================================================
 *
 * 本模組集中管理所有常數和配置項目，包括：
 * - 網路請求相關的超時和延遲設定
 * - localStorage 儲存鍵名
 * - 所有外部 API 的 URL 定義
 *
 * 📌 設計原則：
 * - 集中管理便於維護和修改
 * - 使用 TypeScript 類型確保 API 函式的正確性
 * - 環境變數和魔術數字統一定義
 */

import type { ApiUrls } from "../types/index";

// ============================================================================
// ⏱️ 時間常數
// ============================================================================

/**
 * 請求超時時間 (毫秒)
 * 📌 當 API 請求超過此時間未回應，將被視為失敗
 */
export const FETCH_TIMEOUT = 8000;

/**
 * 防抖動延遲 (毫秒)
 * 📌 用於避免頻繁觸發的事件（如 URL 變化）導致過多請求
 * 📌 在最後一次觸發後等待此時間才執行
 */
export const DEBOUNCE_DELAY = 500;

/**
 * 緩存過期時間 (30 分鐘)
 * 📌 全市場財務數據的快取時間
 * 📌 這些數據更新頻率低，使用快取可減少 API 請求
 */
export const CACHE_TTL = 30 * 60 * 1000;

// ============================================================================
// 🔑 localStorage 儲存鍵
// ============================================================================

/**
 * 成交量 API Token 的 localStorage 儲存鍵
 * 📌 finmindtrade API 需要認證 Token
 */
export const VOLUME_API_TOKEN_KEY = "fugle-volume-api-token";

/**
 * 預設成交量 Token (空字串，需使用者自行設置)
 * 📌 使用者可透過 UI 設定自己的 Token
 */
export const DEFAULT_VOLUME_TOKEN = "";

// ============================================================================
// 🌐 API 配置
// ============================================================================

/**
 * API_URLS - 外部數據源 URL 配置
 *
 * 定義所有外部 API 的 URL 建構函式或靜態 URL。
 * 主要資料來源為玉山證券 (sjis.esunsec.com.tw) 的公開 API。
 *
 * 📌 URL 參數說明：
 * - x: API 識別碼，用於指定資料類型
 * - a: 股票代碼（通常格式為 AS{stockId}）
 * - b: 子類型參數（關係類型、分類類型等）
 *
 * 📌 API 分類：
 * 1. 股票基本資料 API
 * 2. 股票分類 API（產業、概念、集團）
 * 3. 關係企業 API
 * 4. 機構評等 API
 * 5. 全市場財務指標 API
 * 6. 第三方資料 API（ETF 持股、成交量）
 * 7. 主力買賣 API
 */
export const API_URLS: ApiUrls = {
    // ========================================
    // 📂 股票分類 API
    // ========================================

    /**
     * 產業分類數據
     * @param id - 股票代碼
     * @returns 產業分類列表
     */
    industry: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/12/d4/7f/twstockdata.xdjjson?x=Stock-Basic0006-1&a=AS${id}`,

    /**
     * 概念股數據
     * @param id - 股票代碼
     * @returns 所屬概念股列表
     * @note b=XQ 表示使用 XQ 資料來源
     */
    concept: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/d3/2e/ee/twstockdata.xdjjson?x=Stock-Basic0006-2&a=AS${id}&b=XQ`,

    /**
     * 集團數據
     * @param id - 股票代碼
     * @returns 所屬集團列表
     */
    group: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/7a/00/dd/twstockdata.xdjjson?x=Stock-Basic0006-3&a=AS${id}&b=XQ`,

    // ========================================
    // 📋 股票基本資料 API
    // ========================================

    /**
     * 股票基本資料（含股本、營收等）
     * @param id - 股票代碼
     * @returns 包含 V1-V16 欄位的基本資料
     */
    basic: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b8/58/f9/twstockdata.xdjjson?x=Stock-Basic0001&a=AS${id}`,

    // ========================================
    // 🤝 公司互動關係 API
    // ========================================

    /**
     * 📊 公司互動關係系列
     * @param id - 股票代碼（需帶 .TW 後綴）
     * @param type - 關係類型代碼
     *
     * 關係類型定義 (b 參數)：
     * - 0: 供應商 - 提供原物料或服務的公司
     * - 1: 客戶 - 購買產品或服務的公司
     * - 2: 競爭對手 - 同業競爭者
     * - 3: 策略聯盟 - 有合作關係的公司
     * - 4: 轉投資 - 本公司投資的對象
     * - 5: 被投資 - 投資本公司的對象
     */
    relation: (id: string, type: number) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/default/twstockdata.xdjjson?x=Stock-Basic0007&a=${id}.TW&b=${type}`,

    // ========================================
    // 🎯 機構評等 API
    // ========================================

    /**
     * 機構評等數據
     * @param id - 股票代碼
     * @returns 包含日期、機構名稱、評等、目標價的列表
     */
    ratings: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/cf/9a/42/twstockdata.xdjjson?x=Stock-others0001&a=AS${id}`,

    // ========================================
    // 📊 全市場財務指標 API
    // ========================================
    // 📌 這些 API 返回全市場所有股票的特定指標
    // 📌 使用 findVal() 函式從中提取特定股票的數值

    /** 每股淨值 (BVPS) 排行 */
    netValueList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/fe/5f/27/twstockdata.xdjjson?x=stock-basic0001a&a=2`,

    /** 股價淨值比 (PB) 排行 */
    pbRatioList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/67/25/75/twstockdata.xdjjson?x=stock-basic0001a&a=1`,

    /** 每股盈餘 (EPS) 排行 */
    epsList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/ec/64/28/twstockdata.xdjjson?x=stock-basic0001a&a=4`,

    /** 本益比 (PE) 排行 */
    peRatioList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/6f/4c/4a/twstockdata.xdjjson?x=stock-basic0001a&a=3`,

    /** 殖利率排行 */
    yieldList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/dd/6c/c1/twstockdata.xdjjson?x=stock-basic0001a&a=9`,

    /** 毛利率排行 */
    marginList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/94/36/d5/twstockdata.xdjjson?x=stock-basic0001a&a=5`,

    /** 股東權益報酬率 (ROE) 排行 */
    roeList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/4f/88/14/twstockdata.xdjjson?x=stock-basic0001a&a=7`,

    /** 資產報酬率 (ROA) 排行 */
    roaList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/5b/b4/ce/twstockdata.xdjjson?x=stock-basic0001a&a=6`,

    // ========================================
    // 📦 ETF 持股 API (findbillion)
    // ========================================

    /**
     * ETF 持股數據
     * @param id - 股票代碼
     * @returns 持有該股票的 ETF 列表，包含持股比例和張數
     * @note 使用 findbillion 第三方 API
     */
    etfHolding: (id: string) => `https://www.findbillion.com/api/strategy/v2/strategy/etf_hold_reverse/?stock_country=tw&stock_symbol=${id}`,

    // ========================================
    // 🏭 產能分析 API
    // ========================================

    /**
     * 產能分析數據
     * @param id - 股票代碼
     * @returns 產能規格、位置、數量等資訊
     */
    capacity: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/28/97/4b/twstockdata.xdjjson?x=Stock-Basic0008-1&a=${id}.TW`,

    // ========================================
    // 💼 主力買賣超 API
    // ========================================
    // 📌 f 參數指定統計天數

    /** 主力買賣超 1 日數據 */
    majorBuySell1: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=1`,

    /** 主力買賣超 3 日數據 */
    majorBuySell3: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=3`,

    /** 主力買賣超 5 日數據 */
    majorBuySell5: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=5`,

    /** 主力買賣超 10 日數據 */
    majorBuySell10: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=10`,

    /** 主力買賣超 20 日數據 */
    majorBuySell20: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=20`,

    // ========================================
    // 📊 成交量 API (finmindtrade)
    // ========================================

    /**
     * 成交量數據
     * @param id - 股票代碼
     * @returns 過去 80 天的每日成交量數據
     * @note 使用 finmindtrade API，需要認證 Token
     * @note 日期範圍動態計算：當日往前 80 天
     */
    tradingVolume: (id: string) => {
        // 計算日期範圍：當日和 80 天前
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        return `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${id}&start_date=${startDate}&end_date=${endDate}`;
    },

    // ========================================
    // 🏛️ 連續買賣超 API
    // ========================================

    /** 投信連買排行 */
    trustBuyList: (date: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/c8/64/c0/twstockdata.xdjjson?x=rank-chip0017-1&b=B&d=5000&a=B&e=${date}`,

    /** 投信連賣排行 */
    trustSellList: (date: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/3d/e5/3e/twstockdata.xdjjson?x=rank-chip0017-1&b=S&d=5000&a=B&e=${date}`,

    /** 外資連買排行 */
    foreignBuyList: (date: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/a8/fa/2b/twstockdata.xdjjson?x=rank-chip0007-1&b=B&d=5000&a=B&e=${date}`,

    /** 外資連賣排行 */
    foreignSellList: (date: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/aa/45/7f/twstockdata.xdjjson?x=rank-chip0007-1&b=S&d=5000&a=B&e=${date}`,
};
