/**
 * background/cache.ts 補充：warm()、重新導向白名單、policy.cacheKey（固定快取鍵）、
 * 持久快取卡住時的逾時回退；以及 stockdb.ts 拒絕被導向到其他主機的遠端版本。
 */
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { JsonCache, PERSIST_TIMEOUT_MS, describeError, errorCode } from "../../src/background/cache";
import type { CacheOptions, FetchPolicy } from "../../src/background/cache";
import { StockDbService } from "../../src/background/stockdb";
import { parseBasic } from "../../src/core/esun";
import { indexMarketList } from "../../src/core/market";
import { ALLOWED_HOSTS, API, MARKET_LISTS, STALE_IF_ERROR_MS, STOCK_DB_REMOTE_URL, TTL } from "../../src/shared/constants";
import type { StockDatabase } from "../../src/shared/types";
import { FakeCacheStorage } from "../helpers/fakes";
import { fixture, jsonResponse } from "../helpers/fixtures";

const CACHE_NAME = "extra-cache";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const AT_HEADER = "x-fi-fetched-at";
const URL_BASIC = API.basic("2330");

/** 可手動推進的時鐘 */
function clock(start = Date.UTC(2026, 10, 5, 1, 0, 0)) {
    let t = start;
    return { now: () => t, advance: (ms: number) => void (t += ms) };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/** 將回應標記為「經過重新導向，最終網址為 finalUrl」 */
function redirected(res: Response, finalUrl: string): Response {
    Object.defineProperty(res, "redirected", { value: true });
    Object.defineProperty(res, "url", { value: finalUrl });
    return res;
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** 簡單的可記錄 fetch（需要自訂 Response 屬性時使用，不經過 createFetch） */
function recordingFetch(handler: Handler) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        return handler(url, init);
    };
    return { fetch, calls };
}

function makeCache(handler: Handler, opts: Partial<CacheOptions> & { storage?: CacheStorage | null; time?: ReturnType<typeof clock> } = {}) {
    const time = opts.time ?? clock();
    const storage = opts.storage === undefined ? new FakeCacheStorage().asCacheStorage() : opts.storage;
    const f = recordingFetch(handler);
    const cache = new JsonCache(
        { fetch: f.fetch, caches: storage, now: time.now },
        {
            cacheName: CACHE_NAME,
            memoryLimit: 50,
            allowedHosts: "allowedHosts" in opts ? opts.allowedHosts : ALLOWED_HOSTS,
            defaultTimeoutMs: opts.defaultTimeoutMs ?? 1_000,
            persistTimeoutMs: opts.persistTimeoutMs,
        }
    );
    return { cache, calls: f.calls, time, storage };
}

const fake = (s: CacheStorage | null): FakeCacheStorage => s as unknown as FakeCacheStorage;
const persisted = (s: CacheStorage | null, key: string) => fake(s).caches.get(CACHE_NAME)?.store.get(key);
const basicBody = () => fixture("basic-2330.json");

// ============================================================================
// warm()
// ============================================================================

describe("JsonCache.warm()", () => {
    test("預先開啟持久快取一次；重複 warm 與之後的讀寫都共用同一次 open", async () => {
        const storage = new FakeCacheStorage();
        const { cache } = makeCache(() => jsonResponse(basicBody()), { storage: storage.asCacheStorage() });
        assert.equal(storage.opens, 0, "建構時不開啟");
        cache.warm();
        assert.equal(storage.opens, 1);
        cache.warm();
        cache.warm();
        assert.equal(storage.opens, 1);

        await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        await settle();
        await cache.get(API.basic("6488"), { ttlMs: MINUTE }, (j) => j);
        await settle();
        await cache.purge(DAY);
        assert.equal(storage.opens, 1);
        assert.ok(storage.caches.get(CACHE_NAME)?.store.has(URL_BASIC), "寫入使用預先開啟的 store");
    });

    test("沒有 Cache Storage 時 warm() 不出錯", async () => {
        const { cache, calls } = makeCache(() => jsonResponse(basicBody()), { storage: null });
        assert.doesNotThrow(() => cache.warm());
        const r = await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        assert.equal(r.value?.shortName, "台積電");
        assert.equal(calls.length, 1);
    });

    test("open() 失敗時 warm() 不產生未處理的拒絕，之後的請求改走網路", async () => {
        const storage = {
            opens: 0,
            open() {
                this.opens++;
                return Promise.reject(new Error("quota"));
            },
            delete: async () => true,
        };
        const { cache, calls } = makeCache(() => jsonResponse(basicBody()), { storage: storage as unknown as CacheStorage });
        cache.warm();
        await settle();
        const r = await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        assert.equal(r.value?.shortName, "台積電");
        assert.equal(calls.length, 1);
        assert.equal(storage.opens, 1, "失敗的 open 不會重試（以 null 記住）");
    });
});

// ============================================================================
// 重新導向
// ============================================================================

describe("JsonCache 重新導向白名單", () => {
    const outside = ["https://evil.example.com/steal.json", "http://sjis.esunsec.com.tw/b2brwdCommon/jsondata/x", "https://sjis.esunsec.com.tw.evil.example/x"];
    for (const finalUrl of outside) {
        test(`被導向到 ${finalUrl} → 拒絕，且不寫入記憶體或持久快取`, async () => {
            const { cache, calls, storage } = makeCache(() => redirected(jsonResponse(basicBody()), finalUrl));
            const err = await cache.get(URL_BASIC, { ttlMs: MINUTE, staleIfErrorMs: DAY }, parseBasic).then(
                () => null,
                (e: unknown) => e
            );
            assert.ok(err instanceof Error);
            assert.match(err.message, /不允許的重新導向/);
            assert.equal(errorCode(err), "unknown");
            assert.equal(describeError(err), "不允許的重新導向");

            await settle();
            assert.equal(persisted(storage, URL_BASIC), undefined, "不寫入持久快取");
            await assert.rejects(cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic), /不允許的重新導向/);
            assert.equal(calls.length, 2, "沒有記憶體快取：第二次仍重新請求");
        });
    }

    test("被導向到白名單內的其他網址 → 正常使用並以原網址快取", async () => {
        const { cache, calls, storage } = makeCache(() => redirected(jsonResponse(basicBody()), "https://sjis.esunsec.com.tw/b2brwdCommon/jsondata/other"));
        const r = await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        assert.equal(r.value?.shortName, "台積電");
        await settle();
        assert.ok(persisted(storage, URL_BASIC));
        await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        assert.equal(calls.length, 1);
    });

    test("未設定 allowedHosts 時不檢查重新導向目的地", async () => {
        const { cache } = makeCache(() => redirected(jsonResponse(basicBody()), "https://anywhere.example.com/x"), { allowedHosts: undefined });
        const r = await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        assert.equal(r.value?.shortName, "台積電");
    });

    test("被導向到白名單外 → 有舊資料時以 stale-if-error 回退", async () => {
        let redirect = false;
        const { cache, time } = makeCache(() => (redirect ? redirected(jsonResponse({ hacked: true }), "https://evil.example.com/") : jsonResponse(basicBody())));
        const first = await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        time.advance(2 * MINUTE);
        redirect = true;
        const r = await cache.get(URL_BASIC, { ttlMs: MINUTE, staleIfErrorMs: DAY }, parseBasic);
        assert.equal(r.stale, true);
        assert.equal(r.fetchedAt, first.fetchedAt);
        assert.equal(r.value?.shortName, "台積電");
    });
});

// ============================================================================
// policy.cacheKey
// ============================================================================

describe("JsonCache policy.cacheKey（網址含日期時的固定快取鍵）", () => {
    const def = MARKET_LISTS.trustBuy;
    const KEY = def.url("latest");
    const URL_D1 = def.url("2026/11/04");
    const URL_D2 = def.url("2026/11/05");
    const transform = (json: unknown) => indexMarketList(json, def.keyField);
    const marketBody = () => fixture("market-trustbuy.json");
    const p = (extra: Partial<FetchPolicy> = {}): FetchPolicy => ({ ttlMs: TTL.chip, cacheKey: KEY, ...extra });

    test("不同網址共用同一鍵：第二個網址在 TTL 內直接命中記憶體，不發出請求", async () => {
        const { cache, calls, time } = makeCache(() => jsonResponse(marketBody()));
        const a = await cache.get(URL_D1, p(), transform);
        time.advance(MINUTE);
        const b = await cache.get(URL_D2, p(), transform);
        assert.deepEqual(
            calls.map((c) => c.url),
            [URL_D1]
        );
        assert.equal(b.value, a.value, "同一份已解析資料");
        assert.equal(b.fetchedAt, a.fetchedAt);
        assert.equal(b.stale, false);
    });

    test("持久快取以鍵儲存（而非實際網址）；新實例以另一個網址讀取也能命中", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const first = makeCache(() => jsonResponse(marketBody()), { storage: storage.asCacheStorage(), time });
        const a = await first.cache.get(URL_D1, p(), transform);
        await settle();
        const store = storage.caches.get(CACHE_NAME)?.store;
        assert.ok(store?.has(KEY));
        assert.equal(store?.has(URL_D1), false);
        assert.equal(store?.size, 1);

        time.advance(MINUTE);
        const second = makeCache(() => jsonResponse(marketBody()), { storage: storage.asCacheStorage(), time });
        const b = await second.cache.get(URL_D2, p(), transform);
        assert.equal(second.calls.length, 0, "Service Worker 重啟後由持久快取取得");
        assert.equal(b.fetchedAt, a.fetchedAt);
        assert.deepEqual([...b.value.entries()], [...a.value.entries()]);
    });

    test("同一鍵的併發請求只發出一次 fetch（以第一個網址請求）", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const { cache, calls } = makeCache(async () => {
            await gate;
            return jsonResponse(marketBody());
        });
        const pa = cache.get(URL_D1, p(), transform);
        const pb = cache.get(URL_D2, p(), transform);
        await settle();
        release();
        const [a, b] = await Promise.all([pa, pb]);
        assert.deepEqual(
            calls.map((c) => c.url),
            [URL_D1]
        );
        assert.equal(a.value, b.value);
    });

    test("未指定 cacheKey 時兩個網址各自請求", async () => {
        const { cache, calls } = makeCache(() => jsonResponse(marketBody()));
        await cache.get(URL_D1, { ttlMs: TTL.chip }, transform);
        await cache.get(URL_D2, { ttlMs: TTL.chip }, transform);
        assert.equal(calls.length, 2);
    });

    test("跨日後網路失敗：新日期網址回退到鍵下的舊資料（記憶體）並標記 stale", async () => {
        let fail = false;
        const { cache, calls, time } = makeCache(() => (fail ? new Response("down", { status: 503 }) : jsonResponse(marketBody())));
        const a = await cache.get(URL_D1, p({ staleIfErrorMs: STALE_IF_ERROR_MS }), transform);
        time.advance(DAY);
        fail = true;
        const b = await cache.get(URL_D2, p({ staleIfErrorMs: STALE_IF_ERROR_MS }), transform);
        assert.deepEqual(
            calls.map((c) => c.url),
            [URL_D1, URL_D2],
            "過期後以新日期網址請求"
        );
        assert.equal(b.stale, true);
        assert.equal(b.fetchedAt, a.fetchedAt);
        assert.equal(b.value, a.value);
    });

    test("跨日 + Service Worker 重啟 + 網路失敗：由持久快取的鍵回退", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const first = makeCache(() => jsonResponse(marketBody()), { storage: storage.asCacheStorage(), time });
        const a = await first.cache.get(URL_D1, p({ staleIfErrorMs: STALE_IF_ERROR_MS }), transform);
        await settle();

        time.advance(DAY + MINUTE);
        const second = makeCache(() => Promise.reject(new TypeError("Failed to fetch")), { storage: storage.asCacheStorage(), time });
        const b = await second.cache.get(URL_D2, p({ staleIfErrorMs: STALE_IF_ERROR_MS }), transform);
        assert.equal(second.calls[0]?.url, URL_D2);
        assert.equal(b.stale, true);
        assert.equal(b.fetchedAt, a.fetchedAt);
        assert.deepEqual([...b.value.entries()], [...a.value.entries()]);
    });

    test("沒有 cacheKey 時跨日失敗無法回退（對照組）", async () => {
        let fail = false;
        const { cache, time } = makeCache(() => (fail ? new Response("down", { status: 503 }) : jsonResponse(marketBody())));
        await cache.get(URL_D1, { ttlMs: TTL.chip, staleIfErrorMs: STALE_IF_ERROR_MS }, transform);
        time.advance(DAY);
        fail = true;
        await assert.rejects(cache.get(URL_D2, { ttlMs: TTL.chip, staleIfErrorMs: STALE_IF_ERROR_MS }, transform), /HTTP 503/);
    });

    test("cacheKey 不在白名單（或非 https）→ 拒絕且不發出請求", async () => {
        const { cache, calls } = makeCache(() => jsonResponse(marketBody()));
        await assert.rejects(cache.get(URL_D1, p({ cacheKey: "https://evil.example.com/k" }), transform), /不允許的網址/);
        await assert.rejects(cache.get(URL_D1, p({ cacheKey: "latest" }), transform), /不允許的網址/);
        assert.equal(calls.length, 0);
    });
});

// ============================================================================
// 持久快取卡住
// ============================================================================

describe("JsonCache 持久快取逾時回退（persistTimeoutMs）", () => {
    const PERSIST_MS = 30;

    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    /** 讓 promise 鏈前進（setImmediate 不受 mock 影響） */
    async function drain(rounds = 20): Promise<void> {
        for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
    }

    /** 啟動 get，確認在 persistTimeoutMs 之前不發出網路請求，到期後才改走網路 */
    async function expectNetworkAfter<T>(pending: Promise<T>, calls: unknown[], waitMs: number): Promise<T> {
        let settled = false;
        pending.then(
            () => (settled = true),
            () => (settled = true)
        );
        await drain();
        assert.equal(calls.length, 0, "持久快取尚未逾時，不發出請求");
        mock.timers.tick(waitMs - 1);
        await drain();
        assert.equal(calls.length, 0, "逾時前仍在等待持久快取");
        assert.equal(settled, false);
        mock.timers.tick(1);
        await drain();
        assert.equal(calls.length, 1, "逾時後改走網路");
        return pending;
    }

    test("caches.open() 永遠不完成 → persistTimeoutMs 後改走網路", async () => {
        const hanging = { open: () => new Promise<never>(() => undefined), delete: async () => true };
        const { cache, calls } = makeCache(() => jsonResponse(basicBody()), { storage: hanging as unknown as CacheStorage, persistTimeoutMs: PERSIST_MS });
        cache.warm();
        const r = await expectNetworkAfter(cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic), calls, PERSIST_MS);
        assert.equal(r.value?.shortName, "台積電");

        // 第二次在 TTL 內由記憶體命中，不再等待持久快取
        const again = await cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic);
        assert.equal(again.fetchedAt, r.fetchedAt);
        assert.equal(calls.length, 1);
    });

    test("store.match() 永遠不完成 → persistTimeoutMs 後改走網路", async () => {
        const store = { match: () => new Promise<never>(() => undefined), put: async () => undefined, keys: async () => [], delete: async () => true };
        const storage = { open: async () => store, delete: async () => true };
        const { cache, calls } = makeCache(() => jsonResponse(basicBody()), { storage: storage as unknown as CacheStorage, persistTimeoutMs: PERSIST_MS });
        const r = await expectNetworkAfter(cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic), calls, PERSIST_MS);
        assert.equal(r.value?.shortName, "台積電");
    });

    test("快取回應的 text() 永遠不完成 → persistTimeoutMs 後改走網路", async () => {
        const time = clock();
        const stuck = { headers: new Headers({ [AT_HEADER]: String(time.now()) }), text: () => new Promise<never>(() => undefined) };
        const store = { match: async () => stuck, put: async () => undefined, keys: async () => [], delete: async () => true };
        const storage = { open: async () => store, delete: async () => true };
        const { cache, calls } = makeCache(() => jsonResponse(basicBody()), { storage: storage as unknown as CacheStorage, persistTimeoutMs: PERSIST_MS, time });
        const r = await expectNetworkAfter(cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic), calls, PERSIST_MS);
        assert.equal(r.value?.shortName, "台積電");
    });

    test("未指定 persistTimeoutMs 時使用 PERSIST_TIMEOUT_MS", async () => {
        const hanging = { open: () => new Promise<never>(() => undefined), delete: async () => true };
        const { cache, calls } = makeCache(() => jsonResponse(basicBody()), { storage: hanging as unknown as CacheStorage });
        const r = await expectNetworkAfter(cache.get(URL_BASIC, { ttlMs: MINUTE }, parseBasic), calls, PERSIST_TIMEOUT_MS);
        assert.equal(r.value?.shortName, "台積電");
    });

    test("持久快取卡住且網路失敗 → stale 讀取也逾時，最終拋出原錯誤（不會永遠等待）", async () => {
        const hanging = { open: () => new Promise<never>(() => undefined), delete: async () => true };
        const { cache, calls } = makeCache(() => new Response("x", { status: 502 }), { storage: hanging as unknown as CacheStorage, persistTimeoutMs: PERSIST_MS });
        const pending = cache.get(URL_BASIC, { ttlMs: MINUTE, staleIfErrorMs: DAY }, parseBasic);
        const outcome = pending.then(
            () => "resolved",
            (e: unknown) => e
        );
        await drain();
        mock.timers.tick(PERSIST_MS);
        await drain();
        assert.equal(calls.length, 1);
        // readStale 再等一次 persistTimeoutMs
        mock.timers.tick(PERSIST_MS);
        await drain();
        const err = await outcome;
        assert.ok(err instanceof Error);
        assert.match(err.message, /HTTP 502/);
    });
});

// ============================================================================
// stockdb.ts：重新導向
// ============================================================================

describe("StockDbService 遠端版本重新導向", () => {
    const BUNDLED_URL = "chrome-extension://fake-id/stock-data.json";
    const DB_CACHE = "db-cache";
    const NOW = Date.UTC(2026, 10, 5, 1, 0, 0);

    const bundledDb = (): StockDatabase => fixture<StockDatabase>("stock-db-subset.json");
    function remoteDb(): StockDatabase {
        const db = bundledDb();
        db.basicInfo.push({ 股票代碼: "7777", 股票名稱: "遠端新股", 股本_億元: 1 });
        return db;
    }

    function makeDb(remote: () => Response) {
        const storage = new FakeCacheStorage();
        const f = recordingFetch((url) => (url === BUNDLED_URL ? jsonResponse(bundledDb()) : url === STOCK_DB_REMOTE_URL ? remote() : new Response("nf", { status: 404 })));
        const svc = new StockDbService({
            fetch: f.fetch,
            caches: storage.asCacheStorage(),
            now: () => NOW,
            bundledUrl: BUNDLED_URL,
            remoteUrl: STOCK_DB_REMOTE_URL,
            ttlMs: DAY,
            cacheName: DB_CACHE,
            timeoutMs: 1_000,
            refreshDelayMs: 0,
        });
        const remoteCalls = () => f.calls.filter((c) => c.url === STOCK_DB_REMOTE_URL).length;
        return { svc, storage, remoteCalls };
    }

    const foreign = ["https://evil.example.com/stock-data.json", "https://gist.githubusercontent.com/x/stock-data.json"];
    for (const finalUrl of foreign) {
        test(`遠端被導向到其他主機（${new URL(finalUrl).hostname}）→ 索引不變、不寫入快取`, async () => {
            const { svc, storage, remoteCalls } = makeDb(() => redirected(jsonResponse(remoteDb()), finalUrl));
            const first = await svc.getIndex();
            await svc.settled();
            assert.equal(remoteCalls(), 1);
            const after = await svc.getIndex();
            assert.equal(after, first, "仍是內建版索引");
            assert.equal(after.getStock("7777"), null);
            assert.equal(storage.caches.get(DB_CACHE)?.store.has(STOCK_DB_REMOTE_URL) ?? false, false);
        });
    }

    test("在同一主機內重新導向（例如 refs/heads 路徑變更）→ 正常採用並寫入快取（對照組）", async () => {
        const { svc, storage } = makeDb(() => redirected(jsonResponse(remoteDb()), "https://raw.githubusercontent.com/Yuno-Liu/Fugle-Integrator-Extension/main/stock-data.json"));
        await svc.getIndex();
        await svc.settled();
        assert.equal((await svc.getIndex()).getStock("7777")?.name, "遠端新股");
        assert.ok(storage.caches.get(DB_CACHE)?.store.has(STOCK_DB_REMOTE_URL));
    });

    test("內建版失敗且遠端被導向到其他主機 → 載入失敗（不採用外來內容）", async () => {
        const storage = new FakeCacheStorage();
        const f = recordingFetch((url) => (url === STOCK_DB_REMOTE_URL ? redirected(jsonResponse(remoteDb()), "https://evil.example.com/db.json") : new Response("nf", { status: 404 })));
        const svc = new StockDbService({ fetch: f.fetch, caches: storage.asCacheStorage(), now: () => NOW, bundledUrl: BUNDLED_URL, remoteUrl: STOCK_DB_REMOTE_URL, ttlMs: DAY, cacheName: DB_CACHE, timeoutMs: 1_000, refreshDelayMs: 0 });
        await assert.rejects(svc.getIndex(), /股票資料庫載入失敗/);
        assert.equal(storage.caches.get(DB_CACHE)?.store.has(STOCK_DB_REMOTE_URL) ?? false, false);
    });
});
