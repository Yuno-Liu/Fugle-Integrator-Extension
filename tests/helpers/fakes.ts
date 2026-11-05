/**
 * Cache Storage 與 fetch 的測試替身。
 */

/** 記憶體版 Cache（只實作程式用到的方法） */
export class FakeCache {
    readonly store = new Map<string, { body: string; headers: Record<string, string> }>();

    private key(req: RequestInfo | URL): string {
        return typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
    }

    async match(req: RequestInfo | URL): Promise<Response | undefined> {
        const hit = this.store.get(this.key(req));
        return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
    }

    async put(req: RequestInfo | URL, res: Response): Promise<void> {
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => (headers[k] = v));
        this.store.set(this.key(req), { body: await res.text(), headers });
    }

    async keys(): Promise<Request[]> {
        return [...this.store.keys()].map((url) => new Request(url));
    }

    async delete(req: RequestInfo | URL): Promise<boolean> {
        return this.store.delete(this.key(req));
    }
}

export class FakeCacheStorage {
    readonly caches = new Map<string, FakeCache>();
    opens = 0;

    async open(name: string): Promise<FakeCache> {
        this.opens++;
        let cache = this.caches.get(name);
        if (!cache) {
            cache = new FakeCache();
            this.caches.set(name, cache);
        }
        return cache;
    }

    async delete(name: string): Promise<boolean> {
        return this.caches.delete(name);
    }

    asCacheStorage(): CacheStorage {
        return this as unknown as CacheStorage;
    }
}

export interface RouteReply {
    status?: number;
    /** JSON 物件或字串內容 */
    body?: unknown;
    delayMs?: number;
    /** 直接拋出（模擬網路錯誤） */
    error?: Error;
    headers?: Record<string, string>;
}

export type RouteHandler = (url: string, init: RequestInit | undefined, callIndex: number) => RouteReply | Promise<RouteReply>;

export interface FetchCall {
    url: string;
    init: RequestInit | undefined;
}

/**
 * 建立可控的 fetch：依序比對路由（字串包含 / 正規表示式 / 函式），未符合者回 404。
 * 支援 AbortSignal：延遲期間被中止會以 AbortError 拒絕。
 */
export function createFetch(routes: Array<[string | RegExp | ((url: string) => boolean), RouteReply | RouteHandler]>) {
    const calls: FetchCall[] = [];
    const counts = new Map<number, number>();

    const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url: input, init });
        const index = routes.findIndex(([m]) => (typeof m === "string" ? input.includes(m) : m instanceof RegExp ? m.test(input) : m(input)));
        if (index < 0) return new Response("not found", { status: 404 });
        const n = counts.get(index) ?? 0;
        counts.set(index, n + 1);
        const entry = routes[index]?.[1];
        const reply = typeof entry === "function" ? await entry(input, init, n) : (entry ?? {});
        if (reply.delayMs) {
            await new Promise<void>((resolve, reject) => {
                const signal = init?.signal;
                const onAbort = (): void => {
                    clearTimeout(timer);
                    reject(new DOMException("The operation was aborted.", "AbortError"));
                };
                const timer = setTimeout(() => {
                    signal?.removeEventListener("abort", onAbort);
                    resolve();
                }, reply.delayMs);
                // 與真實 fetch 相同：已中止的 signal 立即拒絕
                if (signal?.aborted) onAbort();
                else signal?.addEventListener("abort", onAbort, { once: true });
            });
        }
        if (reply.error) throw reply.error;
        const body = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
        return new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? { "content-type": "application/json" } });
    };

    return { fetch, calls };
}
