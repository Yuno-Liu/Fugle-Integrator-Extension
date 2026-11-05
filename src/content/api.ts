/**
 * ============================================================================
 * 📡 content script → background 請求
 * ============================================================================
 *
 * 基礎的 send() 與錯誤類別在 shared/runtime.ts（設定頁也共用）；
 * 這裡加上唯讀請求的自動重試與資料集的型別化存取。
 */

import type { DatasetMap, DatasetName, Meta, Request, ResponseMap } from "../shared/messages";
import { MESSAGE_TIMEOUT_MS } from "../shared/constants";
import { TransientMessageError, isContextValid, send } from "../shared/runtime";
import { log } from "../utils/log";

export { ApiError, ExtensionContextError, TransientMessageError, isContextValid, send } from "../shared/runtime";

/** 重試前的等待時間 */
export const RETRY_DELAY_MS = 400;

/**
 * 最後一次以外的嘗試所用的逾時。
 * 📌 實測在擴充功能剛安裝、Service Worker 啟動期間，訊息偶爾會遺失（不回應也不報錯），
 *    重送就能立刻取得結果；background 會合併同一網址進行中的請求，提早重試不會中斷或重複抓取。
 *    最後一次嘗試使用完整的 MESSAGE_TIMEOUT_MS（來源較慢時 background 最久約 20 秒才回應）。
 */
export const QUICK_ATTEMPT_TIMEOUT_MS = 8_000;

/**
 * 唯讀請求：遇到暫時性訊息錯誤（例如 Service Worker 冷啟動、訊息遺失）自動重試。
 * 來源 API 的錯誤（ApiError）與擴充功能失效（ExtensionContextError）不重試。
 */
export async function query<T extends "dataset" | "related" | "category" | "search">(req: Extract<Request, { type: T }>, retries = 2): Promise<ResponseMap[T]> {
    for (let attempt = 0; ; attempt++) {
        const last = attempt >= retries;
        try {
            return await send(req, last ? MESSAGE_TIMEOUT_MS : QUICK_ATTEMPT_TIMEOUT_MS);
        } catch (error) {
            if (!(error instanceof TransientMessageError) || last || !isContextValid()) throw error;
            log.debug("retry", (req as Request).type, error.message);
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
    }
}

export interface DatasetResponse<K extends DatasetName> {
    data: DatasetMap[K];
    meta: Meta;
}

/** 取得指定資料集 */
export async function fetchDataset<K extends DatasetName>(name: K, stockId: string, force = false): Promise<DatasetResponse<K>> {
    const res = await query({ type: "dataset", name, stockId, force });
    return res as DatasetResponse<K>;
}
