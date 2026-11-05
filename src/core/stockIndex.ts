/**
 * ============================================================================
 * 📚 股票資料庫索引
 * ============================================================================
 *
 * 將 stock-data.json（約 2,000 檔個股、10,000 筆分類）一次建立成 Map 索引：
 * - 依代碼查個股：O(1)
 * - 依個股查分類：O(1)
 * - 依分類查成員（已依股本排序）：O(1)
 * - 搜尋：線性掃描預先正規化的字串（約 3,000 筆，< 1ms）
 */

import type { CategoryType, RelatedCategory, RelatedGroups, RelatedStock, SearchResults, StockDatabase } from "../shared/types";
import { CATEGORY_TYPES } from "../shared/types";

/**
 * 搜尋用字串正規化：全形轉半形（NFKC）、轉小寫、「臺」視同「台」、去除空白。
 */
export function normalizeSearchText(value: string): string {
    return value.normalize("NFKC").toLowerCase().replace(/臺/g, "台").replace(/\s+/g, "");
}

interface CategoryEntry {
    type: CategoryType;
    name: string;
    key: string;
    normalized: string;
    /** 成員代碼（依股本由大到小） */
    members: string[];
}

interface StockEntry extends RelatedStock {
    normalizedName: string;
}

const categoryKey = (type: CategoryType, name: string): string => `${type}|${name}`;

function isCategoryType(value: unknown): value is CategoryType {
    return value === "概念" || value === "產業" || value === "集團";
}

export class StockIndex {
    private readonly stocks = new Map<string, StockEntry>();
    private readonly categories = new Map<string, CategoryEntry>();
    private readonly stockCategories = new Map<string, Record<CategoryType, string[]>>();
    private readonly categoryList: CategoryEntry[];

    constructor(db: StockDatabase) {
        for (const info of db.basicInfo ?? []) {
            const code = String(info.股票代碼 ?? "").trim();
            const name = String(info.股票名稱 ?? "").trim();
            if (!code || !name || this.stocks.has(code)) continue;
            const capital = typeof info.股本_億元 === "number" && Number.isFinite(info.股本_億元) ? info.股本_億元 : 0;
            this.stocks.set(code, { code, name, capital, normalizedName: normalizeSearchText(name) });
        }

        const memberSets = new Map<string, Set<string>>();
        for (const cat of db.categories ?? []) {
            const code = String(cat.股票代碼 ?? "").trim();
            const name = String(cat.分類名稱 ?? "").trim();
            const type = cat.分類類型;
            if (!code || !name || !isCategoryType(type)) continue;

            const key = categoryKey(type, name);
            if (!this.categories.has(key)) {
                this.categories.set(key, { type, name, key, normalized: normalizeSearchText(name), members: [] });
                memberSets.set(key, new Set());
            }
            memberSets.get(key)?.add(code);

            let byType = this.stockCategories.get(code);
            if (!byType) {
                byType = { 概念: [], 產業: [], 集團: [] };
                this.stockCategories.set(code, byType);
            }
            if (!byType[type].includes(name)) byType[type].push(name);
        }

        // 成員依股本排序；資料庫中查無基本資料的代碼（已下市等）排除
        for (const entry of this.categories.values()) {
            entry.members = [...(memberSets.get(entry.key) ?? [])].filter((c) => this.stocks.has(c)).sort((a, b) => this.capitalOf(b) - this.capitalOf(a) || a.localeCompare(b));
        }
        this.categoryList = [...this.categories.values()].filter((c) => c.members.length > 0);
    }

    get stockCount(): number {
        return this.stocks.size;
    }

    get categoryCount(): number {
        return this.categoryList.length;
    }

    private capitalOf(code: string): number {
        return this.stocks.get(code)?.capital ?? 0;
    }

    private toRelated(code: string): RelatedStock | null {
        const s = this.stocks.get(code);
        return s ? { code: s.code, name: s.name, capital: s.capital } : null;
    }

    /** 查詢個股名稱 */
    getStock(code: string): RelatedStock | null {
        return this.toRelated(code);
    }

    /** 個股所屬的分類名稱 */
    categoriesOf(code: string, type: CategoryType): string[] {
        return [...(this.stockCategories.get(code)?.[type] ?? [])];
    }

    /** 分類的全部成員（依股本排序），可排除指定代碼 */
    members(type: CategoryType, name: string, exclude?: string): RelatedStock[] {
        const entry = this.categories.get(categoryKey(type, name));
        if (!entry) return [];
        const out: RelatedStock[] = [];
        for (const code of entry.members) {
            if (code === exclude) continue;
            const s = this.toRelated(code);
            if (s) out.push(s);
        }
        return out;
    }

    /**
     * 取得個股的相關分類與成員。
     * @param extra API 回傳的分類（與資料庫合併、去重；資料庫查無的分類會被略過）
     * @param limit 每個分類回傳的個股數
     */
    related(stockId: string, extra: Partial<Record<CategoryType, readonly string[]>>, limit: number): RelatedGroups {
        const groups: RelatedGroups = { 概念: [], 產業: [], 集團: [] };
        for (const type of CATEGORY_TYPES) {
            const names = [...new Set([...this.categoriesOf(stockId, type), ...(extra[type] ?? [])])];
            const list: RelatedCategory[] = [];
            for (const name of names) {
                const all = this.members(type, name, stockId);
                if (all.length === 0) continue;
                list.push({ type, name, total: all.length, stocks: all.slice(0, limit) });
            }
            // 成員越少的分類越具代表性，排在前面；同數量依名稱排序
            list.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name, "zh-Hant"));
            groups[type] = list;
        }
        return groups;
    }

    /**
     * 搜尋個股與分類。
     * 排序：完全符合 > 開頭符合 > 包含；同分時個股依股本、分類依成員數由大到小。
     */
    search(query: string, stockLimit: number, categoryLimit: number): SearchResults {
        const q = normalizeSearchText(query);
        if (!q) return { stocks: [], categories: [] };

        const scoredStocks: Array<{ s: StockEntry; score: number }> = [];
        for (const s of this.stocks.values()) {
            const code = s.code.toLowerCase();
            let score = 0;
            if (code === q) score = 100;
            else if (s.normalizedName === q) score = 95;
            else if (code.startsWith(q)) score = 80;
            else if (s.normalizedName.startsWith(q)) score = 70;
            else if (s.normalizedName.includes(q)) score = 40;
            else if (code.includes(q)) score = 30;
            if (score > 0) scoredStocks.push({ s, score });
        }
        scoredStocks.sort((a, b) => b.score - a.score || b.s.capital - a.s.capital || a.s.code.localeCompare(b.s.code));

        const scoredCats: Array<{ c: CategoryEntry; score: number }> = [];
        for (const c of this.categoryList) {
            let score = 0;
            if (c.normalized === q) score = 100;
            else if (c.normalized.startsWith(q)) score = 70;
            else if (c.normalized.includes(q)) score = 40;
            if (score > 0) scoredCats.push({ c, score });
        }
        scoredCats.sort((a, b) => b.score - a.score || b.c.members.length - a.c.members.length || a.c.name.localeCompare(b.c.name, "zh-Hant"));

        return {
            stocks: scoredStocks.slice(0, stockLimit).map(({ s }) => ({ code: s.code, name: s.name, capital: s.capital })),
            categories: scoredCats.slice(0, categoryLimit).map(({ c }) => ({ type: c.type, name: c.name, count: c.members.length })),
        };
    }
}

/** 驗證 JSON 是否為股票資料庫格式 */
export function isStockDatabase(value: unknown): value is StockDatabase {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Partial<StockDatabase>;
    return Array.isArray(v.basicInfo) && Array.isArray(v.categories) && v.basicInfo.length > 0;
}
