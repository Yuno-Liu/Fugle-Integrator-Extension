/**
 * 持股分級下拉選單項目定義
 */
export interface LevelOption {
    /** 級距數值 (1 ~ 15) */
    value: number;
    /** 下拉選單顯示文字 (例如: "100", "> 1000") */
    text: string;
}

/**
 * TDCC 表格解析出的單一級距資料
 */
export interface StockLevelData {
    /** 持股分級編號 (1 ~ 15) */
    level: number;
    /** 該級距佔集保庫存的持股比例 (%) */
    percent: number;
}

/**
 * 散戶與大戶持股比例計算結果
 */
export interface Totals {
    /** 散戶持股合計比例 (%) */
    retailTotal: number;
    /** 大戶持股合計比例 (%) */
    whaleTotal: number;
}

/**
 * 統計面板中的 DOM 元素集合
 */
export interface PanelElements {
    /** 浮動面板主容器 */
    panel: HTMLDivElement;
    /** 面板標題區塊 (用於點擊收合/展開) */
    header: HTMLElement;
    /** 散戶門檻下拉選單 */
    retailSelect: HTMLSelectElement;
    /** 大戶門檻下拉選單 */
    whaleSelect: HTMLSelectElement;
    /** 散戶比例文字顯示元件 */
    retailResult: HTMLElement;
    /** 大戶比例文字顯示元件 */
    whaleResult: HTMLElement;
    /** 散戶比例進度條元件 */
    retailProgress: HTMLElement;
    /** 大戶比例進度條元件 */
    whaleProgress: HTMLElement;
    /** 面板標題列狀態文字元件 */
    status: HTMLElement;
    /** 面板底部資料筆數狀態元件 */
    dataStatus: HTMLElement;
    /** 重新計算按鈕元件 */
    refreshButton: HTMLButtonElement;
}
