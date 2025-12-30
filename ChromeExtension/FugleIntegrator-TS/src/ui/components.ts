/**
 * ============================================================================
 * 🔗 UI 元件模組 - TypeScript 版本
 * ============================================================================
 *
 * 本模組負責生成富果整合器的所有 UI 元件 HTML。
 *
 * 📌 設計原則：
 * - 純函式設計：所有函式接收資料，返回 HTML 字串
 * - 不直接操作 DOM（由呼叫者插入）
 * - 樣式內聯化：避免外部 CSS 依賴問題
 * - 資料驗證：空值/無效資料時返回空字串或 null
 *
 * 📌 元件類型：
 * 1. 基礎元件 - createLine, createSection
 * 2. 連結元件 - createLinkList, createRelatedStocksHtml
 * 3. 資料展示元件 - createETFHoldingHtml, createCapacityHtml
 * 4. 複合元件 - createRatingHtml, createMajorContent
 *
 * 📌 樣式規範：
 * - 主題色: var(--fugle-accent) = 橙色
 * - 上漲色: #ff4d4f (紅)
 * - 下跌色: #52c41a (綠)
 * - 背景色: rgba(x, x, x, 0.08) 透明度
 */

import type { RelationItem, ETFHoldingItem, CapacityItem, RatingItem, MajorRatioResult, RelatedStock } from "../types/index";
import { cleanNum } from "../utils/helpers";

// ============================================================================
// 🧱 基礎元件
// ============================================================================

/**
 * createLine - 生成單行資訊 HTML
 *
 * 建立標準的「標籤: 數值」格式資訊列。
 * 是資訊卡中最基本的顯示單元。
 *
 * @param emoji - 前綴表情符號（例如 "💰"）
 * @param label - 標籤文字（例如 "股本"）
 * @param content - 顯示內容，若為空則返回空字串
 * @param color - 內容文字顏色，預設繼承
 * @param isBold - 是否加粗內容文字
 * @returns HTML 字串，或空字串（若 content 無效）
 *
 * 📌 使用範例：
 * ```typescript
 * createLine("💰", "股本", "2,500 億", "#52c41a", true);
 * // => <div class="info-row">...<span>💰</span>股本...2,500 億...</div>
 * ```
 *
 * 📌 CSS 類別：
 * - .info-row: 行容器（flexbox 佈局）
 * - .info-label: 標籤區塊
 * - .info-content: 內容區塊
 */
export function createLine(emoji: string, label: string, content: string | null | undefined, color: string = "inherit", isBold: boolean = false): string {
    if (!content) return "";
    return `
        <div class="info-row">
            <div class="info-label"><span>${emoji}</span>${label}</div>
            <div class="info-content" style="color: ${color}; ${isBold ? "font-weight: 600;" : ""}">${content}</div>
        </div>`;
}

/**
 * createSection - 生成可折疊區塊 HTML
 *
 * 建立帶有展開/折疊功能的內容區塊。
 * 折疊狀態會儲存在 localStorage 以保持用戶偏好。
 *
 * @param id - 區塊唯一識別符（用於 localStorage 鍵名）
 * @param title - 區塊標題
 * @param emoji - 標題前的表情符號
 * @param content - 區塊內容 HTML，若為空則返回空字串
 * @param defaultOpen - 預設是否展開，預設為 true
 * @returns HTML 字串，或空字串（若 content 無效）
 *
 * 📌 localStorage 鍵名格式：
 * `fugle-section-{id}` => "true" | "false"
 *
 * 📌 互動機制：
 * - 點擊 .section-header 觸發折疊切換
 * - .section-toggle 顯示 △（展開）或 ▽（折疊）
 * - 事件監聽器在 content.ts 的 initSectionToggle() 中設定
 *
 * 📌 CSS 類別：
 * - .info-section: 區塊容器
 * - .collapsible-section: 標記為可折疊
 * - .section-header: 標題列（可點擊）
 * - .section-body: 內容區域（可隱藏）
 */
export function createSection(id: string, title: string, emoji: string, content: string | null, defaultOpen: boolean = true): string {
    if (!content) return "";
    const storedState = localStorage.getItem(`fugle-section-${id}`);
    const actualOpen = storedState === null ? defaultOpen : storedState !== "false";
    return `
        <div class="info-section collapsible-section" data-section-id="${id}">
            <div class="section-header" style="cursor: pointer; display: flex; align-items: center; margin-bottom: ${actualOpen ? "8px" : "0"};">
                <span style="font-weight: 600; color: #aaa;">${emoji} ${title}</span>
                <span class="section-toggle" style="margin-left: auto; font-size: 10px; color: #666; transition: 0.2s;">${actualOpen ? "△" : "▽"}</span>
            </div>
            <div class="section-body" style="display: ${actualOpen ? "block" : "none"};">
                ${content}
            </div>
        </div>`;
}

// ============================================================================
// 🔗 連結元件
// ============================================================================

/**
 * createLinkList - 生成關係企業連結列表
 *
 * 將關係企業陣列轉換為可點擊的富果股票頁面連結。
 * 自動區分台股（可點擊）與非台股（純文字）。
 *
 * @param list - 關係企業項目陣列
 * @param className - 連結的 CSS 類別名稱
 * @returns HTML 字串，或 null（若 list 為空）
 *
 * 📌 台股判斷邏輯：
 * - 後綴為 .TW（上市）、.TE（上櫃）、.TT（興櫃）視為台股
 * - 台股：生成 <a> 連結到 /ai/{股票代碼}
 * - 非台股：生成 <span> 純文字顯示
 *
 * 📌 分隔符：
 * - 使用 "•" 符號分隔各項目
 */
export function createLinkList(list: RelationItem[] | null, className: string): string | null {
    if (!list || list.length === 0) return null;
    return list
        .map((item) => {
            const isTW = /(.TW|.TE|.TT)$/.test(item.id);
            const cleanId = item.id.replace(/\.(TW|TE|TT)/, "");
            return isTW ? `<a href="/ai/${cleanId}" class="${className}">${item.name}(${cleanId})</a>` : `<span style="opacity: 0.8;">${item.name}(${cleanId})</span>`;
        })
        .join('<span style="color: #444; margin: 0 4px;">•</span>');
}

/**
 * createRelatedStocksHtml - 生成相關股票連結 HTML
 *
 * 將同分類（概念/產業/集團）股票轉換為可點擊連結。
 * 用於「相關個股」區塊顯示。
 *
 * @param stocks - 相關股票陣列（含代碼、名稱、股本）
 * @param className - 連結的 CSS 類別名稱，預設 "relation-link"
 * @returns HTML 字串，或空字串（若 stocks 為空）
 *
 * 📌 與 createLinkList 的差異：
 * - createLinkList: 處理外部 API 的關係企業資料
 * - createRelatedStocksHtml: 處理本地資料庫的分類資料
 */
export function createRelatedStocksHtml(stocks: RelatedStock[], className: string = "relation-link"): string {
    if (!stocks || stocks.length === 0) return "";
    return stocks.map((stock) => `<a class="${className}" href="/ai/${stock.code}">${stock.name}(${stock.code})</a>`).join('<span style="color: #444; margin: 0 4px;">•</span>');
}

// ============================================================================
// 📊 資料展示元件
// ============================================================================

/**
 * createETFHoldingHtml - 生成 ETF 持股列表 HTML
 *
 * 將持有該股票的 ETF 清單轉換為視覺化展示。
 * 包含統計摘要和詳細列表。
 *
 * @param etfList - ETF 持股項目陣列
 * @returns HTML 字串，或 null（若 etfList 為空）
 *
 * 📌 排序邏輯：
 * - 依持股股數（stock_holding_stocknum）由大到小排序
 *
 * 📌 顯示內容：
 * 1. 摘要區：總 ETF 檔數、合計持股張數、占比加總
 * 2. 列表區：前 15 檔 ETF 的詳細資訊
 * 3. 溢出提示：若超過 15 檔顯示「還有 X 檔 ETF」
 *
 * 📌 股數格式化：
 * - >= 1 萬張：顯示「X.XX 萬張」
 * - >= 1 張：顯示「X 張」
 * - < 1 張：顯示「< 1 張」
 */
export function createETFHoldingHtml(etfList: ETFHoldingItem[] | null): string | null {
    if (!etfList || etfList.length === 0) return null;

    const sortedList = [...etfList].sort((a, b) => (b.stock_holding_stocknum || 0) - (a.stock_holding_stocknum || 0));

    const totalHolding = sortedList.reduce((sum, etf) => sum + (etf.stock_holding_stocknum || 0), 0);
    const totalRatio = sortedList.reduce((sum, etf) => sum + (etf.stock_holding_ratio || 0), 0);

    const formatShares = (num: number): string => {
        const shares = num / 1000;
        if (shares >= 10000) return (shares / 10000).toFixed(2) + " 萬張";
        if (shares >= 1) return shares.toFixed(0).toLocaleString() + " 張";
        return "< 1 張";
    };

    const summary = `<div style="margin-bottom: 8px; padding: 8px; background: rgba(114, 137, 218, 0.1); border-radius: 6px; border: 1px dashed #7289da;">
        <span style="color: #7289da; font-weight: bold;">📦 共 ${sortedList.length} 檔 ETF 持股：</span>
        <span style="color: #fff;">合計 ${formatShares(totalHolding)}</span>
        <span style="color: #7289da;">(占比加總 ${totalRatio.toFixed(2)}%)</span>
    </div>`;

    const etfItems = sortedList
        .slice(0, 15)
        .map((etf) => {
            const symbol = etf.symbol;
            const name = etf.name || symbol;
            const ratio = etf.stock_holding_ratio?.toFixed(2) || "0.00";
            const shares = formatShares(etf.stock_holding_stocknum || 0);

            return `<a href="/ai/${symbol}" class="etf-link"><span style="font-weight: 600;">${symbol}</span> ${name} <span style="color: #7289da;">${ratio}%</span> <span style="color: #888; font-size: 11px;">${shares}</span></a>`;
        })
        .join('<span style="color: #444; margin: 0 4px;">•</span>');

    return summary + `<div style="display: flex; flex-wrap: wrap; gap: 4px;">${etfItems}</div>` + (sortedList.length > 15 ? `<div style="color: #888; font-size: 11px; margin-top: 4px;">...還有 ${sortedList.length - 15} 檔 ETF</div>` : "");
}

/**
 * createCapacityHtml - 生成產能分析 HTML
 *
 * 將公司產能資料轉換為表格形式展示。
 * 包含位置、規格、數量、單位四欄。
 *
 * @param capacityList - 產能項目陣列
 * @returns HTML 字串（表格），或 null（若 capacityList 為空）
 *
 * 📌 資料來源：
 * - Stock-Basic0008-1 API
 * - 僅製造業/科技業有此資料
 *
 * 📌 表格欄位：
 * - 📍 位置：廠區地點（例如 "台南廠"）
 * - 📋 規格：產品規格（例如 "12 吋晶圓"）
 * - 📊 數量：產能數值
 * - 📐 單位：數量單位（例如 "萬片/月"）
 */
export function createCapacityHtml(capacityList: CapacityItem[] | null): string | null {
    if (!capacityList || capacityList.length === 0) return null;

    const capacityRows = capacityList
        .map((item) => {
            const location = item.V1 || "-";
            const spec = item.V2 || "-";
            const quantity = item.V3 || "-";
            const unit = item.V4 || "";

            return `<tr style="border-bottom: 1px dashed #333; font-size: 14px;">
                <td style="color: #e67e22; padding: 4px 8px 4px 0;">${location}</td>
                <td style="color: #fff; padding: 4px 8px;">${spec}</td>
                <td style="color: #3498db; font-weight: 600; padding: 4px 8px; text-align: right;">${quantity}</td>
                <td style="color: #888; padding: 4px 0 4px 8px;">${unit}</td>
            </tr>`;
        })
        .join("");

    return `<table style="margin-top: 4px; border-collapse: collapse; width: 100%;">
        <thead>
            <tr style="border-bottom: 1px solid #444; font-size: 11px; color: #666;">
                <th style="padding: 4px 8px 4px 0; text-align: left; font-weight: normal;">📍 位置</th>
                <th style="padding: 4px 8px; text-align: left; font-weight: normal;">📋 規格</th>
                <th style="padding: 4px 8px; text-align: right; font-weight: normal;">📊 數量</th>
                <th style="padding: 4px 0 4px 8px; text-align: left; font-weight: normal;">📐 單位</th>
            </tr>
        </thead>
        <tbody>
            ${capacityRows}
        </tbody>
    </table>`;
}

// ============================================================================
// 📈 複合元件
// ============================================================================

/**
 * createRatingHtml - 生成機構評等 HTML
 *
 * 處理機構評等資料，生成統計摘要和詳細列表。
 * 僅顯示近 6 個月內的評等資料。
 *
 * @param ratingData - 機構評等項目陣列
 * @param currPrice - 當前股價，用於計算目標價差異百分比
 * @returns 包含 ratingSummary 和 ratingHtml 的物件
 *
 * 📌 資料篩選：
 * - 僅保留 6 個月內的評等資料
 * - 過濾無效日期或目標價
 *
 * 📌 統計指標：
 * - 最高目標價 + 與現價差異 %
 * - 最低目標價 + 與現價差異 %
 * - 平均目標價 + 與現價差異 %
 *
 * 📌 差異顏色：
 * - 正數（目標價高於現價）：紅色 #ff4d4f
 * - 負數（目標價低於現價）：綠色 #52c41a
 *
 * 📌 顯示限制：
 * - 最多顯示 20 筆評等記錄
 */
export function createRatingHtml(ratingData: RatingItem[], currPrice: number): { ratingSummary: string; ratingHtml: string | null } {
    // 計算 6 個月前的日期基準
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // 篩選近 6 個月的評等資料
    const recentRatings = ratingData.filter((r) => {
        const d = new Date(r.V1);
        return !isNaN(d.getTime()) && d >= sixMonthsAgo;
    });

    // 提取所有有效的目標價數值
    const prices = recentRatings.map((r) => parseFloat(String(r.V4).replace(/,/g, ""))).filter((p) => !isNaN(p));

    /**
     * getDiff - 計算目標價與現價的差異百分比
     * @param target - 目標價
     * @returns 格式化的差異百分比 HTML
     */
    const getDiff = (target: number): string => {
        if (!currPrice) return "";
        const diff = (((target - currPrice) / currPrice) * 100).toFixed(1);
        const color = parseFloat(diff) >= 0 ? "#ff4d4f" : "#52c41a";
        return `<span style="color: ${color}; font-size: 12px; margin-left: 2px; font-weight: bold;">(${parseFloat(diff) >= 0 ? "+" : ""}${diff}%)</span>`;
    };

    // 計算目標價統計值
    const maxP = prices.length > 0 ? Math.max(...prices) : 0; // 最高目標價
    const minP = prices.length > 0 ? Math.min(...prices) : 0; // 最低目標價
    const avgP = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0; // 平均目標價

    // 生成統計摘要 HTML
    const ratingSummary =
        prices.length > 0
            ? `<div style="margin-bottom: 8px; padding: 8px; background: rgba(255, 159, 67, 0.1); border-radius: 6px; border: 1px dashed var(--fugle-accent);">
                <span style="color: var(--fugle-accent); font-weight: bold;">📊 近 6 個月目標價統計：<br/></span>
                最高 <span style="color: #fff;">${maxP}</span>${getDiff(maxP)} ｜
                最低 <span style="color: #fff;">${minP}</span>${getDiff(minP)} ｜
                平均 <span style="color: #fff;">${avgP.toFixed(2)}</span>${getDiff(avgP)}
               </div>`
            : "";

    // 生成評等詳細列表 HTML（結合摘要和標籤）
    const ratingHtml =
        recentRatings.length > 0
            ? ratingSummary +
              `<div style="display: flex; flex-wrap: wrap;">` +
              recentRatings
                  .slice(0, 20) // 限制最多 20 筆
                  .map(
                      (r) => `
                    <span class="rating-tag">
                        <span style="color: #888;">${r.V1}</span> ${r.V2}
                        <span style="color: var(--fugle-accent); font-weight: bold;">${r.V3}</span>
                        <span style="color: #fff;">(${r.V4})</span>
                    </span>`
                  )
                  .join("") +
              `</div>`
            : null;

    return { ratingSummary, ratingHtml };
}

/**
 * createMajorContent - 生成主力買賣 HTML
 *
 * 將不同區間（1/5/10/20 日）的主力買賣數據轉換為視覺化卡片。
 * 使用四欄網格佈局展示。
 *
 * @param major1Ratio - 1 日主力買賣比率
 * @param major5Ratio - 5 日主力買賣比率
 * @param major10Ratio - 10 日主力買賣比率
 * @param major20Ratio - 20 日主力買賣比率
 * @returns HTML 字串，或 null（若所有資料皆無效）
 *
 * 📌 比率計算公式：
 * majorRatio = (總買股數 - 總賣股數) / 區間總成交量 × 100
 *
 * 📌 顏色表示：
 * - 正數（買超）：紅色 #ff4d4f
 * - 負數（賣超）：綠色 #52c41a
 *
 * 📌 各區間邊框顏色：
 * - 主1：紅色 #ff4d4f
 * - 主5：橙色 #ff9f43
 * - 主10：藍色 #3498db
 * - 主20：紫色 #9b59b6
 */
export function createMajorContent(major1Ratio: MajorRatioResult | null, major5Ratio: MajorRatioResult | null, major10Ratio: MajorRatioResult | null, major20Ratio: MajorRatioResult | null): string | null {
    /**
     * formatMajorRatio - 格式化主力買賣比率
     * @param ratio - 主力買賣比率結果
     * @returns 格式化的 HTML 字串
     */
    const formatMajorRatio = (ratio: MajorRatioResult | null): string => {
        if (!ratio) return "-";
        const color = ratio.majorRatio >= 0 ? "#ff4d4f" : "#52c41a";
        const sign = ratio.majorRatio >= 0 ? "+" : "";
        return `<span style="color: ${color}; font-weight: bold;">${sign}${ratio.majorRatio}%</span>`;
    };

    // 若所有資料皆無效，返回 null
    if (!major1Ratio && !major5Ratio && !major10Ratio && !major20Ratio) {
        return null;
    }

    // 生成四欄網格佈局的主力買賣卡片
    return `
        <div style="font-size: 13px; color: #888; margin-bottom: 8px; font-weight: 600;">最後更新日期：${major1Ratio?.date || major5Ratio?.date || major10Ratio?.date || major20Ratio?.date}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px;">
            <div style="background: rgba(255, 77, 79, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #ff4d4f;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主1買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major1Ratio)}</div>
                ${major1Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major1Ratio.totalBuyStocks / 1000).toFixed(2)} 張｜賣${(major1Ratio.totalSellStocks / 1000).toFixed(2)} 張</div>` : ""}
            </div>
            <div style="background: rgba(255, 159, 67, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #ff9f43;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主5買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major5Ratio)}</div>
                ${major5Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major5Ratio.totalBuyStocks / 1000).toFixed(2)} 張｜賣${(major5Ratio.totalSellStocks / 1000).toFixed(2)} 張</div>` : ""}
            </div>
            <div style="background: rgba(52, 152, 219, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #3498db;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主10買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major10Ratio)}</div>
                ${major10Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major10Ratio.totalBuyStocks / 1000).toFixed(2)} 張｜賣${(major10Ratio.totalSellStocks / 1000).toFixed(2)} 張</div>` : ""}
            </div>
            <div style="background: rgba(155, 89, 182, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #9b59b6;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主20買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major20Ratio)}</div>
                ${major20Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major20Ratio.totalBuyStocks / 1000).toFixed(2)} 張｜賣${(major20Ratio.totalSellStocks / 1000).toFixed(2)} 張</div>` : ""}
            </div>
        </div>`;
}
