/**
 * ============================================================================
 * 🔘 工具列
 * ============================================================================
 *
 * 版面：[搜尋] [位置：靠左｜靠右｜嵌入] [彈出] [資訊卡 開關] [設定] ｜ [外部連結…]
 * - 內部控制放前面，資訊卡浮動時也不會被遮住
 * - 外部網站使用真正的 <a target="_blank" rel="noopener">：可中鍵 / Ctrl 點擊、可看到網址
 */

import type { CardPosition, UiSettings } from "../shared/types";
import { FUGLE } from "../shared/constants";
import { EXTERNAL_LINKS } from "../shared/links";
import { html } from "../utils/html";
import type { StockContext } from "./page";

export const TOOLBAR_ID = "fi-toolbar";

export interface ToolbarActions {
    search(): void;
    setPosition(position: CardPosition): void;
    popout(): void;
    setVisible(visible: boolean): void;
    openOptions(): void;
}

const POSITIONS: ReadonlyArray<{ value: CardPosition; label: string; title: string }> = [
    { value: "left", label: "靠左", title: "資訊卡固定在畫面左側" },
    { value: "right", label: "靠右", title: "資訊卡固定在畫面右側" },
    { value: "default", label: "嵌入", title: "資訊卡嵌入頁面中（隨頁面捲動）" },
];

export class Toolbar {
    private el: HTMLElement | null = null;
    private renderedKey = "";
    private stateKey = "";

    constructor(
        private readonly actions: ToolbarActions,
        private readonly getSettings: () => UiSettings
    ) {}

    get element(): HTMLElement | null {
        return this.el;
    }

    /** 確保工具列存在於富果頁首；內容依股票更新 */
    ensure(ctx: StockContext, doc: Document = document): void {
        const host = doc.querySelector(FUGLE.toolbarHost);
        if (!host) return;
        if (!this.el) this.el = this.create(doc);
        const settings = this.getSettings();
        const key = `${ctx.stockId}|${ctx.name}|${ctx.market}|${settings.hiddenLinks.join(",")}`;
        if (key !== this.renderedKey) {
            this.render(ctx, settings);
            this.renderedKey = key;
        }
        this.syncState(settings);
        if (this.el.parentElement !== host) host.appendChild(this.el);
    }

    /** 依設定更新按鈕狀態（位置、開關） */
    syncState(settings: UiSettings = this.getSettings()): void {
        if (!this.el) return;
        // 監看迴圈每 400ms 會呼叫：狀態沒變就不寫入 DOM
        const key = `${settings.position}|${settings.visible}`;
        if (key === this.stateKey) return;
        this.stateKey = key;
        this.el.querySelectorAll<HTMLButtonElement>("[data-position]").forEach((btn) => btn.setAttribute("aria-pressed", btn.dataset.position === settings.position ? "true" : "false"));
        const toggle = this.el.querySelector<HTMLInputElement>("[data-action='visible']");
        if (toggle) toggle.checked = settings.visible;
    }


    remove(): void {
        this.el?.remove();
        this.el = null;
        this.renderedKey = "";
        this.stateKey = "";
    }

    private create(doc: Document): HTMLElement {
        const el = doc.createElement("div");
        el.id = TOOLBAR_ID;
        el.className = "fi-root";
        // 未實作方向鍵導覽，因此不使用 role="toolbar"（避免螢幕閱讀器預期錯誤的操作方式）
        el.setAttribute("role", "group");
        el.setAttribute("aria-label", "富果整合器工具列");
        el.addEventListener("click", (event) => {
            const target = (event.target as Element).closest<HTMLElement>("[data-action], [data-position]");
            if (!target) return;
            if (target.dataset.position) {
                this.actions.setPosition(target.dataset.position as CardPosition);
                return;
            }
            switch (target.dataset.action) {
                case "search":
                    this.actions.search();
                    break;
                case "popout":
                    this.actions.popout();
                    break;
                case "options":
                    this.actions.openOptions();
                    break;
            }
        });
        el.addEventListener("change", (event) => {
            const input = event.target;
            if (input instanceof HTMLInputElement && input.dataset.action === "visible") this.actions.setVisible(input.checked);
        });
        return el;
    }

    private render(ctx: StockContext, settings: UiSettings): void {
        if (!this.el) return;
        this.stateKey = ""; // 重新渲染後需重新套用狀態
        const hidden = new Set(settings.hiddenLinks);
        const links = EXTERNAL_LINKS.filter((l) => !hidden.has(l.id)).map((l) => {
            const subject = `${ctx.name || ctx.stockId}（${ctx.stockId}）`;
            return html`<a class="fi-btn" href="${l.url(ctx)}" target="_blank" rel="noopener noreferrer" title="${`${l.title}：${subject}`}">${l.label}<span class="fi-btn__ext" aria-hidden="true">↗</span></a>`;
        });
        this.el.innerHTML = html`<span class="fi-toolbar__group"><button type="button" class="fi-btn fi-btn--primary" data-action="search" title="搜尋個股、概念股、產業或集團">🔍 搜尋</button><span class="fi-seg" role="group" aria-label="資訊卡位置">${POSITIONS.map(
            (p) => html`<button type="button" class="fi-seg__btn" data-position="${p.value}" aria-pressed="false" title="${p.title}">${p.label}</button>`
        )}</span><button type="button" class="fi-btn" data-action="popout" title="在獨立視窗開啟資訊卡（適合多螢幕）">❐ 彈出</button><label class="fi-switch" title="顯示 / 隱藏資訊卡"><input type="checkbox" role="switch" data-action="visible"><span class="fi-switch__track" aria-hidden="true"></span><span>資訊卡</span></label><button type="button" class="fi-btn" data-action="options" title="開啟設定（快捷鍵、主題、外部連結、Token）" aria-label="設定">⚙️</button></span>${
            links.length ? html`<span class="fi-toolbar__sep" aria-hidden="true"></span><span class="fi-toolbar__group" role="group" aria-label="外部分析網站">${links}</span>` : null
        }`.value;
    }
}
