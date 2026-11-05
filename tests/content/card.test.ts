/**
 * 資訊卡（InfoCard）：以假的 CardDeps 控制每個資料集的回應時機，
 * 資料一律由 tests/fixtures 的真實 API 回應經 src/core 解析器產生。
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers/fixtures";
import { flush, setupFuglePage } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { CARD_ID, InfoCard } from "../../src/content/card";
import type { CardDeps } from "../../src/content/card";
import { ApiError } from "../../src/content/api";
import type { DatasetResponse } from "../../src/content/api";
import type { StockContext } from "../../src/content/page";
import { SECTIONS } from "../../src/content/sections";
import { parseBasic, parseCapacity, parseEtfHoldings, parseNames, parseRatings, parseRelations } from "../../src/core/esun";
import { summarizeMajor, toMajorPeriod } from "../../src/core/major";
import { buildMarketSnapshot, indexMarketList } from "../../src/core/market";
import type { MarketIndex } from "../../src/core/market";
import type { MarketListId } from "../../src/shared/constants";
import { DATASET_NAMES } from "../../src/shared/messages";
import type { DatasetMap, DatasetName, Meta } from "../../src/shared/messages";
import { defaultSettings } from "../../src/shared/settings";
import type { CategoryType, MajorPeriod, RelatedGroups, UiSettings } from "../../src/shared/types";

// ============================================================================
// 真實資料（fixtures → src/core 解析器）
// ============================================================================

/** 2026-11-05 13:00 台北時間 */
const NOW = new Date("2026-11-05T05:00:00Z");
const PRICE = 2260; // fugle-stock-page.html 上的現價

function marketSnapshot(stockId: string): DatasetMap["market"] {
    const list = (name: string, key: "V1" | "V2"): MarketIndex => indexMarketList(fixture(name), key);
    const indexes: Record<MarketListId, MarketIndex | undefined> = {
        nav: list("market-nav.json", "V1"),
        pb: list("market-pb.json", "V1"),
        eps: list("market-eps.json", "V1"),
        pe: list("market-pe.json", "V1"),
        dividendYield: list("market-yield.json", "V1"),
        grossMargin: list("market-margin.json", "V1"),
        roe: list("market-roe.json", "V1"),
        roa: list("market-roa.json", "V1"),
        trustBuy: list("market-trustbuy.json", "V2"),
        trustSell: list("market-trustsell.json", "V2"),
        foreignBuy: list("market-foreignbuy.json", "V2"),
        foreignSell: list("market-foreignsell.json", "V2"),
        trustHold: list("market-trusthold.json", "V2"),
        foreignHold: list("market-foreignhold.json", "V2"),
    };
    return buildMarketSnapshot(stockId, indexes);
}

function majorPeriod(name: string, days: number): MajorPeriod {
    const raw = summarizeMajor(fixture(name));
    assert.ok(raw);
    const period = toMajorPeriod(raw, days);
    assert.ok(period);
    return period;
}

const DATA_2330: DatasetMap = {
    basic: parseBasic(fixture("basic-2330.json")),
    industry: parseNames(fixture("industry-2330.json")),
    concept: parseNames(fixture("concept-2330.json")),
    group: parseNames(fixture("group-2330.json")),
    relations: {
        suppliers: parseRelations(fixture("relation-suppliers-2330.json")),
        customers: parseRelations(fixture("relation-customers-2330.json")),
        rivals: [],
        alliances: [],
        investOuts: [],
        investIns: [],
        failed: 0,
    },
    ratings: parseRatings(fixture("ratings-2330.json")),
    etf: parseEtfHoldings(fixture("etf-2330.synthetic.json")),
    capacity: parseCapacity(fixture("capacity-2330.json")),
    major: { periods: [majorPeriod("major1-2330.json", 1), null, majorPeriod("major5-2330.json", 5), null, null] },
    market: marketSnapshot("2330"),
};

/** 另一檔股票（用來驗證切換股票時不會混用資料） */
const DATA_2454: DatasetMap = {
    ...DATA_2330,
    basic: DATA_2330.basic ? { ...DATA_2330.basic, shortName: "聯發科", fullName: "聯發科技股份有限公司", listedDate: "2001/07/23" } : null,
    // 以主 5 的真實占比（-17.84%）作為 2454 的主 1，與 2330 的 -21.73% 區分
    major: { periods: [{ ...majorPeriod("major5-2330.json", 5), days: 1 }, null, null, null, null] },
};

const RELATED: RelatedGroups = {
    產業: [{ type: "產業", name: "晶圓代工", total: 4, stocks: [{ code: "2303", name: "聯電", capital: 1253 }, { code: "5347", name: "世界", capital: 189 }] }],
    集團: [],
    概念: [],
};
const EMPTY_RELATED: RelatedGroups = { 產業: [], 集團: [], 概念: [] };

const CTX_2330: StockContext = { stockId: "2330", name: "台積電", market: "上市" };
const CTX_2454: StockContext = { stockId: "2454", name: "聯發科", market: "上市" };

const SECTION_IDS = SECTIONS.map((s) => s.id);

const pad = (n: number): string => String(n).padStart(2, "0");
/** 卡片狀態列使用本地時間 HH:MM:SS */
const hms = (ms: number): string => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const meta = (ageMs = 5_000, stale = false): Meta => ({ fetchedAt: NOW.getTime() - ageMs, stale });

// ============================================================================
// 測試替身
// ============================================================================

interface FetchCall {
    name: DatasetName;
    stockId: string;
    force: boolean;
    settled: boolean;
    resolve(value: { data: unknown; meta: Meta }): void;
    reject(error: unknown): void;
}

interface Harness {
    env: DomEnv;
    doc: Document;
    card: InfoCard;
    settings: UiSettings;
    calls: FetchCall[];
    log: {
        setSection: Array<[string, boolean]>;
        patches: Array<Partial<UiSettings>>;
        navigate: string[];
        categories: Array<[CategoryType, string]>;
        related: Array<{ stockId: string; limit: number }>;
        popout: number;
        contextLost: number;
        changed: number;
    };
    el(): HTMLElement;
    section(id: string): HTMLElement;
    state(id: string): string | undefined;
    status(): HTMLElement;
    summary(): Array<[string, string, string]>;
    pending(name: DatasetName, stockId?: string): FetchCall[];
    resolve<K extends DatasetName>(name: K, opts?: { data?: DatasetMap[K]; meta?: Meta; stockId?: string }): Promise<void>;
    reject(name: DatasetName, error: unknown, stockId?: string): Promise<void>;
    resolveAll(opts?: { data?: DatasetMap; meta?: (name: DatasetName) => Meta; stockId?: string; except?: DatasetName[] }): Promise<void>;
    click(selector: string, init?: MouseEventInit): MouseEvent;
}

let current: Harness | null = null;

function setup(options: { settings?: Partial<UiSettings>; related?: RelatedGroups; price?: number | null } = {}): Harness {
    const env = setupFuglePage();
    const settings: UiSettings = { ...defaultSettings(), ...options.settings };
    const calls: FetchCall[] = [];
    const log: Harness["log"] = { setSection: [], patches: [], navigate: [], categories: [], related: [], popout: 0, contextLost: 0, changed: 0 };
    let card: InfoCard | null = null;

    const deps: CardDeps = {
        getSettings: () => settings,
        updateSettings: (patch) => {
            log.patches.push(patch);
            Object.assign(settings, patch);
            card?.applySettings(settings);
        },
        setSection: (id, open) => {
            log.setSection.push([id, open]);
            settings.sections = { ...settings.sections, [id]: open };
        },
        fetchDataset: <K extends DatasetName>(name: K, stockId: string, force: boolean) =>
            new Promise<DatasetResponse<K>>((resolve, reject) => {
                calls.push({ name, stockId, force, settled: false, resolve: resolve as FetchCall["resolve"], reject });
            }),
        fetchRelated: async (stockId, _extra, limit) => {
            log.related.push({ stockId, limit });
            return options.related ?? EMPTY_RELATED;
        },
        readPrice: () => (options.price === undefined ? PRICE : options.price),
        navigate: (code) => log.navigate.push(code),
        openCategory: (type, name) => log.categories.push([type, name]),
        popout: () => log.popout++,
        changed: () => log.changed++,
        contextLost: () => log.contextLost++,
        now: () => NOW,
    };
    card = new InfoCard(deps);
    const theCard = card;

    const el = (): HTMLElement => {
        const e = theCard.element;
        assert.ok(e, "card element should exist");
        return e;
    };
    const section = (id: string): HTMLElement => {
        const s = el().querySelector<HTMLElement>(`.fi-section[data-section="${id}"]`);
        assert.ok(s, `section ${id} should exist`);
        return s;
    };
    const pending = (name: DatasetName, stockId?: string): FetchCall[] => calls.filter((c) => !c.settled && c.name === name && (stockId === undefined || c.stockId === stockId));

    const h: Harness = {
        env,
        doc: env.document,
        card: theCard,
        settings,
        calls,
        log,
        el,
        section,
        state: (id) => section(id).dataset.state,
        status: () => {
            const s = el().querySelector<HTMLElement>("[data-role='status']");
            assert.ok(s);
            return s;
        },
        summary: () =>
            [...el().querySelectorAll<HTMLElement>(".fi-summary__item")].map((b) => {
                const value = b.querySelector<HTMLElement>(".fi-summary__value");
                const tone = [...(value?.classList ?? [])].find((c) => /^fi-(up|down|flat)$/.test(c)) ?? "";
                return [b.querySelector(".fi-summary__label")?.textContent ?? "", value?.textContent ?? "", tone];
            }),
        pending,
        async resolve(name, opts = {}) {
            const list = pending(name, opts.stockId);
            assert.ok(list.length > 0, `no pending fetch for ${name}`);
            const source = opts.stockId === "2454" ? DATA_2454 : DATA_2330;
            for (const c of list) {
                c.settled = true;
                c.resolve({ data: opts.data !== undefined ? opts.data : source[name], meta: opts.meta ?? meta() });
            }
            await flush();
        },
        async reject(name, error, stockId) {
            const list = pending(name, stockId);
            assert.ok(list.length > 0, `no pending fetch for ${name}`);
            for (const c of list) {
                c.settled = true;
                c.reject(error);
            }
            await flush();
        },
        async resolveAll(opts = {}) {
            for (const name of DATASET_NAMES) {
                if (opts.except?.includes(name)) continue;
                for (const c of pending(name, opts.stockId)) {
                    const source = opts.data ?? (c.stockId === "2454" ? DATA_2454 : DATA_2330);
                    c.settled = true;
                    c.resolve({ data: source[name], meta: opts.meta ? opts.meta(name) : meta() });
                }
            }
            await flush();
        },
        click(selector, init = {}) {
            const target = el().querySelector<HTMLElement>(selector);
            assert.ok(target, `element ${selector} should exist`);
            const event = new env.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
            target.dispatchEvent(event);
            return event;
        },
    };
    current = h;
    return h;
}

afterEach(() => {
    if (!current) return;
    try {
        current.card.remove();
    } finally {
        current.env.cleanup();
        current = null;
    }
});

// ============================================================================
// 載入與渲染
// ============================================================================

describe("InfoCard.load：立即顯示骨架", () => {
    test("標題用頁面上的名稱 / 代碼 / 市場別，10 個區塊皆為載入中並顯示骨架", () => {
        const h = setup();
        h.card.load(CTX_2330);

        const el = h.el();
        assert.equal(el.id, CARD_ID);
        assert.equal(el.dataset.stockId, "2330");
        assert.ok(el.isConnected, "card should be mounted");
        assert.equal(el.querySelector("[data-role='name']")?.textContent, "台積電");
        assert.equal(el.querySelector("[data-role='code']")?.textContent, "2330 · 上市");
        assert.equal(h.status().textContent, "載入中…");
        assert.equal(el.querySelector("[data-action='refresh']")?.getAttribute("aria-busy"), "true");

        const sections = [...el.querySelectorAll<HTMLElement>(".fi-section")];
        assert.equal(sections.length, 10);
        assert.deepEqual(
            sections.map((s) => s.dataset.section),
            SECTION_IDS
        );
        for (const s of sections) {
            assert.equal(s.dataset.state, "loading", `${s.dataset.section} state`);
            assert.equal(s.getAttribute("aria-busy"), "true");
            assert.ok(s.querySelector(".fi-section__body .fi-skel"), `${s.dataset.section} skeleton`);
        }
        assert.equal(h.summary().length, 0);
    });

    test("每個資料集在同一次載入中只請求一次（多個區塊共用）", () => {
        const h = setup();
        h.card.load(CTX_2330);
        const names = h.calls.map((c) => c.name).sort();
        assert.deepEqual(names, [...DATASET_NAMES].sort());
        assert.ok(h.calls.every((c) => c.stockId === "2330" && c.force === false));
    });

    test("預設展開狀態沿用區塊定義，使用者設定可覆寫", () => {
        const h = setup({ settings: { sections: { basic: false, invest: true } } });
        h.card.load(CTX_2330);
        for (const def of SECTIONS) {
            const expected = def.id === "basic" ? false : def.id === "invest" ? true : def.defaultOpen;
            const body = h.section(def.id).querySelector<HTMLElement>(".fi-section__body");
            const header = h.section(def.id).querySelector<HTMLElement>(".fi-section__header");
            assert.equal(body?.hidden, !expected, `${def.id} hidden`);
            assert.equal(header?.getAttribute("aria-expanded"), expected ? "true" : "false");
        }
    });

    test("股票名稱含 HTML 時以文字顯示（不注入）", () => {
        const h = setup();
        h.card.load({ stockId: "2330", name: "<img src=x onerror=alert(1)>", market: "上市" });
        assert.equal(h.el().querySelector("img"), null);
        assert.equal(h.el().querySelector("[data-role='name']")?.textContent, "<img src=x onerror=alert(1)>");
    });
});

describe("InfoCard：各區塊獨立填入", () => {
    test("依自訂順序到達：只有相依資料到齊的區塊離開載入狀態", async () => {
        const h = setup({ related: RELATED });
        h.card.load(CTX_2330);

        await h.resolve("capacity");
        assert.equal(h.state("capacity"), "ready");
        assert.match(h.section("capacity").textContent ?? "", /位置/);
        assert.match(h.section("capacity").querySelector("[data-role='meta']")?.textContent ?? "", /^13 項$/);
        for (const id of SECTION_IDS.filter((x) => x !== "capacity")) assert.equal(h.state(id), "loading", id);

        await h.resolve("major");
        assert.equal(h.state("major"), "ready");
        assert.equal(h.section("major").querySelector("[data-role='meta']")?.textContent, "主1 -21.73%");

        // 財務指標需要 market + basic：只到 market 時仍在載入
        await h.resolve("market");
        assert.equal(h.state("continuous"), "ready");
        assert.equal(h.state("finance"), "loading");
        await h.resolve("basic");
        assert.equal(h.state("finance"), "ready");
        assert.equal(h.section("finance").querySelector("[data-role='meta']")?.textContent, "PE 26.20 · 殖利率 0.97%");
        // 基本資料還在等產業 / 概念
        assert.equal(h.state("basic"), "loading");

        await h.resolve("industry");
        await h.resolve("concept");
        assert.equal(h.state("basic"), "ready");
        assert.equal(h.section("basic").querySelector("[data-role='meta']")?.textContent, "IC生產、IC製造、晶圓代工");
        assert.equal(h.state("related"), "loading", "related waits for group too");

        await h.resolve("group");
        assert.equal(h.state("related"), "ready");
        assert.deepEqual(h.log.related, [{ stockId: "2330", limit: 10 }]);
        assert.equal(h.state("relation"), "loading", "relation waits for relations");

        await h.resolve("relations");
        assert.equal(h.state("relation"), "ready");
        assert.equal(h.state("rating"), "loading");
        await h.resolve("ratings");
        await h.resolve("etf");
        for (const id of SECTION_IDS) assert.notEqual(h.state(id), "loading", id);
        assert.equal(h.el().querySelectorAll(".fi-skel").length, 0);
        assert.equal(h.el().querySelector("[data-action='refresh']")?.getAttribute("aria-busy"), "false");
    });

    test("基本資料到達後標題改用正式簡稱並顯示全名、上市櫃日期", async () => {
        const h = setup();
        h.card.load({ stockId: "2330", name: "", market: "上市" });
        assert.equal(h.el().querySelector("[data-role='name']")?.textContent, "2330", "falls back to the code while the page name is empty");
        await h.resolve("basic");
        assert.equal(h.el().querySelector("[data-role='name']")?.textContent, "台積電");
        const sub = h.el().querySelector("[data-role='sub']")?.textContent ?? "";
        assert.match(sub, /台灣積體電路製造股份有限公司/);
        assert.match(sub, /上市櫃 1994\/09\/05/);
    });

    test("沒有內容且未設定 emptyText 的區塊為 empty；有 emptyText 者顯示提示", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.resolveAll({
            data: { ...DATA_2330, capacity: [], major: { periods: [null, null, null, null, null] } },
        });
        // 真實關係資料只有供應商 / 客戶，沒有轉投資 → 投資佈局為空
        assert.equal(h.state("invest"), "empty");
        assert.equal(h.state("capacity"), "empty");
        assert.equal(h.section("capacity").querySelector(".fi-section__body")?.innerHTML, "");
        assert.equal(h.state("related"), "empty", "no related groups");
        assert.equal(h.state("major"), "ready");
        assert.equal(h.section("major").querySelector(".fi-empty")?.textContent, "暫無主力買賣資料");
    });
});

describe("InfoCard：錯誤與重試", () => {
    test("資料集失敗 → 錯誤區塊含重試按鈕；其他區塊不受影響", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.reject("capacity", new ApiError("HTTP 500", "http-500"));
        await h.resolveAll();

        assert.equal(h.state("capacity"), "error");
        const err = h.section("capacity").querySelector<HTMLElement>(".fi-error");
        assert.ok(err);
        assert.equal(err.getAttribute("role"), "alert");
        assert.match(err.textContent ?? "", /載入失敗：HTTP 500/);
        const retry = err.querySelector<HTMLElement>("[data-action='retry']");
        assert.equal(retry?.dataset.section, "capacity");
        assert.equal(h.state("basic"), "ready");
        assert.equal(h.status().textContent, `更新於 ${hms(NOW.getTime() - 5_000)} · 1 個區塊載入失敗`);
        assert.ok(h.status().classList.contains("fi-card__status--warn"));
    });

    test("重試只重抓失敗的資料集並恢復，錯誤計數隨之歸零", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.reject("capacity", new Error("network down"));
        await h.resolveAll();
        const before = h.calls.length;

        h.click(".fi-section[data-section='capacity'] [data-action='retry']");
        assert.equal(h.state("capacity"), "loading");
        assert.ok(h.section("capacity").querySelector(".fi-skel"));
        const retried = h.calls.slice(before);
        assert.deepEqual(
            retried.map((c) => [c.name, c.stockId, c.force]),
            [["capacity", "2330", false]]
        );

        await h.resolve("capacity");
        assert.equal(h.state("capacity"), "ready");
        assert.equal(h.status().textContent, `更新於 ${hms(NOW.getTime() - 5_000)}`);
        assert.ok(!h.status().classList.contains("fi-card__status--warn"));
    });

    test("多個資料集的區塊：重試只重抓失敗的 group / relations，成功的資料沿用", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.reject("group", new Error("boom"));
        await h.reject("relations", new Error("boom"));
        await h.resolveAll();
        assert.equal(h.state("relation"), "error");
        assert.equal(h.state("invest"), "error");
        assert.match(h.status().textContent ?? "", /2 個區塊載入失敗$/);

        const before = h.calls.length;
        h.click(".fi-section[data-section='relation'] [data-action='retry']");
        assert.deepEqual(h.calls.slice(before).map((c) => c.name).sort(), ["group", "relations"]);
        await h.resolveAll();
        assert.equal(h.state("relation"), "ready");
        assert.match(h.status().textContent ?? "", /1 個區塊載入失敗$/);

        // 投資佈局重試：relations 已在上一輪成功取得 → 不再發出請求
        const before2 = h.calls.length;
        h.click(".fi-section[data-section='invest'] [data-action='retry']");
        await flush();
        assert.equal(h.calls.length, before2);
        assert.equal(h.state("invest"), "empty");
        assert.equal(h.status().textContent, `更新於 ${hms(NOW.getTime() - 5_000)}`);
    });

    const etfCases: Array<{ code: string; unavailable: boolean }> = [
        { code: "http-403", unavailable: true },
        { code: "http-503", unavailable: true },
        { code: "payload", unavailable: true },
        { code: "timeout", unavailable: false },
        { code: "network", unavailable: false },
    ];
    for (const { code, unavailable } of etfCases) {
        test(`ETF 來源錯誤 ${code} → ${unavailable ? "顯示 FindBillion 說明且不計入失敗" : "錯誤區塊並計入失敗"}`, async () => {
            const h = setup();
            h.card.load(CTX_2330);
            await h.reject("etf", new ApiError(`來源錯誤 ${code}`, code));
            await h.resolveAll();
            const etf = h.section("etf");
            const stamp = `更新於 ${hms(NOW.getTime() - 5_000)}`;
            if (unavailable) {
                assert.equal(etf.dataset.state, "ready");
                const link = etf.querySelector<HTMLAnchorElement>("a.fi-chip");
                assert.equal(link?.href, "https://www.findbillion.com/twstock/2330/etf");
                assert.equal(link?.target, "_blank");
                assert.equal(etf.querySelector("[data-role='meta']")?.textContent, "需至來源網站查看");
                assert.ok(etf.querySelector("[data-action='retry'][data-section='etf']"));
                assert.equal(h.status().textContent, stamp);
                assert.ok(!h.status().classList.contains("fi-card__status--warn"));
            } else {
                assert.equal(etf.dataset.state, "error");
                assert.equal(h.status().textContent, `${stamp} · 1 個區塊載入失敗`);
            }
        });
    }

    test("全部資料集失敗 → 狀態列提示可重試", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        for (const name of DATASET_NAMES) await h.reject(name, new Error("offline"));
        assert.equal(h.status().textContent, "⚠ 資料載入失敗，可點區塊內的「重試」");
        assert.ok(h.status().classList.contains("fi-card__status--warn"));
        // 相關個股在分類全部失敗時仍以空分類查詢，因此為 empty 而非 error
        assert.equal(h.state("related"), "empty");
        for (const id of SECTION_IDS.filter((x) => x !== "related")) assert.equal(h.state(id), "error", id);
    });
});

describe("InfoCard：狀態列", () => {
    const cases: Array<{ title: string; meta: (name: DatasetName) => Meta; expected: string; warn: boolean }> = [
        { title: "新資料 → 更新於", meta: () => meta(5_000), expected: `更新於 ${hms(NOW.getTime() - 5_000)}`, warn: false },
        { title: "超過 1 分鐘的快取 → 快取資料", meta: (n) => meta(n === "ratings" ? 10 * 60_000 : 5_000), expected: `快取資料 · 取得於 ${hms(NOW.getTime() - 10 * 60_000)}`, warn: false },
        { title: "任一資料集為過期快取 → 離線快取警告（取最舊時間）", meta: (n) => (n === "market" ? meta(2 * 3_600_000, true) : meta(5_000)), expected: `⚠ 網路異常，顯示離線快取（${hms(NOW.getTime() - 2 * 3_600_000)}）`, warn: true },
    ];
    for (const c of cases) {
        test(c.title, async () => {
            const h = setup();
            h.card.load(CTX_2330);
            await h.resolveAll({ meta: c.meta });
            assert.equal(h.status().textContent, c.expected);
            assert.equal(h.status().classList.contains("fi-card__status--warn"), c.warn);
        });
    }

    test("離線快取與區塊失敗同時發生 → 兩者都顯示", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.reject("capacity", new Error("x"));
        await h.resolveAll({ meta: (n) => (n === "basic" ? meta(60_000 * 30, true) : meta()) });
        assert.equal(h.status().textContent, `⚠ 網路異常，顯示離線快取（${hms(NOW.getTime() - 30 * 60_000)}） · 1 個區塊載入失敗`);
    });
});

describe("InfoCard：標題列摘要", () => {
    test("資料陸續到達時逐步加入 主1 / 投信 / 外資 / 本益比 / 殖利率 / 目標均價", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        assert.deepEqual(h.summary(), []);

        await h.resolve("major");
        assert.deepEqual(h.summary(), [["主1", "-21.73%", "fi-down"]]);

        await h.resolve("market");
        assert.deepEqual(h.summary(), [
            ["主1", "-21.73%", "fi-down"],
            ["投信", "連買24", "fi-up"],
            ["外資", "連賣19", "fi-down"],
            ["本益比", "26.20", "fi-flat"],
            ["殖利率", "0.97%", "fi-flat"],
        ]);

        // 8 筆評等（2026/10/16）平均目標價 3,356，現價 2,260 → +48.5%
        await h.resolve("ratings");
        assert.deepEqual(h.summary().at(-1), ["目標均價", "+48.5%", "fi-up"]);
        const chip = h.el().querySelector<HTMLElement>(".fi-summary__item:last-child");
        assert.equal(chip?.dataset.section, "rating");
        assert.match(chip?.title ?? "", /3,356\.00（8 筆）/);
    });

    test("讀不到現價時不顯示目標均價", async () => {
        const h = setup({ price: null });
        h.card.load(CTX_2330);
        await h.resolve("ratings");
        assert.deepEqual(h.summary(), []);
    });

    test("點擊摘要跳到對應區塊：展開已收合的卡片與區塊", async () => {
        const h = setup({ settings: { collapsed: true, sections: { continuous: false } } });
        h.card.load(CTX_2330);
        await h.resolve("market");
        h.click(".fi-summary__item[data-section='continuous']");
        assert.deepEqual(h.log.patches, [{ collapsed: false }]);
        assert.equal(h.section("continuous").querySelector<HTMLElement>(".fi-section__body")?.hidden, false);
        assert.deepEqual(h.log.setSection, [["continuous", true]]);
    });
});

describe("InfoCard：切換股票時丟棄舊結果", () => {
    test("2330 的結果在切到 2454 後才到 → 不會畫到新股票上", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        h.card.load(CTX_2454);
        assert.equal(h.el().dataset.stockId, "2454");
        assert.equal(h.calls.filter((c) => c.stockId === "2454").length, DATASET_NAMES.length, "2454 fetches its own datasets");

        await h.resolveAll({ stockId: "2330" });
        assert.equal(h.el().dataset.stockId, "2454");
        assert.equal(h.el().querySelector("[data-role='name']")?.textContent, "聯發科");
        assert.equal(h.el().querySelector("[data-role='sub']")?.textContent, "");
        assert.deepEqual(h.summary(), []);
        for (const id of SECTION_IDS) assert.equal(h.state(id), "loading", id);
        assert.equal(h.status().textContent, "載入中…");

        await h.resolveAll({ stockId: "2454" });
        assert.equal(h.el().querySelector("[data-role='name']")?.textContent, "聯發科");
        assert.match(h.el().querySelector("[data-role='sub']")?.textContent ?? "", /聯發科技股份有限公司/);
        assert.deepEqual(h.summary()[0], ["主1", "-17.84%", "fi-down"]);
        assert.equal(h.section("major").querySelector("[data-role='meta']")?.textContent, "主1 -17.84%");
    });

    test("新股票先載入完成、舊股票失敗較晚到 → 不改變內容也不計入錯誤", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        h.card.load(CTX_2454);
        await h.resolveAll({ stockId: "2454" });
        const snapshot = h.el().innerHTML;
        for (const name of DATASET_NAMES) await h.reject(name, new Error("late failure"), "2330");
        assert.equal(h.el().innerHTML, snapshot);
        assert.equal(h.status().textContent, `更新於 ${hms(NOW.getTime() - 5_000)}`);
        assert.equal(h.el().querySelectorAll(".fi-section[data-state='error']").length, 0);
    });

    test("remove() 之後到達的結果不會重新建立卡片", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        h.card.remove();
        assert.equal(h.doc.getElementById(CARD_ID), null);
        assert.equal(h.card.element, null);
        assert.equal(h.card.stockId, null);
        await h.resolveAll();
        assert.equal(h.doc.getElementById(CARD_ID), null);
        assert.equal(h.card.element, null);
    });
});

// ============================================================================
// 版面設定
// ============================================================================

describe("InfoCard.applySettings", () => {
    const positions: Array<{ position: UiSettings["position"]; classes: string[]; parent: string }> = [
        { position: "right", classes: ["fi-card--floating", "fi-card--right"], parent: "body" },
        { position: "left", classes: ["fi-card--floating", "fi-card--left"], parent: "body" },
        { position: "default", classes: [], parent: ".card-group-header" },
    ];
    for (const p of positions) {
        test(`位置 ${p.position} → ${p.classes.join(" ") || "嵌入富果頁首"}`, () => {
            const h = setup({ settings: { position: p.position } });
            h.card.load(CTX_2330);
            const el = h.el();
            for (const cls of ["fi-card--floating", "fi-card--right", "fi-card--left"]) {
                assert.equal(el.classList.contains(cls), p.classes.includes(cls), cls);
            }
            assert.equal(el.parentElement, h.doc.querySelector(p.parent));
            assert.match(el.querySelector<HTMLElement>("[data-role='position']")?.title ?? "", new RegExp(`目前：${{ right: "靠右", left: "靠左", default: "嵌入" }[p.position]}`));
        });
    }

    test("從浮動改為嵌入再改回浮動，元素在 body 與頁首之間移動且不重複", () => {
        const h = setup();
        h.card.load(CTX_2330);
        h.settings.position = "default";
        h.card.applySettings(h.settings);
        assert.equal(h.el().parentElement, h.doc.querySelector(".card-group-header"));
        h.settings.position = "left";
        h.card.applySettings(h.settings);
        assert.equal(h.el().parentElement, h.doc.body);
        assert.equal(h.doc.querySelectorAll(`#${CARD_ID}`).length, 1);
    });

    test("visible=false 或 setSuppressed(true) 時隱藏", () => {
        const h = setup();
        h.card.load(CTX_2330);
        assert.equal(h.el().hidden, false);
        h.card.setSuppressed(true);
        assert.equal(h.el().hidden, true, "suppressed by popup");
        h.card.setSuppressed(false);
        assert.equal(h.el().hidden, false);
        h.settings.visible = false;
        h.card.applySettings(h.settings);
        assert.equal(h.el().hidden, true);
        h.settings.visible = true;
        h.card.setSuppressed(true);
        h.card.applySettings(h.settings);
        assert.equal(h.el().hidden, true, "suppression survives a settings change");
    });

    test("collapsed 隱藏內容並更新收合按鈕", () => {
        const h = setup({ settings: { collapsed: true } });
        h.card.load(CTX_2330);
        const body = h.el().querySelector<HTMLElement>("[data-role='body']");
        const btn = h.el().querySelector<HTMLElement>("[data-role='collapse']");
        assert.equal(body?.hidden, true);
        assert.equal(btn?.textContent, "▾");
        assert.equal(btn?.getAttribute("aria-expanded"), "false");
        assert.equal(btn?.getAttribute("aria-label"), "展開資訊卡");

        h.click("[data-role='collapse']");
        assert.deepEqual(h.log.patches, [{ collapsed: false }]);
        assert.equal(body?.hidden, false);
        assert.equal(btn?.textContent, "▴");
        assert.equal(btn?.getAttribute("aria-expanded"), "true");
    });
});

// ============================================================================
// 互動
// ============================================================================

describe("InfoCard 互動（事件委派）", () => {
    test("toggle-section：切換區塊並保存展開狀態", () => {
        const h = setup();
        h.card.load(CTX_2330);
        const header = ".fi-section[data-section='basic'] .fi-section__header";
        const body = (): HTMLElement | null => h.section("basic").querySelector<HTMLElement>(".fi-section__body");
        h.click(header);
        assert.equal(body()?.hidden, true);
        assert.equal(h.el().querySelector(header)?.getAttribute("aria-expanded"), "false");
        h.click(`${header} .fi-section__title`); // 點到按鈕內的子元素也算
        assert.equal(body()?.hidden, false);
        assert.equal(h.el().querySelector(header)?.getAttribute("aria-expanded"), "true");
        h.click(".fi-section[data-section='capacity'] .fi-section__header");
        assert.deepEqual(h.log.setSection, [
            ["basic", false],
            ["basic", true],
            ["capacity", true],
        ]);
    });

    test("expand：顯示 / 收合溢出的概念股晶片（42 個概念，預設顯示 12 個）", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.resolveAll();
        const panel = h.el().querySelector<HTMLElement>("#fi-more-concept");
        const btn = h.el().querySelector<HTMLElement>("[data-action='expand'][data-target='fi-more-concept']");
        assert.ok(panel && btn);
        assert.equal(panel.hidden, true);
        assert.equal(panel.querySelectorAll(".fi-chip").length, 42 - 12);
        assert.equal(btn.textContent, "顯示全部 42");

        h.click("[data-action='expand'][data-target='fi-more-concept']");
        assert.equal(panel.hidden, false);
        assert.equal(btn.textContent, "收合");
        assert.equal(btn.getAttribute("aria-expanded"), "true");

        h.click("[data-action='expand'][data-target='fi-more-concept']");
        assert.equal(panel.hidden, true);
        assert.equal(btn.textContent, "顯示全部 42");
        assert.equal(btn.getAttribute("aria-expanded"), "false");
    });

    test("toggle-cat：收合 / 展開相關個股分類", async () => {
        const h = setup({ related: RELATED });
        h.card.load(CTX_2330);
        await h.resolveAll();
        const head = h.el().querySelector<HTMLElement>(".fi-cat__head");
        const id = head?.getAttribute("aria-controls") ?? "";
        const body = h.el().querySelector<HTMLElement>(`#${id}`);
        assert.ok(head && body);
        assert.equal(body.hidden, false, "產業 categories start expanded");
        h.click(".fi-cat__head .fi-cat__name");
        assert.equal(body.hidden, true);
        assert.equal(head.getAttribute("aria-expanded"), "false");
        h.click(".fi-cat__head");
        assert.equal(body.hidden, false);
        assert.equal(head.getAttribute("aria-expanded"), "true");
    });

    test("category：點分類晶片開啟分類搜尋", async () => {
        const h = setup({ related: RELATED });
        h.card.load(CTX_2330);
        await h.resolveAll();
        h.click(".fi-section[data-section='basic'] [data-action='category'][data-name='晶圓代工']");
        h.click(".fi-section[data-section='related'] .fi-more[data-action='category']");
        assert.deepEqual(h.log.categories, [
            ["產業", "晶圓代工"],
            ["產業", "晶圓代工"],
        ]);
    });

    test("cycle-position：靠右 → 靠左 → 嵌入 → 靠右", () => {
        const h = setup();
        h.card.load(CTX_2330);
        for (let i = 0; i < 3; i++) h.click("[data-action='cycle-position']");
        assert.deepEqual(h.log.patches, [{ position: "left" }, { position: "default" }, { position: "right" }]);
        assert.ok(h.el().classList.contains("fi-card--right"));
        assert.equal(h.el().parentElement, h.doc.body);
    });

    test("hide-card：設定為不顯示並隱藏卡片", () => {
        const h = setup();
        h.card.load(CTX_2330);
        h.click("[data-action='hide-card']");
        assert.deepEqual(h.log.patches, [{ visible: false }]);
        assert.equal(h.el().hidden, true);
    });

    test("popout：交給 deps.popout", () => {
        const h = setup();
        h.card.load(CTX_2330);
        h.click("[data-action='popout']");
        assert.equal(h.log.popout, 1);
    });

    test("refresh：以 force=true 重新抓取所有資料集，區塊回到載入中", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.resolveAll();
        const before = h.calls.length;
        h.click("[data-action='refresh']");
        const again = h.calls.slice(before);
        assert.deepEqual(again.map((c) => c.name).sort(), [...DATASET_NAMES].sort());
        assert.ok(again.every((c) => c.force && c.stockId === "2330"));
        for (const id of SECTION_IDS) assert.equal(h.state(id), "loading", id);
        await h.resolveAll();
        for (const id of SECTION_IDS) assert.notEqual(h.state(id), "loading", id);
    });

    const navCases: Array<{ title: string; init: MouseEventInit; intercepted: boolean }> = [
        { title: "一般左鍵點擊 → 站內導覽", init: {}, intercepted: true },
        { title: "Ctrl + 點擊 → 交給瀏覽器（開新分頁）", init: { ctrlKey: true }, intercepted: false },
        { title: "⌘ + 點擊 → 交給瀏覽器", init: { metaKey: true }, intercepted: false },
        { title: "Shift + 點擊 → 交給瀏覽器", init: { shiftKey: true }, intercepted: false },
        { title: "中鍵 → 交給瀏覽器", init: { button: 1 }, intercepted: false },
    ];
    for (const c of navCases) {
        test(`個股連結：${c.title}`, async () => {
            const h = setup({ related: RELATED });
            h.card.load(CTX_2330);
            await h.resolveAll();
            const link = h.el().querySelector<HTMLAnchorElement>("a[data-fi-nav='2303']");
            assert.ok(link);
            assert.equal(link.getAttribute("href"), "/ai/2303");
            const event = h.click("a[data-fi-nav='2303'] .fi-chip__sub", c.init);
            assert.equal(event.defaultPrevented, c.intercepted);
            assert.deepEqual(h.log.navigate, c.intercepted ? ["2303"] : []);
        });
    }
});

// ============================================================================
// 掛載與移除
// ============================================================================

describe("InfoCard 掛載", () => {
    test("ensureMounted：富果移除卡片後重新掛上，不重新載入資料", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        await h.resolveAll();
        const el = h.el();
        const calls = h.calls.length;
        el.remove();
        assert.equal(el.isConnected, false);
        h.card.ensureMounted();
        assert.equal(h.card.element, el, "same element is reused");
        assert.equal(el.parentElement, h.doc.body);
        assert.equal(h.calls.length, calls);
        assert.equal(h.state("basic"), "ready");
    });

    test("ensureMounted（嵌入模式）：富果重繪頁首後掛回新的頁首", () => {
        const h = setup({ settings: { position: "default" } });
        h.card.load(CTX_2330);
        const oldHeader = h.doc.querySelector(".card-group-header");
        assert.ok(oldHeader);
        const fresh = oldHeader.cloneNode(true) as HTMLElement;
        fresh.querySelector(`#${CARD_ID}`)?.remove();
        oldHeader.replaceWith(fresh);
        assert.equal(h.el().isConnected, false);
        h.card.ensureMounted();
        assert.equal(h.el().parentElement, fresh);
        assert.equal(h.doc.querySelectorAll(`#${CARD_ID}`).length, 1);
    });

    test("ensureMounted 在尚未載入或已移除時不做事", () => {
        const h = setup();
        h.card.ensureMounted();
        assert.equal(h.doc.getElementById(CARD_ID), null);
        h.card.load(CTX_2330);
        h.card.remove();
        h.card.ensureMounted();
        assert.equal(h.doc.getElementById(CARD_ID), null);
    });

    test("remove() 移除元素並通知變更；之後可再次載入", async () => {
        const h = setup();
        h.card.load(CTX_2330);
        const changed = h.log.changed;
        h.card.remove();
        assert.equal(h.doc.getElementById(CARD_ID), null);
        assert.ok(h.log.changed > changed);
        h.card.load(CTX_2454);
        assert.equal(h.doc.querySelectorAll(`#${CARD_ID}`).length, 1);
        assert.equal(h.el().dataset.stockId, "2454");
        await h.resolveAll({ stockId: "2454" });
        assert.equal(h.state("basic"), "ready");
    });
});

beforeEach(() => {
    assert.equal(current, null, "previous test cleaned up");
});
