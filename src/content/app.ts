/**
 * ============================================================================
 * 🚀 content script 控制器
 * ============================================================================
 *
 * 📌 SPA 偵測方式：每 400ms 讀取頁面上的「股票代碼」文字（而非網址）。
 *    - 富果會改寫網址查詢參數（?p=…），以網址判斷會重複載入
 *    - 網址變了但頁面還沒渲染新股票時，讀到的會是舊代碼
 *    以實際顯示的代碼為準即可避免以上問題，也能涵蓋任何導覽方式。
 * 📌 富果重新渲染頁首而移除注入元素時，下一次輪詢會自動重新掛上（不重抓資料）。
 * 📌 離開個股頁超過 1.5 秒，會移除工具列與資訊卡。
 */

import type { CardPosition, CategoryType, ResolvedTheme, UiSettings } from "../shared/types";
import { FUGLE, UNMOUNT_GRACE_MS, WATCH_INTERVAL_MS } from "../shared/constants";
import { ensureStyles } from "../ui/styles";
import { matchesShortcut } from "../utils/shortcut";
import { log } from "../utils/log";
import { ExtensionContextError, fetchDataset, isContextValid, query, send } from "./api";
import { InfoCard } from "./card";
import { cancelNavigationFallback, navigateToStock } from "./navigation";
import { findSearchInput, hasDarkMarker, isDarkBackground, readPrice, readStockContext } from "./page";
import type { StockContext } from "./page";
import { PopupMirror } from "./popup";
import { closeAllModals, hasOpenModal } from "./modal";
import { openSearch } from "./search";
import { SettingsStore } from "./settingsStore";
import { Toolbar } from "./toolbar";
import { Clock, EstimateBadge } from "./widgets";

const THEME_CHECK_INTERVAL_MS = 1500;
/** 沒有深色標記時，以背景亮度判斷主題（getComputedStyle 較昂貴）的間隔 */
const BACKGROUND_CHECK_INTERVAL_MS = 15_000;
/** 監看迴圈中重新計算浮動卡片位置的最短間隔（捲動 / 縮放事件另外即時處理） */
const POSITION_CHECK_INTERVAL_MS = 2000;

export class App {
    readonly settings = new SettingsStore();
    private readonly toolbar: Toolbar;
    private readonly card: InfoCard;
    private readonly popup: PopupMirror;
    private readonly estimate = new EstimateBadge();
    private readonly clock = new Clock();

    private current: StockContext | null = null;
    private missingSince: number | null = null;
    private loop: ReturnType<typeof setInterval> | null = null;
    private theme: ResolvedTheme = "light";
    private lastThemeCheck = 0;
    private lastBackgroundCheck = 0;
    private backgroundDark = false;
    private lastPositionCheck = 0;
    private stopped = false;
    private scrollFrame: number | null = null;

    constructor() {
        this.toolbar = new Toolbar(
            {
                search: () => this.openSearch(),
                setPosition: (position: CardPosition) => void this.settings.update({ position }),
                popout: () => this.popout(),
                setVisible: (visible: boolean) => void this.settings.update({ visible }),
                openOptions: () => this.openOptions(),
            },
            () => this.settings.get()
        );

        this.card = new InfoCard({
            getSettings: () => this.settings.get(),
            updateSettings: (patch) => void this.settings.update(patch),
            setSection: (id, open) => void this.settings.setSection(id, open),
            fetchDataset,
            fetchRelated: (stockId, extra, limit) => query({ type: "related", stockId, extra, limit }),
            readPrice: () => readPrice(),
            navigate: (code) => this.navigate(code),
            openCategory: (type, name, doc) => this.openSearch({ type, name }, doc),
            popout: () => this.popout(),
            changed: () => this.popup.sync(),
            contextLost: () => this.shutdown(),
            now: () => new Date(),
        });

        this.popup = new PopupMirror({
            getCard: () => this.card.element,
            getTitle: () => (this.current ? `${this.current.name || this.current.stockId}（${this.current.stockId}）· 富果整合器` : "富果整合器"),
            getTheme: () => this.theme,
            onAction: (target, event) => this.card.handleAction(target, event),
        });
    }

    async start(): Promise<void> {
        await this.settings.load();
        ensureStyles();
        this.applyTheme(true);
        this.settings.onChange((settings, changed) => this.onSettingsChanged(settings, changed));

        document.addEventListener("keydown", this.onKeydown, true);
        document.addEventListener("visibilitychange", this.onVisibility);
        window.addEventListener("popstate", this.onNavigationHint);
        window.addEventListener("resize", this.onNavigationHint);
        window.addEventListener("scroll", this.onScroll, { passive: true });
        window.addEventListener("pagehide", this.onPageHide);

        this.startLoop();
        this.tick();
    }

    // ------------------------------------------------------------------------
    // 監看迴圈
    // ------------------------------------------------------------------------

    private startLoop(): void {
        if (this.loop === null && !this.stopped) this.loop = setInterval(this.tick, WATCH_INTERVAL_MS);
    }

    private stopLoop(): void {
        if (this.loop !== null) clearInterval(this.loop);
        this.loop = null;
    }

    private readonly onVisibility = (): void => {
        if (document.hidden) {
            this.stopLoop();
            this.clock.pause();
        } else {
            this.startLoop();
            this.tick();
        }
    };

    private readonly onNavigationHint = (): void => {
        // popstate / resize 後提早檢查一次（富果渲染需要一點時間，交由輪詢接手）
        setTimeout(this.tick, 50);
    };

    readonly tick = (): void => {
        if (this.stopped) return;
        if (!isContextValid()) {
            this.shutdown();
            return;
        }
        try {
            this.applyTheme();
            this.clock.ensure();

            const ctx = readStockContext();
            if (!ctx) {
                const now = Date.now();
                this.missingSince ??= now;
                if (now - this.missingSince >= UNMOUNT_GRACE_MS) this.unmount();
                return;
            }
            this.missingSince = null;

            if (!this.current || this.current.stockId !== ctx.stockId) {
                this.current = ctx;
                this.card.load(ctx);
                this.lastPositionCheck = 0;
            } else if (ctx.name !== this.current.name || ctx.market !== this.current.market) {
                this.current = ctx;
                this.card.updateIdentity(ctx);
            }

            this.toolbar.ensure(ctx);
            this.estimate.update();
            this.card.ensureMounted();
            this.card.setSuppressed(this.popup.isOpen());
            this.card.syncPrice(readPrice());
            // 位置只在必要時重算（getBoundingClientRect 會強制排版）
            if (Date.now() - this.lastPositionCheck >= POSITION_CHECK_INTERVAL_MS) this.positionCard();
        } catch (error) {
            log.error("監看迴圈錯誤：", error);
        }
    };

    private readonly onScroll = (): void => {
        if (this.scrollFrame !== null) return;
        this.scrollFrame = requestAnimationFrame(() => {
            this.scrollFrame = null;
            this.positionCard();
        });
    };

    /**
     * 浮動資訊卡的頂端對齊「個股頁首（含工具列）」的下緣，捲動時跟著上移到導覽列下方。
     * 不論靠左或靠右，都不會遮住股票名稱、價格與整合器工具列。
     */
    private positionCard(): void {
        this.lastPositionCheck = Date.now();
        const card = this.card.element;
        if (!card || card.hidden || !card.classList.contains("fi-card--floating")) return;
        const nav = document.querySelector("header.header, header");
        const header = document.querySelector(FUGLE.header);
        const navBottom = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
        const headerBottom = header ? header.getBoundingClientRect().bottom : navBottom;
        const min = Math.round(navBottom + 8);
        const max = Math.max(min, Math.round(window.innerHeight * 0.45));
        const top = Math.min(Math.max(Math.round(headerBottom + 8), min), max);
        const value = `${top}px`;
        if (card.style.getPropertyValue("--fi-card-top") !== value) card.style.setProperty("--fi-card-top", value);
    }

    private unmount(): void {
        if (!this.current && !this.card.element && !this.toolbar.element) return;
        this.current = null;
        this.toolbar.remove();
        this.estimate.remove();
        this.card.remove();
        this.popup.sync();
    }

    /** 擴充功能被更新或停用：停止所有計時器並提示重新整理 */
    private shutdown(): void {
        if (!this.stopped) this.stop();
        // 每次都停止卡片的載入流程，避免稍後完成的請求覆寫這則提示
        this.card.halt("⚠ 擴充功能已更新，請重新整理頁面以載入新版本");
    }

    /** 停止監看與所有計時器、移除事件監聽（保留畫面上的元素） */
    stop(): void {
        this.stopped = true;
        this.stopLoop();
        cancelNavigationFallback();
        this.clock.pause();
        if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
        this.scrollFrame = null;
        document.removeEventListener("keydown", this.onKeydown, true);
        document.removeEventListener("visibilitychange", this.onVisibility);
        window.removeEventListener("popstate", this.onNavigationHint);
        window.removeEventListener("resize", this.onNavigationHint);
        window.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("pagehide", this.onPageHide);
        this.popup.sync.cancel();
    }

    /** 頁面即將卸載（重新整理、離開）：讓彈出視窗顯示「已停止同步」 */
    private readonly onPageHide = (): void => {
        this.popup.detach();
    };

    // ------------------------------------------------------------------------
    // 設定與主題
    // ------------------------------------------------------------------------

    private onSettingsChanged(settings: UiSettings, changed: ReadonlySet<keyof UiSettings>): void {
        if (changed.has("theme")) this.applyTheme(true);
        if (changed.has("position") || changed.has("visible") || changed.has("collapsed")) {
            this.card.applySettings(settings);
            this.toolbar.syncState(settings);
            this.positionCard();
        }
        if (changed.has("hiddenLinks") && this.current) this.toolbar.ensure(this.current);
        if (changed.has("sections")) this.card.applySectionStates(settings.sections);
        this.popup.sync();
    }

    private applyTheme(force = false): void {
        const now = Date.now();
        if (!force && now - this.lastThemeCheck < THEME_CHECK_INTERVAL_MS) return;
        this.lastThemeCheck = now;
        const pref = this.settings.get().theme;
        let theme: ResolvedTheme;
        if (pref !== "auto") theme = pref;
        else if (hasDarkMarker()) theme = "dark";
        else {
            // 沒有深色標記時才用背景亮度判斷，且降低頻率
            if (force || now - this.lastBackgroundCheck >= BACKGROUND_CHECK_INTERVAL_MS) {
                this.lastBackgroundCheck = now;
                this.backgroundDark = isDarkBackground();
            }
            theme = this.backgroundDark ? "dark" : "light";
        }
        if (theme !== this.theme || document.documentElement.getAttribute("data-fi-theme") !== theme) {
            this.theme = theme;
            document.documentElement.setAttribute("data-fi-theme", theme);
            this.popup.sync();
        }
    }

    // ------------------------------------------------------------------------
    // 動作
    // ------------------------------------------------------------------------

    private navigate(code: string): void {
        navigateToStock(code);
        setTimeout(this.tick, 50);
        try {
            window.focus();
        } catch {
            // 忽略
        }
    }

    /** 開啟搜尋視窗；doc 為要顯示的文件（從彈出視窗點擊時開在彈出視窗內） */
    private openSearch(category?: { type: CategoryType; name: string }, doc: Document = document): void {
        openSearch({ currentStockId: () => this.current?.stockId ?? null, navigate: (code) => this.navigate(code) }, category, doc);
    }

    private popout(): void {
        if (!this.popup.open()) {
            this.card.setStatus("⚠ 瀏覽器阻擋了彈出視窗，請允許 www.fugle.tw 開啟彈出視窗", true);
            return;
        }
        this.card.setSuppressed(true);
    }

    private openOptions(): void {
        send({ type: "openOptions" }).catch((error: unknown) => {
            if (error instanceof ExtensionContextError) this.shutdown();
        });
    }

    private readonly onKeydown = (event: KeyboardEvent): void => {
        if (!matchesShortcut(event, this.settings.get().shortcut)) return;
        event.preventDefault();
        event.stopPropagation();
        // 整合器的對話框開著時先關閉，否則焦點會跑到被遮住的富果搜尋框
        if (hasOpenModal()) closeAllModals();
        const input = findSearchInput();
        if (input) {
            input.scrollIntoView({ behavior: "smooth", block: "center" });
            input.focus();
            input.select();
        } else {
            // 找不到富果搜尋框時，改開啟整合器的搜尋視窗
            this.openSearch();
        }
    };
}
