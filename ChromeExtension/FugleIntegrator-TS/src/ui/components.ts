/**
 * 🔗 UI 元件模組 - TypeScript 版本
 */

import type { RelationItem, ETFHoldingItem, CapacityItem, RatingItem, MajorRatioResult, RelatedStock } from "../types/index";
import { cleanNum } from "../utils/helpers";

/**
 * 生成單行資訊 HTML
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
 * 生成可折疊區塊 HTML
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

/**
 * 🔗 生成連結列表：將關係企業轉換為可點擊的富果連結
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
 * 🏢 生成可點擊的相關股票 HTML
 */
export function createRelatedStocksHtml(stocks: RelatedStock[], className: string = "relation-link"): string {
    if (!stocks || stocks.length === 0) return "";
    return stocks.map((stock) => `<a class="${className}" href="/ai/${stock.code}">${stock.name}(${stock.code})</a>`).join('<span style="color: #444; margin: 0 4px;">•</span>');
}

/**
 * 📦 生成 ETF 持股列表 HTML
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
 * 🏭 生成產能分析 HTML
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

/**
 * 🎯 生成機構評等 HTML
 */
export function createRatingHtml(ratingData: RatingItem[], currPrice: number): { ratingSummary: string; ratingHtml: string | null } {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const recentRatings = ratingData.filter((r) => {
        const d = new Date(r.V1);
        return !isNaN(d.getTime()) && d >= sixMonthsAgo;
    });

    const prices = recentRatings.map((r) => parseFloat(String(r.V4).replace(/,/g, ""))).filter((p) => !isNaN(p));

    const getDiff = (target: number): string => {
        if (!currPrice) return "";
        const diff = (((target - currPrice) / currPrice) * 100).toFixed(1);
        const color = parseFloat(diff) >= 0 ? "#ff4d4f" : "#52c41a";
        return `<span style="color: ${color}; font-size: 12px; margin-left: 2px; font-weight: bold;">(${parseFloat(diff) >= 0 ? "+" : ""}${diff}%)</span>`;
    };

    const maxP = prices.length > 0 ? Math.max(...prices) : 0;
    const minP = prices.length > 0 ? Math.min(...prices) : 0;
    const avgP = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    const ratingSummary =
        prices.length > 0
            ? `<div style="margin-bottom: 8px; padding: 8px; background: rgba(255, 159, 67, 0.1); border-radius: 6px; border: 1px dashed var(--fugle-accent);">
                <span style="color: var(--fugle-accent); font-weight: bold;">📊 近 6 個月目標價統計：<br/></span>
                最高 <span style="color: #fff;">${maxP}</span>${getDiff(maxP)} ｜
                最低 <span style="color: #fff;">${minP}</span>${getDiff(minP)} ｜
                平均 <span style="color: #fff;">${avgP.toFixed(2)}</span>${getDiff(avgP)}
               </div>`
            : "";

    const ratingHtml =
        recentRatings.length > 0
            ? ratingSummary +
              `<div style="display: flex; flex-wrap: wrap;">` +
              recentRatings
                  .slice(0, 20)
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
 * 💼 生成主力買賣 HTML
 */
export function createMajorContent(major1Ratio: MajorRatioResult | null, major5Ratio: MajorRatioResult | null, major10Ratio: MajorRatioResult | null, major20Ratio: MajorRatioResult | null): string | null {
    const formatMajorRatio = (ratio: MajorRatioResult | null): string => {
        if (!ratio) return "-";
        const color = ratio.majorRatio >= 0 ? "#ff4d4f" : "#52c41a";
        const sign = ratio.majorRatio >= 0 ? "+" : "";
        return `<span style="color: ${color}; font-weight: bold;">${sign}${ratio.majorRatio}%</span>`;
    };

    if (!major1Ratio && !major5Ratio && !major10Ratio && !major20Ratio) {
        return null;
    }

    return `
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px;">
            <div style="background: rgba(255, 77, 79, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #ff4d4f;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主1買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major1Ratio)}</div>
                ${major1Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major1Ratio.totalBuyStocks / 10000).toFixed(2)} 張｜賣${(major1Ratio.totalSellStocks / 10000).toFixed(2)} 張</div>` : ""}
            </div>
            <div style="background: rgba(255, 159, 67, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #ff9f43;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主5買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major5Ratio)}</div>
                ${major5Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major5Ratio.totalBuyStocks / 10000).toFixed(2)} 張｜賣${(major5Ratio.totalSellStocks / 10000).toFixed(2)} 張</div>` : ""}
            </div>
            <div style="background: rgba(52, 152, 219, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #3498db;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主10買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major10Ratio)}</div>
                ${major10Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major10Ratio.totalBuyStocks / 10000).toFixed(2)} 張｜賣${(major10Ratio.totalSellStocks / 10000).toFixed(2)} 張</div>` : ""}
            </div>
            <div style="background: rgba(155, 89, 182, 0.08); padding: 8px; border-radius: 4px; border: 1px dashed #9b59b6;">
                <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">📊 主20買賣占比</div>
                <div style="font-size: 16px; font-weight: bold; color: #fff;">${formatMajorRatio(major20Ratio)}</div>
                ${major20Ratio ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">買${(major20Ratio.totalBuyStocks / 10000).toFixed(2)} 張｜賣${(major20Ratio.totalSellStocks / 10000).toFixed(2)} 張</div>` : ""}
            </div>
        </div>`;
}
