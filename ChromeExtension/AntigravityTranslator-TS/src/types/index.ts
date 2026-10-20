/**
 * ============================================================================
 * 🌐 Antigravity Translator - 核心資料型別定義 (Types Definition)
 * ============================================================================
 *
 * 本檔案定義 Antigravity 網頁翻譯擴充套件於 Content Script、Background Service Worker、
 * Popup、Options 頁面以及本地 Antigravity CLI Bridge Server 之間共享的型別與介面。
 *
 * 📌 設計準則：
 * - 嚴格型別定義（Strict Typing），嚴禁隱式 any
 * - 完備的 JSDoc 文件註釋，提供 IDE 智慧補全與型別推論支援
 * - 模組化解耦，提供跨執行環境（瀏覽器與 Node.js 測試）的良好相容性
 */

/**
 * Antigravity CLI 推理深度等級 (Reasoning Effort Level)
 * - `low`: 快速回應、低延遲，適合大批次段落翻譯（預設值）
 * - `medium`: 平衡型思考
 * - `high`: 深度推理，適合複雜術語或專業文獻
 * - `xhigh`: 極高推理深度
 * - `max`: 最大推理極限
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * 網頁翻譯結果之呈現模式 (Display Mode)
 * - `bilingual`: 雙語對照模式（在原文下方注入翻譯，不破壞原文排版）
 * - `replace`: 直接替換模式（以翻譯替換原文字串）
 * - `hover`: 懸停顯示模式（滑鼠移動或按快捷鍵時懸浮提示）
 */
export type DisplayMode = 'bilingual' | 'replace' | 'hover';

/**
 * 翻譯風格與語意領域 (Translation Style & Domain Preset)
 * - `natural`: 流暢自然（預設）
 * - `technical`: 技術與工程規範
 * - `financial`: 財經與商業投資
 * - `academic`: 學術與論文專著
 * - `concise`: 簡潔精要
 * - `custom`: 使用者自訂提示詞
 */
export type TranslationStyle = 'natural' | 'technical' | 'financial' | 'academic' | 'concise' | 'custom';

/**
 * 雙語翻譯文字視覺高亮樣式 (Visual Highlight Style)
 * - `none`: 無特殊背景
 * - `subtle-bg`: 微妙背景色塊
 * - `left-border`: 左側彩色邊框標註
 * - `dashed-underline`: 虛線底線
 * - `card`: 獨立氣泡卡片
 */
export type HighlightStyle = 'none' | 'subtle-bg' | 'left-border' | 'dashed-underline' | 'card';

/**
 * 觸發懸停翻譯的輔助修飾鍵 (Hover Modifier Key)
 */
export type HoverTriggerKey = 'Alt' | 'Control' | 'Shift' | 'none';

/**
 * 自訂術語庫表單項目 (Glossary Entry)
 */
export interface GlossaryEntry {
    /** 唯一識別識別碼 (UUID 或 timestamp) */
    id: string;
    /** 原文字詞 (例如: "LLM") */
    source: string;
    /** 目標語言強制對應詞 (例如: "大型語言模型 (LLM)") */
    target: string;
    /** 是否啟用此項對照 */
    enabled: boolean;
    /** 是否區分大小寫 (預設為 false) */
    caseSensitive?: boolean;
}

/**
 * Antigravity 翻譯擴充套件全域設定物件 (Translator Configuration)
 */
export interface TranslatorConfig {
    /** 是否啟用擴充套件全域功能 */
    enabled: boolean;

    // ========================================================================
    // 🖥️ CLI & 本地 Bridge 伺服器設定
    // ========================================================================
    /** 本地橋接伺服器位址 (例如: http://127.0.0.1:18765) */
    bridgeUrl: string;
    /** 系統執行的 Antigravity CLI 指令或執行檔路徑 (例如: agy) */
    cliPath: string;
    /** 呼叫的模型識別碼 (預設: gemini-3.8-flash) */
    model: string;
    /** 模型推理深度 Effort (預設: low) */
    effort: EffortLevel;
    /** 是否啟用「單次最大 Token 全頁直出（免分批）」極速模式 */
    singleBatchMode: boolean;
    /** 單一批次翻譯的最大文字節點數量 */
    batchSize: number;
    /** 單一批次翻譯的最大總字元長度限制 */
    maxCharsPerBatch: number;
    /** 平行批次請求最大併發數 */
    concurrency: number;
    /** CLI 執行或 HTTP 請求逾時秒數 */
    timeoutSec: number;
    /** 傳遞至 Antigravity CLI 的額外參數旗標 */
    extraCliFlags: string;

    // ========================================================================
    // 🌐 語言、提示詞與術語庫設定
    // ========================================================================
    /** 來源語言代碼 (例如: auto, en, ja) */
    sourceLang: string;
    /** 目標語言代碼 (例如: zh-TW, en) */
    targetLang: string;
    /** 翻譯語域風格 */
    translationStyle: TranslationStyle;
    /** 自訂系統指示與補充提示詞 */
    customPrompt: string;
    /** 使用者自訂專有名詞與術語對照清單 */
    glossary: GlossaryEntry[];
    /** 是否嚴格保留原文排版符號與換行 */
    preserveFormatting: boolean;
    /** 是否跳過純數字、金額、版本號與短程式碼符號 */
    skipNumbersAndCodes: boolean;

    // ========================================================================
    // 🎨 視覺渲染與顯示樣式設定
    // ========================================================================
    /** 預設顯示模式 */
    displayMode: DisplayMode;
    /** 譯文字體縮放比例 (0.7 ~ 1.3，預設 0.95) */
    fontSizeScale: number;
    /** 譯文字體顏色 (CSS 顏色值) */
    textColor: string;
    /** 雙語模式下的視覺標記樣式 */
    highlightStyle: HighlightStyle;
    /** 雙語模式下原文與譯文之間的上下間距 (px) */
    bilingualSpacing: number;
    /** 是否將原文稍微淡化顯示 (以凸顯譯文) */
    dimOriginal: boolean;
    /** 是否在網頁右下角顯示浮動快速控制球 */
    showFloatingBall: boolean;
    /** 浮動球停靠方位 */
    floatingBallPosition: 'right' | 'left';

    // ========================================================================
    // ⚡ 互動操作與鍵盤快速鍵
    // ========================================================================
    /** 是否啟用劃詞選取即時翻譯浮窗 */
    enableSelectionTranslate: boolean;
    /** 是否啟用滑鼠懸停劃詞翻譯 */
    enableHoverTranslate: boolean;
    /** 懸停翻譯觸發修飾鍵 */
    hoverTriggerKey: HoverTriggerKey;
    /** 全頁翻譯切換快速鍵 (例如: Alt+T) */
    shortcutTogglePage: string;
    /** 切換顯示模式快速鍵 (例如: Alt+M) */
    shortcutToggleMode: string;
    /** 選取文字翻譯快速鍵 (例如: Alt+S) */
    shortcutTranslateSelection: string;

    // ========================================================================
    // ⚙️ 自動化規則、黑白名單與快取設定
    // ========================================================================
    /** 開啟網頁即自動翻譯的網域名稱清單 (支援萬用字元) */
    autoTranslateDomains: string[];
    /** 永不翻譯的排除網域名稱清單 */
    excludedDomains: string[];
    /** 排除翻譯的 CSS 選擇器清單 (例如: pre, code, .no-translate) */
    excludedSelectors: string[];
    /** 是否翻譯常見標籤屬性 (如 title, placeholder, alt) */
    translateAttributes: boolean;
    /** 是否監聽 DOM 動態變更 (適用於 SPA 單頁應用) */
    dynamicMutationObserve: boolean;
    /** 是否優先翻譯當前視窗 (Viewport) 可見範圍 */
    viewportPriorityOnly: boolean;
    /** 是否啟用本地快取以避免重複消耗額度與時間 */
    enableCache: boolean;
    /** 本地快取最大項目數量 */
    maxCacheEntries: number;
}

/**
 * 待翻譯文字單元 (Translation Item)
 */
export interface TranslationItem {
    /** 唯一識別 ID (通常為數值字串 "0", "1", ...) */
    id: string;
    /** 原始純文字內容 */
    text: string;
}

/**
 * 批次翻譯請求負載 (Translation Batch Request)
 */
export interface TranslationBatchRequest {
    /** 待翻譯單元陣列 */
    items: TranslationItem[];
    /** 來源語言代碼 */
    sourceLang: string;
    /** 目標語言代碼 */
    targetLang: string;
    /** 翻譯語域風格 */
    style: TranslationStyle;
    /** 自訂提示詞 */
    customPrompt: string;
    /** 專有名詞術語表 */
    glossary: GlossaryEntry[];
    /** CLI 模型識別碼 */
    model: string;
    /** CLI 推理深度等級 */
    effort: EffortLevel;
    /** CLI 執行路徑 */
    cliPath: string;
    /** 逾時秒數限制 */
    timeoutSec: number;
    /** 額外傳遞至 CLI 的旗標字串 */
    extraCliFlags: string;
}

/**
 * 批次翻譯結果回應 (Translation Batch Response)
 */
export interface TranslationBatchResponse {
    /** 執行是否成功 */
    success: boolean;
    /** 翻譯結果字典 (Key: id, Value: translated text) */
    translations: Record<string, string>;
    /** 實際使用的模型名稱 */
    modelUsed: string;
    /** 實際使用的推理深度 */
    effortUsed: EffortLevel;
    /** 耗時毫秒數 */
    durationMs: number;
    /** 從快取中命中的項目數 (可選) */
    cachedCount?: number;
    /** 若失敗時的錯誤訊息文字 (可選) */
    error?: string;
}

/**
 * 本地 Bridge 伺服器健康度檢查回應 (Bridge Health Response)
 */
export interface BridgeHealthResponse {
    /** 伺服器與 CLI 是否一切就緒正常 */
    ok: boolean;
    /** 狀態描述文字 (例如 "ready", "cli_not_found") */
    status: string;
    /** 偵測到的 CLI 執行路徑 */
    cliPath: string;
    /** 伺服器預設使用的模型 */
    defaultModel: string;
    /** 伺服器預設推理深度 */
    defaultEffort: EffortLevel;
    /** 可用的模型名稱清單 */
    availableModels?: string[];
    /** Antigravity CLI 或 Bridge 伺服器版本號 */
    version?: string;
    /** 若異常時的詳細錯誤說明 */
    error?: string;
}

/**
 * 本地翻譯快取狀態統計 (Cache Statistics)
 */
export interface CacheStats {
    /** 當前已儲存的快取總筆數 */
    count: number;
    /** 設定的上限筆數 */
    maxEntries: number;
    /** 預估快取佔用記憶體/儲存空間大小 (bytes) */
    estimatedBytes: number;
}

/**
 * 網頁分頁目前的翻譯狀態 (Page Translation State)
 */
export interface PageTranslationState {
    /** 網頁是否已完成全站翻譯呈現 */
    isTranslated: boolean;
    /** 目前是否正在翻譯處理中 */
    isTranslating: boolean;
    /** 總共偵測到的文字節點數 */
    totalNodes: number;
    /** 已成功翻譯的文字節點數 */
    translatedNodes: number;
    /** 從快取直接命中的節點數 */
    cachedNodes: number;
    /** 翻譯失敗或逾時的節點數 */
    failedNodes: number;
    /** 當前頁面使用的呈現模式 */
    displayMode: DisplayMode;
    /** 目前執行的模型名稱 */
    model: string;
    /** 目前執行的推理深度 */
    effort: EffortLevel;
    /** 最近一次發生的錯誤訊息 */
    lastError?: string;
}

/**
 * 擴充套件內部 Runtime Message 動作指令集 (Runtime Message Actions)
 */
export type RuntimeMessageAction =
    | 'TRANSLATE_BATCH'
    | 'TRANSLATE_SINGLE'
    | 'CHECK_BRIDGE_HEALTH'
    | 'CLEAR_CACHE'
    | 'GET_CACHE_STATS'
    | 'TOGGLE_PAGE_TRANSLATION'
    | 'RESTORE_PAGE'
    | 'SWITCH_DISPLAY_MODE'
    | 'GET_PAGE_STATE'
    | 'CONFIG_UPDATED'
    | 'TRANSLATE_SELECTION_FROM_MENU';

/**
 * 擴充套件通用通訊訊息結構 (Runtime Message)
 */
export interface RuntimeMessage<T = unknown> {
    /** 訊息動作指令識別 */
    action: RuntimeMessageAction;
    /** 附帶的負載資料 */
    payload?: T;
}
