/**
 * 建置期常數（由 esbuild `define` 注入）。
 * - 正式建置：false（移除除錯輸出）
 * - 開發 / watch 建置：true
 */
declare const __DEV__: boolean;

/** CSS 檔以字串形式匯入（建置時壓縮） */
declare module "*.css" {
    const css: string;
    export default css;
}
