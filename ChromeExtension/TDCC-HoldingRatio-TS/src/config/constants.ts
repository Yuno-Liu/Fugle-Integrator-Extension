import type { LevelOption } from "../types/index.js";

/** 浮動面板容器 DOM ID */
export const PANEL_ID = "stk-helper-panel";

/** 動態注入樣式標籤 DOM ID */
export const STYLE_ID = "stk-helper-style";

/**
 * 擴充功能核心配置
 */
export const CONFIG = {
    /** TDCC 集保股權分散表之表格選擇器 */
    tableSelector: "table.table",
    /** 最小持股分級編號 */
    minLevel: 1,
    /** 最大持股分級編號 */
    maxLevel: 15,
    /** 預設散戶判定門檻 (級距 9: 100 張以下) */
    defaultRetailLevel: 9,
    /** 預設大戶判定門檻 (級距 15: 1000 張以上) */
    defaultWhaleLevel: 15,
} as const;

/**
 * TDCC 持股分級對應清單 (1 ~ 15 級距)
 * 數值代表持股張數/股數分級，顯示文字為對應張數說明
 */
export const LEVELS: LevelOption[] = [
    { value: 1, text: "> 1" },      // 1-999 股 (不足 1 張)
    { value: 2, text: "5" },        // 1,000 - 5,000 股 (1-5 張)
    { value: 3, text: "10" },       // 5,001 - 10,000 股 (5-10 張)
    { value: 4, text: "15" },       // 10,001 - 15,000 股 (10-15 張)
    { value: 5, text: "20" },       // 15,001 - 20,000 股 (15-20 張)
    { value: 6, text: "30" },       // 20,001 - 30,000 股 (20-30 張)
    { value: 7, text: "40" },       // 30,001 - 40,000 股 (30-40 張)
    { value: 8, text: "50" },       // 40,001 - 50,000 股 (40-50 張)
    { value: 9, text: "100" },      // 50,001 - 100,000 股 (50-100 張)
    { value: 10, text: "200" },     // 100,001 - 200,000 股 (100-200 張)
    { value: 11, text: "400" },     // 200,001 - 400,000 股 (200-400 張)
    { value: 12, text: "600" },     // 400,001 - 600,000 股 (400-600 張)
    { value: 13, text: "800" },     // 600,001 - 800,000 股 (600-800 張)
    { value: 14, text: "< 1000" },  // 800,001 - 1,000,000 股 (800-1000 張)
    { value: 15, text: "> 1000" },  // 1,000,001 股以上 (超過 1000 張)
];
