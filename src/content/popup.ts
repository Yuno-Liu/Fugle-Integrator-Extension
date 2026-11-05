/**
 * ============================================================================
 * ❐ 彈出視窗（資訊卡鏡像）
 * ============================================================================
 *
 * 彈出視窗只是頁面資訊卡的「鏡像」：
 * - 文件與事件委派由每個實例初始化一次（舊版每次重繪都新增 click 監聽器，會重複觸發）
 * - 內容變更時（防抖）複製卡片 HTML，保留捲動位置與鍵盤焦點
 * - 視窗中的點擊轉交頁面上的卡片處理，結果再同步回來
 * - 富果分頁重新整理或關閉時，彈出視窗會顯示「已停止同步」
 */

import type { ResolvedTheme } from "../shared/types";
import { POPUP_STYLESHEET, STYLESHEET } from "../ui/styles";
import { escapeHtml } from "../utils/html";
import { debounce } from "../utils/timing";

export interface PopupDeps {
    getCard(): HTMLElement | null;
    getTitle(): string;
    getTheme(): ResolvedTheme;
    /** 彈出視窗中的互動，交給頁面卡片處理 */
    onAction(target: HTMLElement, event: MouseEvent): void;
}

const WINDOW_NAME = "FugleIntegratorCard";

/** 用來在重新渲染後找回「同一個」控制項的屬性 */
const FOCUS_ATTRS = ["data-action", "data-section", "data-target", "aria-controls", "data-type", "data-name", "data-fi-nav"] as const;

/** 依識別屬性組出選擇器（值含引號或反斜線時放棄，避免組出無效選擇器） */
export function focusSelectorFor(el: Element): string | null {
    let selector = "";
    for (const attr of FOCUS_ATTRS) {
        const value = el.getAttribute(attr);
        if (value === null) continue;
        if (/["\\]/.test(value)) return null;
        selector += `[${attr}="${value}"]`;
    }
    return selector ? `${el.tagName.toLowerCase()}${selector}` : null;
}

export class PopupMirror {
    private win: Window | null = null;
    /** 本實例已初始化過的彈出視窗文件 */
    private readonly prepared = new WeakSet<Document>();
    /** 上次鏡像的卡片 HTML（未變更就不重寫） */
    private lastHtml: string | null = null;
    /** 本實例的識別碼：彈出視窗只回應目前擁有者的事件 */
    private readonly ownerId = `fi-${Math.random().toString(36).slice(2)}`;

    constructor(private readonly deps: PopupDeps) {}

    isOpen(): boolean {
        try {
            return !!this.win && !this.win.closed;
        } catch {
            return false;
        }
    }

    /** 開啟（或聚焦）彈出視窗；被瀏覽器阻擋時回傳 false */
    open(): boolean {
        if (this.isOpen() && this.win) {
            this.win.focus();
            this.syncNow();
            return true;
        }
        const width = Math.round(Math.min(600, Math.max(420, screen.availWidth * 0.32)));
        const height = Math.round(Math.min(960, screen.availHeight - 40));
        const left = Math.max(0, screen.availWidth - width - 24);
        const win = window.open("", WINDOW_NAME, `popup=yes,width=${width},height=${height},left=${left},top=20,scrollbars=yes,resizable=yes`);
        if (!win) return false;
        this.win = win;
        this.prepare(win);
        this.syncNow();
        win.focus();
        return true;
    }

    close(): void {
        if (this.isOpen()) this.win?.close();
        this.win = null;
    }

    /**
     * 富果分頁即將卸載（重新整理、離開或關閉）：停止回應彈出視窗中的操作，並提示使用者。
     * 之後在新頁面按「彈出」會重新接手同一個視窗。
     */
    detach(): void {
        const win = this.win;
        this.win = null;
        this.sync.cancel();
        if (!win) return;
        try {
            if (win.closed) return;
            const doc = win.document;
            doc.documentElement.dataset.fiOwner = "";
            const status = doc.querySelector<HTMLElement>("#fi-card [data-role='status']");
            if (status) {
                status.textContent = "⚠ 富果分頁已重新整理或關閉，此視窗已停止同步。請在富果頁面重新按「❐ 彈出」。";
                status.classList.add("fi-card__status--warn");
            }
        } catch {
            // 視窗已不可存取
        }
    }

    /** 內容變更時呼叫（自動防抖） */
    readonly sync = debounce(() => this.syncNow(), 60);

    syncNow(): void {
        const win = this.win;
        if (!win || !this.isOpen()) return;
        const doc = win.document;
        if (!this.prepared.has(doc) || !doc.getElementById("fi-card")) this.prepare(win);
        const target = doc.getElementById("fi-card");
        if (!target) return;

        const theme = this.deps.getTheme();
        if (doc.documentElement.getAttribute("data-fi-theme") !== theme) doc.documentElement.setAttribute("data-fi-theme", theme);
        const title = this.deps.getTitle();
        if (doc.title !== title) doc.title = title;

        const card = this.deps.getCard();
        const scroller = doc.scrollingElement ?? doc.documentElement;
        const scrollTop = scroller.scrollTop;
        if (!card) {
            this.lastHtml = null;
            target.innerHTML = '<div class="fi-card__header"><div class="fi-card__status">目前頁面不是個股頁，請在富果開啟任一檔股票。</div></div>';
            return;
        }
        const htmlNow = card.innerHTML;
        if (htmlNow === this.lastHtml) return;
        this.lastHtml = htmlNow;

        // 重新渲染會銷毀目前聚焦的按鈕：記下它，渲染後聚焦回同一個控制項
        const active = doc.activeElement;
        const focusSelector = active && active !== doc.body && target.contains(active) ? focusSelectorFor(active) : null;

        target.innerHTML = htmlNow;
        // 彈出視窗中不需要的控制項
        target.querySelectorAll<HTMLElement>("[data-action='popout'], [data-action='cycle-position'], [data-action='hide-card']").forEach((el) => el.remove());
        const header = target.querySelector<HTMLElement>("[data-role='header']");
        if (header) target.style.setProperty("--fi-header-h", `${header.offsetHeight}px`);
        scroller.scrollTop = scrollTop;
        if (focusSelector) target.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
    }

    /** 在彈出視窗內捲動到指定區塊（摘要按鈕使用） */
    private scrollToSection(doc: Document, sectionId: string): void {
        if (!/^[a-z0-9-]{1,32}$/.test(sectionId)) return;
        const section = doc.querySelector<HTMLElement>(`#fi-card .fi-section[data-section="${sectionId}"]`);
        if (!section) return;
        const headerHeight = doc.querySelector<HTMLElement>("#fi-card [data-role='header']")?.offsetHeight ?? 0;
        const top = section.getBoundingClientRect().top + (doc.defaultView?.scrollY ?? 0) - headerHeight;
        doc.defaultView?.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        section.querySelector<HTMLElement>(".fi-section__header")?.focus({ preventScroll: true });
    }

    /**
     * 初始化彈出視窗文件並綁定事件。
     * 📌 富果分頁重新整理後，window.open 會取回既有的彈出視窗；
     *    document.open() 會清除舊頁面留下的監聽器，再由本實例重新綁定，互動才不會失效。
     */
    private prepare(win: Window): void {
        const doc = win.document;
        doc.open();
        doc.write(
            `<!doctype html><html lang="zh-Hant" data-fi-theme="${escapeHtml(this.deps.getTheme())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(this.deps.getTitle())}</title><style>${STYLESHEET}</style><style>${POPUP_STYLESHEET}</style></head><body><div id="fi-card" class="fi-root"></div></body></html>`
        );
        doc.close();
        this.lastHtml = null;
        const current = win.document;
        current.documentElement.dataset.fiOwner = this.ownerId;
        this.prepared.add(current);
        // 固定的函式參照：同一份文件重複綁定時，瀏覽器會忽略重複的監聽器（不依賴 document.open() 清除監聽器）
        current.addEventListener("click", this.onPopupClick);
    }

    private readonly onPopupClick = (event: MouseEvent): void => {
        const doc = event.currentTarget as Document;
        // 舊頁面遺留的監聽器（若仍存活）不會處理不屬於自己的視窗內容
        if (doc.documentElement.dataset.fiOwner !== this.ownerId) return;
        const target = (event.target as Element | null)?.closest?.<HTMLElement>("[data-action], a[data-fi-nav]");
        if (!target) return;
        const gotoSection = target.dataset.action === "goto" ? (target.dataset.section ?? "") : null;
        this.deps.onAction(target, event);
        if (gotoSection !== null) {
            // 先同步（展開卡片與區塊），再在彈出視窗內捲動
            this.syncNow();
            this.scrollToSection(doc, gotoSection);
        } else {
            this.sync();
        }
    };
}
