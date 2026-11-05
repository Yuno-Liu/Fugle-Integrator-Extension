/**
 * ============================================================================
 * 🔍 搜尋視窗：個股 / 概念 / 產業 / 集團
 * ============================================================================
 *
 * - 輸入防抖 120ms，由 background 的資料庫索引排序（完全符合 > 開頭符合 > 包含）
 * - ↑ / ↓ 選擇、Enter 開啟、Esc 關閉；滑鼠中鍵可在新分頁開啟個股
 * - 分類詳情可再篩選，返回時保留先前的搜尋結果與捲動位置
 */

import type { CategoryType, RelatedStock, SearchResults } from "../shared/types";
import { stockPath } from "../shared/constants";
import { normalizeSearchText } from "../core/stockIndex";
import { fmtNumber } from "../utils/format";
import { SafeHtml, html } from "../utils/html";
import { debounce } from "../utils/timing";
import { errorMessage } from "../utils/log";
import { query } from "./api";
import { isImeComposing, openModal } from "./modal";
import type { ModalHandle } from "./modal";
import { shouldInterceptClick } from "./navigation";

export interface SearchDeps {
    currentStockId: () => string | null;
    navigate: (code: string) => void;
}

const MODAL_ID = "fi-search-modal";
const RECENT_KEY = "fi.recentSearches";
const RECENT_LIMIT = 8;

/** 以原字串標示符合的片段（比對使用與索引相同的正規化） */
export function highlight(text: string, query: string): SafeHtml {
    const q = normalizeSearchText(query);
    if (!q) return html`${text}`;
    const normalized = text.normalize("NFKC").toLowerCase().replace(/臺/g, "台");
    // 只有在正規化不改變長度時，索引才能對應回原字串
    if (normalized.length !== text.length) return html`${text}`;
    const at = normalized.replace(/\s/g, " ").indexOf(q);
    if (at < 0) return html`${text}`;
    return html`${text.slice(0, at)}<mark class="fi-mark">${text.slice(at, at + q.length)}</mark>${text.slice(at + q.length)}`;
}

async function loadRecent(): Promise<string[]> {
    try {
        const stored = await chrome.storage.local.get(RECENT_KEY);
        const list = stored[RECENT_KEY];
        return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string").slice(0, RECENT_LIMIT) : [];
    } catch {
        return [];
    }
}

async function saveRecent(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return;
    try {
        const list = (await loadRecent()).filter((v) => v !== q);
        await chrome.storage.local.set({ [RECENT_KEY]: [q, ...list].slice(0, RECENT_LIMIT) });
    } catch {
        // 忽略
    }
}

export function openSearch(deps: SearchDeps, initialCategory?: { type: CategoryType; name: string }, doc: Document = document): ModalHandle {
    let requestSeq = 0;
    let activeIndex = -1;
    let lastQuery = "";
    let savedResults: { html: string; scroll: number; active: number } | null = null;

    const modal = openModal({ id: MODAL_ID, title: "🔍 搜尋個股 / 概念 / 產業 / 集團", onClose: () => search.cancel(), doc });
    modal.body.innerHTML = html`<div class="fi-search__field"><input type="search" class="fi-search__input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="fi-search-results" aria-label="搜尋關鍵字" placeholder="股票代號、名稱，或 AI、散熱、台積電集團…" autocomplete="off" spellcheck="false"><span class="fi-search__hint">Esc 關閉</span></div><div class="fi-search__results" id="fi-search-results" role="listbox" aria-label="搜尋結果"></div>`.value;

    const input = modal.body.querySelector<HTMLInputElement>(".fi-search__input") as HTMLInputElement;
    const results = modal.body.querySelector<HTMLElement>("#fi-search-results") as HTMLElement;

    const options = (): HTMLElement[] => [...results.querySelectorAll<HTMLElement>('[role="option"]')];

    const setActive = (index: number, scroll = true): void => {
        const list = options();
        if (list.length === 0) {
            activeIndex = -1;
            input.removeAttribute("aria-activedescendant");
            return;
        }
        activeIndex = (index + list.length) % list.length;
        list.forEach((el, i) => el.setAttribute("aria-selected", i === activeIndex ? "true" : "false"));
        const active = list[activeIndex] as HTMLElement;
        input.setAttribute("aria-activedescendant", active.id);
        if (scroll) active.scrollIntoView({ block: "nearest" });
    };

    const renderIdle = async (): Promise<void> => {
        const recent = await loadRecent();
        if (input.value.trim()) return; // 使用者已開始輸入
        results.innerHTML = html`<div class="fi-search__empty">輸入股票代號（2330）、名稱（台積電），或概念 / 產業 / 集團關鍵字（AI、散熱、台積電集團）。${
            recent.length
                ? html`<div class="fi-search__group">最近搜尋</div><div class="fi-chips">${recent.map((q) => html`<button type="button" class="fi-chip" data-recent="${q}">${q}</button>`)}</div>`
                : null
        }</div>`.value;
        input.setAttribute("aria-expanded", "false");
        activeIndex = -1;
    };

    const renderResults = (data: SearchResults, query: string): void => {
        if (data.stocks.length === 0 && data.categories.length === 0) {
            results.innerHTML = html`<div class="fi-search__empty">找不到「${query}」的相關結果。<br>試試股票代號、名稱，或「AI」「散熱」等概念關鍵字。</div>`.value;
            input.setAttribute("aria-expanded", "false");
            activeIndex = -1;
            return;
        }
        let n = 0;
        const self = deps.currentStockId();
        const stockItems = data.stocks.map(
            (s) =>
                html`<a role="option" id="fi-opt-${n++}" aria-selected="false" class="fi-search__item" href="${stockPath(s.code)}" data-kind="stock" data-code="${s.code}"><span class="fi-tag fi-tag--stock">個股</span><span class="fi-search__name">${highlight(s.name, query)} <span class="fi-muted">${highlight(s.code, query)}</span></span><span class="fi-search__meta">${s.code === self ? "目前 · " : ""}股本 ${fmtNumber(s.capital, s.capital >= 100 ? 0 : 1)} 億</span></a>`
        );
        const byType: Record<CategoryType, typeof data.categories> = { 概念: [], 產業: [], 集團: [] };
        data.categories.forEach((c) => byType[c.type].push(c));
        const groups = (["產業", "概念", "集團"] as const)
            .filter((t) => byType[t].length > 0)
            .map(
                (t) =>
                    html`<div class="fi-search__group">${t} · ${byType[t].length}</div>${byType[t].map(
                        (c) =>
                            html`<button type="button" role="option" id="fi-opt-${n++}" aria-selected="false" class="fi-search__item" data-kind="category" data-type="${c.type}" data-name="${c.name}"><span class="fi-tag fi-tag--${c.type}">${c.type}</span><span class="fi-search__name">${highlight(c.name, query)}</span><span class="fi-search__meta">${c.count} 檔 ›</span></button>`
                    )}`
            );
        results.innerHTML = html`${stockItems.length ? html`<div class="fi-search__group">個股 · ${stockItems.length}</div>${stockItems}` : null}${groups}`.value;
        input.setAttribute("aria-expanded", "true");
        setActive(0, false);
    };

    /** 目前畫面上的結果所對應的查詢字串（null 表示畫面上不是這次輸入的結果） */
    let renderedQuery: string | null = null;

    /** 執行搜尋並渲染；回傳結果是否為最新且已顯示 */
    const runSearch = async (text: string): Promise<boolean> => {
        const seq = ++requestSeq;
        try {
            const data = await query({ type: "search", query: text });
            if (seq !== requestSeq || !modal.root.isConnected) return false;
            renderResults(data, text);
            renderedQuery = text;
            return true;
        } catch (error) {
            if (seq !== requestSeq || !modal.root.isConnected) return false;
            results.innerHTML = html`<div class="fi-error" role="alert">搜尋失敗：${errorMessage(error)}</div>`.value;
            renderedQuery = null;
            return false;
        }
    };

    const search = debounce((text: string) => void runSearch(text), 120);

    const showCategory = async (type: CategoryType, name: string, fromResults: boolean): Promise<void> => {
        if (fromResults) savedResults = { html: results.innerHTML, scroll: modal.body.scrollTop, active: activeIndex };
        const seq = ++requestSeq;
        results.innerHTML = html`<div class="fi-skel"><span></span><span></span><span></span></div>`.value;
        let stocks: RelatedStock[];
        try {
            stocks = await query({ type: "category", categoryType: type, name });
        } catch (error) {
            if (seq === requestSeq) results.innerHTML = html`<div class="fi-error" role="alert">載入失敗：${errorMessage(error)}</div>`.value;
            return;
        }
        if (seq !== requestSeq || !modal.root.isConnected) return;
        const self = deps.currentStockId();
        const back = savedResults ? html`<button type="button" class="fi-link-btn" data-back>← 返回</button>` : null;
        results.innerHTML = html`<div class="fi-search__crumb">${back}<span class="fi-tag fi-tag--${type}">${type}</span><strong>${name}</strong><span class="fi-muted">（${stocks.length} 檔）</span></div><input type="search" class="fi-search__input" data-filter placeholder="在此分類中篩選代號或名稱…" aria-label="篩選分類個股" style="height:34px;font-size:13px;margin-bottom:8px"><div class="fi-search__grid">${stocks.map(
            (s) =>
                html`<a class="fi-chip${s.code === self ? " fi-chip--self" : ""}" href="${stockPath(s.code)}" data-kind="stock" data-code="${s.code}" data-filter-text="${normalizeSearchText(`${s.code}${s.name}`)}" title="${`股本 ${fmtNumber(s.capital, 1)} 億`}">${s.name}<span class="fi-chip__sub">${s.code}${s.code === self ? " · 目前" : ""}</span></a>`
        )}</div>`.value;
        input.setAttribute("aria-expanded", "false");
        activeIndex = -1;
        results.querySelector<HTMLInputElement>("[data-filter]")?.focus();
    };

    const activate = (el: HTMLElement): void => {
        if (el.dataset.kind === "stock" && el.dataset.code) {
            void saveRecent(lastQuery);
            modal.close();
            deps.navigate(el.dataset.code);
        } else if (el.dataset.kind === "category" && el.dataset.type && el.dataset.name) {
            void saveRecent(lastQuery);
            void showCategory(el.dataset.type as CategoryType, el.dataset.name, true);
        }
    };

    input.addEventListener("input", () => {
        lastQuery = input.value;
        savedResults = null;
        if (!input.value.trim()) {
            search.cancel();
            requestSeq++;
            renderedQuery = null;
            void renderIdle();
            return;
        }
        search(input.value.trim());
    });

    input.addEventListener("keydown", (event) => {
        // 注音 / 拼音選字時的 Enter、方向鍵屬於輸入法，不是搜尋指令
        if (isImeComposing(event)) return;
        const count = options().length;
        if (event.key === "ArrowDown" && count) {
            event.preventDefault();
            setActive(activeIndex + 1);
        } else if (event.key === "ArrowUp" && count) {
            event.preventDefault();
            setActive(activeIndex - 1);
        } else if (event.key === "Enter") {
            event.preventDefault();
            const text = input.value.trim();
            if (text && text !== renderedQuery) {
                // 輸入後立刻按 Enter：畫面上還是舊查詢的結果，改為立即查詢並開啟新結果的第一筆
                search.cancel();
                void runSearch(text).then((ok) => {
                    // 等待結果期間又改了輸入：以新的輸入為準，不開啟這次的結果
                    if (!ok || input.value.trim() !== text) return;
                    const first = options()[0];
                    if (first) activate(first);
                });
                return;
            }
            const target = options()[activeIndex];
            if (target) activate(target);
        }
    });

    results.addEventListener("input", (event) => {
        // 可能位於彈出視窗（不同 window），不能用 instanceof 判斷
        const filter = event.target as Element | null;
        if (!filter?.matches?.("input[data-filter]")) return;
        const q = normalizeSearchText((filter as HTMLInputElement).value);
        results.querySelectorAll<HTMLElement>("[data-filter-text]").forEach((el) => {
            el.hidden = q !== "" && !(el.dataset.filterText ?? "").includes(q);
        });
    });

    results.addEventListener("mousemove", (event) => {
        const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
        if (!option) return;
        const index = options().indexOf(option);
        if (index >= 0 && index !== activeIndex) setActive(index, false);
    });

    results.addEventListener("click", (event) => {
        const target = event.target as Element;
        if (target.closest("[data-back]") && savedResults) {
            results.innerHTML = savedResults.html;
            modal.body.scrollTop = savedResults.scroll;
            setActive(savedResults.active, false);
            savedResults = null;
            input.focus();
            return;
        }
        const recent = target.closest<HTMLElement>("[data-recent]");
        if (recent?.dataset.recent) {
            input.value = recent.dataset.recent;
            input.dispatchEvent(new (doc.defaultView?.Event ?? Event)("input"));
            input.focus();
            return;
        }
        const item = target.closest<HTMLElement>("[data-kind]");
        if (!item) return;
        if (item.tagName === "A" && !shouldInterceptClick(event as MouseEvent)) return; // 新分頁開啟
        event.preventDefault();
        activate(item);
    });

    if (initialCategory) {
        void showCategory(initialCategory.type, initialCategory.name, false);
    } else {
        void renderIdle();
        setTimeout(() => input.focus(), 0);
    }
    return modal;
}
