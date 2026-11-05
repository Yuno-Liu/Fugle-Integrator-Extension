/**
 * ============================================================================
 * 📚 股票資料庫服務（background）
 * ============================================================================
 *
 * 載入策略（快且可離線）：
 * 1. 若 Cache Storage 有遠端版本 → 直接使用；超過 TTL 時於背景更新
 * 2. 否則使用擴充功能內建的 stock-data.json → 並於背景下載遠端版本供下次使用
 *
 * 遠端版本必須通過格式驗證才會被採用，載入失敗不會被永久記住（下次呼叫會重試）。
 */

import { StockIndex, isStockDatabase } from "../core/stockIndex";
import type { StockDatabase } from "../shared/types";
import { settleWithin } from "../utils/timing";
import { PERSIST_TIMEOUT_MS } from "./cache";

export interface StockDbDeps {
    fetch: (input: string, init?: RequestInit) => Promise<globalThis.Response>;
    caches: CacheStorage | null;
    now: () => number;
    bundledUrl: string;
    remoteUrl: string;
    ttlMs: number;
    cacheName: string;
    timeoutMs: number;
    /** 背景更新遠端版本前的延遲（避免與頁面首次請求搶資源） */
    refreshDelayMs?: number;
    /** Cache Storage 單次操作上限（預設 PERSIST_TIMEOUT_MS） */
    persistTimeoutMs?: number;
}

const AT_HEADER = "x-fi-fetched-at";

export class StockDbService {
    private index: StockIndex | null = null;
    private loading: Promise<StockIndex> | null = null;
    private refreshing: Promise<void> | null = null;

    constructor(private readonly deps: StockDbDeps) {}

    /** 取得索引（首次呼叫時載入） */
    getIndex(): Promise<StockIndex> {
        if (this.index) return Promise.resolve(this.index);
        if (!this.loading) {
            this.loading = this.load().finally(() => {
                this.loading = null;
            });
        }
        return this.loading;
    }

    /** 等待背景更新完成（測試用） */
    async settled(): Promise<void> {
        await this.refreshing;
    }

    private async load(): Promise<StockIndex> {
        const cached = await this.readCachedRemote();
        if (cached) {
            try {
                const index = this.build(cached.text);
                if (this.deps.now() - cached.at > this.deps.ttlMs) this.scheduleRefresh();
                return index;
            } catch {
                // 快取內容損壞：改用內建版本
            }
        }

        try {
            const res = await this.deps.fetch(this.deps.bundledUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const index = this.build(await res.text());
            this.scheduleRefresh();
            return index;
        } catch {
            // 內建檔案讀取失敗（理論上不會發生）：直接嘗試遠端
            await this.refreshRemote(true);
            if (this.index) return this.index;
            throw new Error("股票資料庫載入失敗");
        }
    }

    private build(text: string): StockIndex {
        const json: unknown = JSON.parse(text);
        if (!isStockDatabase(json)) throw new Error("股票資料庫格式錯誤");
        const index = new StockIndex(json as StockDatabase);
        this.index = index;
        return index;
    }

    private scheduleRefresh(): void {
        const delay = this.deps.refreshDelayMs ?? 0;
        if (delay <= 0) void this.refreshRemote();
        else setTimeout(() => void this.refreshRemote(), delay);
    }

    /** 背景下載遠端版本；成功後替換目前索引並寫入快取 */
    private refreshRemote(awaitResult = false): Promise<void> {
        if (!this.refreshing) {
            this.refreshing = (async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);
                try {
                    const res = await this.deps.fetch(this.deps.remoteUrl, { signal: controller.signal, cache: "no-cache" });
                    if (!res.ok) return;
                    // 被重新導向到其他主機的內容不採用
                    if (res.redirected && new URL(res.url).hostname !== new URL(this.deps.remoteUrl).hostname) return;
                    const text = await res.text();
                    this.build(text); // 驗證失敗會拋錯，不會寫入快取
                    const store = this.deps.caches ? await this.deps.caches.open(this.deps.cacheName) : null;
                    await store?.put(this.deps.remoteUrl, new Response(text, { headers: { "content-type": "application/json", [AT_HEADER]: String(this.deps.now()) } }));
                } catch {
                    // 遠端更新失敗不影響目前使用的版本
                } finally {
                    clearTimeout(timer);
                    this.refreshing = null;
                }
            })();
        }
        return awaitResult ? this.refreshing : Promise.resolve();
    }

    /** 讀取快取的遠端版本；Cache Storage 卡住時直接放棄（改用內建版本），不阻塞查詢 */
    private async readCachedRemote(): Promise<{ text: string; at: number } | null> {
        const limit = this.deps.persistTimeoutMs ?? PERSIST_TIMEOUT_MS;
        try {
            if (!this.deps.caches) return null;
            const store = await settleWithin(this.deps.caches.open(this.deps.cacheName), limit);
            const res = store ? await settleWithin(store.match(this.deps.remoteUrl), limit) : null;
            if (!res) return null;
            const at = Number(res.headers.get(AT_HEADER));
            // 2MB 文字讀取給較寬裕的時間
            const text = await settleWithin(res.text(), limit * 5);
            return text === null ? null : { text, at: Number.isFinite(at) ? at : 0 };
        } catch {
            return null;
        }
    }
}
