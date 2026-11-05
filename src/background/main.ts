/**
 * ============================================================================
 * 🔧 Background Service Worker
 * ============================================================================
 *
 * 職責：
 * - 代替 content script 向外部 API 取資料（content script 受 CORS 限制）
 * - 快取（記憶體 + Cache Storage），多分頁共用、Service Worker 重啟後仍有效
 * - 解析與正規化資料，只把必要的結果傳回頁面
 * - 股票資料庫索引與搜尋
 *
 * 安全性：只接受本擴充功能自身的訊息、只連線白名單主機、Token 不離開擴充功能。
 */

import { parseRequest } from "../shared/messages";
import type { Response } from "../shared/messages";
import { ALLOWED_HOSTS, CACHE_NAME, CACHE_PURGE_AGE_MS, FETCH_TIMEOUT_MS, LOCAL_KEYS, MEMORY_CACHE_LIMIT, STOCK_DB_BUNDLED_PATH, STOCK_DB_REMOTE_URL, TTL } from "../shared/constants";
import { log } from "../utils/log";
import { JsonCache, describeError, errorCode } from "./cache";
import { createDatasetService } from "./datasets";
import { route } from "./router";
import { StockDbService } from "./stockdb";

const PURGE_KEY = "fi.lastCachePurge";
const PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function startBackground(): void {
    const now = (): number => Date.now();
    const cacheStorage = typeof caches === "undefined" ? null : caches;
    const boundFetch = (input: string, init?: RequestInit): Promise<globalThis.Response> => fetch(input, init);

    const cache = new JsonCache({ fetch: boundFetch, caches: cacheStorage, now }, { cacheName: CACHE_NAME, memoryLimit: MEMORY_CACHE_LIMIT, allowedHosts: ALLOWED_HOSTS, defaultTimeoutMs: FETCH_TIMEOUT_MS });

    const stockDb = new StockDbService({
        fetch: boundFetch,
        caches: cacheStorage,
        now,
        bundledUrl: chrome.runtime.getURL(STOCK_DB_BUNDLED_PATH),
        remoteUrl: STOCK_DB_REMOTE_URL,
        ttlMs: TTL.stockDb,
        cacheName: CACHE_NAME,
        timeoutMs: 20_000,
        refreshDelayMs: 15_000,
    });

    const datasets = createDatasetService({
        cache,
        now,
        getFinmindToken: async () => {
            const stored = await chrome.storage.local.get(LOCAL_KEYS.finmindToken);
            const token = stored[LOCAL_KEYS.finmindToken];
            return typeof token === "string" ? token : "";
        },
    });

    // Service Worker 啟動時就開啟持久快取，避免第一個請求等待
    cache.warm();

    const services = {
        datasets,
        stockDb,
        cache,
        openOptions: () => chrome.runtime.openOptionsPage(),
        version: chrome.runtime.getManifest().version,
    };

    /** 每 12 小時最多清理一次過期的持久快取 */
    const maybePurge = async (): Promise<void> => {
        try {
            const stored = await chrome.storage.local.get(PURGE_KEY);
            const last = Number(stored[PURGE_KEY]) || 0;
            if (now() - last < PURGE_INTERVAL_MS) return;
            await chrome.storage.local.set({ [PURGE_KEY]: now() });
            const removed = await cache.purge(CACHE_PURGE_AGE_MS);
            log.debug("purged cache entries:", removed);
        } catch (error) {
            log.warn("cache purge failed:", error);
        }
    };

    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: Response<unknown>) => void) => {
        // 只處理本擴充功能內部（content script / 設定頁）送來的訊息
        if (sender.id !== chrome.runtime.id) return false;
        const req = parseRequest(message);
        if (!req) {
            sendResponse({ ok: false, error: "不支援的請求", code: "invalid" });
            return false;
        }
        const started = Date.now();
        log.debug("recv", req.type, (req as { name?: string }).name ?? "");
        route(req, services).then(
            (data) => {
                log.debug("respond", req.type, (req as { name?: string }).name ?? "", Date.now() - started, "ms");
                sendResponse({ ok: true, data });
            },
            (error: unknown) => {
                log.debug("request failed:", req, error);
                sendResponse({ ok: false, error: describeError(error), code: errorCode(error) });
            }
        );
        return true; // 非同步回應
    });

    // 清理與預載延後執行，避免和頁面第一次的資料請求搶 CPU 與連線
    const idle = (fn: () => void): void => void setTimeout(fn, 3000);
    chrome.runtime.onInstalled.addListener(() => {
        idle(() => {
            void maybePurge();
            void stockDb.getIndex().catch(() => undefined);
        });
    });
    chrome.runtime.onStartup.addListener(() => idle(() => void maybePurge()));
}
