/**
 * ============================================================================
 * ⚙️ Antigravity Translator - 全域常數與預設配置 (Constants & Config)
 * ============================================================================
 *
 * 本模組負責管理擴充套件的預設配置、支援語言列表、可用模型定義、領域提示詞預設集，
 * 以及提供 Chrome Storage 與 Node.js 執行環境相容的設定讀寫封裝。
 */

import type {
    EffortLevel,
    GlossaryEntry,
    TranslationStyle,
    TranslatorConfig
} from "../types/index.js";

/**
 * Chrome Storage Local 儲存鍵名定義
 */
export const STORAGE_KEYS = {
    /** 擴充套件全域偏好設定 */
    CONFIG: "agy_translator_config",
    /** 本地翻譯快取資料 */
    CACHE: "agy_translator_cache",
    /** 翻譯次數與流量統計 */
    STATS: "agy_translator_stats"
} as const;

/**
 * 支援的翻譯語言清單
 */
export const SUPPORTED_LANGUAGES = [
    { code: "auto", name: "自動偵測 (Auto Detect)" },
    { code: "zh-TW", name: "繁體中文 (台灣 - Traditional Chinese)" },
    { code: "zh-CN", name: "簡體中文 (Simplified Chinese)" },
    { code: "en", name: "English (英語)" },
    { code: "ja", name: "日本語 (日語)" },
    { code: "ko", name: "한국어 (韓語)" },
    { code: "fr", name: "Français (法語)" },
    { code: "de", name: "Deutsch (德語)" },
    { code: "es", name: "Español (西班牙語)" },
    { code: "vi", name: "Tiếng Việt (越南語)" },
    { code: "th", name: "ภาษาไทย (泰語)" }
] as const;

/**
 * Antigravity CLI 可呼叫的推薦模型清單
 */
export const AVAILABLE_MODELS = [
    {
        id: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash (推薦・極速翻譯)",
        badge: "預設",
        description: "極速回應、資源消耗低，特別適合全站大批次網頁即時翻譯"
    },
    {
        id: "gemini-4-argon",
        label: "Gemini 4 Argon (深度語意與長文)",
        badge: "高階",
        description: "高推理深度、上下文理解極佳，適合結構複雜文獻與長篇報導"
    },
    {
        id: "claude-sonnet-5-5",
        label: "Claude Sonnet 5.5 (自然文學語感)",
        badge: "進階",
        description: "文筆自然流暢、優美，適合小說閱讀與軟體文件在地化"
    },
    {
        id: "claude-opus-5-5",
        label: "Claude Opus 5.5 (最高精準度)",
        badge: "旗艦",
        description: "旗艦級精確度與推敲能力，適用於合約法律與嚴格學術文本"
    },
    {
        id: "gpt-oss-120b",
        label: "GPT-OSS 120B (開放模型)",
        badge: "開源",
        description: "開放權重大型模型，表現穩定且具備良好多語言能力"
    }
] as const;

/**
 * CLI 推理深度等級定義與標籤說明
 */
export const EFFORT_LEVELS: Record<EffortLevel, { label: string; description: string }> = {
    low: {
        label: "極速低延遲 (low)",
        description: "預設模式，最小化推論時間與延遲，達成絲滑網頁閱讀體驗"
    },
    medium: {
        label: "標準平衡 (medium)",
        description: "在翻譯精準度與反應速度之間取得良好平衡"
    },
    high: {
        label: "深度推理 (high)",
        description: "給予模型充裕思考空間，深入分析句構與文化意涵"
    },
    xhigh: {
        label: "極高推理 (xhigh)",
        description: "適合高度歧義或晦澀文法之專業論文翻譯"
    },
    max: {
        label: "最大極限 (max)",
        description: "最大推理預算，確保每一細節精確無誤"
    }
};

/**
 * 領域翻譯風格預設集與系統指示詞
 */
export const STYLE_PRESETS: Record<
    TranslationStyle,
    { label: string; description: string; systemInstruction: string }
> = {
    natural: {
        label: "自然流暢 (Natural)",
        description: "日常母語習慣，通順得體，兼顧閱讀流暢感與原意",
        systemInstruction:
            "請以符合目標語言母語人士的日常閱讀習慣進行翻譯，行文流暢自然、語調得體，避免生硬死板的逐字直譯。"
    },
    technical: {
        label: "軟體技術 (Technical)",
        description: "精準規範的工程語彙，保留常見英文縮寫與專有名詞",
        systemInstruction:
            "你是一位資深軟體工程專家。翻譯請使用精確專業的電腦科學與技術工程術語；對於業界習慣保留英文的縮寫或術語（如 API, React, async/await 等），請保留原文或適當加註。"
    },
    financial: {
        label: "財經商業 (Financial)",
        description: "專業財金、證券投資與商務語氣，嚴謹客觀",
        systemInstruction:
            "你是一位專業財經分析師與商務口譯。翻譯時請採用標準證券、金融財務與商業經營術語（例如 EPS 翻譯為每股盈餘、YoY 翻譯為年增率），語調保持客觀嚴謹且精準。"
    },
    academic: {
        label: "學術論文 (Academic)",
        description: "典雅嚴謹的論文論述風格，結構清晰邏輯嚴密",
        systemInstruction:
            "請以正式學術期刊規範的嚴謹典雅風格進行翻譯，保持邏輯結構分明，術語對照嚴格一致，符合學術研究專著之論述口吻。"
    },
    concise: {
        label: "簡潔精要 (Concise)",
        description: "精煉俐落，去除多餘贅字與冗言，提綱挈領",
        systemInstruction:
            "請以精簡洗鍊的文筆進行翻譯，在完全不失原意的前提下去除冗贅語詞，確保文字短小精幹，利於快速掃讀瀏覽。"
    },
    custom: {
        label: "自訂風格 (Custom)",
        description: "使用使用者在設定中指定的自訂指示詞",
        systemInstruction: "請遵循使用者提供的自訂規則與特殊語氣要求進行翻譯。"
    }
};

/**
 * 預設略過的 HTML 標籤名稱集合（不進行內容翻譯）
 */
export const DEFAULT_EXCLUDED_TAGS = new Set<string>([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "CODE",
    "PRE",
    "KBD",
    "SAMP",
    "VAR",
    "SVG",
    "MATH",
    "CANVAS",
    "IFRAME",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION"
]);

/**
 * 內建預設術語庫項目範例
 */
export const DEFAULT_GLOSSARY: GlossaryEntry[] = [
    {
        id: "glossary-1",
        source: "Antigravity",
        target: "Antigravity",
        enabled: true,
        caseSensitive: false
    },
    {
        id: "glossary-2",
        source: "EPS",
        target: "每股盈餘 (EPS)",
        enabled: true,
        caseSensitive: true
    },
    {
        id: "glossary-3",
        source: "LLM",
        target: "大型語言模型 (LLM)",
        enabled: true,
        caseSensitive: true
    },
    {
        id: "glossary-4",
        source: "YoY",
        target: "年增率 (YoY)",
        enabled: true,
        caseSensitive: false
    }
];

/**
 * 擴充套件預設設定值
 */
export const DEFAULT_CONFIG: TranslatorConfig = {
    enabled: true,

    // CLI & Bridge Settings
    bridgeUrl: "http://127.0.0.1:18765",
    cliPath: "agy",
    model: "gemini-3.8-flash",
    effort: "low",
    singleBatchMode: true,
    batchSize: 100,
    maxCharsPerBatch: 15000,
    concurrency: 4,
    timeoutSec: 60,
    extraCliFlags: "",

    // Language & Prompt Settings
    sourceLang: "auto",
    targetLang: "zh-TW",
    translationStyle: "natural",
    customPrompt: "",
    glossary: DEFAULT_GLOSSARY,
    preserveFormatting: true,
    skipNumbersAndCodes: true,

    // Visual & Display Settings
    displayMode: "bilingual",
    fontSizeScale: 0.95,
    textColor: "#2563EB",
    highlightStyle: "subtle-bg",
    bilingualSpacing: 4,
    dimOriginal: false,
    showFloatingBall: true,
    floatingBallPosition: "right",

    // Interaction & Shortcuts
    enableSelectionTranslate: true,
    enableHoverTranslate: false,
    hoverTriggerKey: "Alt",
    shortcutTogglePage: "Alt+T",
    shortcutToggleMode: "Alt+M",
    shortcutTranslateSelection: "Alt+S",

    // Automation & Filtering
    autoTranslateDomains: [],
    excludedDomains: [],
    excludedSelectors: [".no-translate", '[translate="no"]'],
    translateAttributes: false,
    dynamicMutationObserve: true,
    viewportPriorityOnly: false,
    enableCache: true,
    maxCacheEntries: 5000
};

/**
 * 記憶體暫存（用於非 Chrome 擴充環境，例如 Node.js 單元測試）
 */
let memoryConfigStore: TranslatorConfig = { ...DEFAULT_CONFIG };

/**
 * 取得當前擴充套件設定
 *
 * 自動適應 Chrome 擴充套件環境與 Node.js 測試環境。
 * 若尚未儲存過設定，將自動回傳預設設定。
 *
 * @returns Promise<TranslatorConfig>
 */
export async function getConfig(): Promise<TranslatorConfig> {
    try {
        if (
            typeof chrome !== "undefined" &&
            chrome.storage &&
            chrome.storage.local
        ) {
            const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
            const saved = result[STORAGE_KEYS.CONFIG] as Partial<TranslatorConfig> | undefined;
            if (!saved) {
                return { ...DEFAULT_CONFIG };
            }
            return {
                ...DEFAULT_CONFIG,
                ...saved
            };
        }
    } catch (err) {
        console.warn("[Antigravity Translator] 無法讀取 chrome.storage.local，退回記憶體設定:", err);
    }
    return { ...memoryConfigStore };
}

/**
 * 儲存或部分更新擴充套件設定
 *
 * @param partial - 欲更新的設定欄位
 * @returns Promise<TranslatorConfig> - 更新後的完整設定
 */
export async function saveConfig(partial: Partial<TranslatorConfig>): Promise<TranslatorConfig> {
    const current = await getConfig();
    const updated: TranslatorConfig = {
        ...current,
        ...partial
    };

    try {
        if (
            typeof chrome !== "undefined" &&
            chrome.storage &&
            chrome.storage.local
        ) {
            await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: updated });
            return updated;
        }
    } catch (err) {
        console.warn("[Antigravity Translator] 無法寫入 chrome.storage.local，更新記憶體設定:", err);
    }

    memoryConfigStore = updated;
    return updated;
}
