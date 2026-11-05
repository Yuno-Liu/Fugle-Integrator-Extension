/**
 * 輕量日誌：debug 只在開發建置（__DEV__ = true）輸出，正式版自動移除。
 */

const PREFIX = "[富果整合器]";

export const log = {
    debug(...args: unknown[]): void {
        // 📌 用 if 區塊而非提早 return：正式版的 if (false) 區塊在打包時就被移除，
        //    debugText 不會因為被參照而留在正式版裡
        if (__DEV__) {
            console.debug(PREFIX, ...args);
            // 開發版：保留最近 300 筆，方便在 Service Worker 主控台以 __fiDebugLog 檢視
            const buffer = ((globalThis as { __fiDebugLog?: string[] }).__fiDebugLog ??= []);
            buffer.push(`${new Date().toISOString().slice(11, 23)} ${debugText(args)}`);
            if (buffer.length > 300) buffer.shift();
        }
    },
    warn(...args: unknown[]): void {
        console.warn(PREFIX, ...args);
    },
    error(...args: unknown[]): void {
        console.error(PREFIX, ...args);
    },
};

/** 把日誌參數串成一行文字；循環參照、BigInt 等無法 JSON 化的值不會拋錯（日誌不應中斷呼叫端） */
export function debugText(args: readonly unknown[]): string {
    return args.map((a) => (typeof a === "string" ? a : errorMessage(a))).join(" ");
}

/** 將任意錯誤轉為簡短訊息（不會拋錯） */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        // JSON.stringify 對 undefined / 函式 / Symbol 會回傳 undefined（不會拋錯）
        return JSON.stringify(error) ?? String(error);
    } catch {
        try {
            return String(error);
        } catch {
            // 沒有原型（Object.create(null)）或 toString 會拋錯的物件
            return Object.prototype.toString.call(error);
        }
    }
}
