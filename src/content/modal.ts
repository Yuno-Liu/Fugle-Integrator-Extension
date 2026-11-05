/**
 * ============================================================================
 * 🪟 無障礙對話框
 * ============================================================================
 *
 * - role="dialog" + aria-modal，標題以 aria-labelledby 關聯
 * - Esc 關閉、點擊遮罩關閉、Tab 焦點鎖定在對話框內
 * - 關閉後焦點回到開啟前的元素
 * - 輸入法選字中（isComposing）按下的 Esc 不會關閉對話框
 */

import { html } from "../utils/html";

export interface ModalHandle {
    root: HTMLElement;
    body: HTMLElement;
    close(): void;
}

export interface ModalOptions {
    id: string;
    title: string;
    onClose?: () => void;
    /** 顯示在哪份文件（頁面或彈出視窗） */
    doc?: Document;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 目前開啟中的對話框（依文件與 id）；重複開啟時先正常關閉舊的，避免遺留監聽器 */
const openModals = new WeakMap<Document, Map<string, ModalHandle>>();

/** 輸入法正在組字（注音、拼音選字）時的按鍵不應被當成指令 */
export function isImeComposing(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
}

/** 文件中是否有開啟的整合器對話框 */
export function hasOpenModal(doc: Document = document): boolean {
    return (openModals.get(doc)?.size ?? 0) > 0;
}

/** 關閉文件中所有整合器對話框 */
export function closeAllModals(doc: Document = document): void {
    for (const handle of [...(openModals.get(doc)?.values() ?? [])]) handle.close();
}

export function openModal({ id, title, onClose, doc = document }: ModalOptions): ModalHandle {
    let registry = openModals.get(doc);
    if (!registry) {
        registry = new Map();
        openModals.set(doc, registry);
    }
    registry.get(id)?.close();
    doc.getElementById(id)?.remove();

    const view = doc.defaultView;
    const active = doc.activeElement;
    const previouslyFocused = view && active instanceof view.HTMLElement ? active : null;

    const root = doc.createElement("div");
    root.id = id;
    root.className = "fi-root fi-modal-backdrop";
    const titleId = `${id}-title`;
    root.innerHTML = html`<div class="fi-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}"><div class="fi-modal__header"><h2 class="fi-modal__title" id="${titleId}">${title}</h2><button type="button" class="fi-icon-btn" data-modal-close aria-label="關閉" title="關閉（Esc）">✕</button></div><div class="fi-modal__body"></div></div>`.value;
    doc.body.appendChild(root);

    const body = root.querySelector<HTMLElement>(".fi-modal__body") as HTMLElement;
    let closed = false;

    const handle: ModalHandle = {
        root,
        body,
        close: () => {
            if (closed) return;
            closed = true;
            root.remove();
            doc.removeEventListener("keydown", onKeydown, true);
            if (registry?.get(id) === handle) registry.delete(id);
            if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
            onClose?.();
        },
    };

    const onKeydown = (event: KeyboardEvent): void => {
        if (!root.isConnected || isImeComposing(event)) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            handle.close();
            return;
        }
        if (event.key !== "Tab") return;
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
        if (items.length === 0) return;
        const first = items[0] as HTMLElement;
        const last = items[items.length - 1] as HTMLElement;
        const current = doc.activeElement;
        if (event.shiftKey && (current === first || !root.contains(current))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (current === last || !root.contains(current))) {
            event.preventDefault();
            first.focus();
        }
    };

    // capture：在富果自身的快捷鍵處理之前攔截 Esc / Tab
    doc.addEventListener("keydown", onKeydown, true);
    root.addEventListener("mousedown", (event) => {
        if (event.target === root) handle.close();
    });
    root.querySelector("[data-modal-close]")?.addEventListener("click", () => handle.close());

    registry.set(id, handle);
    return handle;
}
