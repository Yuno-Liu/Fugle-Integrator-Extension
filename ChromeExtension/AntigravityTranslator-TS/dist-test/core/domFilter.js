/**
 * ============================================================================
 * 🔍 Antigravity Translator - DOM 元素過濾與網域名稱匹配核心 (DOM Filter)
 * ============================================================================
 *
 * 本模組負責：
 * 1. 智慧識別與跳過無須翻譯的純文字（純數字、金額、網址、程式碼符號、空標點等）
 * 2. 比對網域名稱黑白名單規則（支援精確比對、根網域子網域比對與萬用字元）
 * 3. 判斷 DOM 元素是否應排除於翻譯流程之外（排除特定標籤、不可翻譯屬性與自訂 Selector）
 */
import { DEFAULT_EXCLUDED_TAGS } from "../config/constants.js";
/**
 * 判斷指定文字內容是否應跳過翻譯
 *
 * @param text - 待檢驗的字串
 * @param skipNumbersAndCodes - 是否開啟略過純數字、金額、版本與程式碼之選項
 * @returns boolean - true 代表應略過，false 代表應進行翻譯
 */
export function shouldSkipText(text, skipNumbersAndCodes) {
    if (!text) {
        return true;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return true;
    }
    // 若僅有單一字元且為標點或空白符號，跳過
    if (trimmed.length === 1 && !/[\p{L}\p{N}]/u.test(trimmed)) {
        return true;
    }
    // 全文字串中若完全不包含任何可發音語言字母或數字（純符號/線條/空格），直接跳過
    if (!/[\p{L}\p{N}]/u.test(trimmed)) {
        return true;
    }
    if (!skipNumbersAndCodes) {
        return false;
    }
    // 1. 純數字、金額、貨幣、正負百分比 (例如: "$1,234.56", "+5.2%", "100%", "NT$ 500", "€12.00")
    const numericOrCurrencyRegex = /^[\s$€£¥NT¥+\-~≈]*[\d,]+(?:\.\d+)?%?[\s]*$/i;
    if (numericOrCurrencyRegex.test(trimmed)) {
        return true;
    }
    // 2. 日期與時間格式 (例如: "2026-10-20", "2026/10/20 23:30", "14:20:00", "11:30 PM")
    const dateRegex = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;
    const timeRegex = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?$/i;
    if (dateRegex.test(trimmed) || timeRegex.test(trimmed)) {
        return true;
    }
    // 3. 網址 URL (http/https/ftp 或以 www 開頭)
    const urlRegex = /^(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    const wwwRegex = /^www\.[a-z0-9\-]+(?:\.[a-z0-9\-]+)+(?:[/?#]\S*)?$/i;
    if (urlRegex.test(trimmed) || wwwRegex.test(trimmed)) {
        return true;
    }
    // 4. 電子郵件信箱 Email
    const emailRegex = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
    if (emailRegex.test(trimmed)) {
        return true;
    }
    // 5. 軟體版本號 (例如: "v1.2.3", "v24.14.1", "3.8.0-rc1")
    const versionRegex = /^v?\d+(?:\.\d+)+(?:-[a-zA-Z0-9.]+)?$/i;
    if (versionRegex.test(trimmed)) {
        return true;
    }
    return false;
}
/**
 * 檢查目前網域名稱是否符合指定的網域清單規則
 *
 * 支援比對情境：
 * 1. 完整網域精準比對：`example.com` 匹配 `example.com`
 * 2. 根網域子網域涵蓋：`example.com` 同時匹配 `www.example.com` 與 `api.sub.example.com`
 * 3. 萬用字元前綴比對：`*.example.com` 匹配 `sub.example.com`
 *
 * @param hostname - 當前頁面之主機名稱 (window.location.hostname)
 * @param patterns - 網域規則陣列
 * @returns boolean - true 代表符合規則
 */
export function matchesDomainList(hostname, patterns) {
    if (!hostname || !patterns || patterns.length === 0) {
        return false;
    }
    const host = hostname.toLowerCase().trim();
    if (!host) {
        return false;
    }
    for (const pattern of patterns) {
        let p = pattern.toLowerCase().trim();
        if (!p)
            continue;
        // 精確比對
        if (p === host) {
            return true;
        }
        // 萬用字元萬用匹配 (例如: *.fugle.tw)
        if (p.startsWith("*.")) {
            const rootDomain = p.slice(2);
            if (host === rootDomain || host.endsWith("." + rootDomain)) {
                return true;
            }
        }
        // 自動子網域延伸比對 (若 pattern 為 fugle.tw，則 www.fugle.tw 亦匹配)
        if (host.endsWith("." + p)) {
            return true;
        }
    }
    return false;
}
/**
 * 檢查指定的 DOM 元素或其父層祖先是否屬於被排除翻譯的範圍
 *
 * 排除條件包含：
 * - 屬於非文字渲染標籤 (SCRIPT, STYLE, PRE, CODE, SVG, INPUT, TEXTAREA 等)
 * - 具備 `translate="no"` 屬性
 * - 具備 `contenteditable="true"` 屬性 (避免破壞富文本編輯器)
 * - 具備 `.notranslate` 或 `.no-translate` 等防翻譯樣式類別
 * - 符合使用者自訂的 CSS 選擇器清單 (安全 try-catch 保護)
 *
 * @param el - 欲檢查之 DOM 元素
 * @param excludedSelectors - 使用者自訂排除選擇器清單
 * @returns boolean - true 代表應排除，不可翻譯
 */
export function isElementExcluded(el, excludedSelectors = []) {
    if (!el || typeof el.closest !== "function") {
        return false;
    }
    // 1. 檢查自身或祖先標籤名稱是否在預設排除清單中
    let current = el;
    while (current) {
        const tagName = current.tagName?.toUpperCase();
        if (tagName && DEFAULT_EXCLUDED_TAGS.has(tagName)) {
            return true;
        }
        current = current.parentElement;
    }
    // 2. 檢查常用不可翻譯標準屬性與 class
    try {
        const hasExcludedAttr = el.closest('[translate="no"], [contenteditable="true"], .notranslate, .no-translate');
        if (hasExcludedAttr) {
            return true;
        }
    }
    catch {
        // 忽略偽類錯誤
    }
    // 3. 檢查使用者自訂的排除 CSS 選擇器
    if (excludedSelectors && excludedSelectors.length > 0) {
        for (const selector of excludedSelectors) {
            const sel = selector.trim();
            if (!sel)
                continue;
            try {
                if (el.closest(sel)) {
                    return true;
                }
            }
            catch {
                // 使用者可能輸入了非法的 CSS 選擇器，安全忽略以避免程式崩潰
            }
        }
    }
    return false;
}
