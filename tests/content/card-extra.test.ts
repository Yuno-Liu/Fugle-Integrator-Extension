/**
 * 資訊卡（InfoCard）補充測試：載入計數、依股價重新渲染、區塊狀態套用、焦點管理、halt。
 * 以假的 CardDeps 控制每個資料集的回應時機；股價與時間（deps.now）皆可由測試調整。
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fixture } from "../helpers/fixtures";
import { flush, setupFuglePage } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { InfoCard } from "../../src/content/card";
import type { CardDeps } from "../../src/content/card";
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
import type { CategoryType, RelatedGroups, UiSettings } from "../../src/shared/types";
import { fmtHundredMillion } from "../../src/utils/format";

// ============================================================================
// 真實資料（fixtures → src/core 解析器）
// ============================================================================

/** 2026-11-05 13:00 台北時間 */
const NOW_MS = new Date("2026-11-05T05:00:00Z").getTime();
const PRICE = 2260;
/** 與 src/content/card.ts 的 PRICE_REFRESH_MS 相同 */
const PRICE_REFRESH_MS = 5000;

function buildData(): DatasetMap {
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
    const raw1 = summarizeMajor(fixture("major1-2330.json"));
    return {
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
        major: { periods: [raw1 ? toMajorPeriod(raw1, 1) : null, null, null, null, null] },
        market: buildMarketSnapshot("2330", indexes),
    };
}

const DATA = buildData();
const RELATED: RelatedGroups = {
    產業: [{ type: "產業", name: "晶圓代工", total: 2, stocks: [{ code: "2303", name: "聯電", capital: 1253 }] }],
    集團: [],
    概念: [],
};
const CTX: StockContext = { stockId: "2330", name: "台積電", market: "上市" };

const pad = (n: number): string => String(n).padStart(2, "0");
const hms = (ms: number): string => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const META: Meta = { fetchedAt: NOW_MS - 5_000, stale: false };

// ============================================================================
// 測試替身
// ============================================================================

interface FetchCall {
    name: DatasetName;
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
    categories: Array<[CategoryType, string, Document]>;
    changed: { count: number };
    /** 頁面股價（deps.readPrice 回傳值） */
    price: { value: number | null };
    /** deps.now 的時間（毫秒） */
    clock: { ms: number };
    el(): HTMLElement;
    section(id: string): HTMLElement;
    body(id: string): HTMLElement;
    status(): HTMLElement;
    busy(): string | null;
    resolve(name: DatasetName, data?: unknown): Promise<void>;
    reject(name: DatasetName, error: unknown): Promise<void>;
    resolveAll(opts?: { except?: DatasetName[]; data?: Partial<DatasetMap> }): Promise<void>;
    click(selector: string): MouseEvent;
}

let current: Harness | null = null;

function setup(options: { settings?: Partial<UiSettings>; price?: number | null } = {}): Harness {
    const env = setupFuglePage();
    const settings: UiSettings = { ...defaultSettings(), ...options.settings };
    const calls: FetchCall[] = [];
    const categories: Harness["categories"] = [];
    const changed = { count: 0 };
    const price = { value: options.price === undefined ? PRICE : options.price };
    const clock = { ms: NOW_MS };
    let card: InfoCard | null = null;

    const deps: CardDeps = {
        getSettings: () => settings,
        updateSettings: (patch) => {
            Object.assign(settings, patch);
            card?.applySettings(settings);
        },
        setSection: (id, open) => {
            settings.sections = { ...settings.sections, [id]: open };
        },
        fetchDataset: <K extends DatasetName>(name: K) =>
            new Promise<DatasetResponse<K>>((resolve, reject) => {
                calls.push({ name, settled: false, resolve: resolve as FetchCall["resolve"], reject });
            }),
        fetchRelated: async () => RELATED,
        readPrice: () => price.value,
        navigate: () => undefined,
        openCategory: (type, name, doc) => categories.push([type, name, doc]),
        popout: () => undefined,
        changed: () => changed.count++,
        contextLost: () => undefined,
        now: () => new Date(clock.ms),
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
        assert.ok(s, `section ${id}`);
        return s;
    };
    const pending = (name: DatasetName): FetchCall[] => calls.filter((c) => !c.settled && c.name === name);

    const h: Harness = {
        env,
        doc: env.document,
        card: theCard,
        settings,
        calls,
        categories,
        changed,
        price,
        clock,
        el,
        section,
        body: (id) => {
            const b = section(id).querySelector<HTMLElement>(".fi-section__body");
            assert.ok(b);
            return b;
        },
        status: () => {
            const s = el().querySelector<HTMLElement>("[data-role='status']");
            assert.ok(s);
            return s;
        },
        busy: () => el().querySelector("[data-action='refresh']")?.getAttribute("aria-busy") ?? null,
        async resolve(name, data) {
            const list = pending(name);
            assert.ok(list.length > 0, `no pending fetch for ${name}`);
            for (const c of list) {
                c.settled = true;
                c.resolve({ data: data !== undefined ? data : DATA[name], meta: META });
            }
            await flush();
        },
        async reject(name, error) {
            const list = pending(name);
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
                for (const c of pending(name)) {
                    c.settled = true;
                    const data = opts.data && name in opts.data ? opts.data[name] : DATA[name];
                    c.resolve({ data, meta: META });
                }
            }
            await flush();
        },
        click(selector) {
            const target = el().querySelector<HTMLElement>(selector);
            assert.ok(target, `element ${selector}`);
            const event = new env.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
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

const kpi = (h: Harness, label: string): string | null => {
    for (const tile of h.section("finance").querySelectorAll(".fi-kpi")) {
        if (tile.querySelector(".fi-kpi__label")?.textContent === label) return tile.querySelector(".fi-kpi__value")?.textContent ?? null;
    }
    return null;
};
const marketCap = (price: number): string => {
    const shares = DATA.basic?.sharesThousand;
    assert.ok(shares, "fixture has shares");
    return fmtHundredMillion((price * shares) / 100_000);
};
const summaryLabels = (h: Harness): string[] => [...h.el().querySelectorAll(".fi-summary__item .fi-summary__label")].map((l) => l.textContent ?? "");

// ============================================================================
// 載入計數：重試中的區塊也要計入
// ============================================================================

describe("InfoCard：載入計數（重試與其他區塊同時進行）", () => {
    test("其他區塊仍在載入時重試失敗區塊：重試完成不會提早清除轉圈或寫入最終狀態", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.reject("capacity", new Error("network down"));
        assert.equal(h.section("capacity").dataset.state, "error");
        assert.equal(h.busy(), "true", "other sections still loading");

        h.click(".fi-section[data-section='capacity'] [data-action='retry']");
        assert.equal(h.section("capacity").dataset.state, "loading");
        assert.equal(h.busy(), "true");

        await h.resolve("capacity");
        assert.equal(h.section("capacity").dataset.state, "ready");
        assert.equal(h.busy(), "true", "retry finished first: spinner must stay while others load");
        assert.equal(h.status().textContent, "載入中…", "final status not written yet");

        await h.resolveAll();
        assert.equal(h.busy(), "false");
        assert.equal(h.status().textContent, `更新於 ${hms(META.fetchedAt)}`);
        assert.ok(!h.status().classList.contains("fi-card__status--warn"));
    });

    test("其他區塊先完成、重試中的區塊尚未完成：仍維持載入中，直到重試結束才寫入最終狀態", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.reject("capacity", new Error("network down"));
        h.click(".fi-section[data-section='capacity'] [data-action='retry']");

        await h.resolveAll({ except: ["capacity"] });
        for (const def of SECTIONS) {
            if (def.id !== "capacity") assert.notEqual(h.section(def.id).dataset.state, "loading", def.id);
        }
        assert.equal(h.section("capacity").dataset.state, "loading");
        assert.equal(h.busy(), "true", "retry still in flight");
        assert.equal(h.status().textContent, "載入中…");

        await h.reject("capacity", new Error("still down"));
        assert.equal(h.busy(), "false");
        assert.equal(h.status().textContent, `更新於 ${hms(META.fetchedAt)} · 1 個區塊載入失敗`);
        assert.ok(h.status().classList.contains("fi-card__status--warn"));
    });

    test("全部完成後再重試：重試期間轉圈，完成後恢復且錯誤計數歸零", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.reject("capacity", new Error("x"));
        await h.resolveAll();
        assert.equal(h.busy(), "false");
        assert.match(h.status().textContent ?? "", /1 個區塊載入失敗/);

        h.click(".fi-section[data-section='capacity'] [data-action='retry']");
        assert.equal(h.busy(), "true");
        await h.resolve("capacity");
        assert.equal(h.busy(), "false");
        assert.equal(h.status().textContent, `更新於 ${hms(META.fetchedAt)}`);
    });
});

// ============================================================================
// syncPrice：股價出現 / 變動時重新渲染依股價計算的區塊
// ============================================================================

describe("InfoCard.syncPrice", () => {
    test("區塊在股價出現前完成（市值為「—」）→ 股價出現後重新渲染財務指標與評等，不重新抓資料", async () => {
        const h = setup({ price: null });
        h.card.load(CTX);
        await h.resolveAll();
        assert.equal(h.section("finance").dataset.state, "ready");
        assert.equal(kpi(h, "市值"), "—", "no price yet");
        assert.ok(!summaryLabels(h).includes("目標均價"));
        const ratingBefore = h.body("rating").innerHTML;
        const fetches = h.calls.length;

        h.price.value = PRICE;
        h.card.syncPrice(PRICE);
        await flush();
        assert.equal(kpi(h, "市值"), marketCap(PRICE));
        assert.notEqual(h.body("rating").innerHTML, ratingBefore, "rating upside recomputed with the price");
        assert.ok(summaryLabels(h).includes("目標均價"), "summary refreshed with the price");
        assert.equal(h.calls.length, fetches, "no dataset refetch");
        assert.equal(h.section("finance").dataset.state, "ready");
    });

    test("盤中股價跳動：財務指標最多每 5 秒重新渲染一次，評等表格不再重新渲染", async () => {
        const h = setup({ price: null });
        h.card.load(CTX);
        await h.resolveAll();
        h.price.value = PRICE;
        h.card.syncPrice(PRICE);
        await flush();
        assert.equal(kpi(h, "市值"), marketCap(PRICE));
        const ratingNode = h.body("rating").firstElementChild;
        assert.ok(ratingNode);

        // 同一時間點再跳動：節流中，不更新
        h.price.value = 2300;
        h.card.syncPrice(2300);
        await flush();
        assert.equal(kpi(h, "市值"), marketCap(PRICE), "throttled");

        h.clock.ms = NOW_MS + PRICE_REFRESH_MS - 1;
        h.card.syncPrice(2300);
        await flush();
        assert.equal(kpi(h, "市值"), marketCap(PRICE), "still within 5s");

        h.clock.ms = NOW_MS + PRICE_REFRESH_MS;
        h.card.syncPrice(2300);
        await flush();
        assert.equal(kpi(h, "市值"), marketCap(2300), "re-rendered after 5s");
        assert.equal(h.body("rating").firstElementChild, ratingNode, "rating table never re-rendered after the first price");

        // 下一次跳動又要再等 5 秒
        h.price.value = 2350;
        h.clock.ms = NOW_MS + PRICE_REFRESH_MS + 1000;
        h.card.syncPrice(2350);
        await flush();
        assert.equal(kpi(h, "市值"), marketCap(2300));
        h.clock.ms = NOW_MS + 2 * PRICE_REFRESH_MS;
        h.card.syncPrice(2350);
        await flush();
        assert.equal(kpi(h, "市值"), marketCap(2350));
        assert.equal(h.body("rating").firstElementChild, ratingNode);
    });

    test("股價未變動或為 null 時不重新渲染", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.resolveAll();
        const node = h.body("finance").firstElementChild;
        h.clock.ms = NOW_MS + 60_000;
        h.card.syncPrice(PRICE);
        h.card.syncPrice(null);
        await flush();
        assert.equal(h.body("finance").firstElementChild, node);
    });

    test("尚未載入 / 已移除時呼叫不會出錯", () => {
        const h = setup();
        h.card.syncPrice(PRICE);
        h.card.load(CTX);
        h.card.remove();
        h.card.syncPrice(PRICE);
        assert.equal(h.card.element, null);
    });
});

// ============================================================================
// applySectionStates
// ============================================================================

describe("InfoCard.applySectionStates", () => {
    test("依傳入的狀態開關區塊並同步 aria-expanded；未指定者回到預設", () => {
        const h = setup();
        h.card.load(CTX);
        const before = h.changed.count;
        h.card.applySectionStates({ basic: false, invest: true, capacity: true });
        for (const def of SECTIONS) {
            const expected = def.id === "basic" ? false : def.id === "invest" || def.id === "capacity" ? true : def.defaultOpen;
            assert.equal(h.body(def.id).hidden, !expected, `${def.id} hidden`);
            assert.equal(h.section(def.id).querySelector(".fi-section__header")?.getAttribute("aria-expanded"), expected ? "true" : "false", def.id);
        }
        assert.ok(h.changed.count > before, "popup notified");

        // 設定頁「重設」：清空 → 全部回到預設
        h.card.applySectionStates({});
        for (const def of SECTIONS) {
            assert.equal(h.body(def.id).hidden, !def.defaultOpen, `${def.id} reset`);
            assert.equal(h.section(def.id).querySelector(".fi-section__header")?.getAttribute("aria-expanded"), def.defaultOpen ? "true" : "false");
        }
    });

    test("資料已載入的區塊內容保留（只切換顯示）", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.resolveAll();
        const content = h.body("capacity").innerHTML;
        h.card.applySectionStates({ capacity: true });
        assert.equal(h.body("capacity").hidden, false);
        assert.equal(h.body("capacity").innerHTML, content);
        assert.equal(h.section("capacity").dataset.state, "ready");
    });

    test("尚未載入時不做事", () => {
        const h = setup();
        assert.doesNotThrow(() => h.card.applySectionStates({ basic: false }));
        assert.equal(h.card.element, null);
    });
});

// ============================================================================
// 焦點管理
// ============================================================================

describe("InfoCard：焦點管理", () => {
    test("cycle-position：卡片被移到新位置（重新掛載）後焦點仍在 ⇄ 按鈕", () => {
        const h = setup({ settings: { position: "left" } });
        h.card.load(CTX);
        assert.equal(h.el().parentElement, h.doc.body);
        const button = h.el().querySelector<HTMLElement>("[data-action='cycle-position']");
        assert.ok(button);
        button.focus();
        assert.equal(h.doc.activeElement, button);

        // 靠左 → 嵌入：元素從 body 移到富果頁首
        h.click("[data-action='cycle-position']");
        assert.equal(h.settings.position, "default");
        assert.equal(h.el().parentElement, h.doc.querySelector(".card-group-header"));
        assert.equal(h.doc.activeElement, button, "focus restored after re-mount");

        // 嵌入 → 靠右：再移回 body
        h.click("[data-action='cycle-position']");
        assert.equal(h.el().parentElement, h.doc.body);
        assert.equal(h.doc.activeElement, button);
    });

    test("cycle-position：點擊前焦點不在按鈕上（滑鼠點擊）也會聚焦到按鈕", () => {
        const h = setup();
        h.card.load(CTX);
        assert.equal(h.doc.activeElement, h.doc.body);
        h.click("[data-action='cycle-position']");
        assert.equal(h.doc.activeElement, h.el().querySelector("[data-action='cycle-position']"));
    });

    test("hide-card：工具列存在時焦點移到工具列的「資訊卡」開關", () => {
        const h = setup();
        const toolbar = h.doc.createElement("div");
        toolbar.id = "fi-toolbar";
        toolbar.innerHTML = '<button type="button" data-action="search">搜尋</button><input type="checkbox" role="switch" data-action="visible" checked>';
        h.doc.querySelector(".card-group-header__upper-left")?.appendChild(toolbar) ?? h.doc.body.appendChild(toolbar);
        h.card.load(CTX);
        h.el().querySelector<HTMLElement>("[data-action='hide-card']")?.focus();

        h.click("[data-action='hide-card']");
        assert.equal(h.settings.visible, false);
        assert.equal(h.el().hidden, true);
        assert.equal(h.doc.activeElement, toolbar.querySelector("input[data-action='visible']"));
    });

    test("hide-card：沒有工具列時仍正常隱藏（不拋錯）", () => {
        const h = setup();
        h.card.load(CTX);
        assert.doesNotThrow(() => h.click("[data-action='hide-card']"));
        assert.equal(h.el().hidden, true);
    });
});

// ============================================================================
// category：對話框開在點擊所在的文件
// ============================================================================

describe("InfoCard：category 動作", () => {
    test("頁面卡片中點擊 → openCategory 收到頁面文件", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.resolveAll();
        h.click(".fi-section[data-section='basic'] [data-action='category'][data-name='晶圓代工']");
        assert.equal(h.categories.length, 1);
        const [type, name, doc] = h.categories[0]!;
        assert.equal(type, "產業");
        assert.equal(name, "晶圓代工");
        assert.equal(doc, h.doc);
    });

    test("彈出視窗中的目標（另一份文件）→ openCategory 收到彈出視窗的文件", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.resolveAll();
        const popup = new JSDOM(`<!doctype html><html><body><div id="fi-card">${h.el().innerHTML}</div></body></html>`);
        try {
            const target = popup.window.document.querySelector<HTMLElement>("[data-action='category'][data-name='晶圓代工']");
            assert.ok(target);
            const event = new popup.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
            h.card.handleAction(target, event as unknown as MouseEvent);
            assert.equal(h.categories.length, 1);
            assert.equal(h.categories[0]?.[2], popup.window.document);
            assert.notEqual(h.categories[0]?.[2], h.doc);
        } finally {
            popup.window.close();
        }
    });

    test("缺少 data-type 或 data-name 時不呼叫", () => {
        const h = setup();
        h.card.load(CTX);
        const target = h.doc.createElement("button");
        target.dataset.action = "category";
        target.dataset.name = "晶圓代工";
        h.card.handleAction(target, new h.env.window.MouseEvent("click"));
        assert.equal(h.categories.length, 0);
    });
});

// ============================================================================
// 摘要：本益比為 0（近四季虧損）不顯示
// ============================================================================

describe("InfoCard：摘要的本益比", () => {
    test("pe.value 為 0 → 摘要與財務指標標題都不顯示本益比", async () => {
        const h = setup();
        h.card.load(CTX);
        const market = DATA.market;
        await h.resolve("market", { ...market, pe: { ...market.pe, value: 0 } });
        await h.resolveAll();
        const labels = summaryLabels(h);
        assert.ok(!labels.includes("本益比"), `labels: ${labels.join(",")}`);
        assert.ok(labels.includes("殖利率"), "dividend yield still shown");
        assert.doesNotMatch(h.section("finance").querySelector("[data-role='meta']")?.textContent ?? "", /PE/);
        assert.equal(kpi(h, "本益比"), "—");
    });

    test("pe.value 為 null → 不顯示；正值 → 顯示", async () => {
        const h = setup();
        h.card.load(CTX);
        const market = DATA.market;
        await h.resolve("market", { ...market, pe: { ...market.pe, value: null } });
        assert.ok(!summaryLabels(h).includes("本益比"));
        h.click("[data-action='refresh']");
        await h.resolve("market");
        assert.ok(summaryLabels(h).includes("本益比"));
    });
});

// ============================================================================
// halt
// ============================================================================

describe("InfoCard.halt", () => {
    test("隱藏仍在載入的區塊、停止轉圈並顯示訊息；之後到達的結果全部丟棄", async () => {
        const h = setup();
        h.card.load(CTX);
        await h.resolve("capacity");
        await h.resolve("major");
        const message = "⚠ 擴充功能已更新，請重新整理頁面以載入新版本";

        h.card.halt(message);
        assert.equal(h.busy(), "false");
        assert.equal(h.status().textContent, message);
        assert.ok(h.status().classList.contains("fi-card__status--warn"));
        assert.equal(h.section("capacity").dataset.state, "ready", "finished sections keep their content");
        assert.equal(h.section("major").dataset.state, "ready");
        for (const def of SECTIONS) {
            if (def.id === "capacity" || def.id === "major") continue;
            const s = h.section(def.id);
            assert.equal(s.dataset.state, "empty", def.id);
            assert.equal(s.getAttribute("aria-busy"), null, def.id);
        }

        await h.resolveAll();
        assert.equal(h.status().textContent, message, "late results do not overwrite the message");
        assert.equal(h.busy(), "false");
        assert.equal(h.section("finance").dataset.state, "empty");
        assert.equal(h.el().querySelectorAll(".fi-section[data-state='ready']").length, 2);
        assert.equal(h.el().querySelector("[data-role='sub']")?.textContent, "", "late basic does not render subtitle");
    });

    test("halt 之後到達的失敗也不會改變狀態列或區塊", async () => {
        const h = setup();
        h.card.load(CTX);
        h.card.halt("stopped");
        for (const name of DATASET_NAMES) await h.reject(name, new Error("late"));
        assert.equal(h.status().textContent, "stopped");
        assert.equal(h.el().querySelectorAll(".fi-section[data-state='error']").length, 0);
    });

    test("尚未載入時 halt 不會出錯", () => {
        const h = setup();
        assert.doesNotThrow(() => h.card.halt("x"));
    });
});
