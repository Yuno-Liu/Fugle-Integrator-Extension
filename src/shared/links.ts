/**
 * ============================================================================
 * 🔗 工具列外部連結
 * ============================================================================
 *
 * 工具列與設定頁共用；id 用於設定頁的顯示 / 隱藏開關。
 */

export interface LinkContext {
    stockId: string;
    name: string;
    /** 富果頁面上的市場別文字（上市 / 上櫃 / 興櫃…） */
    market: string;
}

export interface ExternalLink {
    id: string;
    label: string;
    /** 滑鼠提示（不含股票資訊） */
    title: string;
    url: (c: LinkContext) => string;
}

const enc = encodeURIComponent;

export const EXTERNAL_LINKS: readonly ExternalLink[] = [
    { id: "wantgoo", label: "📈 WantGoo", title: "玩股網個股頁", url: (c) => `https://www.wantgoo.com/stock/${enc(c.stockId)}` },
    { id: "cmoney", label: "💬 CMoney", title: "CMoney 股市爆料同學會", url: (c) => `https://www.cmoney.tw/forum/stock/${enc(c.stockId)}` },
    { id: "dispose", label: "⚔︎ 處置", title: "處置神器（處置股資訊）", url: (c) => `https://warrantlb8888.cmoney.tw/DispositionGod/stock/${enc(c.stockId)}` },
    {
        id: "tradingview",
        label: "📊 TV",
        title: "TradingView 技術線圖",
        url: (c) => `https://tw.tradingview.com/chart/2i2CtMYT/?symbol=${c.market === "上市" ? "TWSE" : "TPEX"}:${enc(c.stockId)}`,
    },
    { id: "fubon-institution", label: "🏛️ 法人", title: "富邦證券：法人進出", url: (c) => `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl.djhtm?a=${enc(c.stockId)}&b=3` },
    { id: "fubon-major", label: "👤 主力", title: "富邦證券：主力進出", url: (c) => `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zco/zco_${enc(c.stockId)}.djhtm` },
    {
        id: "gemini",
        label: "🤖 Gemini",
        title: "以 Gemini 分析這檔股票",
        url: (c) => `https://gemini.google.com/gem/1QUXOXLuTZt54GwWAClfuBcs7Q4LlFRsc?usp=sharing&p=${enc(`${c.stockId} ${c.name}`.trim())}`,
    },
    {
        id: "chatgpt",
        label: "🤖 ChatGPT",
        title: "以 ChatGPT 分析這檔股票",
        url: (c) => `https://chatgpt.com/g/g-p-6a7bd905e76c8191845afc2c828aec0f/project?prompt=${enc(`${c.stockId} ${c.name}`.trim())}`,
    },
];
