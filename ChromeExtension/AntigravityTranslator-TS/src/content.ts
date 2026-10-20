/**
 * ============================================================================
 * 🌐 Antigravity Translator - 網頁內容腳本核心引擎 (Content Script Engine)
 * ============================================================================
 *
 * 本模組負責在網頁中執行全域翻譯協調整合：
 * 1. 初始化設定與黑白名單比對 (Excluded & Auto-Translate Domains)
 * 2. 智慧 DOM 文字節點收集、排版結構分析與無損還原記錄 (Lossless Restore)
 * 3. 視窗可見區域優先翻譯 (Viewport Priority with IntersectionObserver)
 * 4. 三種渲染模式即時無縫切換 (Bilingual / Replace / Hover)
 * 5. 單頁應用 (SPA) 動態 DOM 變更監聽增量翻譯 (MutationObserver)
 * 6. 滑鼠修飾鍵段落懸停翻譯與反白劃詞翻譯氣泡整合
 * 7. 鍵盤快速鍵與 Chrome Runtime Message 雙向通訊
 */

import { getConfig } from "./config/constants.js";
import { isElementExcluded, matchesDomainList, shouldSkipText } from "./core/domFilter.js";
import { chunkTranslationItems } from "./core/textChunker.js";
import {
    injectTranslatorStyles,
    updateTranslatorStyleVariables
} from "./ui/styles.js";
import {
    FloatingTranslatorWidget,
    SelectionTooltipWidget
} from "./ui/widget.js";
import type {
    DisplayMode,
    PageTranslationState,
    RuntimeMessage,
    TranslationBatchResponse,
    TranslationItem,
    TranslatorConfig
} from "./types/index.js";

// ============================================================================
// 內部狀態與資料節點紀錄結構
// ============================================================================

/**
 * 追蹤被翻譯的 DOM 文字節點紀錄
 */
interface TextNodeRecord {
    id: string;
    node: Text;
    originalText: string;
    translatedText?: string;
    translatedElement?: HTMLElement;
    parentElement: HTMLElement;
}

/**
 * 追蹤被翻譯的 DOM 標籤屬性紀錄
 */
interface AttrRecord {
    id: string;
    element: HTMLElement;
    attrName: string;
    originalValue: string;
    translatedValue?: string;
}

/**
 * 擴充套件全域設定快取
 */
let currentConfig: TranslatorConfig;

/**
 * 分頁翻譯狀態
 */
const pageState: PageTranslationState = {
    isTranslated: false,
    isTranslating: false,
    totalNodes: 0,
    translatedNodes: 0,
    cachedNodes: 0,
    failedNodes: 0,
    displayMode: "bilingual",
    model: "gemini-3.8-flash",
    effort: "low"
};

/**
 * 註冊追蹤的所有文字節點 (Key: id)
 */
const trackedTextNodes = new Map<string, TextNodeRecord>();

/**
 * 註冊追蹤的所有屬性節點 (Key: id)
 */
const trackedAttrs = new Map<string, AttrRecord>();

/**
 * 懸浮控制球元件實例
 */
let floatingWidget: FloatingTranslatorWidget | null = null;

/**
 * 劃詞翻譯氣泡卡片實例
 */
let selectionWidget: SelectionTooltipWidget | null = null;

/**
 * 增量 DOM 變更監聽器
 */
let domMutationObserver: MutationObserver | null = null;

/**
 * 視窗可見區域交叉監聽器
 */
let viewportObserver: IntersectionObserver | null = null;

/**
 * 節點 ID 計數器
 */
let nodeIdCounter = 0;

// ============================================================================
// 1. 輔助工具函式
// ============================================================================

/**
 * 產生唯一節點識別 ID
 */
function generateNodeId(): string {
    nodeIdCounter++;
    return `agy_node_${nodeIdCounter}`;
}

/**
 * 判斷指定 DOM 文字節點之父容器是否處於當前螢幕可視範圍 (Viewport) 內
 */
function isNodeInViewport(parentElement: HTMLElement): boolean {
    const rect = parentElement.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    return (
        rect.top < windowHeight + 250 &&
        rect.bottom > -250 &&
        rect.left < windowWidth &&
        rect.right > 0 &&
        rect.width > 0 &&
        rect.height > 0
    );
}

/**
 * 比對鍵盤事件是否符合自訂快捷鍵設定 (例如 "Alt+T" 或 "Ctrl+Shift+S")
 */
function isShortcutPressed(event: KeyboardEvent, shortcutStr: string): boolean {
    if (!shortcutStr) return false;
    const parts = shortcutStr.split("+").map((s) => s.trim().toLowerCase());
    const key = event.key.toLowerCase();

    const needAlt = parts.includes("alt");
    const needCtrl = parts.includes("ctrl") || parts.includes("control");
    const needShift = parts.includes("shift");
    const needMeta = parts.includes("meta") || parts.includes("command") || parts.includes("cmd");

    if (needAlt !== event.altKey) return false;
    if (needCtrl !== event.ctrlKey) return false;
    if (needShift !== event.shiftKey) return false;
    if (needMeta !== event.metaKey) return false;

    const mainKey = parts.find(
        (p) => !["alt", "ctrl", "control", "shift", "meta", "command", "cmd"].includes(p)
    );

    return mainKey ? mainKey === key : true;
}

// ============================================================================
// 2. DOM 節點收集與批次翻譯核心流程
// ============================================================================

/**
 * 收集頁面中所有合法的待翻譯文字節點與屬性
 */
function collectTranslatableNodes(): {
    textItems: TranslationItem[];
    attrItems: TranslationItem[];
} {
    if (!document.body) {
        return { textItems: [], attrItems: [] };
    }

    const textItems: TranslationItem[] = [];
    const attrItems: TranslationItem[] = [];

    // 建立 DOM TreeWalker 專門遍歷文字節點
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node: Text) => {
                const parent = node.parentElement;
                if (!parent) {
                    return NodeFilter.FILTER_REJECT;
                }

                // 排除宿主翻譯器本身的 Shadow DOM 容器
                if (
                    parent.closest("#agy-floating-widget-host") ||
                    parent.closest("#agy-selection-widget-host") ||
                    parent.classList.contains("agy-translated-block")
                ) {
                    return NodeFilter.FILTER_REJECT;
                }

                // 檢查是否符合黑名單標籤或選擇器排除
                if (isElementExcluded(parent, currentConfig.excludedSelectors)) {
                    return NodeFilter.FILTER_REJECT;
                }

                const text = node.nodeValue || "";
                if (shouldSkipText(text, currentConfig.skipNumbersAndCodes)) {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let currentNode = walker.nextNode() as Text | null;
    while (currentNode) {
        const parent = currentNode.parentElement;
        if (parent) {
            const rawText = currentNode.nodeValue || "";
            const id = generateNodeId();

            trackedTextNodes.set(id, {
                id,
                node: currentNode,
                originalText: rawText,
                parentElement: parent
            });

            textItems.push({
                id,
                text: rawText.trim()
            });
        }
        currentNode = walker.nextNode() as Text | null;
    }

    // 若設定啟用了屬性翻譯，一併收集常見標籤之提示字串
    if (currentConfig.translateAttributes) {
        const attributeTargets = ["placeholder", "title", "aria-label"];
        const selector = attributeTargets.map((attr) => `[${attr}]`).join(", ");
        const elements = document.body.querySelectorAll(selector);

        elements.forEach((el) => {
            if (isElementExcluded(el, currentConfig.excludedSelectors)) {
                return;
            }

            for (const attrName of attributeTargets) {
                const attrVal = el.getAttribute(attrName);
                if (attrVal && !shouldSkipText(attrVal, currentConfig.skipNumbersAndCodes)) {
                    const id = generateNodeId();
                    trackedAttrs.set(id, {
                        id,
                        element: el as HTMLElement,
                        attrName,
                        originalValue: attrVal
                    });

                    attrItems.push({
                        id,
                        text: attrVal.trim()
                    });
                }
            }
        });
    }

    return { textItems, attrItems };
}

/**
 * 依據當前顯示模式 (DisplayMode) 渲染單一文字節點之翻譯成果
 */
function renderTranslatedNode(record: TextNodeRecord, mode: DisplayMode): void {
    if (!record.translatedText) {
        return;
    }

    switch (mode) {
        case "bilingual": {
            // 恢復原文內容
            record.node.nodeValue = record.originalText;

            // 建立或更新雙語譯文區塊
            if (!record.translatedElement) {
                const block = document.createElement("span");
                block.className = `agy-translated-block agy-hl-${currentConfig.highlightStyle}`;
                block.dataset.agyFor = record.id;
                block.textContent = record.translatedText;
                record.translatedElement = block;

                // 插入至文字節點緊鄰後方
                if (record.node.nextSibling) {
                    record.node.parentNode?.insertBefore(block, record.node.nextSibling);
                } else {
                    record.node.parentNode?.appendChild(block);
                }
            } else {
                record.translatedElement.style.display = "";
                record.translatedElement.className = `agy-translated-block agy-hl-${currentConfig.highlightStyle}`;
                record.translatedElement.textContent = record.translatedText;
            }

            // 原文淡化樣式
            if (currentConfig.dimOriginal && record.parentElement) {
                record.parentElement.classList.add("agy-dim-original");
            }
            break;
        }

        case "replace": {
            // 隱藏雙語區塊
            if (record.translatedElement) {
                record.translatedElement.style.display = "none";
            }
            // 直接替換節點字串
            record.node.nodeValue = record.translatedText;
            record.parentElement.classList.remove("agy-dim-original");
            record.parentElement.removeAttribute("title");
            break;
        }

        case "hover": {
            // 隱藏雙語區塊
            if (record.translatedElement) {
                record.translatedElement.style.display = "none";
            }
            // 替換為譯文，並將原文記錄於 title 懸停氣泡提示中
            record.node.nodeValue = record.translatedText;
            record.parentElement.title = `【原文】：${record.originalText}`;
            record.parentElement.classList.remove("agy-dim-original");
            break;
        }
    }
}

/**
 * 依據當前顯示模式渲染屬性翻譯
 */
function renderTranslatedAttr(record: AttrRecord, mode: DisplayMode): void {
    if (!record.translatedValue) {
        return;
    }

    if (mode === "replace" || mode === "hover") {
        record.element.setAttribute(record.attrName, record.translatedValue);
    } else {
        // 雙語模式下將原文與譯文並列標註
        record.element.setAttribute(
            record.attrName,
            `${record.originalValue} (${record.translatedValue})`
        );
    }
}

/**
 * 發送批次翻譯項目至 Background Service Worker 處理
 */
async function dispatchBatchTranslation(batch: TranslationItem[]): Promise<void> {
    if (batch.length === 0) {
        return;
    }

    try {
        const response = await new Promise<TranslationBatchResponse>((resolve) => {
            chrome.runtime.sendMessage(
                {
                    action: "TRANSLATE_BATCH",
                    payload: batch
                },
                (res: TranslationBatchResponse) => {
                    resolve(res);
                }
            );
        });

        if (response && response.success && response.translations) {
            const translations = response.translations;

            for (const item of batch) {
                const translated = translations[item.id];
                if (!translated) continue;

                // 處理文字節點
                const textRec = trackedTextNodes.get(item.id);
                if (textRec) {
                    textRec.translatedText = translated;
                    renderTranslatedNode(textRec, pageState.displayMode);
                    pageState.translatedNodes++;
                }

                // 處理屬性節點
                const attrRec = trackedAttrs.get(item.id);
                if (attrRec) {
                    attrRec.translatedValue = translated;
                    renderTranslatedAttr(attrRec, pageState.displayMode);
                    pageState.translatedNodes++;
                }
            }

            if (response.cachedCount) {
                pageState.cachedNodes += response.cachedCount;
            }

            if (floatingWidget) {
                floatingWidget.updateState(pageState);
            }
        } else if (response && response.error) {
            pageState.lastError = response.error;
            pageState.failedNodes += batch.length;
            if (floatingWidget) {
                floatingWidget.updateState(pageState);
            }
        }
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        pageState.lastError = errorMsg;
        pageState.failedNodes += batch.length;
        if (floatingWidget) {
            floatingWidget.updateState(pageState);
        }
    }
}

/**
 * 啟動網頁全站翻譯
 */
export async function startPageTranslation(): Promise<void> {
    if (pageState.isTranslating) {
        return;
    }

    // 檢查是否處於排除網域中
    if (matchesDomainList(window.location.hostname, currentConfig.excludedDomains)) {
        return;
    }

    pageState.isTranslating = true;
    pageState.isTranslated = false;
    pageState.lastError = undefined;
    pageState.displayMode = currentConfig.displayMode;
    pageState.model = currentConfig.model;
    pageState.effort = currentConfig.effort;

    // 清理先前狀態
    restorePage();

    // 收集待翻譯元素
    const { textItems, attrItems } = collectTranslatableNodes();
    const allItems = [...textItems, ...attrItems];

    pageState.totalNodes = allItems.length;
    pageState.translatedNodes = 0;
    pageState.cachedNodes = 0;
    pageState.failedNodes = 0;

    if (floatingWidget) {
        floatingWidget.updateState(pageState);
    }

    if (allItems.length === 0) {
        pageState.isTranslating = false;
        pageState.isTranslated = true;
        if (floatingWidget) {
            floatingWidget.updateState(pageState);
        }
        return;
    }

    const isSingleBatch = currentConfig.singleBatchMode !== false;
    const batchSize = currentConfig.batchSize || 100;
    const maxChars = currentConfig.maxCharsPerBatch || 15000;

    // 可視範圍優先策略 (Viewport Priority)
    if (currentConfig.viewportPriorityOnly && typeof IntersectionObserver !== "undefined") {
        const visibleItems: TranslationItem[] = [];
        const deferredItems: TranslationItem[] = [];

        for (const item of allItems) {
            const textRec = trackedTextNodes.get(item.id);
            const parent = textRec?.parentElement;
            if (parent && isNodeInViewport(parent)) {
                visibleItems.push(item);
            } else {
                deferredItems.push(item);
            }
        }

        // 1. 優先翻譯當前畫面中的項目
        const visibleBatches = chunkTranslationItems(
            visibleItems,
            batchSize,
            maxChars,
            isSingleBatch
        );

        await Promise.all(visibleBatches.map((batch) => dispatchBatchTranslation(batch)));

        // 2. 對其餘元素註冊 IntersectionObserver，捲動進入可視範圍時再載入
        const deferredMap = new Map<HTMLElement, TranslationItem[]>();
        for (const item of deferredItems) {
            const textRec = trackedTextNodes.get(item.id);
            const parent = textRec?.parentElement;
            if (parent) {
                const list = deferredMap.get(parent) || [];
                list.push(item);
                deferredMap.set(parent, list);
            }
        }

        viewportObserver = new IntersectionObserver(
            (entries, observer) => {
                const pendingToFetch: TranslationItem[] = [];
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const targetEl = entry.target as HTMLElement;
                        const items = deferredMap.get(targetEl);
                        if (items) {
                            pendingToFetch.push(...items);
                            deferredMap.delete(targetEl);
                        }
                        observer.unobserve(targetEl);
                    }
                }

                if (pendingToFetch.length > 0) {
                    const batches = chunkTranslationItems(
                        pendingToFetch,
                        batchSize,
                        maxChars,
                        isSingleBatch
                    );
                    batches.forEach((b) => dispatchBatchTranslation(b));
                }
            },
            { rootMargin: "350px 0px" }
        );

        deferredMap.forEach((_, parentEl) => {
            viewportObserver?.observe(parentEl);
        });
    } else {
        // 全頁翻譯：支援「單次最大 Token 直出（免分批）」與「多批次真・平行併發」
        const batches = chunkTranslationItems(
            allItems,
            batchSize,
            maxChars,
            isSingleBatch
        );

        await Promise.all(batches.map((batch) => dispatchBatchTranslation(batch)));
    }

    pageState.isTranslating = false;
    pageState.isTranslated = true;
    if (floatingWidget) {
        floatingWidget.updateState(pageState);
    }
}

/**
 * 100% 無損還原網頁原始排版與文字
 */
export function restorePage(): void {
    if (viewportObserver) {
        viewportObserver.disconnect();
        viewportObserver = null;
    }

    // 1. 還原文字節點
    for (const record of trackedTextNodes.values()) {
        record.node.nodeValue = record.originalText;
        if (record.translatedElement) {
            record.translatedElement.remove();
            record.translatedElement = undefined;
        }
        if (record.parentElement) {
            record.parentElement.classList.remove("agy-dim-original");
            record.parentElement.removeAttribute("title");
        }
    }

    // 2. 還原屬性
    for (const record of trackedAttrs.values()) {
        record.element.setAttribute(record.attrName, record.originalValue);
    }

    trackedTextNodes.clear();
    trackedAttrs.clear();

    pageState.isTranslated = false;
    pageState.isTranslating = false;
    pageState.translatedNodes = 0;
    pageState.totalNodes = 0;
    pageState.cachedNodes = 0;
    pageState.failedNodes = 0;

    if (floatingWidget) {
        floatingWidget.updateState(pageState);
    }

    // 通知 Background 還原 Badge
    chrome.runtime.sendMessage({ action: "RESTORE_PAGE" });
}

/**
 * 切換頁面譯文呈現模式 (Bilingual / Replace / Hover)
 *
 * 無須重新呼叫 CLI，極速即時重新渲染已獲得的翻譯結果。
 *
 * @param newMode - 目標呈現模式
 */
export function switchDisplayMode(newMode: DisplayMode): void {
    pageState.displayMode = newMode;

    for (const record of trackedTextNodes.values()) {
        renderTranslatedNode(record, newMode);
    }

    for (const record of trackedAttrs.values()) {
        renderTranslatedAttr(record, newMode);
    }

    if (floatingWidget) {
        floatingWidget.updateState(pageState);
    }
}

// ============================================================================
// 3. SPA 動態內容監聽 (MutationObserver)
// ============================================================================

let mutationDebounceTimer: number | null = null;

/**
 * 監聽單頁應用 (SPA) 動態 DOM 載入並進行增量翻譯
 */
function setupMutationObserver(): void {
    if (typeof MutationObserver === "undefined" || !document.body) {
        return;
    }

    domMutationObserver = new MutationObserver((mutations) => {
        if (!currentConfig.dynamicMutationObserve || !pageState.isTranslated || pageState.isTranslating) {
            return;
        }

        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const node = mutation.addedNodes[i];
                    // 忽略自身懸浮球的變更
                    if (
                        node.nodeType === Node.ELEMENT_NODE &&
                        ((node as HTMLElement).id === "agy-floating-widget-host" ||
                            (node as HTMLElement).id === "agy-selection-widget-host" ||
                            (node as HTMLElement).classList.contains("agy-translated-block"))
                    ) {
                        continue;
                    }
                    hasNewNodes = true;
                    break;
                }
            }
            if (hasNewNodes) break;
        }

        if (hasNewNodes) {
            if (mutationDebounceTimer !== null) {
                window.clearTimeout(mutationDebounceTimer);
            }
            mutationDebounceTimer = window.setTimeout(() => {
                // 收集新節點增量翻譯
                const { textItems, attrItems } = collectTranslatableNodes();
                const newItems = [...textItems, ...attrItems].filter(
                    (item) => !trackedTextNodes.get(item.id)?.translatedText
                );

                if (newItems.length > 0) {
                    pageState.totalNodes += newItems.length;
                    const batches = chunkTranslationItems(
                        newItems,
                        currentConfig.batchSize || 100,
                        currentConfig.maxCharsPerBatch || 15000,
                        currentConfig.singleBatchMode !== false
                    );
                    batches.forEach((b) => dispatchBatchTranslation(b));
                }
            }, 350);
        }
    });

    domMutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// ============================================================================
// 4. 滑鼠懸停即時段落翻譯 (Hover Translate)
// ============================================================================

let inspectedElement: HTMLElement | null = null;

/**
 * 綁定滑鼠修飾鍵段落懸停即時翻譯事件
 */
function setupHoverTranslate(): void {
    const isModifierActive = (e: MouseEvent): boolean => {
        switch (currentConfig.hoverTriggerKey) {
            case "Alt":
                return e.altKey;
            case "Control":
                return e.ctrlKey;
            case "Shift":
                return e.shiftKey;
            default:
                return false;
        }
    };

    document.addEventListener("mousemove", (e: MouseEvent) => {
        if (!currentConfig.enableHoverTranslate) return;

        const target = e.target as HTMLElement | null;
        if (!target || !isModifierActive(e)) {
            if (inspectedElement) {
                inspectedElement.classList.remove("agy-hover-inspect-target");
                inspectedElement = null;
            }
            return;
        }

        if (
            target.closest("#agy-floating-widget-host") ||
            target.closest("#agy-selection-widget-host") ||
            target.classList.contains("agy-translated-block")
        ) {
            return;
        }

        if (inspectedElement && inspectedElement !== target) {
            inspectedElement.classList.remove("agy-hover-inspect-target");
        }

        inspectedElement = target;
        inspectedElement.classList.add("agy-hover-inspect-target");
    });

    document.addEventListener("click", async (e: MouseEvent) => {
        if (!currentConfig.enableHoverTranslate || !isModifierActive(e) || !inspectedElement) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const target = inspectedElement;
        target.classList.remove("agy-hover-inspect-target");
        inspectedElement = null;

        const originalText = target.innerText || target.textContent || "";
        if (!originalText.trim()) return;

        target.classList.add("agy-translating-shimmer");

        try {
            const res = await new Promise<{ translation: string; error?: string }>((resolve) => {
                chrome.runtime.sendMessage(
                    {
                        action: "TRANSLATE_SINGLE",
                        payload: { text: originalText }
                    },
                    (response) => resolve(response)
                );
            });

            target.classList.remove("agy-translating-shimmer");
            if (res && res.translation) {
                target.innerText = res.translation;
                target.title = `【原文】：${originalText}`;
            }
        } catch {
            target.classList.remove("agy-translating-shimmer");
        }
    });
}

// ============================================================================
// 5. 劃詞選取翻譯氣泡與快捷鍵監聽
// ============================================================================

/**
 * 綁定劃詞反白選取文字事件
 */
function setupSelectionTranslate(): void {
    selectionWidget = new SelectionTooltipWidget();

    // 實作單一文字向 Background 請求翻譯
    selectionWidget.onTranslateRequested = (text: string) => {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                {
                    action: "TRANSLATE_SINGLE",
                    payload: { text }
                },
                (res) => {
                    resolve(res);
                }
            );
        });
    };

    document.addEventListener("mouseup", (e: MouseEvent) => {
        if (!currentConfig.enableSelectionTranslate || !selectionWidget) {
            return;
        }

        // 避免在點擊 widget 內部時觸發
        const target = e.target as HTMLElement | null;
        if (
            target?.closest("#agy-floating-widget-host") ||
            target?.closest("#agy-selection-widget-host")
        ) {
            return;
        }

        setTimeout(() => {
            const selection = window.getSelection();
            const text = selection ? selection.toString().trim() : "";

            if (text.length >= 2 && !shouldSkipText(text, true)) {
                const range = selection?.getRangeAt(0);
                if (range) {
                    const rect = range.getBoundingClientRect();
                    selectionWidget?.showTrigger(rect.right, rect.top, text);
                }
            } else {
                // 若沒有選取文字且未展開卡片，隱藏觸發按鈕
                selectionWidget?.hide();
            }
        }, 80);
    });
}

/**
 * 綁定全域鍵盤快捷鍵
 */
function setupKeyboardShortcuts(): void {
    window.addEventListener("keydown", (e: KeyboardEvent) => {
        // 1. 全頁翻譯切換 (shortcutTogglePage, 如 Alt+T)
        if (isShortcutPressed(e, currentConfig.shortcutTogglePage)) {
            e.preventDefault();
            if (pageState.isTranslated) {
                restorePage();
            } else {
                startPageTranslation();
            }
            return;
        }

        // 2. 顯示模式輪替 (shortcutToggleMode, 如 Alt+M)
        if (isShortcutPressed(e, currentConfig.shortcutToggleMode)) {
            e.preventDefault();
            const modes: DisplayMode[] = ["bilingual", "replace", "hover"];
            const nextIdx = (modes.indexOf(pageState.displayMode) + 1) % modes.length;
            switchDisplayMode(modes[nextIdx]);
            return;
        }

        // 3. 選取文字翻譯快捷鍵 (shortcutTranslateSelection, 如 Alt+S)
        if (isShortcutPressed(e, currentConfig.shortcutTranslateSelection)) {
            const selection = window.getSelection();
            const text = selection ? selection.toString().trim() : "";
            if (text && selectionWidget) {
                e.preventDefault();
                const range = selection?.getRangeAt(0);
                const rect = range
                    ? range.getBoundingClientRect()
                    : { right: window.innerWidth / 2, top: window.innerHeight / 3 };
                selectionWidget.showCard(rect.right, rect.top, text);
            }
        }
    });
}

// ============================================================================
// 6. Chrome Runtime 通訊訊息監聽
// ============================================================================

function setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener(
        (message: RuntimeMessage<unknown>, _sender, sendResponse) => {
            switch (message.action) {
                case "TOGGLE_PAGE_TRANSLATION":
                    if (pageState.isTranslated) {
                        restorePage();
                    } else {
                        startPageTranslation();
                    }
                    sendResponse({ success: true, isTranslated: pageState.isTranslated });
                    break;

                case "RESTORE_PAGE":
                    restorePage();
                    sendResponse({ success: true });
                    break;

                case "SWITCH_DISPLAY_MODE": {
                    const mode = (message.payload as { mode: DisplayMode })?.mode || "bilingual";
                    switchDisplayMode(mode);
                    sendResponse({ success: true, mode: pageState.displayMode });
                    break;
                }

                case "GET_PAGE_STATE":
                    sendResponse(pageState);
                    break;

                case "CONFIG_UPDATED": {
                    const updated = message.payload as TranslatorConfig;
                    if (updated) {
                        currentConfig = updated;
                        updateTranslatorStyleVariables(currentConfig);
                        if (floatingWidget) {
                            floatingWidget.updateConfig(currentConfig);
                        }
                    }
                    sendResponse({ success: true });
                    break;
                }

                case "TRANSLATE_SELECTION_FROM_MENU": {
                    const payload = message.payload as { text: string };
                    if (payload && payload.text && selectionWidget) {
                        selectionWidget.showCard(
                            window.innerWidth / 2 - 160,
                            120,
                            payload.text
                        );
                    }
                    sendResponse({ success: true });
                    break;
                }

                default:
                    break;
            }
            return true;
        }
    );
}

// ============================================================================
// 7. 擴充套件啟動入口 (Bootstrap)
// ============================================================================

/**
 * 初始化 Content Script 擴充功能
 */
async function bootstrap(): Promise<void> {
    currentConfig = await getConfig();

    // 檢查排除網域名單
    if (matchesDomainList(window.location.hostname, currentConfig.excludedDomains)) {
        return;
    }

    // 注入頁面翻譯 CSS 樣式
    injectTranslatorStyles(currentConfig);

    // 建立懸浮控制球元件
    floatingWidget = new FloatingTranslatorWidget(currentConfig, pageState);
    floatingWidget.onToggleTranslate = () => {
        if (pageState.isTranslated) {
            restorePage();
        } else {
            startPageTranslation();
        }
    };
    floatingWidget.onSwitchDisplayMode = (mode: DisplayMode) => {
        switchDisplayMode(mode);
    };
    floatingWidget.onRestorePage = () => {
        restorePage();
    };

    // 建立劃詞選取翻譯氣泡
    setupSelectionTranslate();

    // 啟用懸停段落翻譯與快捷鍵
    setupHoverTranslate();
    setupKeyboardShortcuts();

    // 註冊通訊監聽與動態 DOM 觀察器
    setupMessageListeners();
    setupMutationObserver();

    // 若當前網址符合自動翻譯網域規則，自動開始全頁翻譯
    if (matchesDomainList(window.location.hostname, currentConfig.autoTranslateDomains)) {
        startPageTranslation();
    }
}

// 啟動腳本
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        bootstrap();
    });
} else {
    bootstrap();
}
