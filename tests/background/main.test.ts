/**
 * background/main.ts：startBackground() 的訊息閘道（寄件者驗證、格式驗證、錯誤代碼）
 * 與安裝 / 啟動後延遲執行的快取清理、資料庫預載。
 *
 * 以 chrome 替身 + 受控的 globalThis.fetch / globalThis.caches 執行，不連線真實網路。
 */
import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { startBackground } from "../../src/background/main";
import { API, CACHE_NAME, LOCAL_KEYS, MAJOR_PERIODS, STOCK_DB_BUNDLED_PATH, STOCK_DB_REMOTE_URL } from "../../src/shared/constants";
import type { EsunRow } from "../../src/shared/types";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl } from "../helpers/chrome";
import { FakeCacheStorage, createFetch } from "../helpers/fakes";
import type { RouteReply } from "../helpers/fakes";
import { fixture } from "../helpers/fixtures";

const EXT_ID = "test-extension-id";
const BUNDLED_URL = `chrome-extension://${EXT_ID}/${STOCK_DB_BUNDLED_PATH}`;
const PURGE_KEY = "fi.lastCachePurge";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const AT_HEADER = "x-fi-fetched-at";

type Routes = Parameters<typeof createFetch>[0];
type Listener = (message: unknown, sender: { id?: string }, sendResponse: (res: unknown) => void) => unknown;

/** 去除主力資料中的 V7（迫使走 FinMind 備援，用來驗證 Token 讀取） */
function withoutV7(name: string): unknown {
    const sets = fixture<Array<{ ResultSet: { Result: EsunRow[] } }>>(name);
    for (const s of sets) {
        s.ResultSet.Result = s.ResultSet.Result.map((row) => {
            const copy = { ...row };
            delete copy.V7;
            return copy;
        });
    }
    return sets;
}

/** 讓非同步鏈（storage、Cache Storage、Response.text）跑完；不依賴 setTimeout（可能被 mock） */
async function drain(rounds = 30): Promise<void> {
    for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

interface Booted {
    fake: FakeChromeControl;
    listeners: Listener[];
    calls: ReturnType<typeof createFetch>["calls"];
    storage: FakeCacheStorage | null;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
});

/**
 * 安裝 chrome 替身、替換 fetch / caches 後啟動 background。
 * 所有替換都在 afterEach 還原。
 */
function boot(routes: Routes, opts: { storage?: FakeCacheStorage | null; local?: Record<string, unknown>; version?: string } = {}): Booted {
    const fake = installFakeChrome({ local: opts.local, version: opts.version });
    cleanups.push(() => fake.uninstall());

    // 攔截 onMessage.addListener，以便直接檢查監聽器的回傳值
    const listeners: Listener[] = [];
    const onMessage = fake.chrome.runtime.onMessage;
    const originalAdd = onMessage.addListener;
    onMessage.addListener = (l: Listener) => {
        listeners.push(l);
        return originalAdd(l);
    };

    const f = createFetch(routes);
    const g = globalThis as Record<string, unknown>;
    const prevFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    const prevCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
    const storage = opts.storage === undefined ? new FakeCacheStorage() : opts.storage;
    Object.defineProperty(globalThis, "fetch", { value: f.fetch, configurable: true, writable: true });
    Object.defineProperty(globalThis, "caches", { value: storage ? storage.asCacheStorage() : undefined, configurable: true, writable: true });
    cleanups.push(() => {
        if (prevFetch) Object.defineProperty(globalThis, "fetch", prevFetch);
        else delete g.fetch;
        if (prevCaches) Object.defineProperty(globalThis, "caches", prevCaches);
        else delete g.caches;
    });

    startBackground();
    return { fake, listeners, calls: f.calls, storage };
}

const basicRoutes = (extra: Routes = []): Routes => [...extra, [API.basic("2330"), { body: fixture("basic-2330.json") }]];

// ============================================================================
// 訊息閘道
// ============================================================================

describe("startBackground：訊息閘道", () => {
    test("註冊一個 onMessage 監聽器，並在啟動時預先開啟持久快取（只開一次）", async () => {
        const { listeners, storage, fake } = boot(basicRoutes());
        assert.equal(listeners.length, 1);
        assert.equal(storage?.opens, 1, "啟動時 warm() 開啟 Cache Storage");
        await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330" });
        assert.equal(storage?.opens, 1, "之後的請求共用同一個已開啟的 store");
    });

    const foreignSenders: Array<{ name: string; sender: { id?: string } }> = [
        { name: "其他擴充功能的 id", sender: { id: "some-other-extension" } },
        { name: "沒有 id（網頁 / 外部來源）", sender: {} },
    ];
    for (const c of foreignSenders) {
        test(`寄件者為${c.name} → 不回應、監聽器回傳 false、不發出任何請求`, async () => {
            const { fake, listeners, calls } = boot(basicRoutes());
            let responded = false;
            const keepOpen = listeners[0]?.({ type: "dataset", name: "basic", stockId: "2330" }, c.sender, () => {
                responded = true;
            });
            assert.equal(keepOpen, false);

            const res = await fake.dispatch({ type: "ping" }, c.sender);
            assert.equal(res, undefined);
            await drain();
            assert.equal(responded, false);
            assert.equal(calls.length, 0);
        });
    }

    const malformed: Array<{ name: string; message: unknown }> = [
        { name: "null", message: null },
        { name: "字串", message: "ping" },
        { name: "未知 type", message: { type: "fetchUrl", url: "https://evil.example.com/" } },
        { name: "不存在的資料集", message: { type: "dataset", name: "secrets", stockId: "2330" } },
        { name: "不合法的股票代碼", message: { type: "dataset", name: "basic", stockId: "../../x" } },
        { name: "search 查詢過長", message: { type: "search", query: "x".repeat(101) } },
        { name: "related limit 超出範圍", message: { type: "related", stockId: "2330", extra: {}, limit: 0 } },
    ];
    for (const c of malformed) {
        test(`格式不合法（${c.name}）→ 同步回應 {ok:false, code:"invalid"}，不發出請求`, async () => {
            const { listeners, calls, fake } = boot(basicRoutes());
            const responses: unknown[] = [];
            const keepOpen = listeners[0]?.(c.message, { id: EXT_ID }, (r) => responses.push(r));
            assert.equal(keepOpen, false, "同步回應後不保留通道");
            assert.deepEqual(responses, [{ ok: false, error: "不支援的請求", code: "invalid" }]);

            assert.deepEqual(await fake.dispatch(c.message), { ok: false, error: "不支援的請求", code: "invalid" });
            assert.equal(calls.length, 0);
        });
    }

    test("dataset basic → 監聽器回傳 true（非同步），稍後回應 {ok:true, data:{data, meta}}", async () => {
        const { listeners, calls } = boot(basicRoutes());
        const before = Date.now();
        let response: any;
        const done = new Promise<void>((resolve) => {
            const keepOpen = listeners[0]?.({ type: "dataset", name: "basic", stockId: "2330" }, { id: EXT_ID }, (r) => {
                response = r;
                resolve();
            });
            assert.equal(keepOpen, true, "非同步回應需回傳 true 保持通道");
            assert.equal(response, undefined, "不應同步回應");
        });
        await done;

        assert.equal(response.ok, true);
        assert.equal(response.data.data.shortName, "台積電");
        assert.equal(response.data.data.capitalThousand, 259_323_701);
        assert.equal(response.data.meta.stale, false);
        assert.ok(response.data.meta.fetchedAt >= before && response.data.meta.fetchedAt <= Date.now());
        assert.deepEqual(
            calls.map((c) => c.url),
            [API.basic("2330")]
        );
        assert.equal(calls[0]?.init?.credentials, "omit");
    });

    test("同一資料集第二次請求走快取（不再 fetch）；force:true 時重新請求", async () => {
        const { fake, calls } = boot(basicRoutes());
        const a: any = await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330" });
        const b: any = await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330" });
        assert.equal(calls.length, 1);
        assert.deepEqual(b, a);
        const c: any = await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330", force: true });
        assert.equal(c.ok, true);
        assert.equal(calls.length, 2);
        assert.equal(calls[1]?.init?.cache, "no-cache");
    });

    const failures: Array<{ name: string; reply: RouteReply; code: string; error: string }> = [
        { name: "HTTP 403（Cloudflare 擋下）", reply: { status: 403, body: "forbidden" }, code: "http-403", error: "來源拒絕存取（HTTP 403）" },
        { name: "HTTP 500", reply: { status: 500, body: "oops" }, code: "http-500", error: "來源錯誤（HTTP 500）" },
        { name: "HTML 挑戰頁（HTTP 200）", reply: { body: "<html>Just a moment...</html>", headers: { "content-type": "text/html" } }, code: "payload", error: "資料格式錯誤" },
        { name: "網路錯誤", reply: { error: new TypeError("Failed to fetch") }, code: "network", error: "網路連線失敗" },
    ];
    for (const c of failures) {
        test(`etf 上游失敗（${c.name}）→ {ok:false, code:"${c.code}"} 與中文訊息`, async () => {
            const { fake, calls } = boot([[API.etfHolding("2330"), c.reply]]);
            const res = await fake.dispatch({ type: "dataset", name: "etf", stockId: "2330" });
            assert.deepEqual(res, { ok: false, error: c.error, code: c.code });
            assert.equal(calls.length, 1);
        });
    }

    test("ping → 回傳 manifest 版本", async () => {
        const { fake, calls } = boot([], { version: "9.8.7" });
        assert.deepEqual(await fake.dispatch({ type: "ping" }), { ok: true, data: { version: "9.8.7" } });
        assert.equal(calls.length, 0);
    });

    test("openOptions → 呼叫 chrome.runtime.openOptionsPage", async () => {
        const { fake } = boot([]);
        assert.deepEqual(await fake.dispatch({ type: "openOptions" }), { ok: true, data: { opened: true } });
        assert.deepEqual(fake.sent, [{ type: "__openOptionsPage" }]);
    });

    test("clearCache → 清除記憶體與持久快取，之後的請求重新 fetch", async () => {
        const { fake, calls, storage } = boot(basicRoutes());
        await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330" });
        await drain();
        assert.ok(storage?.caches.get(CACHE_NAME)?.store.has(API.basic("2330")), "已寫入持久快取");

        assert.deepEqual(await fake.dispatch({ type: "clearCache" }), { ok: true, data: { cleared: true } });
        assert.equal(storage?.caches.has(CACHE_NAME), false);

        const again: any = await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330" });
        assert.equal(again.ok, true);
        assert.equal(calls.length, 2);
    });

    test("沒有 Cache Storage（globalThis.caches 未定義）時仍以記憶體快取運作", async () => {
        const { fake, calls } = boot(basicRoutes(), { storage: null });
        const a: any = await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330" });
        const b: any = await fake.dispatch({ type: "dataset", name: "basic", stockId: "2330" });
        assert.equal(a.ok, true);
        assert.equal(a.data.data.shortName, "台積電");
        assert.deepEqual(b, a);
        assert.equal(calls.length, 1);
    });

    const tokenCases: Array<{ name: string; stored: unknown; auth: string | undefined }> = [
        { name: "字串 Token（去除前後空白）", stored: "  my-token \n", auth: "Bearer my-token" },
        { name: "非字串值視為未設定", stored: 12345, auth: undefined },
        { name: "未設定", stored: undefined, auth: undefined },
    ];
    for (const c of tokenCases) {
        test(`FinMind Token 由 chrome.storage.local 讀取：${c.name}`, async () => {
            const routes: Routes = [[/api\.finmindtrade\.com/, { body: fixture("finmind-2330.json") }]];
            for (const d of MAJOR_PERIODS) routes.push([(u) => u === API.major("2330", d), { body: withoutV7(d === 1 ? "major1-2330.json" : "major5-2330.json") }]);
            const local = c.stored === undefined ? {} : { [LOCAL_KEYS.finmindToken]: c.stored };
            const { fake, calls } = boot(routes, { local });

            const res: any = await fake.dispatch({ type: "dataset", name: "major", stockId: "2330" });
            assert.equal(res.ok, true);
            const fm = calls.filter((x) => x.url.includes("api.finmindtrade.com"));
            assert.equal(fm.length, 1);
            const headers = (fm[0]?.init?.headers ?? {}) as Record<string, string>;
            assert.equal(headers.Authorization, c.auth);
        });
    }
});

// ============================================================================
// 安裝 / 啟動後的延遲工作
// ============================================================================

describe("startBackground：安裝 / 啟動後的清理與預載", () => {
    const START = Date.UTC(2026, 10, 5, 1, 0, 0);

    afterEach(() => mock.timers.reset());

    /** 在 CACHE_NAME 內放一筆過期（9 天前）與一筆新鮮（1 小時前）的項目 */
    async function seededStorage(): Promise<FakeCacheStorage> {
        const storage = new FakeCacheStorage();
        const store = await storage.open(CACHE_NAME);
        await store.put("https://sjis.esunsec.com.tw/old", new Response("{}", { headers: { [AT_HEADER]: String(START - 9 * DAY) } }));
        await store.put("https://sjis.esunsec.com.tw/fresh", new Response("{}", { headers: { [AT_HEADER]: String(START - HOUR) } }));
        storage.opens = 0;
        return storage;
    }

    const keysOf = (storage: FakeCacheStorage): string[] => [...(storage.caches.get(CACHE_NAME)?.store.keys() ?? [])].sort();

    const dbRoutes = (remote: RouteReply = { status: 404 }): Routes => [
        [(u) => u === BUNDLED_URL, { body: fixture("stock-db-subset.json") }],
        [(u) => u === STOCK_DB_REMOTE_URL, remote],
    ];

    test("onInstalled：3 秒閒置後才清理過期快取並預載股票資料庫", async () => {
        const storage = await seededStorage();
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
        const { fake, calls } = boot(dbRoutes(), { storage });

        fake.fireInstalled();
        mock.timers.tick(2999);
        await drain();
        assert.equal(calls.length, 0, "3 秒內不預載");
        assert.equal(fake.local.has(PURGE_KEY), false, "3 秒內不清理");
        assert.deepEqual(keysOf(storage), ["https://sjis.esunsec.com.tw/fresh", "https://sjis.esunsec.com.tw/old"]);

        mock.timers.tick(1);
        await drain();
        assert.deepEqual(keysOf(storage), ["https://sjis.esunsec.com.tw/fresh"], "只刪除超過 CACHE_PURGE_AGE_MS 的項目");
        assert.equal(fake.local.get(PURGE_KEY), START + 3000, "記錄清理時間");
        assert.deepEqual(
            calls.map((c) => c.url),
            [BUNDLED_URL],
            "預載內建股票資料庫"
        );

        // 預載完成後，查詢直接使用已載入的索引
        const res: any = await fake.dispatch({ type: "search", query: "台積" });
        assert.equal(res.ok, true);
        assert.ok(res.data.stocks.some((s: { code: string }) => s.code === "2330"));
        assert.equal(calls.length, 1);

        // 遠端版本在 refreshDelayMs（15 秒）後才下載
        mock.timers.tick(14_999);
        await drain();
        assert.equal(calls.filter((c) => c.url === STOCK_DB_REMOTE_URL).length, 0);
        mock.timers.tick(1);
        await drain();
        assert.equal(calls.filter((c) => c.url === STOCK_DB_REMOTE_URL).length, 1);
    });

    test("onStartup：3 秒後只清理快取，不預載股票資料庫", async () => {
        const storage = await seededStorage();
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
        const { fake, calls } = boot(dbRoutes(), { storage });

        fake.fireStartup();
        mock.timers.tick(2999);
        await drain();
        assert.equal(fake.local.has(PURGE_KEY), false);
        mock.timers.tick(1);
        await drain();
        assert.deepEqual(keysOf(storage), ["https://sjis.esunsec.com.tw/fresh"]);
        assert.equal(fake.local.get(PURGE_KEY), START + 3000);
        assert.equal(calls.length, 0);
    });

    test("12 小時內已清理過 → 跳過（不刪除、不更新時間）", async () => {
        const storage = await seededStorage();
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
        const last = START - 11 * HOUR;
        const { fake } = boot(dbRoutes(), { storage, local: { [PURGE_KEY]: last } });

        fake.fireStartup();
        mock.timers.tick(3000);
        await drain();
        assert.equal(fake.local.get(PURGE_KEY), last);
        assert.deepEqual(keysOf(storage), ["https://sjis.esunsec.com.tw/fresh", "https://sjis.esunsec.com.tw/old"]);
    });

    test("上次清理超過 12 小時 → 再次清理並更新時間", async () => {
        const storage = await seededStorage();
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
        const { fake } = boot(dbRoutes(), { storage, local: { [PURGE_KEY]: START - 13 * HOUR } });

        fake.fireStartup();
        mock.timers.tick(3000);
        await drain();
        assert.equal(fake.local.get(PURGE_KEY), START + 3000);
        assert.deepEqual(keysOf(storage), ["https://sjis.esunsec.com.tw/fresh"]);
    });

    test("連續兩次啟動事件：第二次被 12 小時節流擋下", async () => {
        const storage = await seededStorage();
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
        const { fake } = boot(dbRoutes(), { storage });

        fake.fireStartup();
        mock.timers.tick(3000);
        await drain();
        assert.equal(fake.local.get(PURGE_KEY), START + 3000);

        // 新增一筆過期項目，1 小時後再次啟動 → 不清理
        const store = await storage.open(CACHE_NAME);
        await store.put("https://sjis.esunsec.com.tw/old2", new Response("{}", { headers: { [AT_HEADER]: String(START - 10 * DAY) } }));
        mock.timers.tick(HOUR);
        fake.fireStartup();
        mock.timers.tick(3000);
        await drain();
        assert.equal(fake.local.get(PURGE_KEY), START + 3000);
        assert.ok(keysOf(storage).includes("https://sjis.esunsec.com.tw/old2"));
    });

    test("讀取 storage 失敗時清理以 warn 記錄，不拋出未處理的錯誤", async (t) => {
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
        const warn = t.mock.method(console, "warn", () => undefined);
        const { fake } = boot(dbRoutes());
        fake.chrome.storage.local.get = async () => {
            throw new Error("storage broken");
        };

        fake.fireStartup();
        mock.timers.tick(3000);
        await drain();
        assert.equal(warn.mock.callCount(), 1);
        assert.match(String(warn.mock.calls[0]?.arguments.join(" ")), /cache purge failed/);
    });

    test("沒有 Cache Storage 時清理仍記錄時間且不出錯", async () => {
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
        const { fake } = boot(dbRoutes(), { storage: null });
        fake.fireStartup();
        mock.timers.tick(3000);
        await drain();
        assert.equal(fake.local.get(PURGE_KEY), START + 3000);
    });
});
