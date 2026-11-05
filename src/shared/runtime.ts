/**
 * ============================================================================
 * 📡 傳送請求給 background（content script 與設定頁共用）
 * ============================================================================
 */

import type { Request, Response, ResponseMap } from "./messages";
import { MESSAGE_TIMEOUT_MS } from "./constants";
import { log } from "../utils/log";

/** 擴充功能更新 / 重新載入後，舊頁面上的 content script 會失去與背景的連線 */
export class ExtensionContextError extends Error {
    constructor() {
        super("擴充功能已更新，請重新整理頁面");
        this.name = "ExtensionContextError";
    }
}

/**
 * 訊息層的暫時性錯誤（背景服務尚未啟動完成、逾時、連線中斷）。
 * 與來源 API 回報的錯誤不同，這類錯誤重試通常就會成功。
 */
export class TransientMessageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TransientMessageError";
    }
}

/** background 回報的錯誤（來源 API 失敗、資料格式錯誤…），code 見 Response 型別說明 */
export class ApiError extends Error {
    constructor(
        message: string,
        readonly code: string = "unknown"
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export function isContextValid(): boolean {
    try {
        return typeof chrome !== "undefined" && !!chrome.runtime?.id;
    } catch {
        return false;
    }
}

/** 傳送請求給 background，失敗時以上述錯誤類別拒絕 */
export function send<T extends Request["type"]>(req: Extract<Request, { type: T }>, timeoutMs = MESSAGE_TIMEOUT_MS): Promise<ResponseMap[T]> {
    return new Promise<ResponseMap[T]>((resolve, reject) => {
        if (!isContextValid()) {
            reject(new ExtensionContextError());
            return;
        }
        let settled = false;
        const started = Date.now();
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new TransientMessageError("背景服務回應逾時"));
        }, timeoutMs);

        const finish = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            log.debug("send", req.type, (req as { name?: string }).name ?? "", Date.now() - started, "ms");
            fn();
        };

        try {
            chrome.runtime.sendMessage(req, (res: Response<ResponseMap[T]> | undefined) => {
                const lastError = chrome.runtime.lastError;
                finish(() => {
                    if (lastError) reject(isContextValid() ? new TransientMessageError(lastError.message || "背景服務沒有回應") : new ExtensionContextError());
                    else if (!res) reject(new TransientMessageError("背景服務沒有回應"));
                    else if (res.ok) resolve(res.data);
                    else reject(new ApiError(res.error, res.code));
                });
            });
        } catch (error) {
            finish(() => reject(isContextValid() ? new TransientMessageError(error instanceof Error ? error.message : String(error)) : new ExtensionContextError()));
        }
    });
}
