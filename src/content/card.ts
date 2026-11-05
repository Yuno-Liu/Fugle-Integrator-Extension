/**
 * ============================================================================
 * 📋 資訊卡
 * ============================================================================
 *
 * 流程：偵測到新個股 → 立即顯示骨架（標題用頁面上的名稱）→ 各區塊資料到達即填入。
 *
 * 📌 每次載入遞增 generation；非同步結果回來時若 generation 已變（使用者已切換股票），
 *    結果直接丟棄，不會把上一檔股票的資料畫到新頁面上。
 * 📌 所有互動透過 data-action 事件委派處理，彈出視窗中的同一份 HTML 也共用這套邏輯。
 */

import type { DatasetMap, DatasetName, Meta } from "../shared/messages";
import type { CardPosition, CategoryType, RelatedGroups, UiSettings } from "../shared/types";
import { FUGLE, LIMITS } from "../shared/constants";
import { CHEVRON, SKELETON, emptyBlock, errorBlock, ratingStats, summaryChips } from "../ui/components";
import type { SummaryItem } from "../ui/components";
import { epochDayMonthsAgo, taipeiParts } from "../core/session";
import { fmtClock, fmtNumber, fmtPercent, trendOf } from "../utils/format";
import { SafeHtml, html } from "../utils/html";
import { errorMessage, log } from "../utils/log";
import { ExtensionContextError } from "./api";
import type { DatasetResponse } from "./api";
import { shouldInterceptClick } from "./navigation";
import type { StockContext } from "./page";
import { SECTIONS } from "./sections";
import type { SectionDef, SectionLoadContext } from "./sections";

export const CARD_ID = "fi-card";

export interface CardDeps {
    getSettings(): UiSettings;
    updateSettings(patch: Partial<UiSettings>): void;
    setSection(id: string, open: boolean): void;
    fetchDataset<K extends DatasetName>(name: K, stockId: string, force: boolean): Promise<DatasetResponse<K>>;
    fetchRelated(stockId: string, extra: Partial<Record<CategoryType, string[]>>, limit: number): Promise<RelatedGroups>;
    readPrice(): number | null;
    navigate(code: string): void;
    /** 開啟分類詳情；doc 為點擊發生的文件（頁面或彈出視窗），對話框會開在同一個視窗 */
    openCategory(type: CategoryType, name: string, doc: Document): void;
    popout(): void;
    /** 卡片內容變更（供彈出視窗同步） */
    changed(): void;
    /** 擴充功能 context 失效 */
    contextLost(): void;
    now(): Date;
}

const POSITION_ORDER: readonly CardPosition[] = ["right", "left", "default"];
const POSITION_LABEL: Record<CardPosition, string> = { right: "靠右", left: "靠左", default: "嵌入" };

/** 載入已被新的載入取代（結果會被丟棄） */
class StaleLoadError extends Error {
    constructor() {
        super("stale");
        this.name = "StaleLoadError";
    }
}

/** 內部產生的 id 只含英數與連字號；其他值一律拒絕（避免組出無效選擇器） */
const isSafeId = (id: string): boolean => /^[A-Za-z][\w-]{0,63}$/.test(id);

/** 盤中股價跳動時，財務指標重新計算的最短間隔 */
const PRICE_REFRESH_MS = 5000;

const timeText = (ms: number): string => fmtClock(new Date(ms));

export class InfoCard {
    private el: HTMLElement | null = null;
    private ctx: StockContext | null = null;
    private generation = 0;
    private force = false;
    private suppressed = false;
    private readonly memo = new Map<DatasetName, Promise<unknown>>();
    private readonly resolved: Partial<{ [K in DatasetName]: DatasetMap[K] }> = {};
    private readonly failed = new Set<DatasetName>();
    private metas: Meta[] = [];
    private sectionErrors = 0;
    /** 尚未完成的區塊數（含重試中的區塊）；歸零時才顯示最終狀態 */
    private pending = 0;
    /** 各「依股價計算」區塊渲染時使用的股價 */
    private readonly priceUsed = new Map<string, number | null>();
    private lastPriceRefresh = 0;
    private resizeObserver: ResizeObserver | null = null;

    constructor(private readonly deps: CardDeps) {}

    get element(): HTMLElement | null {
        return this.el;
    }

    get stockId(): string | null {
        return this.ctx?.stockId ?? null;
    }

    // ------------------------------------------------------------------------
    // 載入與渲染
    // ------------------------------------------------------------------------

    /** 載入（或強制重新載入）指定個股 */
    load(ctx: StockContext, force = false): void {
        const gen = ++this.generation;
        this.ctx = ctx;
        this.force = force;
        this.memo.clear();
        this.failed.clear();
        for (const key of Object.keys(this.resolved) as DatasetName[]) delete this.resolved[key];
        this.metas = [];
        this.sectionErrors = 0;
        this.pending = 0;
        this.priceUsed.clear();

        const el = this.ensureElement();
        el.dataset.stockId = ctx.stockId;
        el.innerHTML = this.shellHtml(ctx).value;
        this.observeHeader();
        this.applySettings();
        this.mount();
        this.setBusy(true);
        this.setStatus("載入中…");

        const loadCtx = this.loadContext(gen);
        for (const def of SECTIONS) this.track(def, gen, loadCtx);
        this.deps.changed();
    }

    /** 執行區塊並計數；所有區塊（含重試）都完成後才顯示最終狀態 */
    private track(def: SectionDef, gen: number, loadCtx: SectionLoadContext): void {
        this.pending++;
        this.setBusy(true);
        void this.runSection(def, gen, loadCtx).finally(() => {
            if (gen !== this.generation) return;
            this.pending--;
            if (this.pending === 0) this.finish();
        });
    }

    /** 富果稍晚才更新名稱 / 市場別時，同步更新標題 */
    updateIdentity(ctx: StockContext): void {
        if (!this.el || !this.ctx || ctx.stockId !== this.ctx.stockId) return;
        this.ctx = ctx;
        const name = this.el.querySelector<HTMLElement>("[data-role='name']");
        const code = this.el.querySelector<HTMLElement>("[data-role='code']");
        const basic = this.resolved.basic;
        if (name && !basic?.shortName && ctx.name) name.textContent = ctx.name;
        if (code) code.textContent = [ctx.stockId, ctx.market].filter(Boolean).join(" · ");
        this.deps.changed();
    }

    private shellHtml(ctx: StockContext): SafeHtml {
        const settings = this.deps.getSettings();
        const sections = SECTIONS.map((def) => {
            const open = settings.sections[def.id] ?? def.defaultOpen;
            return html`<section class="fi-section" data-section="${def.id}" data-state="loading" aria-busy="true"><button type="button" class="fi-section__header" data-action="toggle-section" data-section="${def.id}" aria-expanded="${open ? "true" : "false"}" aria-controls="fi-sec-${def.id}"><span class="fi-section__icon" aria-hidden="true">${def.icon}</span><span class="fi-section__title">${def.title}</span><span class="fi-section__meta" data-role="meta"></span>${CHEVRON}</button><div class="fi-section__body" id="fi-sec-${def.id}" role="region" aria-label="${def.title}"${open ? "" : new SafeHtml(" hidden")}>${SKELETON}</div></section>`;
        });
        return html`<div class="fi-card__header" data-role="header"><div class="fi-card__top"><div class="fi-card__titles" data-action="toggle-card" title="點擊收合 / 展開"><div class="fi-card__name"><span class="fi-card__name-text" data-role="name">${ctx.name || ctx.stockId}</span><span class="fi-card__code" data-role="code">${[ctx.stockId, ctx.market].filter(Boolean).join(" · ")}</span></div><div class="fi-card__sub" data-role="sub"></div></div><div class="fi-card__actions"><button type="button" class="fi-icon-btn" data-action="refresh" title="重新整理（略過快取）" aria-label="重新整理"><span class="fi-spin" aria-hidden="true">⟳</span></button><button type="button" class="fi-icon-btn" data-action="cycle-position" data-role="position" title="切換位置" aria-label="切換資訊卡位置">⇄</button><button type="button" class="fi-icon-btn" data-action="popout" title="在獨立視窗開啟" aria-label="在獨立視窗開啟">❐</button><button type="button" class="fi-icon-btn" data-action="toggle-card" data-role="collapse" aria-expanded="true" title="收合" aria-label="收合資訊卡">▴</button><button type="button" class="fi-icon-btn" data-action="hide-card" title="隱藏資訊卡（可用工具列的「資訊卡」開關重新顯示）" aria-label="隱藏資訊卡">✕</button></div></div><div class="fi-card__status" role="status" aria-live="polite" data-role="status"></div><div class="fi-summary" data-role="summary"></div></div><div class="fi-card__body" data-role="body">${sections}</div>`;
    }

    private loadContext(gen: number): SectionLoadContext {
        const stockId = this.ctx?.stockId ?? "";
        return {
            stockId,
            data: <K extends DatasetName>(name: K) => this.data(name, gen),
            related: (extra) => this.deps.fetchRelated(stockId, extra, LIMITS.relatedPerCategory),
            price: () => this.deps.readPrice(),
            now: () => this.deps.now(),
        };
    }

    /** 取得資料集（同一次載入中共用同一個請求） */
    private data<K extends DatasetName>(name: K, gen: number): Promise<DatasetMap[K]> {
        // 已切換到其他股票（或已停止）：不再為舊的載入發出請求
        if (gen !== this.generation) return Promise.reject(new StaleLoadError());
        let pending = this.memo.get(name) as Promise<DatasetMap[K]> | undefined;
        if (!pending) {
            const stockId = this.ctx?.stockId ?? "";
            pending = this.deps.fetchDataset(name, stockId, this.force).then(
                (res) => {
                    if (gen === this.generation) {
                        (this.resolved as Record<string, unknown>)[name] = res.data;
                        this.metas.push(res.meta);
                        this.renderSummary();
                        if (name === "basic") this.renderSubtitle();
                    }
                    return res.data;
                },
                (error: unknown) => {
                    if (gen === this.generation) this.failed.add(name);
                    throw error;
                }
            );
            this.memo.set(name, pending);
        }
        return pending;
    }

    private async runSection(def: SectionDef, gen: number, loadCtx: SectionLoadContext): Promise<void> {
        let state: "ready" | "empty" | "error" = "ready";
        let body: SafeHtml | null = null;
        let meta = "";
        try {
            const view = await def.load(loadCtx);
            if (gen !== this.generation) return;
            meta = view.meta ?? "";
            if (view.content) body = view.content;
            else if (def.emptyText) body = emptyBlock(def.emptyText);
            else state = "empty";
        } catch (error) {
            if (gen !== this.generation) return;
            if (error instanceof ExtensionContextError) {
                this.deps.contextLost();
                return;
            }
            log.debug(`section ${def.id} failed`, error);
            state = "error";
            this.sectionErrors++;
            body = errorBlock(errorMessage(error), def.id);
        }
        const section = this.section(def.id);
        if (!section) return;
        section.dataset.state = state;
        section.removeAttribute("aria-busy");
        const bodyEl = section.querySelector<HTMLElement>(".fi-section__body");
        if (bodyEl) bodyEl.innerHTML = body ? body.value : "";
        const metaEl = section.querySelector<HTMLElement>("[data-role='meta']");
        if (metaEl) metaEl.textContent = meta;
        if (def.usesPrice && state === "ready") this.priceUsed.set(def.id, loadCtx.price());
        this.deps.changed();
    }

    /**
     * 股價出現或變動時，重新渲染依股價計算的區塊（市值、目標價潛在空間），不重新抓資料。
     * 📌 富果切換個股時代碼常比股價先出現：區塊若在股價出現前完成，市值會暫時是「—」。
     * 📌 盤中股價持續跳動：財務指標最多每 5 秒更新一次；評等表格含展開狀態，只在股價首次出現時更新。
     */
    syncPrice(price: number | null): void {
        if (price === null || !this.el) return;
        const gen = this.generation;
        const now = this.deps.now().getTime();
        let rerendered = false;
        for (const def of SECTIONS) {
            if (!def.usesPrice || !this.priceUsed.has(def.id)) continue;
            const used = this.priceUsed.get(def.id) ?? null;
            if (used === price) continue;
            if (used !== null && (def.id === "rating" || now - this.lastPriceRefresh < PRICE_REFRESH_MS)) continue;
            this.priceUsed.delete(def.id);
            void this.runSection(def, gen, this.loadContext(gen));
            rerendered = true;
        }
        if (rerendered) {
            this.lastPriceRefresh = now;
            this.renderSummary();
        }
    }

    /** 套用各區塊的展開狀態（例如設定頁「重設」或其他分頁的變更） */
    applySectionStates(sections: Record<string, boolean>): void {
        if (!this.el) return;
        for (const def of SECTIONS) {
            const section = this.section(def.id);
            const header = section?.querySelector<HTMLElement>(".fi-section__header");
            const body = section?.querySelector<HTMLElement>(".fi-section__body");
            if (!header || !body) continue;
            const open = sections[def.id] ?? def.defaultOpen;
            if (body.hidden !== open) continue;
            body.hidden = !open;
            header.setAttribute("aria-expanded", open ? "true" : "false");
        }
        this.deps.changed();
    }

    /** 重新載入單一區塊（只重抓失敗的資料集） */
    private retrySection(id: string): void {
        const def = SECTIONS.find((s) => s.id === id);
        const section = this.section(id);
        if (!def || !section || !this.ctx) return;
        for (const name of this.failed) this.memo.delete(name);
        this.failed.clear();
        if (section.dataset.state === "error" && this.sectionErrors > 0) this.sectionErrors--;
        section.dataset.state = "loading";
        section.setAttribute("aria-busy", "true");
        const bodyEl = section.querySelector<HTMLElement>(".fi-section__body");
        if (bodyEl) bodyEl.innerHTML = SKELETON.value;
        const gen = this.generation;
        this.track(def, gen, this.loadContext(gen));
        this.deps.changed();
    }

    private finish(): void {
        this.setBusy(false);
        if (this.metas.length === 0) {
            this.setStatus(this.sectionErrors > 0 ? "⚠ 資料載入失敗，可點區塊內的「重試」" : "", this.sectionErrors > 0);
            return;
        }
        const oldest = Math.min(...this.metas.map((m) => m.fetchedAt));
        const stale = this.metas.some((m) => m.stale);
        const age = this.deps.now().getTime() - oldest;
        const parts: string[] = [];
        if (stale) parts.push(`⚠ 網路異常，顯示離線快取（${timeText(oldest)}）`);
        else if (age > 60_000) parts.push(`快取資料 · 取得於 ${timeText(oldest)}`);
        else parts.push(`更新於 ${timeText(oldest)}`);
        if (this.sectionErrors > 0) parts.push(`${this.sectionErrors} 個區塊載入失敗`);
        this.setStatus(parts.join(" · "), stale || this.sectionErrors > 0);
    }

    private renderSubtitle(): void {
        const sub = this.el?.querySelector<HTMLElement>("[data-role='sub']");
        const basic = this.resolved.basic;
        if (!sub || !basic) return;
        sub.innerHTML = html`${basic.fullName ? html`<span>${basic.fullName}</span>` : null}${basic.listedDate ? html`<span>上市櫃 ${basic.listedDate}</span>` : null}`.value;
        const name = this.el?.querySelector<HTMLElement>("[data-role='name']");
        if (name && basic.shortName) name.textContent = basic.shortName;
    }

    /** 標題列的重點摘要（資料陸續到達時更新） */
    private renderSummary(): void {
        const summary = this.el?.querySelector<HTMLElement>("[data-role='summary']");
        if (!summary) return;
        const items: SummaryItem[] = [];
        const major = this.resolved.major?.periods[0];
        if (major) items.push({ label: "主1", value: fmtPercent(major.ratio, 2, true), tone: trendOf(major.ratio), section: "major", title: "主力買賣超占成交量（1 日）" });
        const market = this.resolved.market;
        if (market?.trust) items.push({ label: "投信", value: `連${market.trust.direction === "buy" ? "買" : "賣"}${market.trust.days}`, tone: market.trust.direction === "buy" ? "up" : "down", section: "continuous", title: "投信連續買賣超天數" });
        if (market?.foreign) items.push({ label: "外資", value: `連${market.foreign.direction === "buy" ? "買" : "賣"}${market.foreign.days}`, tone: market.foreign.direction === "buy" ? "up" : "down", section: "continuous", title: "外資連續買賣超天數" });
        // 本益比為 0 代表近四季虧損、不適用，不放進摘要
        if (market && market.pe.value !== null && market.pe.value > 0) items.push({ label: "本益比", value: fmtNumber(market.pe.value, 2), tone: "flat", section: "finance", title: "本益比（近四季）" });
        if (market && market.dividendYield.value !== null) items.push({ label: "殖利率", value: fmtPercent(market.dividendYield.value, 2), tone: "flat", section: "finance", title: "現金殖利率" });
        const ratings = this.resolved.ratings;
        const price = this.deps.readPrice();
        if (ratings && price) {
            const stats = ratingStats(ratings, epochDayMonthsAgo(taipeiParts(this.deps.now()), LIMITS.ratingMonths));
            if (stats.avg !== null) {
                const up = ((stats.avg - price) / price) * 100;
                items.push({ label: "目標均價", value: fmtPercent(up, 1, true), tone: trendOf(up), section: "rating", title: `近 ${LIMITS.ratingMonths} 個月平均目標價 ${fmtNumber(stats.avg, 2)}（${stats.count} 筆）相對現價` });
            }
        }
        summary.innerHTML = summaryChips(items).value;
    }

    // ------------------------------------------------------------------------
    // 版面與狀態
    // ------------------------------------------------------------------------

    private ensureElement(): HTMLElement {
        if (this.el) return this.el;
        const el = document.createElement("div");
        el.id = CARD_ID;
        el.className = "fi-root";
        el.setAttribute("role", "complementary");
        el.setAttribute("aria-label", "富果整合器資訊卡");
        el.addEventListener("click", (event) => this.handleClick(event));
        this.el = el;
        return el;
    }

    /** 依設定把卡片放到正確位置（嵌入富果頁首或浮動於 body） */
    mount(doc: Document = document): void {
        if (!this.el) return;
        const position = this.deps.getSettings().position;
        if (position === "default") {
            const header = doc.querySelector(FUGLE.header);
            if (header && this.el.parentElement !== header) header.appendChild(this.el);
        } else if (this.el.parentElement !== doc.body) {
            doc.body.appendChild(this.el);
        }
    }

    /** 富果重新渲染頁首時，卡片可能被移除：重新掛上（不重新載入資料） */
    ensureMounted(): void {
        if (this.el && this.ctx && !this.el.isConnected) this.mount();
    }

    /** 套用位置、顯示、收合等設定 */
    applySettings(settings: UiSettings = this.deps.getSettings()): void {
        const el = this.el;
        if (!el) return;
        const floating = settings.position !== "default";
        el.classList.toggle("fi-card--floating", floating);
        el.classList.toggle("fi-card--right", settings.position === "right");
        el.classList.toggle("fi-card--left", settings.position === "left");
        el.hidden = !settings.visible || this.suppressed;

        const body = el.querySelector<HTMLElement>("[data-role='body']");
        if (body) body.hidden = settings.collapsed;
        const collapse = el.querySelector<HTMLElement>("[data-role='collapse']");
        if (collapse) {
            collapse.textContent = settings.collapsed ? "▾" : "▴";
            collapse.setAttribute("aria-expanded", settings.collapsed ? "false" : "true");
            collapse.title = settings.collapsed ? "展開" : "收合";
            collapse.setAttribute("aria-label", settings.collapsed ? "展開資訊卡" : "收合資訊卡");
        }
        const position = el.querySelector<HTMLElement>("[data-role='position']");
        if (position) position.title = `切換位置（目前：${POSITION_LABEL[settings.position]}）`;
        this.mount();
    }

    /**
     * 停止所有進行中的載入並保留畫面（例如擴充功能已更新、context 失效）。
     * 尚未完成的區塊改為隱藏，狀態列顯示 message，之後的非同步結果都會被丟棄。
     */
    halt(message: string): void {
        this.generation++;
        this.setBusy(false);
        this.el?.querySelectorAll<HTMLElement>('.fi-section[data-state="loading"]').forEach((section) => {
            section.dataset.state = "empty";
            section.removeAttribute("aria-busy");
        });
        this.setStatus(message, true);
    }

    /** 彈出視窗開啟時隱藏頁面上的卡片，避免同一份資訊出現兩次 */
    setSuppressed(suppressed: boolean): void {
        if (this.suppressed === suppressed) return;
        this.suppressed = suppressed;
        this.applySettings();
    }

    /** 顯示擴充功能已更新等全域訊息 */
    setStatus(text: string, warn = false): void {
        const status = this.el?.querySelector<HTMLElement>("[data-role='status']");
        if (!status) return;
        status.textContent = text;
        status.classList.toggle("fi-card__status--warn", warn);
        this.deps.changed();
    }

    private setBusy(busy: boolean): void {
        this.el?.querySelector("[data-action='refresh']")?.setAttribute("aria-busy", busy ? "true" : "false");
    }

    private section(id: string): HTMLElement | null {
        return isSafeId(id) ? (this.el?.querySelector<HTMLElement>(`.fi-section[data-section="${id}"]`) ?? null) : null;
    }

    private byId(id: string): HTMLElement | null {
        return isSafeId(id) ? (this.el?.querySelector<HTMLElement>(`#${id}`) ?? null) : null;
    }

    private observeHeader(): void {
        if (typeof ResizeObserver === "undefined" || !this.el) return;
        this.resizeObserver?.disconnect();
        const header = this.el.querySelector<HTMLElement>("[data-role='header']");
        if (!header) return;
        this.resizeObserver = new ResizeObserver(() => {
            this.el?.style.setProperty("--fi-header-h", `${Math.ceil(header.getBoundingClientRect().height)}px`);
        });
        this.resizeObserver.observe(header);
    }

    remove(): void {
        this.generation++;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.el?.remove();
        this.el = null;
        this.ctx = null;
        this.deps.changed();
    }

    // ------------------------------------------------------------------------
    // 互動（事件委派；彈出視窗的點擊也會轉到這裡）
    // ------------------------------------------------------------------------

    private handleClick(event: MouseEvent): void {
        const target = (event.target as Element | null)?.closest<HTMLElement>("[data-action], a[data-fi-nav]");
        if (target) this.handleAction(target, event);
    }

    /**
     * 處理互動。target 可能位於彈出視窗中，因此一律以屬性找出本頁卡片中對應的元素。
     */
    handleAction(target: HTMLElement, event: MouseEvent): void {
        if (target.matches("a[data-fi-nav]")) {
            if (!shouldInterceptClick(event)) return;
            event.preventDefault();
            this.deps.navigate(target.dataset.fiNav ?? "");
            return;
        }
        const settings = this.deps.getSettings();
        switch (target.dataset.action) {
            case "toggle-card":
                this.deps.updateSettings({ collapsed: !settings.collapsed });
                break;
            case "toggle-section": {
                const id = target.dataset.section ?? "";
                const section = this.section(id);
                const header = section?.querySelector<HTMLElement>(".fi-section__header");
                const body = section?.querySelector<HTMLElement>(".fi-section__body");
                if (!header || !body) return;
                const open = body.hidden;
                body.hidden = !open;
                header.setAttribute("aria-expanded", open ? "true" : "false");
                this.deps.setSection(id, open);
                break;
            }
            case "expand": {
                const id = target.dataset.target ?? "";
                const panel = this.byId(id);
                const button = panel ? this.el?.querySelector<HTMLElement>(`[data-action="expand"][data-target="${id}"]`) : null;
                if (!panel || !button) return;
                const open = panel.hidden;
                panel.hidden = !open;
                button.dataset.label ??= button.textContent ?? "";
                button.textContent = open ? "收合" : button.dataset.label;
                button.setAttribute("aria-expanded", open ? "true" : "false");
                break;
            }
            case "toggle-cat": {
                const id = target.getAttribute("aria-controls") ?? "";
                const body = this.byId(id);
                const head = body ? this.el?.querySelector<HTMLElement>(`[aria-controls="${id}"]`) : null;
                if (!body || !head) return;
                body.hidden = !body.hidden;
                head.setAttribute("aria-expanded", body.hidden ? "false" : "true");
                break;
            }
            case "category":
                if (target.dataset.type && target.dataset.name) this.deps.openCategory(target.dataset.type as CategoryType, target.dataset.name, target.ownerDocument);
                return;
            case "retry":
                this.retrySection(target.dataset.section ?? "");
                return;
            case "refresh":
                if (this.ctx) this.load(this.ctx, true);
                return;
            case "cycle-position": {
                const next = POSITION_ORDER[(POSITION_ORDER.indexOf(settings.position) + 1) % POSITION_ORDER.length] ?? "right";
                this.deps.updateSettings({ position: next });
                // 卡片被移到新位置（DOM 重新掛載）後焦點會遺失：放回同一個按鈕
                this.el?.querySelector<HTMLElement>("[data-action='cycle-position']")?.focus({ preventScroll: true });
                return;
            }
            case "popout":
                this.deps.popout();
                return;
            case "hide-card":
                this.deps.updateSettings({ visible: false });
                // 卡片隱藏後，把焦點移到工具列的「資訊卡」開關，鍵盤使用者可直接重新開啟
                target.ownerDocument.querySelector<HTMLElement>("#fi-toolbar input[data-action='visible']")?.focus({ preventScroll: true });
                return;
            case "goto":
                this.goto(target.dataset.section ?? "");
                return;
            default:
                return;
        }
        this.deps.changed();
    }

    /** 從摘要跳到對應區塊：自動展開卡片與區塊並捲動 */
    private goto(id: string): void {
        const settings = this.deps.getSettings();
        if (settings.collapsed) this.deps.updateSettings({ collapsed: false });
        const section = this.section(id);
        if (!section || !this.el) return;
        const body = section.querySelector<HTMLElement>(".fi-section__body");
        const header = section.querySelector<HTMLElement>(".fi-section__header");
        if (body?.hidden && header) {
            body.hidden = false;
            header.setAttribute("aria-expanded", "true");
            this.deps.setSection(id, true);
        }
        if (this.el.classList.contains("fi-card--floating")) {
            const headerHeight = this.el.querySelector<HTMLElement>("[data-role='header']")?.offsetHeight ?? 0;
            this.el.scrollTo({ top: Math.max(0, section.offsetTop - headerHeight), behavior: "smooth" });
        } else {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        header?.focus({ preventScroll: true });
        this.deps.changed();
    }
}
