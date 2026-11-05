/**
 * 輕量日誌：debug 只在開發建置（__DEV__ = true）輸出，正式版自動移除。
 */

const PREFIX = "[富果整合器]";

export const log = {
    debug(...args: unknown[]): void {
        if (!__DEV__) return;
        console.debug(PREFIX, ...args);
        // 開發版：保留最近 300 筆，方便在 Service Worker 主控台以 __fiDebugLog 檢視
        const buffer = ((globalThis as { __fiDebugLog?: string[] }).__fiDebugLog ??= []);
        buffer.push(`${new Date().toISOString().slice(11, 23)} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
        if (buffer.length > 300) buffer.shift();
    },
    warn(...args: unknown[]): void {
        console.warn(PREFIX, ...args);
    },
    error(...args: unknown[]): void {
        console.error(PREFIX, ...args);
    },
};

/** 將任意錯誤轉為簡短訊息 */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        // JSON.stringify 對 undefined / 函式 / Symbol 會回傳 undefined（不會拋錯）
        return JSON.stringify(error) ?? String(error);
    } catch {
        return String(error);
    }
}
