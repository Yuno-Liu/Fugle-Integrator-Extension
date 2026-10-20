/**
 * ============================================================================
 * 📝 Antigravity Translator - 提示詞建構與回應解析核心 (Prompt Builder)
 * ============================================================================
 *
 * 本模組負責：
 * 1. 將網頁批次文字節點組裝為結構化、嚴謹的 LLM 提示詞 (Prompt)
 * 2. 融入領域風格、使用者自訂提示與專有名詞術語表 (Glossary)
 * 3. 極致容錯解析 CLI 輸出之 JSON、Markdown 或純文字備援結構
 */

import { STYLE_PRESETS } from "../config/constants.js";
import type {
    GlossaryEntry,
    TranslationBatchRequest,
    TranslationItem,
    TranslationStyle
} from "../types/index.js";

/**
 * 組裝批次文字翻譯提示詞 (Prompt)
 *
 * 將多個待翻譯文字單元序列化為 Key-Value JSON，並附加語言、領域風格與術語表約束。
 *
 * @param req - 包含 items, 語言, 風格, 自訂提示與術語之參數物件
 * @returns 組裝完成之完整 LLM Prompt 字串
 */
export function buildTranslationPrompt(
    req: Pick<
        TranslationBatchRequest,
        "items" | "sourceLang" | "targetLang" | "style" | "customPrompt" | "glossary"
    >
): string {
    const { items, sourceLang, targetLang, style, customPrompt, glossary } = req;

    const sourceLangDesc =
        sourceLang === "auto" ? "原文語言（自動偵測）" : `來源語言：${sourceLang}`;
    const targetLangDesc = `目標語言：${targetLang}`;

    // 取得對應領域風格之指引
    const stylePreset = STYLE_PRESETS[style] || STYLE_PRESETS.natural;
    const styleInstruction = stylePreset.systemInstruction;

    // 過濾出啟用的術語
    const activeGlossary = (glossary || []).filter((g) => g.enabled && g.source.trim().length > 0);
    let glossarySection = "";
    if (activeGlossary.length > 0) {
        const glossaryList = activeGlossary
            .map((entry) => `  - "${entry.source}" => "${entry.target}"`)
            .join("\n");
        glossarySection = `\n【專有名詞強制術語表 (Glossary)】\n翻譯時請嚴格遵守以下術語對應，不可任意替換或直譯：\n${glossaryList}\n`;
    }

    // 自訂補充指示
    let customSection = "";
    if (customPrompt && customPrompt.trim().length > 0) {
        customSection = `\n【使用者自訂特殊要求】\n${customPrompt.trim()}\n`;
    }

    // 將待翻譯項目序列化為緊湊乾淨的 JSON 物件（移除多餘縮排空白以節省 Input/Output Token）
    const payloadObject: Record<string, string> = {};
    for (const item of items) {
        payloadObject[item.id] = item.text;
    }
    const inputJson = JSON.stringify(payloadObject);

    return `你是一位世界頂級的專業全站網頁翻譯引擎。
請將下方 JSON 物件中的所有 Value 從 ${sourceLangDesc} 翻譯為 ${targetLangDesc}。

【翻譯風格與核心原則】
1. 風格指引：${styleInstruction}
2. 保持網頁排版格式：保留 HTML 實體符號、空格結構與原始標點習慣，切勿刪除任何格式標籤。
3. 程式碼與識別碼保護：變數名稱、程式碼片段、URL 與品牌專有名詞請保持原樣或專業慣例。${glossarySection}${customSection}
【輸出格式規範 (至關重要)】
- 請僅輸出一個合法的 JSON 物件。
- JSON 的 Key 必須嚴格保持與輸入相同的 ID（如 "0", "1", "2"...）。
- JSON 的 Value 為翻譯完成後的譯文字串。
- 絕對不要在 JSON 前後輸出任何開場白、感謝詞、結語或額外解釋說明！

【待翻譯 JSON 輸入】：
${inputJson}`;
}

/**
 * 組裝單句或選取段落翻譯提示詞 (Single Prompt)
 *
 * @param text - 待翻譯純文字
 * @param sourceLang - 來源語言
 * @param targetLang - 目標語言
 * @param style - 翻譯風格
 * @param customPrompt - 使用者自訂提示詞
 * @param glossary - 術語表
 * @returns 單筆翻譯提示詞
 */
export function buildSingleTranslationPrompt(
    text: string,
    sourceLang: string,
    targetLang: string,
    style: TranslationStyle,
    customPrompt: string,
    glossary: GlossaryEntry[]
): string {
    const stylePreset = STYLE_PRESETS[style] || STYLE_PRESETS.natural;
    const activeGlossary = (glossary || []).filter((g) => g.enabled && g.source.trim().length > 0);

    const sourceLangDesc =
        sourceLang === "auto" ? "原文語言（自動偵測）" : `來源語言：${sourceLang}`;
    const targetLangDesc = `目標語言：${targetLang}`;

    let glossarySection = "";
    if (activeGlossary.length > 0) {
        const glossaryList = activeGlossary
            .map((entry) => `  - "${entry.source}" => "${entry.target}"`)
            .join("\n");
        glossarySection = `\n【專有名詞強制術語表】：\n${glossaryList}\n`;
    }

    let customSection = "";
    if (customPrompt && customPrompt.trim().length > 0) {
        customSection = `\n【使用者自訂要求】：\n${customPrompt.trim()}\n`;
    }

    return `請將以下文字進行翻譯。
${sourceLangDesc}
${targetLangDesc}

【風格指引】：${stylePreset.systemInstruction}${glossarySection}${customSection}
【重要規範】：
- 請直接輸出最終翻譯結果文字，不要附帶引號、開頭問候、結尾語或任何多餘註解。

【待翻譯原文】：
${text}`;
}

/**
 * 極致容錯解析 CLI 或模型輸出之翻譯結果
 *
 * 支援情境：
 * 1. 標準純 JSON 物件字串
 * 2. 封裝在 Markdown 程式碼區塊（```json ... ``` 或 ``` ... ```）內之 JSON
 * 3. 前後附帶自然語言解釋文字但內嵌 `{ ... }` 物件
 * 4. 模型輸出為 JSON 陣列 `["譯文1", "譯文2", ...]`，依序對應 expectedItems
 * 5. 正則表達式鍵值對抽取救援機制
 * 6. 行級備援格式（如 `[0] 譯文` 或 `0: 譯文`）
 * 7. 單一項目且為純文字時直接指派
 *
 * @param rawOutput - CLI 或模型回傳的原始字串
 * @param expectedItems - 預期接收結果的項目清單
 * @returns 解析完成的對照字典 (Record<id, translatedText>)
 */
export function parseTranslationOutput(
    rawOutput: string,
    expectedItems: TranslationItem[]
): Record<string, string> {
    const result: Record<string, string> = {};
    if (!rawOutput || typeof rawOutput !== "string") {
        return result;
    }

    const trimmed = rawOutput.trim();
    if (!trimmed) {
        return result;
    }

    // ========================================================================
    // 策略 1: 提取 Markdown 程式碼區塊 (Code block extraction)
    // ========================================================================
    let candidate = trimmed;
    const codeBlockMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
        candidate = codeBlockMatch[1].trim();
    }

    // ========================================================================
    // 策略 2: 嘗試直接進行標準 JSON.parse
    // ========================================================================
    try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === "object" && parsed !== null) {
            if (Array.isArray(parsed)) {
                // 模型回傳了陣列，依序匹配 expectedItems
                parsed.forEach((val, idx) => {
                    if (expectedItems[idx] && typeof val === "string") {
                        result[expectedItems[idx].id] = val;
                    }
                });
                if (Object.keys(result).length > 0) {
                    return result;
                }
            } else {
                // 標準 Key-Value 物件
                for (const [key, val] of Object.entries(parsed)) {
                    if (val !== undefined && val !== null) {
                        result[String(key)] = typeof val === "string" ? val : String(val);
                    }
                }
                if (Object.keys(result).length > 0) {
                    return result;
                }
            }
        }
    } catch {
        // 進入後續容錯策略
    }

    // ========================================================================
    // 策略 3: 擷取最外層大括號 `{ ... }` 進行局部 JSON.parse
    // ========================================================================
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const bracketSub = candidate.substring(firstBrace, lastBrace + 1);
        try {
            const parsed = JSON.parse(bracketSub);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                for (const [key, val] of Object.entries(parsed)) {
                    if (val !== undefined && val !== null) {
                        result[String(key)] = typeof val === "string" ? val : String(val);
                    }
                }
                if (Object.keys(result).length > 0) {
                    return result;
                }
            }
        } catch {
            // 局部解析失敗，繼續正則抽取
        }
    }

    // ========================================================================
    // 策略 4: 正則表達式掃描抽取鍵值對 (Regex Key-Value Recovery)
    // 嚴謹匹配帶引號之鍵名或純數字 ID，避免非標籤冒號文字 (如 Output:) 誤判
    // ========================================================================
    const kvRegex = /(?:["']([\w-]+)["']|(?:\b(\d+)\b))\s*:\s*["']((?:\\.|[^"'\\])*)["']/g;
    let match: RegExpExecArray | null;
    while ((match = kvRegex.exec(candidate)) !== null) {
        const key = match[1] || match[2];
        let val = match[3];
        try {
            // 還原常見的轉義字元（如 \" 或 \n）
            val = JSON.parse(`"${val}"`);
        } catch {
            // 若還原失敗則維持原樣
        }
        result[key] = val;
    }
    if (Object.keys(result).length > 0) {
        return result;
    }

    // ========================================================================
    // 策略 5: 行級備援格式解析 (Line-by-line format recovery)
    // 支援 [0] 譯文 或 0. 譯文 或 0: 譯文
    // ========================================================================
    const lines = candidate.split(/\r?\n/);
    const lineRegex = /^\s*\[?(\w+)\]?[\s.:\-]+(.*)$/;
    for (const line of lines) {
        const lMatch = line.match(lineRegex);
        if (lMatch) {
            const id = lMatch[1];
            const text = lMatch[2].trim();
            if (expectedItems.some((item) => item.id === id)) {
                result[id] = text;
            }
        }
    }
    if (Object.keys(result).length > 0) {
        return result;
    }

    // ========================================================================
    // 策略 6: 單一項目直接降級指派 (Single item fallback)
    // 若僅預期 1 個項目且上方解析皆未成功，但輸出存在有效文字，直接指派
    // ========================================================================
    if (expectedItems.length === 1 && trimmed.length > 0) {
        result[expectedItems[0].id] = trimmed;
        return result;
    }

    return result;
}
