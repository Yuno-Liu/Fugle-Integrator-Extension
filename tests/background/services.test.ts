/**
 * background 服務層：資料集（datasets.ts）、股票資料庫（stockdb.ts）、訊息路由（router.ts）。
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, JsonCache } from "../../src/background/cache";
import { createDatasetService } from "../../src/background/datasets";
import type { DatasetService } from "../../src/background/datasets";
import { route } from "../../src/background/router";
import type { RouterServices } from "../../src/background/router";
import { StockDbService } from "../../src/background/stockdb";
import type { StockDbDeps } from "../../src/background/stockdb";
import { StockIndex } from "../../src/core/stockIndex";
import { PayloadError } from "../../src/core/esun";
import { ALLOWED_HOSTS, API, LIMITS, MAJOR_PERIODS, MARKET_LISTS, RELATION_TYPES, STOCK_DB_REMOTE_URL } from "../../src/shared/constants";
import type { MarketListId, RelationKey } from "../../src/shared/constants";
import type { Request } from "../../src/shared/messages";
import type { EsunRow, StockDatabase } from "../../src/shared/types";
import { FakeCacheStorage, createFetch } from "../helpers/fakes";
import type { RouteReply } from "../helpers/fakes";
import { fixture, fixtureText } from "../helpers/fixtures";

// ============================================================================
// 共用
// ============================================================================

/** 2026-11-05 09:00 台北時間 */
const NOW = Date.UTC(2026, 10, 5, 1, 0, 0);
const TODAY_SLASH = "2026/11/05";

type Replies = Map<string, RouteReply | ((init: RequestInit | undefined) => RouteReply)>;

/** 以「完整網址」對應回應的 fake fetch；未定義的網址回 404 */
function exactFetch(replies: Replies) {
    return createFetch([
        [
            () => true,
            (url, init) => {
                const r = replies.get(url);
                if (!r) return { status: 404, body: "not found" };
                return typeof r === "function" ? r(init) : r;
            },
        ],
    ]);
}

const MARKET_FIXTURES: Record<MarketListId, string> = {
    nav: "market-nav.json",
    pb: "market-pb.json",
    eps: "market-eps.json",
    pe: "market-pe.json",
    dividendYield: "market-yield.json",
    grossMargin: "market-margin.json",
    roe: "market-roe.json",
    roa: "market-roa.json",
    trustBuy: "market-trustbuy.json",
    trustSell: "market-trustsell.json",
    foreignBuy: "market-foreignbuy.json",
    foreignSell: "market-foreignsell.json",
    trustHold: "market-trusthold.json",
    foreignHold: "market-foreignhold.json",
};

const RELATION_FIXTURES: Record<RelationKey, string> = {
    suppliers: "relation-suppliers-2330.json",
    customers: "relation-customers-2330.json",
    rivals: "relation-empty.json",
    alliances: "relation-empty.json",
    investOuts: "relation-empty.json",
    investIns: "relation-empty.json",
};

/** 2330 所有資料集網址 → fixture */
function allRoutes(stockId = "2330"): Replies {
    const m: Replies = new Map();
    m.set(API.basic(stockId), { body: fixture("basic-2330.json") });
    m.set(API.industry(stockId), { body: fixture("industry-2330.json") });
    m.set(API.concept(stockId), { body: fixture("concept-2330.json") });
    m.set(API.group(stockId), { body: fixture("group-2330.json") });
    m.set(API.ratings(stockId), { body: fixture("ratings-2330.json") });
    m.set(API.capacity(stockId), { body: fixture("capacity-2330.json") });
    m.set(API.etfHolding(stockId), { body: fixture("etf-2330.synthetic.json") });
    for (const k of Object.keys(RELATION_TYPES) as RelationKey[]) m.set(API.relation(stockId, RELATION_TYPES[k]), { body: fixture(RELATION_FIXTURES[k]) });
    for (const d of MAJOR_PERIODS) m.set(API.major(stockId, d), { body: fixture(d === 1 ? "major1-2330.json" : "major5-2330.json") });
    for (const id of Object.keys(MARKET_LISTS) as MarketListId[]) m.set(MARKET_LISTS[id].url(TODAY_SLASH), { body: fixture(MARKET_FIXTURES[id]) });
    return m;
}

function makeDatasets(replies: Replies, opts: { token?: string; now?: number } = {}) {
    const now = opts.now ?? NOW;
    const f = exactFetch(replies);
    const cache = new JsonCache({ fetch: f.fetch, caches: new FakeCacheStorage().asCacheStorage(), now: () => now }, { cacheName: "t", memoryLimit: 300, allowedHosts: ALLOWED_HOSTS, defaultTimeoutMs: 1_000 });
    let tokenReads = 0;
    const service = createDatasetService({
        cache,
        now: () => now,
        getFinmindToken: async () => {
            tokenReads++;
            return opts.token ?? "";
        },
    });
    return { service, calls: f.calls, tokenReads: () => tokenReads };
}

/** 去除主力資料中的 V7（模擬玉山缺少區間成交量） */
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

/** FinMind 2330 fixture 每日成交量（2026-10-27 ~ 2026-11-04） */
const FINMIND_VOL = {
    "2026-10-29": 18_403_916,
    "2026-10-30": 36_615_931,
    "2026-11-02": 41_165_068,
    "2026-11-03": 46_137_336,
    "2026-11-04": 53_879_371,
};

const finmindUrl = (stockId = "2330") => API.finmindVolume(stockId, "2026-09-06", "2026-11-05");

// ============================================================================
// datasets.ts
// ============================================================================

describe("資料集：單一來源", () => {
    test("basic：台積電基本資料（股本以千元為單位）", async () => {
        const { service, calls } = makeDatasets(allRoutes());
        const r = await service.get("basic", "2330");
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.url, API.basic("2330"));
        assert.equal(r.data?.shortName, "台積電");
        assert.equal(r.data?.fullName, "台灣積體電路製造股份有限公司");
        assert.equal(r.data?.capitalThousand, 259_323_701);
        assert.equal(((r.data?.capitalThousand ?? 0) / 100_000).toFixed(2), "2593.24", "股本 2,593.24 億");
        assert.equal(r.data?.sharesThousand, 25_932_370);
        assert.equal(r.data?.parValue, 10);
        assert.equal(r.data?.marketCode, "TSE");
        assert.match(r.data?.website ?? "", /^https:\/\/www\.tsmc\.com\/?$/);
        assert.deepEqual(r.meta, { fetchedAt: NOW, stale: false });
    });

    test("basic：上櫃股（9962 有益）marketCode 為 OTC", async () => {
        const routes: Replies = new Map([[API.basic("9962"), { body: fixture("basic-9962.json") }]]);
        const { service } = makeDatasets(routes);
        const r = await service.get("basic", "9962");
        assert.equal(r.data?.marketCode, "OTC");
        assert.equal(r.data?.shortName, "有益");
    });

    const nameCases: Array<{ name: "industry" | "concept" | "group"; expectFirst: string; minLen: number }> = [
        { name: "industry", expectFirst: "IC生產", minLen: 3 },
        { name: "concept", expectFirst: "AMD概念股", minLen: 10 },
        { name: "group", expectFirst: "台積電集團", minLen: 1 },
    ];
    for (const c of nameCases) {
        test(`${c.name}：回傳去重的分類名稱字串陣列`, async () => {
            const { service } = makeDatasets(allRoutes());
            const r = await service.get(c.name, "2330");
            assert.ok(Array.isArray(r.data));
            assert.ok(r.data.length >= c.minLen);
            assert.equal(r.data[0], c.expectFirst);
            assert.equal(new Set(r.data).size, r.data.length);
            assert.ok(r.data.every((s) => typeof s === "string" && s.length > 0));
        });
    }

    test("ratings：依日期新到舊排序並解析目標價", async () => {
        const { service } = makeDatasets(allRoutes());
        const r = await service.get("ratings", "2330");
        assert.equal(r.data.length, 8);
        const dates = r.data.map((x) => x.date);
        assert.deepEqual(dates, [...dates].sort().reverse());
        const kgi = r.data.find((x) => x.broker === "康和投顧");
        assert.deepEqual(kgi, { date: "2026/10/16", broker: "康和投顧", rating: "買進", target: 3560, previous: "買進" });
    });

    test("capacity：產能列表欄位", async () => {
        const { service } = makeDatasets(allRoutes());
        const r = await service.get("capacity", "2330");
        assert.equal(r.data.length, 13);
        assert.deepEqual(r.data[0], { location: "上海松江廠(Fab 10)", spec: "8吋廠", quantity: "120", unit: "千片/月" });
    });

    test("etf：不附帶 FindBillion 的 Cookie（隱私），過濾無代號列、空名稱以代號代替、依股數排序", async () => {
        const { service, calls } = makeDatasets(allRoutes());
        const r = await service.get("etf", "2330");
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.url, API.etfHolding("2330"));
        assert.equal(calls[0]?.init?.credentials, "omit");
        assert.deepEqual(
            r.data.map((x) => x.symbol),
            ["0050", "006208", "00881", "00692", "00878"]
        );
        assert.equal(r.data.find((x) => x.symbol === "00692")?.name, "00692");
        assert.ok(r.data.every((x) => x.symbol !== ""));
    });

    test("etf：其他資料集不帶使用者 cookie（credentials omit）", async () => {
        const { service, calls } = makeDatasets(allRoutes());
        await service.get("basic", "2330");
        await service.get("ratings", "2330");
        assert.ok(calls.every((c) => c.init?.credentials === "omit"));
    });

    test("etf：Cloudflare 挑戰頁 → PayloadError", async () => {
        const routes = allRoutes();
        routes.set(API.etfHolding("2330"), { body: fixtureText("etf-cloudflare-challenge.html"), headers: { "content-type": "text/html" } });
        const { service } = makeDatasets(routes);
        await assert.rejects(service.get("etf", "2330"), PayloadError);
    });

    test("etf：HTTP 403 → HttpError(403)", async () => {
        const routes = allRoutes();
        routes.set(API.etfHolding("2330"), { status: 403, body: "forbidden" });
        const { service } = makeDatasets(routes);
        await assert.rejects(service.get("etf", "2330"), (e: unknown) => e instanceof HttpError && e.status === 403);
    });

    test("同一資料集第二次呼叫走快取；force 時重新請求", async () => {
        const { service, calls } = makeDatasets(allRoutes());
        await service.get("basic", "2330");
        await service.get("basic", "2330");
        assert.equal(calls.length, 1);
        await service.get("basic", "2330", true);
        assert.equal(calls.length, 2);
    });
});

describe("資料集：公司互動關係", () => {
    test("六種關係並行載入：供應商去重、客戶含海外代號", async () => {
        const { service, calls } = makeDatasets(allRoutes());
        const r = await service.get("relations", "2330");
        assert.equal(calls.length, 6);
        assert.deepEqual(calls.map((c) => c.url).sort(), Object.values(RELATION_TYPES).map((t) => API.relation("2330", t)).sort());
        assert.equal(r.data.failed, 0);
        assert.equal(r.data.suppliers.length, 11, "12 列中有 1 列重複");
        assert.ok(r.data.suppliers.some((s) => s.exchange === "TE" && s.isTaiwan), ".TE（上櫃）視為台股");
        assert.deepEqual(r.data.suppliers[0], { code: "1560", name: "中砂", exchange: "TW", isTaiwan: true });
        const apple = r.data.customers.find((c) => c.code === "AAPL");
        assert.deepEqual(apple, { code: "AAPL", name: "Apple", exchange: "US", isTaiwan: false });
        assert.deepEqual(r.data.rivals, []);
        assert.deepEqual(r.data.investIns, []);
    });

    test("一種關係失敗 → failed=1，其他照常填入", async () => {
        const routes = allRoutes();
        routes.set(API.relation("2330", RELATION_TYPES.customers), { status: 500 });
        const { service } = makeDatasets(routes);
        const r = await service.get("relations", "2330");
        assert.equal(r.data.failed, 1);
        assert.deepEqual(r.data.customers, []);
        assert.equal(r.data.suppliers.length, 11);
        assert.equal(r.meta.stale, false);
    });

    test("全部失敗 → 拒絕並帶出第一個錯誤", async () => {
        const routes = allRoutes();
        for (const t of Object.values(RELATION_TYPES)) routes.set(API.relation("2330", t), { status: 503 });
        const { service } = makeDatasets(routes);
        await assert.rejects(service.get("relations", "2330"), (e: unknown) => e instanceof HttpError && e.status === 503);
    });
});

describe("資料集：主力買賣", () => {
    test("使用玉山 V7 計算五個區間，比率與真實資料一致，不呼叫 FinMind", async () => {
        const { service, calls, tokenReads } = makeDatasets(allRoutes(), { token: "tok" });
        const r = await service.get("major", "2330");
        const { periods } = r.data;
        assert.equal(periods.length, 5);
        assert.deepEqual(
            periods.map((p) => p?.days),
            [...MAJOR_PERIODS]
        );
        assert.deepEqual(periods[0], {
            days: 1,
            date: "2026/11/04",
            netBuy: 12_728_481,
            netSell: -24_367_496,
            volume: 53_552_371,
            ratio: -21.73,
            volumeSource: "esun",
        });
        assert.equal(periods[2]?.ratio, -17.84);
        assert.equal(periods[2]?.volume, 190_561_922);
        assert.ok(periods.every((p) => p?.volumeSource === "esun"));
        assert.equal(calls.filter((c) => c.url.includes("finmindtrade")).length, 0);
        assert.equal(tokenReads(), 0, "有 V7 時不需讀取 Token");
    });

    test("單一區間失敗 → 該區間為 null，其他照常", async () => {
        const routes = allRoutes();
        routes.set(API.major("2330", 20), { status: 500 });
        const { service } = makeDatasets(routes);
        const r = await service.get("major", "2330");
        assert.equal(r.data.periods[4], null);
        assert.equal(r.data.periods[0]?.ratio, -21.73);
    });

    test("全部區間失敗 → 拒絕", async () => {
        const routes = allRoutes();
        for (const d of MAJOR_PERIODS) routes.set(API.major("2330", d), { status: 500 });
        const { service } = makeDatasets(routes);
        await assert.rejects(service.get("major", "2330"), HttpError);
    });

    test("缺少 V7 → 以 FinMind 備援：Token 帶入 Authorization，成交量為截至主力日期的 N 日加總", async () => {
        const routes = allRoutes();
        for (const d of MAJOR_PERIODS) routes.set(API.major("2330", d), { body: withoutV7(d === 1 ? "major1-2330.json" : "major5-2330.json") });
        routes.set(finmindUrl(), { body: fixture("finmind-2330.json") });
        const { service, calls } = makeDatasets(routes, { token: "  my-token  " });
        const r = await service.get("major", "2330");

        const fm = calls.filter((c) => c.url.includes("api.finmindtrade.com"));
        assert.equal(fm.length, 1, "多個區間共用一次 FinMind 請求");
        assert.equal(fm[0]?.url, finmindUrl(), "查詢區間為台北今日往前 60 天");
        const headers = fm[0]?.init?.headers as Record<string, string>;
        assert.equal(headers.Authorization, "Bearer my-token");

        const [p1, p3, p5, p10, p20] = r.data.periods;
        assert.equal(p1?.volumeSource, "finmind");
        assert.equal(p1?.volume, FINMIND_VOL["2026-11-04"]);
        assert.equal(p1?.ratio, Math.round(((12_728_481 - 24_367_496) / FINMIND_VOL["2026-11-04"]) * 10000) / 100);
        assert.equal(p3?.volume, FINMIND_VOL["2026-11-02"] + FINMIND_VOL["2026-11-03"] + FINMIND_VOL["2026-11-04"]);
        assert.equal(p5?.volume, 196_201_622);
        assert.equal(p5?.volumeSource, "finmind");
        assert.equal(p5?.ratio, Math.round(((31_066_033 - 65_069_847) / 196_201_622) * 10000) / 100);
        // fixture 只有 7 個交易日：10 日、20 日資料不足 → null
        assert.equal(p10, null);
        assert.equal(p20, null);
    });

    test("缺少 V7 且未設定 Token → FinMind 請求不帶 Authorization", async () => {
        const routes = allRoutes();
        for (const d of MAJOR_PERIODS) routes.set(API.major("2330", d), { body: withoutV7("major1-2330.json") });
        routes.set(finmindUrl(), { body: fixture("finmind-2330.json") });
        const { service, calls } = makeDatasets(routes, { token: "" });
        const r = await service.get("major", "2330");
        const fm = calls.find((c) => c.url.includes("api.finmindtrade.com"));
        assert.ok(fm);
        const headers = fm.init?.headers as Record<string, string>;
        assert.equal("Authorization" in headers, false);
        assert.equal(headers.accept, "application/json");
        assert.equal(r.data.periods[0]?.volumeSource, "finmind");
    });

    test("只有部分區間缺 V7 → 只補缺的區間，其餘維持玉山資料", async () => {
        const routes = allRoutes();
        routes.set(API.major("2330", 1), { body: withoutV7("major1-2330.json") });
        routes.set(finmindUrl(), { body: fixture("finmind-2330.json") });
        const { service, calls } = makeDatasets(routes);
        const r = await service.get("major", "2330");
        assert.equal(r.data.periods[0]?.volumeSource, "finmind");
        assert.equal(r.data.periods[0]?.volume, FINMIND_VOL["2026-11-04"]);
        assert.equal(r.data.periods[2]?.volumeSource, "esun");
        assert.equal(r.data.periods[2]?.ratio, -17.84);
        assert.equal(calls.filter((c) => c.url.includes("finmindtrade")).length, 1);
    });

    test("FinMind 備援失敗 → 該區間為 null，整體仍成功", async () => {
        const routes = allRoutes();
        routes.set(API.major("2330", 1), { body: withoutV7("major1-2330.json") });
        routes.set(finmindUrl(), { status: 402, body: "quota" });
        const { service } = makeDatasets(routes);
        const r = await service.get("major", "2330");
        assert.equal(r.data.periods[0], null);
        assert.equal(r.data.periods[2]?.ratio, -17.84);
    });
});

describe("資料集：全市場快照", () => {
    test("帶日期的清單使用台北今日日期，快照與真實資料一致", async () => {
        const { service, calls } = makeDatasets(allRoutes());
        const r = await service.get("market", "2330");
        assert.equal(calls.length, Object.keys(MARKET_LISTS).length);
        assert.ok(calls.every((c) => c.init?.credentials === "omit"));
        const dated = calls.filter((c) => /rank-chip/.test(c.url));
        assert.equal(dated.length, 6);
        assert.ok(dated.every((c) => c.url.endsWith(`=${TODAY_SLASH}`)), "日期參數為 2026/11/05");

        const s = r.data;
        assert.equal(s.failed, 0);
        assert.deepEqual(s.nav, { value: 248.05, date: "2026/06/01" });
        assert.deepEqual(s.pb, { value: 9.11, date: "2026/11/04" });
        assert.deepEqual(s.eps, { value: 27.25, date: "2026/06/01" });
        assert.deepEqual(s.pe, { value: 26.2, date: "2026/11/04" });
        assert.deepEqual(s.dividendYield, { value: 0.97, date: "2026/11/04" });
        assert.deepEqual(s.grossMargin, { value: 67.72, date: "2026/06/01" });
        assert.deepEqual(s.roe, { value: 11.39, date: "2026/06/01" });
        assert.deepEqual(s.roa, { value: 7.86, date: "2026/06/01" });
        assert.deepEqual(s.trust, { date: "2026/11/04", direction: "buy", days: 24, turned: false, previousDays: 0, lots: 3715, amountThousand: 8_432_521 });
        assert.deepEqual(s.foreign, { date: "2026/11/04", direction: "sell", days: 19, turned: false, previousDays: 0, lots: -21_604, amountThousand: -49_035_410 });
        assert.equal(s.trustHoldPct, 3.92);
        assert.equal(s.foreignHoldPct, 68.31);
        assert.deepEqual(r.meta, { fetchedAt: NOW, stale: false });
    });

    test("UTC 仍是前一天時（台北已跨日）使用台北日期", async () => {
        const lateUtc = Date.UTC(2026, 10, 4, 17, 0, 0); // 台北 2026/11/05 01:00
        const { service, calls } = makeDatasets(allRoutes(), { now: lateUtc });
        await service.get("market", "2330");
        const dated = calls.filter((c) => /rank-chip/.test(c.url));
        assert.ok(dated.every((c) => c.url.endsWith("=2026/11/05")));
    });

    test("其他個股的連續買賣超：AS2105 投信連賣、AS2801 由買轉賣、AS8150 由賣轉買", async () => {
        const { service } = makeDatasets(allRoutes("2105"));
        const r2105 = await service.get("market", "2105");
        assert.equal(r2105.data.trust?.direction, "sell");
        assert.equal(r2105.data.trust?.days, 9);
        assert.equal(r2105.data.trust?.turned, false);

        const { service: s2 } = makeDatasets(allRoutes("2801"));
        const r2801 = await s2.get("market", "2801");
        assert.equal(r2801.data.trust?.direction, "sell");
        assert.equal(r2801.data.trust?.days, 1);
        assert.equal(r2801.data.trust?.turned, true);
        assert.equal(r2801.data.trust?.previousDays, 3);

        const { service: s3 } = makeDatasets(allRoutes("8150"));
        const r8150 = await s3.get("market", "8150");
        assert.equal(r8150.data.trust?.direction, "buy");
        assert.equal(r8150.data.trust?.turned, true);
        assert.equal(r8150.data.trust?.previousDays, 1);
    });

    test("部分清單失敗 → failed 計數，對應欄位為空", async () => {
        const routes = allRoutes();
        routes.set(MARKET_LISTS.roe.url(), { status: 500 });
        routes.set(MARKET_LISTS.foreignHold.url(TODAY_SLASH), { body: "<html>challenge</html>" });
        routes.set(MARKET_LISTS.foreignSell.url(TODAY_SLASH), { error: new TypeError("offline") });
        const { service } = makeDatasets(routes);
        const r = await service.get("market", "2330");
        assert.equal(r.data.failed, 3);
        assert.deepEqual(r.data.roe, { value: null, date: null });
        assert.equal(r.data.foreignHoldPct, null);
        assert.equal(r.data.foreign, null);
        assert.equal(r.data.nav.value, 248.05);
    });

    test("全部清單失敗 → 拒絕", async () => {
        const routes = allRoutes();
        for (const id of Object.keys(MARKET_LISTS) as MarketListId[]) routes.set(MARKET_LISTS[id].url(TODAY_SLASH), { status: 500 });
        const { service } = makeDatasets(routes);
        await assert.rejects(service.get("market", "2330"), HttpError);
    });
});

// ============================================================================
// stockdb.ts
// ============================================================================

const BUNDLED_URL = "chrome-extension://fake-id/stock-data.json";
const DB_CACHE = "db-cache";
const DAY = 24 * 60 * 60 * 1000;
const AT_HEADER = "x-fi-fetched-at";

const bundledDb = (): StockDatabase => fixture<StockDatabase>("stock-db-subset.json");

/** 遠端版本：比內建多一檔新股 */
function remoteDb(): StockDatabase {
    const db = bundledDb();
    db.basicInfo.push({ 股票代碼: "7777", 股票名稱: "遠端新股", 股本_億元: 1 });
    db.categories.push({ 股票代碼: "7777", 分類類型: "產業", 分類名稱: "IC製造" });
    return db;
}

async function seedRemote(storage: FakeCacheStorage, db: unknown, at: number): Promise<void> {
    const store = await storage.open(DB_CACHE);
    await store.put(STOCK_DB_REMOTE_URL, new Response(typeof db === "string" ? db : JSON.stringify(db), { headers: { [AT_HEADER]: String(at) } }));
}

async function readRemoteCache(storage: FakeCacheStorage): Promise<{ body: string; at: number } | null> {
    const hit = storage.caches.get(DB_CACHE)?.store.get(STOCK_DB_REMOTE_URL);
    return hit ? { body: hit.body, at: Number(hit.headers[AT_HEADER]) } : null;
}

function makeStockDb(replies: { bundled?: RouteReply | (() => RouteReply); remote?: RouteReply | (() => RouteReply) }, opts: { storage?: FakeCacheStorage; now?: number } = {}) {
    const storage = opts.storage ?? new FakeCacheStorage();
    const f = createFetch([
        [(u) => u === BUNDLED_URL, () => (typeof replies.bundled === "function" ? replies.bundled() : (replies.bundled ?? { status: 404 }))],
        [(u) => u === STOCK_DB_REMOTE_URL, () => (typeof replies.remote === "function" ? replies.remote() : (replies.remote ?? { status: 404 }))],
    ]);
    const deps: StockDbDeps = {
        fetch: f.fetch,
        caches: storage.asCacheStorage(),
        now: () => opts.now ?? NOW,
        bundledUrl: BUNDLED_URL,
        remoteUrl: STOCK_DB_REMOTE_URL,
        ttlMs: DAY,
        cacheName: DB_CACHE,
        timeoutMs: 1_000,
        refreshDelayMs: 0,
    };
    const svc = new StockDbService(deps);
    const count = (url: string) => f.calls.filter((c) => c.url === url).length;
    return { svc, storage, calls: f.calls, bundledCalls: () => count(BUNDLED_URL), remoteCalls: () => count(STOCK_DB_REMOTE_URL) };
}

describe("股票資料庫服務", () => {
    test("沒有遠端快取 → 先用內建版，再於背景下載遠端版並替換索引、寫入快取", async () => {
        const { svc, storage, bundledCalls, remoteCalls } = makeStockDb({ bundled: { body: bundledDb() }, remote: { body: remoteDb() } });
        const first = await svc.getIndex();
        assert.equal(bundledCalls(), 1);
        assert.equal(first.getStock("2330")?.name, "台積電");
        assert.equal(first.getStock("7777"), null, "內建版沒有遠端新股");

        await svc.settled();
        assert.equal(remoteCalls(), 1);
        const second = await svc.getIndex();
        assert.notEqual(second, first);
        assert.equal(second.getStock("7777")?.name, "遠端新股");
        assert.ok(second.members("產業", "IC製造").some((s) => s.code === "7777"));

        const cached = await readRemoteCache(storage);
        assert.ok(cached);
        assert.equal(cached.at, NOW);
        assert.deepEqual(JSON.parse(cached.body), remoteDb());
    });

    test("遠端快取仍新鮮 → 直接使用，不讀內建版也不下載", async () => {
        const storage = new FakeCacheStorage();
        await seedRemote(storage, remoteDb(), NOW - 60_000);
        const { svc, calls } = makeStockDb({ bundled: { body: bundledDb() }, remote: { body: remoteDb() } }, { storage });
        const index = await svc.getIndex();
        await svc.settled();
        assert.equal(calls.length, 0);
        assert.equal(index.getStock("7777")?.name, "遠端新股");
    });

    test("遠端快取過期 → 先回傳快取版本，背景更新後替換", async () => {
        const storage = new FakeCacheStorage();
        const oldDb = bundledDb(); // 舊的遠端版本（沒有 7777）
        await seedRemote(storage, oldDb, NOW - DAY - 1);
        const { svc, bundledCalls, remoteCalls } = makeStockDb({ bundled: { body: bundledDb() }, remote: { body: remoteDb() } }, { storage });
        const first = await svc.getIndex();
        assert.equal(first.getStock("7777"), null);
        assert.equal(bundledCalls(), 0, "有快取時不讀內建版");

        await svc.settled();
        assert.equal(remoteCalls(), 1);
        assert.equal((await svc.getIndex()).getStock("7777")?.name, "遠端新股");
        assert.equal((await readRemoteCache(storage))?.at, NOW, "快取時間標記已更新");
    });

    test("遠端快取損壞 → 改用內建版", async () => {
        const storage = new FakeCacheStorage();
        await seedRemote(storage, "{not json", NOW);
        const { svc, bundledCalls } = makeStockDb({ bundled: { body: bundledDb() }, remote: { status: 500 } }, { storage });
        const index = await svc.getIndex();
        assert.equal(bundledCalls(), 1);
        assert.equal(index.getStock("2330")?.name, "台積電");
        await svc.settled();
    });

    const invalidRemotes: Array<{ name: string; reply: RouteReply }> = [
        { name: "HTML 頁面", reply: { body: "<html>rate limited</html>", headers: { "content-type": "text/html" } } },
        { name: "格式錯誤的 JSON", reply: { body: { foo: 1 } } },
        { name: "basicInfo 為空", reply: { body: { basicInfo: [], categories: [] } } },
        { name: "HTTP 500", reply: { status: 500 } },
        { name: "網路錯誤", reply: { error: new TypeError("offline") } },
    ];
    for (const c of invalidRemotes) {
        test(`遠端版本無效（${c.name}）→ 索引不變且不寫入快取`, async () => {
            const { svc, storage, remoteCalls } = makeStockDb({ bundled: { body: bundledDb() }, remote: c.reply });
            const first = await svc.getIndex();
            await svc.settled();
            assert.equal(remoteCalls(), 1);
            assert.equal(await svc.getIndex(), first);
            assert.equal(await readRemoteCache(storage), null);
        });
    }

    test("內建版讀取失敗 → 改用遠端版並寫入快取", async () => {
        const { svc, storage, bundledCalls, remoteCalls } = makeStockDb({ bundled: { status: 404 }, remote: { body: remoteDb() } });
        const index = await svc.getIndex();
        assert.equal(bundledCalls(), 1);
        assert.equal(remoteCalls(), 1);
        assert.equal(index.getStock("7777")?.name, "遠端新股");
        assert.ok(await readRemoteCache(storage));
    });

    test("內建版內容無效 → 改用遠端版", async () => {
        const { svc } = makeStockDb({ bundled: { body: { basicInfo: [] } }, remote: { body: remoteDb() } });
        const index = await svc.getIndex();
        assert.equal(index.getStock("7777")?.name, "遠端新股");
    });

    test("同時呼叫 getIndex 共用同一次載入", async () => {
        const { svc, bundledCalls } = makeStockDb({ bundled: { body: bundledDb(), delayMs: 20 }, remote: { status: 500 } });
        const [a, b, c] = await Promise.all([svc.getIndex(), svc.getIndex(), svc.getIndex()]);
        assert.equal(bundledCalls(), 1);
        assert.equal(a, b);
        assert.equal(b, c);
        await svc.settled();
    });

    test("載入失敗不會被記住：下一次呼叫重新嘗試", async () => {
        let attempt = 0;
        const { svc, bundledCalls } = makeStockDb({
            bundled: () => (attempt++ === 0 ? { status: 500 } : { body: bundledDb() }),
            remote: { status: 500 },
        });
        await assert.rejects(svc.getIndex(), /股票資料庫載入失敗/);
        const index = await svc.getIndex();
        assert.equal(bundledCalls(), 2);
        assert.equal(index.getStock("2330")?.name, "台積電");
        await svc.settled();
    });

    test("載入成功後的呼叫直接回傳同一索引，不再請求", async () => {
        const { svc, calls } = makeStockDb({ bundled: { body: bundledDb() }, remote: { status: 500 } });
        const a = await svc.getIndex();
        await svc.settled();
        const before = calls.length;
        const b = await svc.getIndex();
        assert.equal(a, b);
        assert.equal(calls.length, before);
    });

    test("沒有 Cache Storage 時仍可用內建版運作", async () => {
        const f = createFetch([[(u) => u === BUNDLED_URL, { body: bundledDb() }]]);
        const svc = new StockDbService({ fetch: f.fetch, caches: null, now: () => NOW, bundledUrl: BUNDLED_URL, remoteUrl: STOCK_DB_REMOTE_URL, ttlMs: DAY, cacheName: DB_CACHE, timeoutMs: 1_000, refreshDelayMs: 0 });
        const index = await svc.getIndex();
        await svc.settled();
        assert.equal(index.getStock("2330")?.name, "台積電");
    });
});

// ============================================================================
// router.ts
// ============================================================================

interface Recorder {
    datasetCalls: Array<[string, string, boolean]>;
    related: unknown[][];
    members: unknown[][];
    search: unknown[][];
    cleared: number;
    opened: number;
}

function stubServices(overrides: { datasetResult?: () => Promise<unknown>; index?: StockIndex } = {}) {
    const rec: Recorder = { datasetCalls: [], related: [], members: [], search: [], cleared: 0, opened: 0 };
    const fakeIndex = {
        related: (...args: unknown[]) => {
            rec.related.push(args);
            return { 概念: [], 產業: [], 集團: [] };
        },
        members: (...args: unknown[]) => {
            rec.members.push(args);
            return [{ code: "2303", name: "聯電", capital: 1257.01 }];
        },
        search: (...args: unknown[]) => {
            rec.search.push(args);
            return { stocks: [], categories: [] };
        },
    };
    const services: RouterServices = {
        datasets: {
            get: async (name: string, stockId: string, force = false) => {
                rec.datasetCalls.push([name, stockId, force]);
                return overrides.datasetResult ? overrides.datasetResult() : { data: { name }, meta: { fetchedAt: NOW, stale: false } };
            },
        } as unknown as DatasetService,
        stockDb: { getIndex: async () => overrides.index ?? fakeIndex } as unknown as StockDbService,
        cache: {
            clear: async () => {
                rec.cleared++;
            },
        } as unknown as JsonCache,
        openOptions: async () => {
            rec.opened++;
        },
        version: "9.9.9",
    };
    return { services, rec };
}

describe("訊息路由 route()", () => {
    test("dataset：轉交資料集服務，force 預設 false", async () => {
        const { services, rec } = stubServices();
        const res = await route({ type: "dataset", name: "basic", stockId: "2330" }, services);
        assert.deepEqual(res, { data: { name: "basic" }, meta: { fetchedAt: NOW, stale: false } });
        await route({ type: "dataset", name: "market", stockId: "00878", force: true }, services);
        assert.deepEqual(rec.datasetCalls, [
            ["basic", "2330", false],
            ["market", "00878", true],
        ]);
    });

    test("dataset：服務錯誤原樣拋出（交由 main 轉成錯誤代碼）", async () => {
        const { services } = stubServices({ datasetResult: () => Promise.reject(new HttpError(403)) });
        await assert.rejects(route({ type: "dataset", name: "etf", stockId: "2330" }, services), (e: unknown) => e instanceof HttpError && e.status === 403);
    });

    test("related：以 stockId、extra、limit 查詢索引", async () => {
        const { services, rec } = stubServices();
        const extra = { 概念: ["AMD概念股"] };
        const res = await route({ type: "related", stockId: "2330", extra, limit: 10 }, services);
        assert.deepEqual(res, { 概念: [], 產業: [], 集團: [] });
        assert.deepEqual(rec.related, [["2330", extra, 10]]);
    });

    test("category：以分類類型、名稱與排除代碼查詢成員", async () => {
        const { services, rec } = stubServices();
        const res = await route({ type: "category", categoryType: "產業", name: "IC製造", exclude: "2330" }, services);
        assert.deepEqual(res, [{ code: "2303", name: "聯電", capital: 1257.01 }]);
        assert.deepEqual(rec.members, [["產業", "IC製造", "2330"]]);
    });

    test("search：套用 LIMITS 的個股與分類上限", async () => {
        const { services, rec } = stubServices();
        await route({ type: "search", query: "台積" }, services);
        assert.deepEqual(rec.search, [["台積", LIMITS.searchStocks, LIMITS.searchCategories]]);
    });

    const simple: Array<{ req: Request; expected: unknown; check: (r: Recorder) => void }> = [
        { req: { type: "clearCache" }, expected: { cleared: true }, check: (r) => assert.equal(r.cleared, 1) },
        { req: { type: "openOptions" }, expected: { opened: true }, check: (r) => assert.equal(r.opened, 1) },
        { req: { type: "ping" }, expected: { version: "9.9.9" }, check: () => undefined },
    ];
    for (const c of simple) {
        test(`${c.req.type}：回傳 ${JSON.stringify(c.expected)}`, async () => {
            const { services, rec } = stubServices();
            assert.deepEqual(await route(c.req, services), c.expected);
            c.check(rec);
        });
    }

    test("整合真實索引（stock-db-subset）：search / category / related", async () => {
        const index = new StockIndex(bundledDb());
        const { services } = stubServices({ index });

        const search = (await route({ type: "search", query: "台積電" }, services)) as { stocks: Array<{ code: string }> };
        assert.equal(search.stocks[0]?.code, "2330");

        const members = (await route({ type: "category", categoryType: "產業", name: "IC製造", exclude: "2330" }, services)) as Array<{ code: string; capital: number }>;
        assert.ok(members.length > 0);
        assert.ok(members.every((m) => m.code !== "2330"));
        const capitals = members.map((m) => m.capital);
        assert.deepEqual(capitals, [...capitals].sort((a, b) => b - a), "依股本由大到小");

        const related = (await route({ type: "related", stockId: "2330", extra: {}, limit: 2 }, services)) as Record<string, Array<{ stocks: unknown[] }>>;
        for (const list of Object.values(related)) for (const cat of list) assert.ok(cat.stocks.length <= 2);
    });
});
