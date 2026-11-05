/**
 * ============================================================================
 * 🎨 樣式注入
 * ============================================================================
 *
 * 樣式本體在 styles.css / popup.css；建置時由 esbuild 壓縮後以字串內嵌。
 * 顏色依 <html data-fi-theme="light|dark"> 切換，與富果的淺色 / 深色模式一致。
 */

import STYLESHEET from "./styles.css";
import POPUP_STYLESHEET from "./popup.css";

export { POPUP_STYLESHEET, STYLESHEET };

export const STYLE_ELEMENT_ID = "fi-styles";

/** 在指定文件注入樣式（每份文件只注入一次） */
export function ensureStyles(doc: Document = document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = STYLESHEET;
    (doc.head ?? doc.documentElement).appendChild(style);
}
