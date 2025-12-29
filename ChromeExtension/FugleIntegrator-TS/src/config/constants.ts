/**
 * 🔧 常數與配置 - TypeScript 版本
 */

import type { ApiUrls } from "../types/index";

/** 請求超時時間 (毫秒) */
export const FETCH_TIMEOUT = 8000;

/** 防抖動延遲 (毫秒) */
export const DEBOUNCE_DELAY = 500;

/** 緩存過期時間 (30 分鐘) */
export const CACHE_TTL = 30 * 60 * 1000;

/** 成交量 API Token 儲存鍵 */
export const VOLUME_API_TOKEN_KEY = "fugle-volume-api-token";

/** 預設成交量 Token (空字串，需使用者自行設置) */
export const DEFAULT_VOLUME_TOKEN = "";

/**
 * 🛠️ API 配置：定義外部數據源路徑
 */
export const API_URLS: ApiUrls = {
    // 產業分類數據
    industry: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/12/d4/7f/twstockdata.xdjjson?x=Stock-Basic0006-1&a=AS${id}`,

    // 概念股數據
    concept: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/d3/2e/ee/twstockdata.xdjjson?x=Stock-Basic0006-2&a=AS${id}&b=XQ`,

    // 集團數據
    group: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/7a/00/dd/twstockdata.xdjjson?x=Stock-Basic0006-3&a=AS${id}&b=XQ`,

    // 股票基本資料（含股本、營收等）
    basic: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b8/58/f9/twstockdata.xdjjson?x=Stock-Basic0001&a=AS${id}`,

    // 📊 公司互動關係系列 (b 參數定義關係類型)
    // 0:供應商, 1:客戶, 2:對手, 3:策略聯盟, 4:轉投資, 5:被投資
    relation: (id: string, type: number) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/default/twstockdata.xdjjson?x=Stock-Basic0007&a=${id}.TW&b=${type}`,

    // 🎯 機構評等數據 (包含日期、機構、評等、目標價)
    ratings: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/cf/9a/42/twstockdata.xdjjson?x=Stock-others0001&a=AS${id}`,

    // 全市場財務指標清單 API
    netValueList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/fe/5f/27/twstockdata.xdjjson?x=stock-basic0001a&a=2`,
    pbRatioList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/67/25/75/twstockdata.xdjjson?x=stock-basic0001a&a=1`,
    epsList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/ec/64/28/twstockdata.xdjjson?x=stock-basic0001a&a=4`,
    peRatioList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/6f/4c/4a/twstockdata.xdjjson?x=stock-basic0001a&a=3`,
    yieldList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/dd/6c/c1/twstockdata.xdjjson?x=stock-basic0001a&a=9`,
    marginList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/94/36/d5/twstockdata.xdjjson?x=stock-basic0001a&a=5`,
    roeList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/4f/88/14/twstockdata.xdjjson?x=stock-basic0001a&a=7`,
    roaList: `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/5b/b4/ce/twstockdata.xdjjson?x=stock-basic0001a&a=6`,

    // 📦 ETF 持股數據 (findbillion)
    etfHolding: (id: string) => `https://www.findbillion.com/api/strategy/v2/strategy/etf_hold_reverse/?stock_country=tw&stock_symbol=${id}`,

    // 🏭 產能分析數據
    capacity: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/28/97/4b/twstockdata.xdjjson?x=Stock-Basic0008-1&a=${id}.TW`,

    // 💼 主力買賣超數據
    majorBuySell1: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=1`,
    majorBuySell5: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=5`,
    majorBuySell10: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=10`,
    majorBuySell20: (id: string) => `https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/b5/2d/d5/twstockdata.xdjjson?a=${id}&x=stock-chip0002-4&f=20`,

    // 📊 成交量數據 (finmindtrade API)
    tradingVolume: (id: string) => {
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        return `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${id}&start_date=${startDate}&end_date=${endDate}`;
    },
};
