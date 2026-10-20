/**
 * ============================================================================
 * 🧩 Antigravity Translator - 文字節點批次切分與快取金鑰計算核心 (Text Chunker)
 * ============================================================================
 *
 * 本模組負責：
 * 1. 將大量 DOM 文字節點按數量 (batchSize) 與字數 (maxCharsPerBatch) 智慧切分為批次
 * 2. 使用快速高效的 FNV-1a 雜湊演算法計算唯一性翻譯快取 Key
 * 3. 根據目前批次內容智慧篩選出相關專有名詞術語，避免消耗過多 Token
 */

import type {
    EffortLevel,
    GlossaryEntry,
    TranslationItem,
    TranslationStyle
} from "../types/index.js";

/**
 * 單次最大 Token 直出模式之單批最大項目上限
 */
export const SINGLE_BATCH_MAX_ITEMS = 1000;

/**
 * 單次最大 Token 直出模式之單批最大字元上限
 * (兼顧 LLM 單次最大輸出 Token 與 Windows CreateProcess 32,767 字元安全上限)
 */
export const SINGLE_BATCH_MAX_CHARS = 25000;

/**
 * 重複文字去重結果結構
 */
export interface DeduplicatedItemsResult {
    /** 去重後的唯一待翻譯項目清單 */
    uniqueItems: TranslationItem[];
    /** 唯一代表項目 ID 對應至所有相同原文之原始項目 ID 列表 */
    idGroupMap: Record<string, string[]>;
}

/**
 * 將待翻譯項目依原文內容去重 (Deduplicate)
 *
 * 網頁中常有大量重複出現的按鈕、導覽列、表頭或標籤文字。
 * 透過在翻譯前去重，相同文字僅需交由 LLM 翻譯一次，大幅節省 Output Token 與等待時間。
 *
 * @param items - 原始待翻譯項目陣列
 * @returns 去重後之唯一項目陣列與 ID 群組映射表
 */
export function deduplicateTranslationItems(items: TranslationItem[]): DeduplicatedItemsResult {
    const uniqueItems: TranslationItem[] = [];
    const idGroupMap: Record<string, string[]> = {};
    const textToRepId = new Map<string, string>();

    if (!items || items.length === 0) {
        return { uniqueItems, idGroupMap };
    }

    for (const item of items) {
        const normalizedText = item.text.trim();
        const existingRepId = textToRepId.get(normalizedText);

        if (existingRepId !== undefined) {
            idGroupMap[existingRepId].push(item.id);
        } else {
            textToRepId.set(normalizedText, item.id);
            idGroupMap[item.id] = [item.id];
            uniqueItems.push({
                id: item.id,
                text: normalizedText
            });
        }
    }

    return { uniqueItems, idGroupMap };
}

/**
 * 將去重後的翻譯結果展開還原至所有原始節點 ID
 *
 * @param uniqueTranslations - 以代表 ID 為 Key 的翻譯結果字典
 * @param idGroupMap - 代表 ID 對所有原始 ID 的映射表
 * @returns 涵蓋所有原始節點 ID 的完整翻譯結果字典
 */
export function expandDeduplicatedTranslations(
    uniqueTranslations: Record<string, string>,
    idGroupMap: Record<string, string[]>
): Record<string, string> {
    const expanded: Record<string, string> = {};
    if (!uniqueTranslations || !idGroupMap) {
        return expanded;
    }

    for (const [repId, translatedText] of Object.entries(uniqueTranslations)) {
        if (!translatedText) continue;
        const groupIds = idGroupMap[repId];
        if (groupIds && groupIds.length > 0) {
            for (const origId of groupIds) {
                expanded[origId] = translatedText;
            }
        } else {
            expanded[repId] = translatedText;
        }
    }

    return expanded;
}

/**
 * 智慧切分待翻譯項目陣列為合適的批次 (支援「單次最大 Token 直出模式」與「微批次模式」)
 *
 * 確保每一個批次同時滿足：
 * 1. 項目數量不超過 `batchSize`（開啟 `singleBatchMode` 時自動放寬至 1000）
 * 2. 累計字元總數不超過 `maxCharsPerBatch`（開啟 `singleBatchMode` 時自動放寬至 25000）
 *
 * @param items - 原始待翻譯文字單元清單
 * @param batchSize - 單一批次最大項目筆數
 * @param maxCharsPerBatch - 單一批次最大字元總量
 * @param singleBatchMode - 是否啟用「單次最大 Token 全頁直出（免分批）」模式
 * @returns 切分後的二維批次陣列 (TranslationItem[][])
 */
export function chunkTranslationItems(
    items: TranslationItem[],
    batchSize: number,
    maxCharsPerBatch: number,
    singleBatchMode = false
): TranslationItem[][] {
    if (!items || items.length === 0) {
        return [];
    }

    const effectiveBatchSize = singleBatchMode
        ? Math.max(batchSize, SINGLE_BATCH_MAX_ITEMS)
        : Math.max(1, batchSize);
    const effectiveMaxChars = singleBatchMode
        ? Math.max(maxCharsPerBatch, SINGLE_BATCH_MAX_CHARS)
        : Math.max(100, maxCharsPerBatch);

    const batches: TranslationItem[][] = [];
    let currentBatch: TranslationItem[] = [];
    let currentCharCount = 0;
    const seenTextsInBatch = new Set<string>();

    for (const item of items) {
        const normalized = item.text.trim();
        // 若開啟單次最大 Token 模式且同批次內已有相同原文，去重後不額外佔用 Token 字元額度
        const isDuplicateInBatch = singleBatchMode && seenTextsInBatch.has(normalized);
        const itemLen = isDuplicateInBatch ? 0 : item.text.length;

        // 若當前批次已有元素，且加入此元素後會超過限制，則先結算當前批次
        const wouldExceedSize = currentBatch.length >= effectiveBatchSize;
        const wouldExceedChars =
            currentBatch.length > 0 && currentCharCount + itemLen > effectiveMaxChars;

        if (wouldExceedSize || wouldExceedChars) {
            batches.push(currentBatch);
            currentBatch = [];
            currentCharCount = 0;
            seenTextsInBatch.clear();
        }

        currentBatch.push(item);
        currentCharCount += itemLen;
        if (singleBatchMode) {
            seenTextsInBatch.add(normalized);
        }
    }

    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    return batches;
}

/**
 * 計算 32-bit FNV-1a 雜湊值
 *
 * FNV-1a 具備極低碰撞率與超高計算效能，特別適合短文字快速雜湊。
 *
 * @param str - 輸入字串
 * @returns 32-bit 十六進位雜湊字串
 */
function fnv1a32(str: string): string {
    let hash = 0x811c9dc5; // 2166136261
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        // hash = (hash * 16777619) >>> 0
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

/**
 * 計算文字單元的唯一翻譯快取 Key (Cache Key)
 *
 * 金鑰結合目標語言、翻譯風格、模型名稱、推理深度、關聯術語表以及原文文字，
 * 確保在任何設定變更時皆能正確命中或失效快取。
 *
 * @param text - 待翻譯原文
 * @param targetLang - 目標語言
 * @param style - 翻譯風格
 * @param model - 使用的模型識別碼
 * @param effort - 推理深度
 * @param glossary - 相關術語列表
 * @returns 快取鍵名字串 (例如: "trans_zh-TW_a1b2c3d4_8f7e6d5c")
 */
export function computeCacheKey(
    text: string,
    targetLang: string,
    style: TranslationStyle,
    model: string,
    effort: EffortLevel,
    glossary: GlossaryEntry[]
): string {
    // 整理啟用的術語指紋
    const activeGlossaryFingerprint = (glossary || [])
        .filter((g) => g.enabled && g.source.trim().length > 0)
        .map((g) => `${g.source}=>${g.target}${g.caseSensitive ? "(CS)" : ""}`)
        .sort()
        .join(";");

    const metaString = `${targetLang}|${style}|${model}|${effort}|${activeGlossaryFingerprint}`;
    const metaHash = fnv1a32(metaString);
    const textHash = fnv1a32(text);

    return `trans_${targetLang}_${metaHash}_${textHash}`;
}

/**
 * 針對特定翻譯批次過濾出「實際有出現在文字中」的啟用術語
 *
 * 避免無關的專有名詞全部塞入 Prompt 中造成 Token 浪費與注意力分散。
 *
 * @param items - 當前批次的待翻譯文字項目陣列
 * @param glossary - 擴充套件設定之完整術語清單
 * @returns 實際命中之術語子集合
 */
export function filterRelevantGlossary(
    items: TranslationItem[],
    glossary: GlossaryEntry[]
): GlossaryEntry[] {
    if (!glossary || glossary.length === 0 || !items || items.length === 0) {
        return [];
    }

    const enabledEntries = glossary.filter(
        (entry) => entry.enabled && entry.source.trim().length > 0
    );
    if (enabledEntries.length === 0) {
        return [];
    }

    // 彙整所有待翻譯文字為全文與全小寫文字以利快速搜尋
    const combinedOriginal = items.map((i) => i.text).join(" ");
    const combinedLower = combinedOriginal.toLowerCase();

    return enabledEntries.filter((entry) => {
        const source = entry.source.trim();
        if (entry.caseSensitive) {
            return combinedOriginal.includes(source);
        }
        return combinedLower.includes(source.toLowerCase());
    });
}
