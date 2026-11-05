/**
 * Content Script 進入點（注入 https://www.fugle.tw/*）。
 * 實作見 ./content/app.ts。
 */
import { App } from "./content/app";
import { log } from "./utils/log";

// 防止同一頁面重複初始化（例如擴充功能重新注入）
const FLAG = "__fugleIntegratorStarted";
const scope = globalThis as unknown as Record<string, unknown>;

if (!scope[FLAG]) {
    scope[FLAG] = true;
    new App().start().catch((error: unknown) => log.error("初始化失敗：", error));
}
