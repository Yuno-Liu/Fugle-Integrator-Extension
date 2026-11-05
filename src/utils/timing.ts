/**
 * ============================================================================
 * ⏱️ 計時工具
 * ============================================================================
 */

export interface Debounced<A extends unknown[]> {
    (...args: A): void;
    /** 取消尚未執行的呼叫 */
    cancel(): void;
}

/** 防抖動：停止觸發 delay 毫秒後才執行最後一次呼叫 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): Debounced<A> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingArgs: A | null = null;

    const run = (): void => {
        timer = null;
        const args = pendingArgs;
        pendingArgs = null;
        if (args) fn(...args);
    };

    const debounced = ((...args: A) => {
        pendingArgs = args;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(run, delay);
    }) as Debounced<A>;

    debounced.cancel = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        pendingArgs = null;
    };
    return debounced;
}

/**
 * 在 ms 內取得結果，逾時或失敗時回傳 null（不拋錯）。
 * 用於「有最好、沒有也沒關係」的操作，例如讀取持久快取。
 */
export function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            () => {
                clearTimeout(timer);
                resolve(null);
            }
        );
    });
}
