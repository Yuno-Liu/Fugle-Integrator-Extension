/**
 * background/cache.ts：JsonCache（記憶體 + Cache Storage + 網路）與錯誤代碼對應。
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, JsonCache, TimeoutError, describeError, errorCode } from "../../src/background/cache";
import type { CacheOptions, FetchPolicy } from "../../src/background/cache";
import { PayloadError, parseBasic, parseEtfHoldings, parseNames } from "../../src/core/esun";
import { ALLOWED_HOSTS, API } from "../../src/shared/constants";
import { FakeCacheStorage, createFetch } from "../helpers/fakes";
import type { RouteReply } from "../helpers/fakes";
import { fixture, fixtureText } from "../helpers/fixtures";

const CACHE_NAME = "test-cache";
const URL_BASIC = API.basic("2330");
const URL_INDUSTRY = API.industry("2330");
const URL_CONCEPT = API.concept("2330");
const URL_ETF = API.etfHolding("2330");

const MINUTE = 60_000;

/** 可手動推進的時鐘 */
function clock(start = Date.UTC(2026, 10, 5, 1, 0, 0)) {
    let t = start;
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms;
        },
        set: (ms: number) => {
            t = ms;
        },
    };
}

/** 等待 fire-and-forget 的持久寫入完成 */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

type Routes = Parameters<typeof createFetch>[0];

function makeCache(routes: Routes, opts: Partial<CacheOptions> & { storage?: FakeCacheStorage | null; time?: ReturnType<typeof clock> } = {}) {
    const time = opts.time ?? clock();
    const storage = opts.storage === undefined ? new FakeCacheStorage() : opts.storage;
    const f = createFetch(routes);
    const cache = new JsonCache(
        { fetch: f.fetch, caches: storage ? storage.asCacheStorage() : null, now: time.now },
        {
            cacheName: CACHE_NAME,
            memoryLimit: opts.memoryLimit ?? 50,
            allowedHosts: opts.allowedHosts ?? ALLOWED_HOSTS,
            defaultTimeoutMs: opts.defaultTimeoutMs ?? 1_000,
        }
    );
    return { cache, calls: f.calls, time, storage };
}

const basicReply: RouteReply = { body: fixture("basic-2330.json") };
const policy = (ttlMs: number, extra: Partial<FetchPolicy> = {}): FetchPolicy => ({ ttlMs, ...extra });

describe("JsonCache 讀取順序", () => {
    test("記憶體新鮮命中：第二次不再發出請求，且回傳已正規化資料", async () => {
        const { cache, calls, time } = makeCache([[URL_BASIC, basicReply]]);
        const first = await cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        time.advance(MINUTE);
        const second = await cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);

        assert.equal(calls.length, 1);
        assert.equal(first.value?.shortName, "台積電");
        assert.equal(first.value?.capitalThousand, 259_323_701);
        assert.equal(first.stale, false);
        assert.deepEqual(second, { value: first.value, fetchedAt: first.fetchedAt, stale: false });
        assert.equal(second.fetchedAt, time.now() - MINUTE, "fetchedAt 保留原始取得時間");
    });

    test("超過 TTL 後重新請求並更新 fetchedAt", async () => {
        const { cache, calls, time } = makeCache([[URL_BASIC, basicReply]]);
        const first = await cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        time.advance(10 * MINUTE); // 剛好到期（now - at < ttl 不成立）
        const second = await cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        assert.equal(calls.length, 2);
        assert.equal(second.fetchedAt, first.fetchedAt + 10 * MINUTE);
        assert.equal(second.stale, false);
    });

    test("持久快取：共用 Cache Storage 的新實例（模擬 Service Worker 重啟）不需網路即可命中", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const a = makeCache([[URL_BASIC, basicReply]], { storage, time });
        const original = await a.cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        await settle();

        time.advance(2 * MINUTE);
        const b = makeCache([[URL_BASIC, { error: new TypeError("offline") }]], { storage, time });
        const restored = await b.cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);

        assert.equal(b.calls.length, 0, "重啟後應從 Cache Storage 讀取");
        assert.deepEqual(restored.value, original.value);
        assert.equal(restored.fetchedAt, original.fetchedAt);
        assert.equal(restored.stale, false);

        // 讀回後放入記憶體：再讀一次也不需要再打開持久快取的內容
        const again = await b.cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        assert.deepEqual(again.value, original.value);
        assert.equal(b.calls.length, 0);
    });

    test("持久快取存的是原始文字：新實例以自己的 transform 重新解析", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const a = makeCache([[URL_INDUSTRY, { body: fixture("industry-2330.json") }]], { storage, time });
        await a.cache.get(URL_INDUSTRY, policy(MINUTE), parseNames);
        await settle();
        const b = makeCache([], { storage, time });
        const r = await b.cache.get(URL_INDUSTRY, policy(MINUTE), (json) => parseNames(json).length);
        assert.equal(r.value, 3);
        assert.equal(b.calls.length, 0);
    });

    test("持久快取過期（超過 TTL）時改走網路", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const a = makeCache([[URL_BASIC, basicReply]], { storage, time });
        await a.cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        await settle();
        time.advance(11 * MINUTE);
        const b = makeCache([[URL_BASIC, basicReply]], { storage, time });
        const r = await b.cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        assert.equal(b.calls.length, 1);
        assert.equal(r.fetchedAt, time.now());
    });

    test("force 略過快取並以 no-cache 重新請求", async () => {
        const { cache, calls } = makeCache([[URL_BASIC, basicReply]]);
        await cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        await cache.get(URL_BASIC, policy(10 * MINUTE, { force: true }), parseBasic);
        assert.equal(calls.length, 2);
        assert.equal(calls[0]?.init?.cache, "default");
        assert.equal(calls[1]?.init?.cache, "no-cache");
    });

    test("請求參數：預設 credentials 為 omit，可指定 include 與 headers", async () => {
        const { cache, calls } = makeCache([
            [URL_BASIC, basicReply],
            [URL_ETF, { body: fixture("etf-2330.synthetic.json") }],
        ]);
        await cache.get(URL_BASIC, policy(MINUTE), parseBasic);
        await cache.get(URL_ETF, policy(MINUTE, { credentials: "include", headers: { accept: "application/json" } }), parseEtfHoldings);
        assert.equal(calls[0]?.init?.credentials, "omit");
        assert.equal(calls[1]?.init?.credentials, "include");
        assert.deepEqual(calls[1]?.init?.headers, { accept: "application/json" });
        assert.ok(calls[0]?.init?.signal instanceof AbortSignal);
    });

    test("同一網址併發請求只發出一次 fetch，所有呼叫者取得相同結果", async () => {
        const { cache, calls } = makeCache([[URL_BASIC, { ...basicReply, delayMs: 20 }]]);
        const results = await Promise.all([1, 2, 3].map(() => cache.get(URL_BASIC, policy(MINUTE), parseBasic)));
        assert.equal(calls.length, 1);
        for (const r of results) assert.equal(r.value?.shortName, "台積電");
    });

    test("併發請求失敗後不會卡住：下一次呼叫重新請求", async () => {
        let n = 0;
        const { cache, calls } = makeCache([[URL_BASIC, () => (n++ === 0 ? { status: 500, delayMs: 10 } : basicReply)]]);
        const settled = await Promise.allSettled([cache.get(URL_BASIC, policy(MINUTE), parseBasic), cache.get(URL_BASIC, policy(MINUTE), parseBasic)]);
        assert.deepEqual(
            settled.map((s) => s.status),
            ["rejected", "rejected"]
        );
        assert.equal(calls.length, 1);
        const ok = await cache.get(URL_BASIC, policy(MINUTE), parseBasic);
        assert.equal(ok.value?.shortName, "台積電");
        assert.equal(calls.length, 2);
    });
});

describe("JsonCache 錯誤處理（不快取壞資料）", () => {
    test("Cloudflare 挑戰頁（HTML、HTTP 200）→ PayloadError，且不寫入任何快取", async () => {
        const { cache, calls, storage } = makeCache([[URL_ETF, { body: fixtureText("etf-cloudflare-challenge.html"), headers: { "content-type": "text/html" } }]]);
        await assert.rejects(cache.get(URL_ETF, policy(MINUTE), parseEtfHoldings), PayloadError);
        await settle();
        assert.equal(storage?.caches.get(CACHE_NAME)?.store.size ?? 0, 0);
        await assert.rejects(cache.get(URL_ETF, policy(MINUTE), parseEtfHoldings), PayloadError);
        assert.equal(calls.length, 2, "錯誤結果不可被記憶體快取");
    });

    test("transform 拋錯（結構不符）→ 原錯誤傳出，且不快取", async () => {
        // ETF 解析器預期陣列，玉山物件結構應被拒絕
        const { cache, calls, storage } = makeCache([[URL_ETF, { body: fixture("basic-2330.json") }]]);
        await assert.rejects(cache.get(URL_ETF, policy(MINUTE), parseEtfHoldings), (e: unknown) => e instanceof PayloadError && errorCode(e) === "payload");
        await settle();
        assert.equal(storage?.caches.get(CACHE_NAME)?.store.size ?? 0, 0);
        await assert.rejects(cache.get(URL_ETF, policy(MINUTE), parseEtfHoldings), PayloadError);
        assert.equal(calls.length, 2);
    });

    const httpCases: Array<{ status: number; code: string; message: string }> = [
        { status: 403, code: "http-403", message: "來源拒絕存取（HTTP 403）" },
        { status: 404, code: "http-404", message: "來源錯誤（HTTP 404）" },
        { status: 500, code: "http-500", message: "來源錯誤（HTTP 500）" },
        { status: 503, code: "http-503", message: "來源錯誤（HTTP 503）" },
    ];
    for (const c of httpCases) {
        test(`HTTP ${c.status} → HttpError(${c.status})，代碼 ${c.code}`, async () => {
            const { cache, storage } = makeCache([[URL_BASIC, { status: c.status, body: "error" }]]);
            const error = await cache.get(URL_BASIC, policy(MINUTE), parseBasic).then(
                () => assert.fail("應該失敗"),
                (e: unknown) => e
            );
            assert.ok(error instanceof HttpError);
            assert.equal(error.status, c.status);
            assert.equal(errorCode(error), c.code);
            assert.equal(describeError(error), c.message);
            await settle();
            assert.equal(storage?.caches.get(CACHE_NAME)?.store.size ?? 0, 0);
        });
    }

    test("逾時（defaultTimeoutMs）→ 中止請求並拋出 TimeoutError", async () => {
        const { cache, calls } = makeCache([[URL_BASIC, { ...basicReply, delayMs: 250 }]], { defaultTimeoutMs: 20 });
        const started = Date.now();
        await assert.rejects(cache.get(URL_BASIC, policy(MINUTE), parseBasic), TimeoutError);
        assert.ok(Date.now() - started < 200, "應在逾時後立即中止，而非等待回應");
        assert.equal(calls[0]?.init?.signal?.aborted, true);
    });

    test("逾時（policy.timeoutMs 覆寫預設值）→ TimeoutError，代碼 timeout", async () => {
        const { cache } = makeCache([[URL_BASIC, { ...basicReply, delayMs: 250 }]], { defaultTimeoutMs: 10_000 });
        const error = await cache.get(URL_BASIC, policy(MINUTE, { timeoutMs: 20 }), parseBasic).then(
            () => assert.fail("應該逾時"),
            (e: unknown) => e
        );
        assert.ok(error instanceof TimeoutError);
        assert.equal(errorCode(error), "timeout");
        assert.equal(describeError(error), "連線逾時");
    });

    test("回應時間在逾時內則正常完成", async () => {
        const { cache } = makeCache([[URL_BASIC, { ...basicReply, delayMs: 5 }]], { defaultTimeoutMs: 200 });
        const r = await cache.get(URL_BASIC, policy(MINUTE), parseBasic);
        assert.equal(r.value?.marketCode, "TSE");
    });

    test("網路錯誤（TypeError）原樣傳出，代碼 network", async () => {
        const { cache } = makeCache([[URL_BASIC, { error: new TypeError("Failed to fetch") }]]);
        const error = await cache.get(URL_BASIC, policy(MINUTE), parseBasic).then(
            () => assert.fail("應該失敗"),
            (e: unknown) => e
        );
        assert.ok(error instanceof TypeError);
        assert.equal(errorCode(error), "network");
        assert.equal(describeError(error), "網路連線失敗");
    });
});

describe("JsonCache stale-if-error", () => {
    const WEEK = 7 * 24 * 60 * MINUTE;

    test("網路失敗時在 staleIfErrorMs 內回傳舊資料並標記 stale", async () => {
        let fail = false;
        const { cache, time } = makeCache([[URL_BASIC, () => (fail ? { status: 500 } : basicReply)]]);
        const fresh = await cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK }), parseBasic);
        fail = true;
        time.advance(3 * 24 * 60 * MINUTE);
        const stale = await cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK }), parseBasic);
        assert.equal(stale.stale, true);
        assert.equal(stale.fetchedAt, fresh.fetchedAt);
        assert.deepEqual(stale.value, fresh.value);
    });

    test("超過 staleIfErrorMs 則拋出原錯誤", async () => {
        let fail = false;
        const { cache, time } = makeCache([[URL_BASIC, () => (fail ? { status: 502 } : basicReply)]]);
        await cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK }), parseBasic);
        fail = true;
        time.advance(WEEK + 1);
        await assert.rejects(cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK }), parseBasic), (e: unknown) => e instanceof HttpError && e.status === 502);
    });

    test("未設定 staleIfErrorMs 時，即使有舊資料也拋出錯誤", async () => {
        let fail = false;
        const { cache, time } = makeCache([[URL_BASIC, () => (fail ? { status: 500 } : basicReply)]]);
        await cache.get(URL_BASIC, policy(MINUTE), parseBasic);
        fail = true;
        time.advance(2 * MINUTE);
        await assert.rejects(cache.get(URL_BASIC, policy(MINUTE), parseBasic), HttpError);
    });

    test("Service Worker 重啟後離線：從持久快取取得 stale 資料", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const a = makeCache([[URL_BASIC, basicReply]], { storage, time });
        const fresh = await a.cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK }), parseBasic);
        await settle();
        time.advance(24 * 60 * MINUTE);
        const b = makeCache([[URL_BASIC, { error: new TypeError("offline") }]], { storage, time });
        const r = await b.cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK }), parseBasic);
        assert.equal(r.stale, true);
        assert.equal(r.fetchedAt, fresh.fetchedAt);
        assert.equal(r.value?.shortName, "台積電");
    });

    test("force 重新整理失敗時也可回退到 stale 資料", async () => {
        let fail = false;
        const { cache } = makeCache([[URL_BASIC, () => (fail ? { error: new TypeError("offline") } : basicReply)]]);
        await cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK }), parseBasic);
        fail = true;
        const r = await cache.get(URL_BASIC, policy(10 * MINUTE, { staleIfErrorMs: WEEK, force: true }), parseBasic);
        assert.equal(r.stale, true);
    });
});

describe("JsonCache 主機白名單", () => {
    const rejected: Array<{ url: string; why: RegExp }> = [
        { url: "https://evil.example.com/data.json", why: /不允許的網址/ },
        { url: "http://sjis.esunsec.com.tw/b2brwdCommon/jsondata/x", why: /不允許的網址/ },
        { url: "ftp://sjis.esunsec.com.tw/x", why: /不允許的網址/ },
        { url: "not a url", why: /不允許的網址/ },
        { url: "https://sjis.esunsec.com.tw.evil.com/x", why: /不允許的網址/ },
    ];
    for (const c of rejected) {
        test(`拒絕 ${c.url}，且不發出請求`, async () => {
            const { cache, calls } = makeCache([[() => true, { body: {} }]]);
            await assert.rejects(cache.get(c.url, policy(MINUTE), (j) => j), c.why);
            assert.equal(calls.length, 0);
        });
    }

    test("白名單內的每個主機都可連線", async () => {
        const { cache, calls } = makeCache([[() => true, { body: { ok: 1 } }]]);
        for (const host of ALLOWED_HOSTS) {
            const r = await cache.get(`https://${host}/x.json`, policy(MINUTE), (j) => j);
            assert.deepEqual(r.value, { ok: 1 });
        }
        assert.equal(calls.length, ALLOWED_HOSTS.length);
    });
});

describe("JsonCache 容量與清理", () => {
    test("記憶體 LRU：超過上限時淘汰最久未使用者", async () => {
        const { cache, calls } = makeCache(
            [
                [URL_BASIC, basicReply],
                [URL_INDUSTRY, { body: fixture("industry-2330.json") }],
                [URL_CONCEPT, { body: fixture("concept-2330.json") }],
            ],
            { memoryLimit: 2, storage: null }
        );
        const p = policy(10 * MINUTE);
        await cache.get(URL_BASIC, p, parseBasic); // [basic]
        await cache.get(URL_INDUSTRY, p, parseNames); // [basic, industry]
        await cache.get(URL_BASIC, p, parseBasic); // 命中，basic 移到最新 → [industry, basic]
        assert.equal(calls.length, 2);
        await cache.get(URL_CONCEPT, p, parseNames); // 淘汰 industry → [basic, concept]
        assert.equal(calls.length, 3);

        await cache.get(URL_BASIC, p, parseBasic);
        assert.equal(calls.length, 3, "最近使用過的 basic 仍在記憶體中");
        await cache.get(URL_INDUSTRY, p, parseNames);
        assert.equal(calls.length, 4, "industry 已被淘汰，需重新請求");
    });

    test("purge(maxAge) 只刪除超過期限的持久項目並回傳筆數", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const { cache } = makeCache(
            [
                [URL_BASIC, basicReply],
                [URL_INDUSTRY, { body: fixture("industry-2330.json") }],
                [URL_CONCEPT, { body: fixture("concept-2330.json") }],
            ],
            { storage, time }
        );
        await cache.get(URL_BASIC, policy(MINUTE), parseBasic); // t0
        time.advance(5 * MINUTE);
        await cache.get(URL_INDUSTRY, policy(MINUTE), parseNames); // t0 + 5m
        time.advance(5 * MINUTE);
        await cache.get(URL_CONCEPT, policy(MINUTE), parseNames); // t0 + 10m
        await settle();

        // now = t0 + 10m；maxAge 6m → 只有 basic（10m 前）過期
        const removed = await cache.purge(6 * MINUTE);
        assert.equal(removed, 1);
        const keys = [...(storage.caches.get(CACHE_NAME)?.store.keys() ?? [])].sort();
        assert.deepEqual(keys, [URL_CONCEPT, URL_INDUSTRY].sort());

        assert.equal(await cache.purge(6 * MINUTE), 0, "再清一次沒有可刪的");
    });

    test("purge 也會刪除缺少時間標記的損壞項目", async () => {
        const storage = new FakeCacheStorage();
        const { cache } = makeCache([], { storage });
        const store = await storage.open(CACHE_NAME);
        await store.put("https://sjis.esunsec.com.tw/legacy", new Response("{}"));
        assert.equal(await cache.purge(60 * MINUTE), 1);
        assert.equal(store.store.size, 0);
    });

    test("沒有 Cache Storage 時 purge 回傳 0", async () => {
        const { cache } = makeCache([], { storage: null });
        assert.equal(await cache.purge(0), 0);
    });

    test("clear() 清除記憶體與持久快取，之後必須重新請求", async () => {
        const storage = new FakeCacheStorage();
        const time = clock();
        const { cache, calls } = makeCache([[URL_BASIC, basicReply]], { storage, time });
        await cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        await settle();
        assert.equal(storage.caches.get(CACHE_NAME)?.store.size, 1);

        await cache.clear();
        assert.equal(storage.caches.has(CACHE_NAME), false);

        await cache.get(URL_BASIC, policy(10 * MINUTE), parseBasic);
        assert.equal(calls.length, 2);
        await settle();
        assert.equal(storage.caches.get(CACHE_NAME)?.store.size, 1, "clear 後重新建立的快取可再次寫入");
    });
});

describe("errorCode / describeError", () => {
    const cases: Array<{ name: string; error: unknown; code: string; message: string }> = [
        { name: "HttpError 403", error: new HttpError(403), code: "http-403", message: "來源拒絕存取（HTTP 403）" },
        { name: "HttpError 429", error: new HttpError(429), code: "http-429", message: "來源錯誤（HTTP 429）" },
        { name: "TimeoutError", error: new TimeoutError(), code: "timeout", message: "連線逾時" },
        { name: "PayloadError", error: new PayloadError("缺少 ResultSet"), code: "payload", message: "資料格式錯誤" },
        { name: "TypeError（fetch 網路失敗）", error: new TypeError("Failed to fetch"), code: "network", message: "網路連線失敗" },
        { name: "一般 Error", error: new Error("不允許的主機：evil.com"), code: "unknown", message: "不允許的主機：evil.com" },
        { name: "字串", error: "boom", code: "unknown", message: "boom" },
        { name: "undefined", error: undefined, code: "unknown", message: "undefined" },
    ];
    for (const c of cases) {
        test(c.name, () => {
            assert.equal(errorCode(c.error), c.code);
            assert.equal(describeError(c.error), c.message);
        });
    }

    test("錯誤類別具備可辨識的 name 與 message", () => {
        const http = new HttpError(500);
        assert.equal(http.name, "HttpError");
        assert.equal(http.message, "HTTP 500");
        assert.equal(new TimeoutError().name, "TimeoutError");
    });
});
