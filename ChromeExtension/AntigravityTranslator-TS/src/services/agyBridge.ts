/**
 * ============================================================================
 * 🌉 Antigravity Translator - CLI 本地橋接通訊服務 (Bridge Service)
 * ============================================================================
 *
 * 本模組負責在 Background Service Worker 中與本地 Antigravity CLI Bridge Server 通訊：
 * 1. 偵測並驗證本地 Bridge Server 與 Antigravity CLI 的健康狀態 (Health Check)
 * 2. 整合本機翻譯快取，僅對未命中的文字節點發送 HTTP 批次翻譯請求
 * 3. 處理模型推論深度 (Effort Level) 與領域風格 (Style Presets) 參數指派
 * 4. 提供單行與選取文字即時翻譯介面 (Single Translation)
 */

import {
    computeCacheKey,
    deduplicateTranslationItems,
    expandDeduplicatedTranslations,
    filterRelevantGlossary
} from "../core/textChunker.js";
import type {
    BridgeHealthResponse,
    EffortLevel,
    TranslationBatchRequest,
    TranslationBatchResponse,
    TranslationItem,
    TranslatorConfig
} from "../types/index.js";
import { getCachedTranslation, setCachedTranslations } from "./cache.js";

/**
 * 檢查本地 Antigravity CLI Bridge Server 連線與就緒狀態
 *
 * 呼叫 Bridge Server 的 `/health` 檢測端點。若未啟動或無法連線，
 * 回傳結構化錯誤訊息，提示使用者啟動 `npm run bridge`。
 *
 * @param config - 擴充套件全域設定物件
 * @returns Promise<BridgeHealthResponse> - 健康檢查狀態回應
 */
export async function checkBridgeHealth(config: TranslatorConfig): Promise<BridgeHealthResponse> {
    const rawUrl = (config.bridgeUrl || "http://127.0.0.1:18765").replace(/\/+$/, "");
    const healthEndpoint = `${rawUrl}/health`;

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
        controller.abort();
    }, 4000);

    try {
        const response = await fetch(healthEndpoint, {
            method: "GET",
            headers: {
                Accept: "application/json"
            },
            signal: controller.signal
        });

        clearTimeout(timeoutTimer);

        if (!response.ok) {
            return {
                ok: false,
                status: "http_error",
                cliPath: config.cliPath,
                defaultModel: config.model,
                defaultEffort: config.effort,
                error: `Bridge 伺服器回應異常狀態碼：${response.status} ${response.statusText}`
            };
        }

        const data = (await response.json()) as BridgeHealthResponse;
        return data;
    } catch (err: unknown) {
        clearTimeout(timeoutTimer);
        const errorMsg = err instanceof Error ? err.message : String(err);

        return {
            ok: false,
            status: "bridge_unreachable",
            cliPath: config.cliPath,
            defaultModel: config.model,
            defaultEffort: config.effort,
            error: `無法連線至本地 Antigravity Bridge 伺服器 (${rawUrl})。請在終端機中執行 'npm run bridge' 啟動本地橋接服務（錯誤原因: ${errorMsg}）。`
        };
    }
}

/**
 * 透過本地 Antigravity CLI Bridge 執行微批次網頁文字翻譯
 *
 * 流程：
 * 1. 檢查快取：若啟用快取，對每個 item 運算 Cache Key，命中者直接收集至結果字典
 * 2. 過濾術語：僅將當前批次出現的專有名詞術語傳送給 CLI，節省 Prompt 長度
 * 3. 呼叫 Bridge：發送 POST 批次請求，由 CLI 呼叫指定模型 (如 gemini-3.8-flash low)
 * 4. 快取寫入：將 CLI 回傳的新翻譯成果寫入快取
 * 5. 合併回傳：將快取命中項目與新翻譯項目整合成完整字典回應
 *
 * @param items - 待翻譯文字項目陣列
 * @param config - 擴充套件全域設定物件
 * @returns Promise<TranslationBatchResponse>
 */
export async function translateBatchViaCli(
    items: TranslationItem[],
    config: TranslatorConfig
): Promise<TranslationBatchResponse> {
    const startTime = performance.now();
    const targetModel = config.model || "gemini-3.8-flash";
    const targetEffort = config.effort || "low";

    if (!items || items.length === 0) {
        return {
            success: true,
            translations: {},
            modelUsed: targetModel,
            effortUsed: targetEffort,
            durationMs: 0,
            cachedCount: 0
        };
    }

    const cachedResults: Record<string, string> = {};
    const unCachedItems: TranslationItem[] = [];

    // 1. 查詢快取
    if (config.enableCache) {
        for (const item of items) {
            const cacheKey = computeCacheKey(
                item.text,
                config.targetLang,
                config.translationStyle,
                targetModel,
                targetEffort,
                config.glossary
            );
            const cachedVal = getCachedTranslation(cacheKey);
            if (cachedVal !== undefined) {
                cachedResults[item.id] = cachedVal;
            } else {
                unCachedItems.push(item);
            }
        }
    } else {
        unCachedItems.push(...items);
    }

    // 2. 若全部項目皆由快取命中，直接回傳
    if (unCachedItems.length === 0) {
        const durationMs = Math.round(performance.now() - startTime);
        return {
            success: true,
            translations: cachedResults,
            modelUsed: targetModel,
            effortUsed: targetEffort,
            durationMs,
            cachedCount: items.length
        };
    }

    // 3. 對未命中快取之項目執行「原文去重 (Deduplication)」，相同字串僅需翻譯 1 次
    const { uniqueItems, idGroupMap } = deduplicateTranslationItems(unCachedItems);
    const dedupSavedCount = unCachedItems.length - uniqueItems.length;

    // 4. 將去重後的唯一項目映射為極短數字索引 ("0", "1", ...)，大幅減少 JSON Input/Output Token 消耗
    const shortIdToRepId = new Map<string, string>();
    const compactItems: TranslationItem[] = uniqueItems.map((item, idx) => {
        const shortId = String(idx);
        shortIdToRepId.set(shortId, item.id);
        return {
            id: shortId,
            text: item.text
        };
    });

    // 5. 篩選與當前未快取項目相關的專有名詞術語
    const relevantGlossary = filterRelevantGlossary(uniqueItems, config.glossary);

    // 單次最大 Token 模式下自動確保充裕的逾時秒數
    const effectiveTimeoutSec =
        config.singleBatchMode !== false
            ? Math.max(config.timeoutSec || 60, 60)
            : config.timeoutSec || 60;

    // 6. 組裝發往 Bridge 的請求資料
    const batchRequest: TranslationBatchRequest = {
        items: compactItems,
        sourceLang: config.sourceLang || "auto",
        targetLang: config.targetLang || "zh-TW",
        style: config.translationStyle || "natural",
        customPrompt: config.customPrompt || "",
        glossary: relevantGlossary,
        model: targetModel,
        effort: targetEffort,
        cliPath: config.cliPath || "agy",
        timeoutSec: effectiveTimeoutSec,
        extraCliFlags: config.extraCliFlags || ""
    };

    const rawUrl = (config.bridgeUrl || "http://127.0.0.1:18765").replace(/\/+$/, "");
    const translateEndpoint = `${rawUrl}/translate`;

    const controller = new AbortController();
    const timeoutMs = effectiveTimeoutSec * 1000;
    const timeoutTimer = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(translateEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify(batchRequest),
            signal: controller.signal
        });

        clearTimeout(timeoutTimer);

        if (!response.ok) {
            let errorDetail = `Bridge HTTP ${response.status} ${response.statusText}`;
            try {
                const errJson = await response.json();
                if (errJson && errJson.error) {
                    errorDetail = errJson.error;
                }
            } catch {
                // 忽略非 JSON 的錯誤回應解析
            }

            return {
                success: false,
                translations: cachedResults,
                modelUsed: targetModel,
                effortUsed: targetEffort,
                durationMs: Math.round(performance.now() - startTime),
                cachedCount: Object.keys(cachedResults).length,
                error: errorDetail
            };
        }

        const data = (await response.json()) as TranslationBatchResponse;

        if (!data.success) {
            return {
                success: false,
                translations: cachedResults,
                modelUsed: data.modelUsed || targetModel,
                effortUsed: data.effortUsed || targetEffort,
                durationMs: Math.round(performance.now() - startTime),
                cachedCount: Object.keys(cachedResults).length,
                error: data.error || "CLI 翻譯失敗"
            };
        }

        // 7. 將短索引結果映射回代表 ID，並展開至所有重複原文之節點 ID
        const repTranslations: Record<string, string> = {};
        if (data.translations) {
            for (const [key, val] of Object.entries(data.translations)) {
                if (val && typeof val === "string") {
                    const repId = shortIdToRepId.get(key) || key;
                    repTranslations[repId] = val;
                }
            }
        }
        const expandedNewTranslations = expandDeduplicatedTranslations(repTranslations, idGroupMap);

        // 8. 將成功回傳的唯一項目翻譯結果寫入快取
        if (config.enableCache && Object.keys(repTranslations).length > 0) {
            const newCacheEntries: Record<string, string> = {};
            for (const item of uniqueItems) {
                const translated = repTranslations[item.id];
                if (translated && typeof translated === "string") {
                    const cacheKey = computeCacheKey(
                        item.text,
                        config.targetLang,
                        config.translationStyle,
                        targetModel,
                        targetEffort,
                        config.glossary
                    );
                    newCacheEntries[cacheKey] = translated;
                }
            }

            if (Object.keys(newCacheEntries).length > 0) {
                await setCachedTranslations(newCacheEntries, config.maxCacheEntries || 5000);
            }
        }

        // 9. 合併快取與新翻譯結果
        const finalTranslations: Record<string, string> = {
            ...cachedResults,
            ...expandedNewTranslations
        };

        return {
            success: true,
            translations: finalTranslations,
            modelUsed: data.modelUsed || targetModel,
            effortUsed: data.effortUsed || targetEffort,
            durationMs: Math.round(performance.now() - startTime),
            cachedCount: Object.keys(cachedResults).length + dedupSavedCount
        };
    } catch (err: unknown) {
        clearTimeout(timeoutTimer);
        const errorMsg = err instanceof Error ? err.message : String(err);

        return {
            success: false,
            translations: cachedResults,
            modelUsed: targetModel,
            effortUsed: targetEffort,
            durationMs: Math.round(performance.now() - startTime),
            cachedCount: Object.keys(cachedResults).length,
            error: `連線至 Antigravity CLI Bridge 失敗: ${errorMsg}`
        };
    }
}

/**
 * 快速翻譯單一文字或選取段落
 *
 * 專供右鍵選單、劃詞選取翻譯氣泡以及懸停段落翻譯呼叫。
 *
 * @param text - 待翻譯文字內容
 * @param config - 擴充套件全域設定物件
 * @returns 翻譯結果物件
 */
export async function translateSingleTextViaCli(
    text: string,
    config: TranslatorConfig
): Promise<{
    success: boolean;
    translation: string;
    modelUsed: string;
    effortUsed: EffortLevel;
    durationMs: number;
    error?: string;
}> {
    const trimmed = text.trim();
    const targetModel = config.model || "gemini-3.8-flash";
    const targetEffort = config.effort || "low";

    if (!trimmed) {
        return {
            success: true,
            translation: "",
            modelUsed: targetModel,
            effortUsed: targetEffort,
            durationMs: 0
        };
    }

    const singleItem: TranslationItem = {
        id: "single_text_0",
        text: trimmed
    };

    const batchRes = await translateBatchViaCli([singleItem], config);

    if (batchRes.success && batchRes.translations[singleItem.id]) {
        return {
            success: true,
            translation: batchRes.translations[singleItem.id],
            modelUsed: batchRes.modelUsed,
            effortUsed: batchRes.effortUsed,
            durationMs: batchRes.durationMs
        };
    }

    return {
        success: false,
        translation: "",
        modelUsed: batchRes.modelUsed,
        effortUsed: batchRes.effortUsed,
        durationMs: batchRes.durationMs,
        error: batchRes.error || "單一文字翻譯失敗"
    };
}
