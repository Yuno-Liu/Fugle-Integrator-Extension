/**
 * ============================================================================
 * ⏱️ 頁首小工具：盤中預估量、時鐘
 * ============================================================================
 */

import { FUGLE } from "../shared/constants";
import { isTradingSession, taipeiParts, volumeMultiplier } from "../core/session";
import { fmtClock, fmtNumber, pad2 } from "../utils/format";
import { readMarketClosed, readVolumeLots } from "./page";

// ============================================================================
// 📊 盤中預估量
// ============================================================================

export const ESTIMATE_ID = "fi-estimate";

/**
 * 只在盤中（台北時間平日 09:00–13:30，且富果未顯示「收盤」）顯示，
 * 避免在盤後把「實際成交量」誤標為預估量。
 */
export class EstimateBadge {
    private el: HTMLElement | null = null;
    private lastText = "";

    update(doc: Document = document, now: Date = new Date()): void {
        const parts = taipeiParts(now);
        // 非盤中（夜間、週末、盤前盤後）：不讀取頁面，直接隱藏
        if (!isTradingSession(parts)) {
            if (this.el && !this.el.hidden) this.el.hidden = true;
            return;
        }
        const host = doc.querySelector(FUGLE.volumeHost);
        if (!host) return;
        if (!this.el) {
            this.el = doc.createElement("span");
            this.el.id = ESTIMATE_ID;
            this.el.className = "fi-root";
            this.el.setAttribute("aria-live", "off");
        }
        if (this.el.parentElement !== host) host.appendChild(this.el);

        const lots = readVolumeLots(doc);
        const active = !readMarketClosed(doc) && lots !== null && lots > 0;
        if (!active || lots === null) {
            this.el.hidden = true;
            return;
        }
        const multiplier = volumeMultiplier(parts);
        const estimate = Math.floor(lots * multiplier);
        const text = `預估量 ≈ ${fmtNumber(estimate)} 張`;
        if (text !== this.lastText) {
            this.el.textContent = text;
            this.el.title = `依盤中時間推估全日成交量：目前 ${fmtNumber(lots)} 張 × 經驗係數 ${multiplier}`;
            this.lastText = text;
        }
        this.el.hidden = false;
    }

    remove(): void {
        this.el?.remove();
        this.el = null;
        this.lastText = "";
    }
}

// ============================================================================
// 🕐 時鐘
// ============================================================================

export const CLOCK_ID = "fi-clock";
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 顯示在富果頁首市場資訊旁的時鐘。
 * - 每秒只更新文字節點（不重建 DOM）
 * - 對齊整秒觸發；分頁隱藏時暫停
 * - 滑鼠移入顯示完整日期與星期（不改變寬度）
 */
export class Clock {
    private el: HTMLElement | null = null;
    private timeNode: Text | null = null;
    private dateNode: Text | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    ensure(doc: Document = document): void {
        const market = doc.querySelector(FUGLE.twMarket);
        if (!market) return;
        if (!this.el) {
            const el = doc.createElement("div");
            el.id = CLOCK_ID;
            el.className = "fi-root";
            el.setAttribute("role", "timer");
            const icon = doc.createElement("span");
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = "🕐";
            const time = doc.createElement("span");
            time.className = "fi-num";
            this.timeNode = doc.createTextNode("");
            time.appendChild(this.timeNode);
            const date = doc.createElement("span");
            date.className = "fi-clock__date";
            this.dateNode = doc.createTextNode("");
            date.appendChild(this.dateNode);
            el.append(icon, time, date);
            this.el = el;
        }
        if (market.nextElementSibling !== this.el) market.after(this.el);
        if (this.timer === null && !doc.hidden) this.tick();
    }

    pause(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    remove(): void {
        this.pause();
        this.el?.remove();
        this.el = null;
        this.timeNode = null;
        this.dateNode = null;
    }

    private tick = (): void => {
        if (!this.el || !this.timeNode || !this.dateNode) return;
        const now = new Date();
        this.timeNode.data = fmtClock(now);
        const full = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}（週${WEEKDAYS[now.getDay()]}）`;
        if (this.dateNode.data !== full) {
            this.dateNode.data = full;
            this.el.setAttribute("aria-label", `目前時間，${full}`);
        }
        this.timer = setTimeout(this.tick, 1000 - (Date.now() % 1000) + 5);
    };
}
