/**
 * ============================================================================
 * 🧩 資訊卡區塊定義
 * ============================================================================
 *
 * 每個區塊獨立載入、獨立顯示（不必等全部資料到齊），失敗時可單獨重試。
 * 區塊 id 與預設展開狀態沿用舊版，使用者先前的折疊偏好會被保留。
 */

import type { DatasetMap, DatasetName } from "../shared/messages";
import type { CategoryType, RelatedGroups } from "../shared/types";
import { LIMITS } from "../shared/constants";
import { epochDayMonthsAgo, taipeiParts } from "../core/session";
import { basicContent, capacityContent, continuousContent, continuousMeta, etfContent, etfUnavailable, financeContent, investContent, majorContent, majorMeta, ratingContent, ratingMeta, relatedContent, relationContent, relationMeta } from "../ui/components";
import type { SafeHtml } from "../utils/html";
import { fmtPercent } from "../utils/format";
import { ApiError } from "./api";

export interface SectionLoadContext {
    stockId: string;
    data<K extends DatasetName>(name: K): Promise<DatasetMap[K]>;
    related(extra: Partial<Record<CategoryType, string[]>>): Promise<RelatedGroups>;
    /** 目前股價（即時從頁面讀取） */
    price(): number | null;
    now(): Date;
}

export interface SectionView {
    content: SafeHtml | null;
    meta?: string;
}

export interface SectionDef {
    id: string;
    title: string;
    icon: string;
    defaultOpen: boolean;
    /** 無資料時的提示；未設定則整個區塊隱藏 */
    emptyText?: string;
    /** 內容依目前股價計算（股價出現或變動時會重新渲染） */
    usesPrice?: boolean;
    load(c: SectionLoadContext): Promise<SectionView>;
}

/** 等待多個 Promise：回傳成功值（失敗為 undefined）；全部失敗時拋出第一個錯誤 */
export async function settleAll<T extends readonly unknown[]>(promises: { [K in keyof T]: Promise<T[K]> }): Promise<{ [K in keyof T]: T[K] | undefined }> {
    const settled = await Promise.allSettled(promises as readonly Promise<unknown>[]);
    if (settled.length > 0 && settled.every((s) => s.status === "rejected")) {
        throw (settled[0] as PromiseRejectedResult).reason;
    }
    return settled.map((s) => (s.status === "fulfilled" ? s.value : undefined)) as { [K in keyof T]: T[K] | undefined };
}

const ratingCutoff = (now: Date): number => epochDayMonthsAgo(taipeiParts(now), LIMITS.ratingMonths);

export const SECTIONS: readonly SectionDef[] = [
    {
        id: "basic",
        title: "基本資料",
        icon: "📝",
        defaultOpen: true,
        async load(c) {
            const [basic, industry, concept] = await settleAll([c.data("basic"), c.data("industry"), c.data("concept")] as const);
            return { content: basicContent(basic ?? null, industry ?? [], concept ?? []), meta: (industry ?? []).join("、") };
        },
    },
    {
        id: "major",
        title: "主力買賣",
        icon: "💼",
        defaultOpen: true,
        emptyText: "暫無主力買賣資料",
        async load(c) {
            const major = await c.data("major");
            return { content: majorContent(major), meta: majorMeta(major) };
        },
    },
    {
        id: "continuous",
        title: "連續買賣超",
        icon: "🏛️",
        defaultOpen: true,
        async load(c) {
            const market = await c.data("market");
            return { content: continuousContent(market), meta: continuousMeta(market) };
        },
    },
    {
        id: "relation",
        title: "關係企業",
        icon: "🔗",
        defaultOpen: true,
        async load(c) {
            const [groups, relations] = await settleAll([c.data("group"), c.data("relations")] as const);
            return { content: relationContent(groups ?? [], relations ?? null, c.stockId), meta: relationMeta(relations ?? null) };
        },
    },
    {
        id: "invest",
        title: "投資佈局",
        icon: "💸",
        defaultOpen: false,
        async load(c) {
            const relations = await c.data("relations");
            const n = relations.investOuts.length + relations.investIns.length;
            return { content: investContent(relations), meta: n ? `${n} 家` : "" };
        },
    },
    {
        id: "rating",
        title: "機構評等",
        icon: "🎯",
        defaultOpen: true,
        usesPrice: true,
        async load(c) {
            const ratings = await c.data("ratings");
            const cutoff = ratingCutoff(c.now());
            return { content: ratingContent(ratings, c.price(), cutoff, LIMITS.ratingMonths), meta: ratingMeta(ratings, c.price(), cutoff) };
        },
    },
    {
        id: "etf",
        title: "ETF 持股",
        icon: "📦",
        defaultOpen: false,
        async load(c) {
            try {
                const [etf, basic] = await Promise.all([c.data("etf"), c.data("basic").catch(() => null)]);
                return { content: etfContent(etf, basic), meta: etf.length ? `${etf.length} 檔` : "" };
            } catch (error) {
                // FindBillion 受 Cloudflare 保護時常回 403：這是來源限制而非故障，改顯示說明與連結
                if (error instanceof ApiError && (error.code === "http-403" || error.code === "http-503" || error.code === "payload")) {
                    return { content: etfUnavailable(c.stockId), meta: "需至來源網站查看" };
                }
                throw error;
            }
        },
    },
    {
        id: "finance",
        title: "財務指標",
        icon: "💹",
        defaultOpen: true,
        usesPrice: true,
        async load(c) {
            const [market, basic] = await settleAll([c.data("market"), c.data("basic")] as const);
            const pe = market?.pe.value;
            const dy = market?.dividendYield.value;
            // 玉山以 0 表示本益比不適用（近四季虧損），不顯示
            const meta = [pe !== null && pe !== undefined && pe > 0 ? `PE ${pe.toFixed(2)}` : null, dy !== null && dy !== undefined ? `殖利率 ${fmtPercent(dy, 2)}` : null].filter(Boolean).join(" · ");
            return { content: financeContent(market ?? null, basic ?? null, c.price()), meta };
        },
    },
    {
        id: "related",
        title: "相關個股",
        icon: "🔍",
        defaultOpen: true,
        async load(c) {
            // API 分類失敗時仍可只用本地資料庫的分類
            const [industry, concept, group] = await Promise.all([c.data("industry").catch(() => []), c.data("concept").catch(() => []), c.data("group").catch(() => [])]);
            const groups = await c.related({ 產業: industry, 概念: concept, 集團: group });
            const n = groups.產業.length + groups.概念.length + groups.集團.length;
            return { content: relatedContent(groups), meta: n ? `${n} 個分類` : "" };
        },
    },
    {
        id: "capacity",
        title: "產能分析",
        icon: "🏭",
        defaultOpen: false,
        async load(c) {
            const capacity = await c.data("capacity");
            return { content: capacityContent(capacity), meta: capacity.length ? `${capacity.length} 項` : "" };
        },
    },
];
