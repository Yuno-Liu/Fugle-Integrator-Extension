/**
 * ============================================================================
 * 🧱 資訊卡元件（純函式）
 * ============================================================================
 *
 * 輸入正規化資料、輸出 SafeHtml（所有外部字串皆已跳脫）。
 * 互動一律以 data-action 屬性描述，由 content script 以事件委派統一處理，
 * 因此同一份 HTML 也能直接複製到彈出視窗中使用。
 *
 * 顏色慣例（台股）：紅 = 上漲 / 買超，綠 = 下跌 / 賣超。
 */

import type { BasicInfo, CapacityItem, CategoryType, ContinuousItem, EtfHolding, MajorPeriod, MajorSummary, MarketSnapshot, MetricValue, RatingItem, RelatedCategory, RelatedGroups, RelatedStock, RelationItem, Relations } from "../shared/types";
import { LIMITS, MAJOR_PERIODS, findBillionEtfPage, stockPath } from "../shared/constants";
import { quarterLabel } from "../core/market";
import { dateToEpochDay } from "../core/session";
import { EMPTY, fmtHundredMillion, fmtLots, fmtNumber, fmtPercent, fmtSharesAsLots, fmtSigned, fmtThousandTwd, roundHalfAway, trendOf } from "../utils/format";
import { SafeHtml, html, joinHtml, raw, safeHttpUrl } from "../utils/html";

// ============================================================================
// 🔩 基礎元件
// ============================================================================

export const CHEVRON = raw('<svg class="fi-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');

export const SKELETON = raw('<div class="fi-skel" aria-hidden="true"><span></span><span></span><span></span></div>');

const trendClass = (v: number | null | undefined): string => `fi-${trendOf(v)}`;

/** 錯誤區塊（含重試按鈕） */
export function errorBlock(message: string, sectionId: string): SafeHtml {
    return html`<div class="fi-error" role="alert"><span>⚠ 載入失敗：${message}</span><button type="button" class="fi-link-btn" data-action="retry" data-section="${sectionId}">重試</button></div>`;
}

export function emptyBlock(message: string): SafeHtml {
    return html`<div class="fi-empty">${message}</div>`;
}

/** 標籤 + 內容的一列 */
export function row(label: string, content: SafeHtml | null, dotColor?: string): SafeHtml | null {
    if (!content || content.value === "") return null;
    const dot = dotColor ? html`<span class="fi-dot" style="--fi-dot:${dotColor}"></span>` : null;
    return html`<div class="fi-row"><div class="fi-row__label">${dot}${label}</div><div class="fi-row__content">${content}</div></div>`;
}

/**
 * 晶片清單：超過 limit 的項目先隱藏，提供「顯示全部」按鈕。
 * @param key 唯一識別，用於展開按鈕對應隱藏區塊
 */
export function chipList(items: readonly SafeHtml[], limit: number, key: string): SafeHtml | null {
    if (items.length === 0) return null;
    if (items.length <= limit) return html`<div class="fi-chips">${items}</div>`;
    const visible = items.slice(0, limit);
    const rest = items.slice(limit);
    return html`<div class="fi-chips">${visible}<span class="fi-overflow" id="fi-more-${key}" hidden>${rest}</span><button type="button" class="fi-more" data-action="expand" data-target="fi-more-${key}" aria-expanded="false" aria-controls="fi-more-${key}">顯示全部 ${items.length}</button></div>`;
}

/** 連到富果個股頁的晶片（支援中鍵 / Ctrl 點擊開新分頁） */
export function stockChip(code: string, name: string, title?: string): SafeHtml {
    return html`<a class="fi-chip" href="${stockPath(code)}" data-fi-nav="${code}" title="${title ?? `前往 ${name}（${code}）`}">${name}<span class="fi-chip__sub">${code}</span></a>`;
}

/** 分類晶片：點擊開啟搜尋視窗的分類詳情 */
export function categoryChip(type: CategoryType, name: string, count?: number): SafeHtml {
    return html`<button type="button" class="fi-chip" data-action="category" data-type="${type}" data-name="${name}" title="查看「${name}」的所有個股">${name}${count !== undefined ? html`<span class="fi-chip__sub">${count}</span>` : null}</button>`;
}

function relationChip(item: RelationItem, selfId: string): SafeHtml {
    if (item.isTaiwan && item.code === selfId) return html`<span class="fi-chip fi-chip--self" title="目前個股">${item.name}<span class="fi-chip__sub">${item.code}</span></span>`;
    if (item.isTaiwan) return stockChip(item.code, item.name);
    const market = item.exchange ? `${item.code}.${item.exchange}` : item.code;
    return html`<span class="fi-chip fi-chip--plain" title="非台股（${market}），無法於富果開啟">${item.name}<span class="fi-chip__sub">${market}</span></span>`;
}

// ============================================================================
// 📝 基本資料
// ============================================================================

export interface RevenueMix {
    items: Array<{ name: string; pct: number }>;
    year: string | null;
}

/** 解析營收比重字串，例如「晶圓-5奈米30.98%、其他14.08% (2025年)」 */
export function parseRevenueMix(text: string): RevenueMix | null {
    if (!text) return null;
    let body = text.trim();
    let year: string | null = null;
    const yearMatch = /[（(]\s*(\d{4}\s*年?[^)）]*)[)）]\s*$/.exec(body);
    if (yearMatch) {
        year = (yearMatch[1] ?? "").trim();
        body = body.slice(0, yearMatch.index).trim();
    }
    const items: Array<{ name: string; pct: number }> = [];
    for (const segment of body.split(/[、,，;；]/)) {
        const m = /^(.*?)\s*(-?\d+(?:\.\d+)?)\s*%$/.exec(segment.trim());
        if (!m) continue;
        const name = (m[1] ?? "").trim();
        const pct = Number(m[2]);
        if (name && Number.isFinite(pct)) items.push({ name, pct });
    }
    if (items.length === 0) return null;
    items.sort((a, b) => b.pct - a.pct);
    return { items, year };
}

function revenueMixHtml(text: string): SafeHtml | null {
    const mix = parseRevenueMix(text);
    if (!mix) return text ? html`<span>${text}</span>` : null;
    const max = Math.max(...mix.items.map((i) => i.pct), 1);
    const rowHtml = (i: { name: string; pct: number }): SafeHtml =>
        html`<div class="fi-mix__row"><span class="fi-mix__name" title="${i.name}">${i.name}</span><span class="fi-mix__track"><span class="fi-mix__fill" style="width:${Math.max(2, (i.pct / max) * 100).toFixed(1)}%"></span></span><span class="fi-mix__pct fi-num">${fmtNumber(i.pct, 2)}%</span></div>`;
    const top = mix.items.slice(0, 5).map(rowHtml);
    const rest = mix.items.slice(5).map(rowHtml);
    const more =
        rest.length > 0
            ? html`<div class="fi-overflow" id="fi-more-revenue" hidden>${rest}</div><div><button type="button" class="fi-more" data-action="expand" data-target="fi-more-revenue" aria-expanded="false">其他 ${rest.length} 項</button></div>`
            : null;
    const yearNote = mix.year ? html`<div class="fi-note">資料年度：${mix.year}</div>` : null;
    return html`<div class="fi-mix">${top}${more}</div>${yearNote}`;
}

export function basicContent(basic: BasicInfo | null, industries: readonly string[], concepts: readonly string[]): SafeHtml | null {
    const sortedConcepts = [...concepts].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const people = basic ? joinHtml([basic.chairman ? html`董事長 <span class="fi-strong">${basic.chairman}</span>` : null, basic.president ? html`總經理 <span class="fi-strong">${basic.president}</span>` : null], " · ") : null;
    const dates = basic ? joinHtml([basic.foundedDate ? html`成立 ${basic.foundedDate}` : null, basic.listedDate ? html`上市櫃 ${basic.listedDate}` : null], " · ") : null;
    const site = basic?.website ? safeHttpUrl(basic.website) : null;

    const rows = [
        row("營收比重", basic ? revenueMixHtml(basic.revenueMix) : null),
        row("產業", chipList(industries.map((n) => categoryChip("產業", n)), LIMITS.chips, "industry")),
        row("概念", chipList(sortedConcepts.map((n) => categoryChip("概念", n)), LIMITS.chips, "concept")),
        row("經營", people && people.value ? people : null),
        row("日期", dates && dates.value ? dates : null),
        row("官網", site ? html`<a class="fi-chip" href="${site}" target="_blank" rel="noopener noreferrer">${site.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗</a>` : null),
    ];
    const out = joinHtml(rows);
    return out.value ? out : null;
}

// ============================================================================
// 💼 主力買賣
// ============================================================================

function divergingBar(ratio: number, scale = 30): SafeHtml {
    const half = (Math.min(Math.abs(ratio), scale) / scale) * 50;
    const dir = ratio >= 0 ? "up" : "down";
    return html`<span class="fi-bar" aria-hidden="true"><span class="fi-bar__fill fi-bar__fill--${dir}" style="width:${half.toFixed(1)}%"></span></span>`;
}

export function majorContent(summary: MajorSummary): SafeHtml | null {
    const periods = summary.periods;
    if (periods.every((p) => p === null)) return null;
    const date = periods.find((p): p is MajorPeriod => p !== null)?.date ?? "";
    const usesFallback = periods.some((p) => p?.volumeSource === "finmind");

    const rows = MAJOR_PERIODS.map((days, i) => {
        const p = periods[i] ?? null;
        if (!p) return html`<tr class="fi-table__muted"><td>主${days}</td><td class="fi-num">${EMPTY}</td><td class="fi-num">${EMPTY}</td><td class="fi-num">${EMPTY}</td><td class="fi-num">${EMPTY}</td><td></td></tr>`;
        // 顏色依「顯示的張數」決定：淨額不足半張顯示 0，不套用買賣超顏色
        const netLots = roundHalfAway((p.netBuy - Math.abs(p.netSell)) / 1000);
        return html`<tr title="${`區間成交量 ${fmtLots(p.volume)} 張`}"><td>主${days}</td><td class="fi-num fi-up">${fmtLots(p.netBuy)}</td><td class="fi-num fi-down">${fmtLots(Math.abs(p.netSell))}</td><td class="fi-num ${trendClass(netLots)}">${fmtSigned(netLots)}</td><td class="fi-num ${trendClass(p.ratio)}"><strong>${fmtPercent(p.ratio, 2, true)}</strong></td><td>${divergingBar(p.ratio)}</td></tr>`;
    });

    return html`<table class="fi-table"><thead><tr><th>區間</th><th class="fi-num">買超(張)</th><th class="fi-num">賣超(張)</th><th class="fi-num">淨額(張)</th><th class="fi-num">占比</th><th></th></tr></thead><tbody>${rows}</tbody></table><div class="fi-note">資料日 ${date} · 占比 = (前 15 大買超 − 前 15 大賣超) ÷ 區間成交量${usesFallback ? "（部分區間成交量取自 FinMind）" : ""}</div>`;
}

/** 主力資料的區塊副標（顯示主1占比） */
export function majorMeta(summary: MajorSummary): string {
    const p1 = summary.periods[0];
    return p1 ? `主1 ${fmtPercent(p1.ratio, 2, true)}` : "";
}

// ============================================================================
// 🏛️ 法人連續買賣超
// ============================================================================

const UNAVAILABLE = raw('<span class="fi-muted" title="資料來源載入失敗，可稍後按「⟳ 重新整理」">暫缺</span>');

/**
 * @param failed 該法人的連買或連賣清單載入失敗（此時「沒有資料」不代表「不在排行中」）
 */
function streakCell(item: ContinuousItem | null, failed: boolean): SafeHtml {
    if (!item) return failed ? UNAVAILABLE : html`<span class="fi-muted" title="今日未進入連續買賣超排行">${EMPTY}</span>`;
    const isBuy = item.direction === "buy";
    const badge = item.turned ? html` <span class="fi-badge fi-badge--${isBuy ? "up" : "down"}" title="${`前一日為連${isBuy ? "賣" : "買"} ${item.previousDays} 天`}">${isBuy ? "轉買" : "轉賣"}</span>` : null;
    return html`<span class="${isBuy ? "fi-up" : "fi-down"}"><strong>連${isBuy ? "買" : "賣"} ${item.days} 天</strong></span>${badge}`;
}

export function continuousContent(m: MarketSnapshot): SafeHtml | null {
    const unavailable = new Set(m.unavailable ?? []);
    const trustFailed = unavailable.has("trustBuy") || unavailable.has("trustSell");
    const foreignFailed = unavailable.has("foreignBuy") || unavailable.has("foreignSell");
    const anyFailed = trustFailed || foreignFailed || unavailable.has("trustHold") || unavailable.has("foreignHold");
    if (!m.trust && !m.foreign && m.trustHoldPct === null && m.foreignHoldPct === null && !anyFailed) return null;

    const holdCell = (hold: number | null, failed: boolean): SafeHtml | string => (hold === null && failed ? UNAVAILABLE : fmtPercent(hold, 2));
    const rowFor = (label: string, item: ContinuousItem | null, hold: number | null, failed: boolean, holdFailed: boolean): SafeHtml =>
        html`<tr><td><strong>${label}</strong></td><td class="fi-num">${holdCell(hold, holdFailed)}</td><td>${streakCell(item, failed)}</td><td class="fi-num ${trendClass(item?.lots)}">${item ? `${fmtSigned(item.lots)} 張` : EMPTY}</td><td class="fi-num ${trendClass(item?.amountThousand)}">${item ? (item.amountThousand > 0 ? "+" : "") + fmtThousandTwd(item.amountThousand) : EMPTY}</td></tr>`;
    const date = m.trust?.date || m.foreign?.date || "";
    return html`<table class="fi-table"><thead><tr><th>法人</th><th class="fi-num">持股比</th><th>連續買賣</th><th class="fi-num">當日淨買賣</th><th class="fi-num">當日金額</th></tr></thead><tbody>${rowFor("投信", m.trust, m.trustHoldPct, trustFailed, unavailable.has("trustHold"))}${rowFor("外資", m.foreign, m.foreignHoldPct, foreignFailed, unavailable.has("foreignHold"))}</tbody></table>${date ? html`<div class="fi-note">資料日 ${date}</div>` : null}${anyFailed ? html`<div class="fi-note">部分法人資料載入失敗，標示「暫缺」的欄位不代表沒有買賣</div>` : null}`;
}

export function continuousMeta(m: MarketSnapshot): string {
    const part = (label: string, item: ContinuousItem | null): string | null => (item ? `${label}連${item.direction === "buy" ? "買" : "賣"}${item.days}` : null);
    return [part("投信", m.trust), part("外資", m.foreign)].filter(Boolean).join(" · ");
}

// ============================================================================
// 🔗 關係企業 / 投資佈局
// ============================================================================

const RELATION_COLORS = {
    alliances: "#1fa9a0",
    suppliers: "#4c8bf5",
    customers: "#8e6cf0",
    rivals: "#f08c2e",
    investOuts: "#b07d48",
    investIns: "#6f86a6",
} as const;

function relationRow(label: string, key: keyof typeof RELATION_COLORS, items: readonly RelationItem[], selfId: string): SafeHtml | null {
    if (items.length === 0) return null;
    return row(`${label}`, chipList(items.map((i) => relationChip(i, selfId)), LIMITS.chips, `rel-${key}`), RELATION_COLORS[key]);
}

export function relationContent(groups: readonly string[], rel: Relations | null, selfId: string): SafeHtml | null {
    const rows = [
        row("集團", chipList(groups.map((g) => categoryChip("集團", g)), LIMITS.chips, "groups")),
        rel ? relationRow("策略聯盟", "alliances", rel.alliances, selfId) : null,
        rel ? relationRow("供應商", "suppliers", rel.suppliers, selfId) : null,
        rel ? relationRow("客戶", "customers", rel.customers, selfId) : null,
        rel ? relationRow("競爭對手", "rivals", rel.rivals, selfId) : null,
    ];
    const out = joinHtml(rows);
    if (!out.value) return null;
    return rel && rel.failed > 0 ? html`${out}<div class="fi-note">部分關係資料載入失敗（${rel.failed} 類）</div>` : out;
}

export function investContent(rel: Relations): SafeHtml | null {
    const out = joinHtml([relationRow("轉投資", "investOuts", rel.investOuts, ""), relationRow("被投資", "investIns", rel.investIns, "")]);
    return out.value ? out : null;
}

export function relationMeta(rel: Relations | null): string {
    if (!rel) return "";
    const n = rel.suppliers.length + rel.customers.length + rel.rivals.length + rel.alliances.length;
    return n > 0 ? `${n} 家` : "";
}

// ============================================================================
// 🎯 機構評等
// ============================================================================

/** 評等強度（用於判斷調升 / 調降）；未知評等回傳 null */
export function ratingStrength(rating: string): number | null {
    const r = rating.replace(/\s+/g, "").toLowerCase();
    if (!r) return null;
    if (/強力買進|強烈買進|強力推薦|strongbuy/.test(r)) return 5;
    if (/買進|加碼|優於大盤|增加持股|推薦|outperform|overweight|^buy$|^add$/.test(r)) return 4;
    if (/中立|持有|區間操作|持平|市場同步|中性|hold|neutral|marketperform|equalweight/.test(r)) return 3;
    if (/減碼|劣於大盤|降低持股|underperform|underweight|reduce/.test(r)) return 2;
    if (/賣出|放空|^sell$/.test(r)) return 1;
    return null;
}

export interface RatingStats {
    recent: RatingItem[];
    count: number;
    max: number | null;
    min: number | null;
    avg: number | null;
}

/** 篩選近 N 個月的評等並計算目標價統計 */
export function ratingStats(ratings: readonly RatingItem[], cutoffEpochDay: number): RatingStats {
    const recent = ratings.filter((r) => {
        const d = dateToEpochDay(r.date);
        return d !== null && d >= cutoffEpochDay;
    });
    const targets = recent.map((r) => r.target).filter((t): t is number => t !== null && t > 0);
    return {
        recent,
        count: recent.length,
        max: targets.length ? Math.max(...targets) : null,
        min: targets.length ? Math.min(...targets) : null,
        avg: targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : null,
    };
}

const upside = (target: number | null, price: number | null): number | null => (target !== null && price !== null && price > 0 ? ((target - price) / price) * 100 : null);

function rangeBar(stats: RatingStats, price: number | null): SafeHtml | null {
    if (stats.min === null || stats.max === null || stats.avg === null) return null;
    const lo = Math.min(stats.min, price ?? stats.min);
    const hi = Math.max(stats.max, price ?? stats.max);
    const span = hi - lo || 1;
    const pos = (v: number): string => `${(((v - lo) / span) * 100).toFixed(1)}%`;
    const nowMark = price !== null && price > 0 ? html`<span class="fi-range__mark fi-range__now" style="left:${pos(price)}" title="${`現價 ${fmtNumber(price, 2)}`}"></span>` : null;
    return html`<div class="fi-range" role="img" aria-label="${`目標價區間 ${fmtNumber(stats.min, 2)} 至 ${fmtNumber(stats.max, 2)}，平均 ${fmtNumber(stats.avg, 2)}`}"><span class="fi-range__mark fi-range__avg" style="left:${pos(stats.avg)}" title="${`平均目標價 ${fmtNumber(stats.avg, 2)}`}"></span>${nowMark}<span class="fi-range__label fi-range__label--left">${fmtNumber(lo, 0)}</span><span class="fi-range__label fi-range__label--right">${fmtNumber(hi, 0)}</span></div>`;
}

export function ratingContent(ratings: readonly RatingItem[], price: number | null, cutoffEpochDay: number, months: number): SafeHtml {
    const stats = ratingStats(ratings, cutoffEpochDay);
    if (stats.count === 0) return emptyBlock(`近 ${months} 個月無機構評等`);

    const pctHtml = (v: number | null): SafeHtml => (v === null ? html`` : html` <span class="fi-num ${trendClass(v)}">(${fmtPercent(v, 1, true)})</span>`);
    const summary =
        stats.avg !== null
            ? html`<div>近 ${months} 個月 <strong>${stats.count}</strong> 筆 · 平均目標價 <strong class="fi-num">${fmtNumber(stats.avg, 2)}</strong>${pctHtml(upside(stats.avg, price))} · 最高 <span class="fi-num">${fmtNumber(stats.max, 2)}</span>${pctHtml(upside(stats.max, price))} · 最低 <span class="fi-num">${fmtNumber(stats.min, 2)}</span>${pctHtml(upside(stats.min, price))}</div>${rangeBar(stats, price)}`
            : html`<div>近 ${months} 個月 <strong>${stats.count}</strong> 筆評等</div>`;

    const rowHtml = (r: RatingItem, i: number): SafeHtml => {
        const now = ratingStrength(r.rating);
        const before = ratingStrength(r.previous);
        let change: SafeHtml | null = null;
        if (r.previous && r.previous !== r.rating) {
            if (now !== null && before !== null && now !== before) change = html` <span class="fi-badge fi-badge--${now > before ? "up" : "down"}" title="${`前次：${r.previous}`}">${now > before ? "▲ 調升" : "▼ 調降"}</span>`;
            else change = html` <span class="fi-badge" title="${`前次：${r.previous}`}">變更</span>`;
        }
        const up = upside(r.target, price);
        const showDate = i === 0 || stats.recent[i - 1]?.date !== r.date;
        return html`<tr><td class="fi-num fi-muted">${showDate ? r.date : ""}</td><td>${r.broker}</td><td>${r.rating}${change}</td><td class="fi-num">${r.target !== null ? fmtNumber(r.target, r.target % 1 === 0 ? 0 : 2) : EMPTY}</td><td class="fi-num ${trendClass(up)}">${fmtPercent(up, 1, true)}</td></tr>`;
    };

    const rows = stats.recent.map(rowHtml);
    const visible = rows.slice(0, LIMITS.ratings);
    const rest = rows.slice(LIMITS.ratings);
    const table = html`<table class="fi-table"><thead><tr><th>日期</th><th>機構</th><th>評等</th><th class="fi-num">目標價</th><th class="fi-num">潛在空間</th></tr></thead><tbody>${visible}</tbody>${rest.length ? html`<tbody class="fi-overflow" id="fi-more-ratings" hidden>${rest}</tbody>` : null}</table>`;
    const more = rest.length ? html`<button type="button" class="fi-more" data-action="expand" data-target="fi-more-ratings" aria-expanded="false">顯示全部 ${rows.length} 筆</button>` : null;
    return html`${summary}${table}${more}`;
}

export function ratingMeta(ratings: readonly RatingItem[], price: number | null, cutoffEpochDay: number): string {
    const s = ratingStats(ratings, cutoffEpochDay);
    if (s.count === 0) return "";
    const up = upside(s.avg, price);
    return up === null ? `${s.count} 筆` : `${s.count} 筆 · 均價 ${fmtPercent(up, 1, true)}`;
}

// ============================================================================
// 📦 ETF 持股
// ============================================================================

export function etfContent(list: readonly EtfHolding[], basic: BasicInfo | null): SafeHtml | null {
    if (list.length === 0) return null;
    const totalShares = list.reduce((sum, e) => sum + e.shares, 0);
    const issued = basic?.sharesThousand ? basic.sharesThousand * 1000 : null;
    const ofIssued = issued ? (totalShares / issued) * 100 : null;
    const rowHtml = (e: EtfHolding): SafeHtml =>
        html`<tr><td><a class="fi-link" href="${stockPath(e.symbol)}" data-fi-nav="${e.symbol}" title="${`前往 ${e.name}（${e.symbol}）`}">${e.symbol}</a> <span class="fi-muted">${e.name !== e.symbol ? e.name : ""}</span></td><td class="fi-num">${fmtPercent(e.ratio, 2)}</td><td class="fi-num">${fmtSharesAsLots(e.shares)}</td></tr>`;
    const rows = list.map(rowHtml);
    const visible = rows.slice(0, LIMITS.etf);
    const rest = rows.slice(LIMITS.etf);
    const summary = html`<div style="margin-bottom:6px">共 <strong>${list.length}</strong> 檔 ETF 持有 · 合計 <strong class="fi-num">${fmtSharesAsLots(totalShares)}</strong>${ofIssued !== null ? html` · 約占發行股數 <strong class="fi-num">${fmtPercent(ofIssued, 2)}</strong>` : null}</div>`;
    const table = html`<table class="fi-table"><thead><tr><th>ETF</th><th class="fi-num" title="此股在該 ETF 中的權重">權重</th><th class="fi-num">持有</th></tr></thead><tbody>${visible}</tbody>${rest.length ? html`<tbody class="fi-overflow" id="fi-more-etf" hidden>${rest}</tbody>` : null}</table>`;
    const more = rest.length ? html`<button type="button" class="fi-more" data-action="expand" data-target="fi-more-etf" aria-expanded="false" aria-controls="fi-more-etf">顯示全部 ${rows.length} 檔</button>` : null;
    return html`${summary}${table}${more}`;
}

/** FindBillion 啟用 Cloudflare 驗證、擴充功能無法直接取得時的說明 */
export function etfUnavailable(stockId: string): SafeHtml {
    return html`<div class="fi-empty">資料來源 FindBillion 目前要求瀏覽器驗證，擴充功能無法直接取得。<br><a class="fi-chip" href="${findBillionEtfPage(stockId)}" target="_blank" rel="noopener noreferrer">在 FindBillion 查看持有 ${stockId} 的 ETF ↗</a> <button type="button" class="fi-link-btn" data-action="retry" data-section="etf">完成驗證後重試</button></div>`;
}

// ============================================================================
// 💹 財務指標
// ============================================================================

interface Kpi {
    label: string;
    value: string;
    tone?: "down";
    title: string;
}

const dateNote = (m: MetricValue, quarterly: boolean): string => (m.date ? (quarterly ? `${quarterLabel(m.date)} 單季` : `資料日 ${m.date}`) : "");

export function financeContent(m: MarketSnapshot | null, basic: BasicInfo | null, price: number | null): SafeHtml | null {
    const capital100M = basic?.capitalThousand ? basic.capitalThousand / 100_000 : null;
    const marketCap100M = basic?.sharesThousand && price ? (price * basic.sharesThousand) / 100_000 : null;

    const kpis: Kpi[] = [];
    if (m) {
        kpis.push(
            // 玉山以 0 表示本益比不適用（近四季合計虧損），顯示「—」而非 0.00；負值同樣代表虧損
            { label: "本益比", value: m.pe.value !== null && m.pe.value > 0 ? fmtNumber(m.pe.value, 2) : EMPTY, title: m.pe.value !== null && m.pe.value <= 0 ? `近四季虧損，本益比不適用。${dateNote(m.pe, false)}` : `股價 ÷ 近四季 EPS。${dateNote(m.pe, false)}` },
            { label: "股價淨值比", value: fmtNumber(m.pb.value, 2), title: `股價 ÷ 每股淨值。${dateNote(m.pb, false)}` },
            { label: `EPS${m.eps.date ? `（${quarterLabel(m.eps.date)}）` : ""}`, value: fmtNumber(m.eps.value, 2), tone: (m.eps.value ?? 0) < 0 ? "down" : undefined, title: `每股盈餘，單季數據。${dateNote(m.eps, true)}` },
            { label: "殖利率", value: fmtPercent(m.dividendYield.value, 2), title: `現金股利 ÷ 股價。${dateNote(m.dividendYield, false)}` },
            { label: "每股淨值", value: fmtNumber(m.nav.value, 2), title: `${dateNote(m.nav, true).replace(" 單季", "")}` },
            { label: "毛利率", value: fmtPercent(m.grossMargin.value, 2), title: `單季毛利率。${dateNote(m.grossMargin, true)}` },
            { label: "ROE（單季）", value: fmtPercent(m.roe.value, 2), tone: (m.roe.value ?? 0) < 0 ? "down" : undefined, title: `股東權益報酬率，單季數據（未年化）。${dateNote(m.roe, true)}` },
            { label: "ROA（單季）", value: fmtPercent(m.roa.value, 2), tone: (m.roa.value ?? 0) < 0 ? "down" : undefined, title: `資產報酬率，單季數據（未年化）。${dateNote(m.roa, true)}` }
        );
    }
    kpis.push(
        { label: "股本", value: fmtHundredMillion(capital100M), title: basic?.parValue ? `實收資本額，每股面額 ${fmtNumber(basic.parValue, 2)} 元` : "實收資本額" },
        { label: "市值", value: fmtHundredMillion(marketCap100M), title: "目前股價 × 發行股數" }
    );

    if (kpis.every((k) => k.value === EMPTY)) return null;
    const tiles = kpis.map((k) => html`<div class="fi-kpi" title="${k.title}"><div class="fi-kpi__label">${k.label}</div><div class="fi-kpi__value${k.tone ? " fi-down" : ""}">${k.value}</div></div>`);
    const quarter = m?.eps.date ? quarterLabel(m.eps.date) : null;
    const daily = m?.pe.date ?? null;
    const note = quarter || daily ? html`<div class="fi-note">${quarter ? `EPS、毛利率、ROE、ROA 為 ${quarter} 單季數據` : ""}${quarter && daily ? "；" : ""}${daily ? `本益比、股價淨值比、殖利率資料日 ${daily}` : ""}</div>` : null;
    return html`<div class="fi-kpis">${tiles}</div>${note}${m && m.failed > 0 ? html`<div class="fi-note">部分全市場資料載入失敗（${m.failed} 份）</div>` : null}`;
}

// ============================================================================
// 🔍 相關個股
// ============================================================================

const GROUP_LABEL: Record<CategoryType, string> = { 產業: "同產業", 集團: "同集團", 概念: "同概念" };

function relatedCategory(cat: RelatedCategory, expanded: boolean, index: number): SafeHtml {
    const id = `fi-cat-${index}`;
    const chips = cat.stocks.map((s: RelatedStock) => stockChip(s.code, s.name));
    const all = cat.total > cat.stocks.length ? html`<button type="button" class="fi-more" data-action="category" data-type="${cat.type}" data-name="${cat.name}">全部 ${cat.total} 檔 →</button>` : null;
    return html`<div class="fi-cat"><button type="button" class="fi-cat__head" data-action="toggle-cat" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${id}">${CHEVRON}<span class="fi-cat__name">${cat.name}</span><span class="fi-cat__count">${cat.total} 檔</span></button><div class="fi-cat__body" id="${id}"${expanded ? "" : raw(" hidden")}><div class="fi-chips">${chips}${all}</div></div></div>`;
}

export function relatedContent(groups: RelatedGroups): SafeHtml | null {
    let index = 0;
    const order: CategoryType[] = ["產業", "集團", "概念"];
    const parts = order.map((type) => {
        const list = groups[type];
        if (list.length === 0) return null;
        // 產業、集團預設展開；概念數量多，僅在 3 個以內時預設展開
        const expanded = type !== "概念" || list.length <= 3;
        return html`<div class="fi-group-title">${GROUP_LABEL[type]}<span class="fi-muted">（${list.length}）</span></div>${list.map((c) => relatedCategory(c, expanded, index++))}`;
    });
    const out = joinHtml(parts);
    return out.value ? out : null;
}

// ============================================================================
// 🏭 產能分析
// ============================================================================

export function capacityContent(list: readonly CapacityItem[]): SafeHtml | null {
    if (list.length === 0) return null;
    const rows = list.map((i) => html`<tr><td>${i.location || EMPTY}</td><td>${i.spec || EMPTY}</td><td class="fi-num"><strong>${i.quantity || EMPTY}</strong></td><td class="fi-muted">${i.unit}</td></tr>`);
    return html`<table class="fi-table"><thead><tr><th>位置</th><th>規格</th><th class="fi-num">數量</th><th>單位</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ============================================================================
// 📌 標題列摘要
// ============================================================================

export interface SummaryItem {
    label: string;
    value: string;
    tone: "up" | "down" | "flat";
    section: string;
    title: string;
}

export function summaryChips(items: readonly SummaryItem[]): SafeHtml {
    return html`${items.map((i) => html`<button type="button" class="fi-summary__item" data-action="goto" data-section="${i.section}" title="${i.title}"><span class="fi-summary__label">${i.label}</span><span class="fi-summary__value fi-${i.tone}">${i.value}</span></button>`)}`;
}
