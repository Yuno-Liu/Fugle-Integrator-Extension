/**
 * ============================================================================
 * 🛡️ 安全 HTML 組裝
 * ============================================================================
 *
 * 所有外部資料（API 回傳的公司名稱、評等機構、營收說明…）都可能含有 HTML，
 * 直接插入 innerHTML 會造成 XSS。本模組提供 `html` tagged template：
 * - 插值一律自動跳脫
 * - 只有以 `raw()` 或另一個 `html` 結果包裝的內容才會原樣輸出
 *
 * @example
 * html`<a href="${url}">${name}</a>`   // name、url 皆會被跳脫
 */

/** 已確認安全的 HTML 片段 */
export class SafeHtml {
    constructor(readonly value: string) {}
    toString(): string {
        return this.value;
    }
}

const ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "`": "&#96;",
};

/** 跳脫 HTML 特殊字元（同時適用於文字節點與屬性值） */
export function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"'`]/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/** 將已知安全的字串標記為 SafeHtml（呼叫者負責確保安全） */
export function raw(value: string): SafeHtml {
    return new SafeHtml(value);
}

function renderValue(value: unknown): string {
    if (value === null || value === undefined || value === false) return "";
    if (value instanceof SafeHtml) return value.value;
    if (Array.isArray(value)) return value.map(renderValue).join("");
    return escapeHtml(value);
}

/** 自動跳脫插值的 HTML 樣板 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
    let out = strings[0] ?? "";
    for (let i = 0; i < values.length; i++) {
        out += renderValue(values[i]) + (strings[i + 1] ?? "");
    }
    return new SafeHtml(out);
}

/** 以分隔符號串接多個片段 */
export function joinHtml(parts: ReadonlyArray<SafeHtml | null | undefined | false>, separator: SafeHtml | string = ""): SafeHtml {
    const sep = separator instanceof SafeHtml ? separator.value : escapeHtml(separator);
    return new SafeHtml(
        parts
            .filter((p): p is SafeHtml => p instanceof SafeHtml && p.value !== "")
            .map((p) => p.value)
            .join(sep)
    );
}

/** 僅允許 http/https 網址，其餘回傳 null（避免 javascript: 等協定） */
export function safeHttpUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : /^www\./i.test(trimmed) ? `https://${trimmed}` : null;
    if (!withScheme) return null;
    try {
        const url = new URL(withScheme);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}
