/**
 * chrome.* API 測試替身（storage、runtime 訊息）。
 * 安裝到 globalThis.chrome，回傳控制介面。
 */

type Listener = (...args: any[]) => unknown;

export interface FakeChromeOptions {
    /** content / options 送出的訊息由此處理（模擬 background） */
    handler?: (message: any) => unknown | Promise<unknown>;
    local?: Record<string, unknown>;
    sync?: Record<string, unknown>;
    id?: string;
    version?: string;
}

export interface FakeChromeControl {
    chrome: any;
    local: Map<string, unknown>;
    sync: Map<string, unknown>;
    sent: any[];
    setHandler(handler: FakeChromeOptions["handler"]): void;
    /** 模擬擴充功能更新後 context 失效 */
    invalidate(): void;
    /** 讓下一次 sendMessage 以 lastError 結束 */
    failNextMessage(message: string): void;
    /** 模擬 background：派送訊息給已註冊的 onMessage 監聽器 */
    dispatch(message: unknown, sender?: { id?: string }): Promise<unknown>;
    /** 觸發 chrome.runtime.onInstalled / onStartup 監聽器 */
    fireInstalled(): void;
    fireStartup(): void;
    uninstall(): void;
}

function createArea(name: "local" | "sync", data: Map<string, unknown>, fire: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void) {
    const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
    return {
        async get(keys?: null | string | string[] | Record<string, unknown>): Promise<Record<string, unknown>> {
            const out: Record<string, unknown> = {};
            if (keys === null || keys === undefined) {
                for (const [k, v] of data) out[k] = clone(v);
            } else if (typeof keys === "string") {
                if (data.has(keys)) out[keys] = clone(data.get(keys));
            } else if (Array.isArray(keys)) {
                for (const k of keys) if (data.has(k)) out[k] = clone(data.get(k));
            } else {
                for (const [k, def] of Object.entries(keys)) out[k] = data.has(k) ? clone(data.get(k)) : def;
            }
            return out;
        },
        async set(items: Record<string, unknown>): Promise<void> {
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
            for (const [k, v] of Object.entries(items)) {
                changes[k] = { oldValue: clone(data.get(k)), newValue: clone(v) };
                data.set(k, clone(v));
            }
            fire(changes, name);
        },
        async remove(keys: string | string[]): Promise<void> {
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
            for (const k of Array.isArray(keys) ? keys : [keys]) {
                if (!data.has(k)) continue;
                changes[k] = { oldValue: clone(data.get(k)) };
                data.delete(k);
            }
            if (Object.keys(changes).length) fire(changes, name);
        },
        async clear(): Promise<void> {
            data.clear();
        },
    };
}

export function installFakeChrome(options: FakeChromeOptions = {}): FakeChromeControl {
    const local = new Map(Object.entries(options.local ?? {}));
    const sync = new Map(Object.entries(options.sync ?? {}));
    const storageListeners = new Set<Listener>();
    const messageListeners = new Set<Listener>();
    const installedListeners = new Set<Listener>();
    const startupListeners = new Set<Listener>();
    const sent: any[] = [];
    let handler = options.handler;
    let valid = true;
    let nextError: string | null = null;
    const id = options.id ?? "test-extension-id";

    const fire = (changes: Record<string, unknown>, area: string): void => {
        // chrome 以非同步方式派送 onChanged
        queueMicrotask(() => storageListeners.forEach((l) => l(changes, area)));
    };

    const runtime: any = {
        get id() {
            return valid ? id : undefined;
        },
        lastError: undefined as { message: string } | undefined,
        getURL: (path: string) => `chrome-extension://${id}/${path}`,
        getManifest: () => ({ version: options.version ?? "2.1.0" }),
        openOptionsPage: async () => {
            sent.push({ type: "__openOptionsPage" });
        },
        sendMessage(message: unknown, callback?: (res: unknown) => void) {
            if (!valid) throw new Error("Extension context invalidated.");
            sent.push(message);
            const forcedError = nextError;
            nextError = null;
            void (async () => {
                let response: unknown;
                let error: string | null = forcedError;
                if (!error) {
                    try {
                        response = handler ? await handler(JSON.parse(JSON.stringify(message))) : undefined;
                        response = response === undefined ? undefined : JSON.parse(JSON.stringify(response));
                    } catch (e) {
                        error = e instanceof Error ? e.message : String(e);
                    }
                }
                runtime.lastError = error ? { message: error } : undefined;
                try {
                    callback?.(error ? undefined : response);
                } finally {
                    runtime.lastError = undefined;
                }
            })();
        },
        onMessage: {
            addListener: (l: Listener) => messageListeners.add(l),
            removeListener: (l: Listener) => messageListeners.delete(l),
        },
        onInstalled: { addListener: (l: Listener) => installedListeners.add(l) },
        onStartup: { addListener: (l: Listener) => startupListeners.add(l) },
    };

    const fake = {
        runtime,
        storage: {
            local: createArea("local", local, fire),
            sync: createArea("sync", sync, fire),
            onChanged: {
                addListener: (l: Listener) => storageListeners.add(l),
                removeListener: (l: Listener) => storageListeners.delete(l),
            },
        },
    };

    const previous = (globalThis as any).chrome;
    (globalThis as any).chrome = fake;

    return {
        chrome: fake,
        local,
        sync,
        sent,
        setHandler: (h) => {
            handler = h;
        },
        invalidate: () => {
            valid = false;
        },
        failNextMessage: (message) => {
            nextError = message;
        },
        dispatch: (message, sender = { id }) =>
            new Promise((resolve) => {
                // 與 Chrome 相同：任一 listener 回傳 true 就保留回應通道；以第一次 sendResponse 為準（Promise 只會 resolve 一次）
                let keepOpen = false;
                let responded = false;
                for (const l of messageListeners) {
                    const result = l(message, sender, (res: unknown) => {
                        responded = true;
                        resolve(res);
                    });
                    if (result === true) keepOpen = true;
                }
                // 所有 listener 都沒有保留通道、也沒有同步回應：Chrome 會關閉通道，送出端收到 undefined
                if (!keepOpen && !responded) resolve(undefined);
            }),
        fireInstalled: () => installedListeners.forEach((l) => l({ reason: "install" })),
        fireStartup: () => startupListeners.forEach((l) => l()),
        uninstall: () => {
            (globalThis as any).chrome = previous;
        },
    };
}
