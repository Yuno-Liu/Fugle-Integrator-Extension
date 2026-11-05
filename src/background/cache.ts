/**
 * ============================================================================
 * 🗄️ JSON 快取（記憶體 + Cache Storage）
 * ============================================================================
 *
 * 讀取順序：
 * 1. 記憶體快取（已解析、已正規化的資料）
 * 2. Cache Storage（Service Worker 重啟後仍保留的原始文字）
 * 3. 網路請求（含逾時中止、同網址併發去重）
 *
 * 網路失敗時，若存在未超過 staleIfErrorMs 的舊資料，回傳舊資料並標記 stale。
 * 只有「通過解析驗證」的回應才會寫入快取，避免快取到 Cloudflare 挑戰頁等錯誤內容。
 */

import { PayloadError } from "../core/esun";
import { log } from "../utils/log";
import { settleWithin } from "../utils/timing";

/**
 * 持久快取（Cache Storage）單次操作的時間上限。
 * 📌 全新的瀏覽器設定檔或磁碟忙碌時，Cache Storage 初始化偶爾會卡住數十秒；
 *    快取只是加速手段，逾時就直接走網路，不能讓它擋住資料請求。
 */
export const PERSIST_TIMEOUT_MS = 400;

export interface CacheDeps {
    fetch: (input: string, init?: RequestInit) => Promise<globalThis.Response>;
    /** Cache Storage；測試或不支援時可為 null（僅使用記憶體） */
    caches: CacheStorage | null;
    now: () => number;
}

export interface CacheOptions {
    cacheName: string;
    memoryLimit: number;
    /** 允許連線的主機；未設定則不限制 */
    allowedHosts?: readonly string[];
    defaultTimeoutMs: number;
    /** 持久快取單次操作上限（預設 PERSIST_TIMEOUT_MS） */
    persistTimeoutMs?: number;
}

export interface FetchPolicy {
    ttlMs: number;
    force?: boolean;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    timeoutMs?: number;
    staleIfErrorMs?: number;
    /**
     * 快取鍵（預設為網址）。網址含日期等變動參數時，可指定固定的鍵，
     * 讓跨日後網路失敗仍能回退到最近一次成功的資料。必須是 https 網址。
     */
    cacheKey?: string;
}

export interface CacheResult<T> {
    value: T;
    fetchedAt: number;
    stale: boolean;
}

export class HttpError extends Error {
    constructor(readonly status: number) {
        super(`HTTP ${status}`);
        this.name = "HttpError";
    }
}

export class TimeoutError extends Error {
    constructor() {
        super("連線逾時");
        this.name = "TimeoutError";
    }
}

const AT_HEADER = "x-fi-fetched-at";

interface MemoryEntry {
    at: number;
    value: unknown;
}

export class JsonCache {
    private readonly memory = new Map<string, MemoryEntry>();
    private readonly inflight = new Map<string, Promise<CacheResult<unknown>>>();
    private storePromise: Promise<Cache | null> | null = null;

    constructor(
        private readonly deps: CacheDeps,
        private readonly options: CacheOptions
    ) {}

    /** 取得 JSON 並以 transform 正規化（transform 拋錯代表資料無效，不會被快取） */
    async get<T>(url: string, policy: FetchPolicy, transform: (json: unknown) => T): Promise<CacheResult<T>> {
        this.assertAllowed(url);
        const key = policy.cacheKey ?? url;
        if (key !== url) this.assertAllowed(key);
        const started = this.deps.now();

        if (!policy.force) {
            const fresh = await this.readFresh(key, policy.ttlMs, transform);
            log.debug("cache", fresh ? "hit" : "miss", this.deps.now() - started, "ms", url);
            if (fresh) return fresh;
        }

        let pending = this.inflight.get(key) as Promise<CacheResult<T>> | undefined;
        if (!pending) {
            pending = this.fetchAndStore(url, key, policy, transform);
            this.inflight.set(key, pending);
            const clear = (): void => {
                if (this.inflight.get(key) === pending) this.inflight.delete(key);
            };
            pending.then(clear, clear);
        }

        try {
            const result = await pending;
            log.debug("fetched", this.deps.now() - started, "ms", url);
            return result;
        } catch (error) {
            log.debug("fetch failed", this.deps.now() - started, "ms", url, error);
            const stale = await this.readStale(key, policy.staleIfErrorMs ?? 0, transform);
            if (stale) return stale;
            throw error;
        }
    }

    /** 清除全部快取 */
    async clear(): Promise<void> {
        this.memory.clear();
        if (this.deps.caches) {
            await this.deps.caches.delete(this.options.cacheName);
            this.storePromise = null;
        }
    }

    /** 刪除超過 maxAgeMs 的持久快取，回傳刪除筆數 */
    async purge(maxAgeMs: number): Promise<number> {
        const store = await this.store();
        if (!store) return 0;
        const now = this.deps.now();
        let removed = 0;
        for (const request of await store.keys()) {
            const res = await store.match(request);
            const at = Number(res?.headers.get(AT_HEADER));
            if (!res || !Number.isFinite(at) || now - at > maxAgeMs) {
                await store.delete(request);
                removed++;
            }
        }
        return removed;
    }

    // ------------------------------------------------------------------------

    /** 只允許 https 與白名單主機 */
    private isAllowed(url: string): boolean {
        const hosts = this.options.allowedHosts;
        if (!hosts) return true;
        try {
            const parsed = new URL(url);
            return parsed.protocol === "https:" && hosts.includes(parsed.hostname);
        } catch {
            return false;
        }
    }

    private assertAllowed(url: string): void {
        if (!this.isAllowed(url)) throw new Error(`不允許的網址：${url}`);
    }

    private remember(url: string, at: number, value: unknown): void {
        this.memory.delete(url);
        this.memory.set(url, { at, value });
        while (this.memory.size > this.options.memoryLimit) {
            const oldest = this.memory.keys().next().value;
            if (oldest === undefined) break;
            this.memory.delete(oldest);
        }
    }

    private async readFresh<T>(url: string, ttlMs: number, transform: (json: unknown) => T): Promise<CacheResult<T> | null> {
        const now = this.deps.now();
        const mem = this.memory.get(url);
        if (mem && now - mem.at < ttlMs) {
            this.remember(url, mem.at, mem.value); // LRU：移到最新
            return { value: mem.value as T, fetchedAt: mem.at, stale: false };
        }
        const stored = await this.readPersistent(url);
        if (stored && now - stored.at < ttlMs) {
            try {
                const value = transform(JSON.parse(stored.text));
                this.remember(url, stored.at, value);
                return { value, fetchedAt: stored.at, stale: false };
            } catch {
                // 持久快取內容損壞：改走網路
            }
        }
        return null;
    }

    private async readStale<T>(url: string, maxStaleMs: number, transform: (json: unknown) => T): Promise<CacheResult<T> | null> {
        if (maxStaleMs <= 0) return null;
        const now = this.deps.now();
        const mem = this.memory.get(url);
        if (mem && now - mem.at <= maxStaleMs) return { value: mem.value as T, fetchedAt: mem.at, stale: true };
        const stored = await this.readPersistent(url);
        if (stored && now - stored.at <= maxStaleMs) {
            try {
                return { value: transform(JSON.parse(stored.text)), fetchedAt: stored.at, stale: true };
            } catch {
                return null;
            }
        }
        return null;
    }

    private async fetchAndStore<T>(url: string, key: string, policy: FetchPolicy, transform: (json: unknown) => T): Promise<CacheResult<T>> {
        const text = await this.fetchText(url, policy);
        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch {
            throw new PayloadError("回應不是有效的 JSON");
        }
        const value = transform(json);
        const at = this.deps.now();
        this.remember(key, at, value);
        void this.writePersistent(key, text, at);
        return { value, fetchedAt: at, stale: false };
    }

    private async fetchText(url: string, policy: FetchPolicy): Promise<string> {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, policy.timeoutMs ?? this.options.defaultTimeoutMs);
        try {
            const res = await this.deps.fetch(url, {
                headers: policy.headers,
                credentials: policy.credentials ?? "omit",
                signal: controller.signal,
                cache: policy.force ? "no-cache" : "default",
            });
            // 被重新導向到白名單以外的主機時拒絕使用（防止成為任意網址代理）
            if (res.redirected && !this.isAllowed(res.url)) throw new Error("不允許的重新導向");
            if (!res.ok) throw new HttpError(res.status);
            return await res.text();
        } catch (error) {
            if (timedOut) throw new TimeoutError();
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    private store(): Promise<Cache | null> {
        if (!this.deps.caches) return Promise.resolve(null);
        this.storePromise ??= this.deps.caches.open(this.options.cacheName).catch(() => null);
        return this.storePromise;
    }

    /** 預先開啟持久快取（Service Worker 啟動時呼叫，讓第一個請求不必等待） */
    warm(): void {
        void this.store();
    }

    /** 讀取持久快取；任何一步逾時或失敗都視為沒有快取 */
    private async readPersistent(url: string): Promise<{ text: string; at: number } | null> {
        const limit = this.options.persistTimeoutMs ?? PERSIST_TIMEOUT_MS;
        try {
            const store = await settleWithin(this.store(), limit);
            if (!store) return null;
            const res = await settleWithin(store.match(url), limit);
            if (!res) return null;
            const at = Number(res.headers.get(AT_HEADER));
            if (!Number.isFinite(at)) return null;
            const text = await settleWithin(res.text(), limit);
            return text === null ? null : { text, at };
        } catch {
            return null;
        }
    }

    private async writePersistent(url: string, text: string, at: number): Promise<void> {
        try {
            const store = await this.store();
            await store?.put(url, new Response(text, { headers: { "content-type": "application/json", [AT_HEADER]: String(at) } }));
        } catch {
            // 配額不足等錯誤：忽略，僅使用記憶體快取
        }
    }
}

/** 錯誤類型代碼（供 content script 判斷，例如 FindBillion 的 http-403） */
export function errorCode(error: unknown): string {
    if (error instanceof HttpError) return `http-${error.status}`;
    if (error instanceof TimeoutError) return "timeout";
    if (error instanceof PayloadError) return "payload";
    if (error instanceof TypeError) return "network";
    return "unknown";
}

/** 將錯誤轉為給使用者看的簡短訊息 */
export function describeError(error: unknown): string {
    if (error instanceof HttpError) return error.status === 403 ? "來源拒絕存取（HTTP 403）" : `來源錯誤（HTTP ${error.status}）`;
    if (error instanceof TimeoutError) return "連線逾時";
    if (error instanceof PayloadError) return "資料格式錯誤";
    if (error instanceof TypeError) return "網路連線失敗";
    if (error instanceof Error) return error.message;
    return String(error);
}
