import { CONFIG, LEVELS } from "./config/constants.js";
import { calculateTotals, clampPercentage } from "./core/calculator.js";
import { getStockData } from "./core/parser.js";
import { createPanel, getPanelElements, removeExistingPanel } from "./ui/panel.js";
import { injectStyles } from "./ui/styles.js";

/**
 * 初始化散戶與大戶的級距下拉選單選項
 * 
 * @param retailSelect - 散戶門檻下拉選單元素
 * @param whaleSelect - 大戶門檻下拉選單元素
 */
function initializeLevelOptions(retailSelect: HTMLSelectElement, whaleSelect: HTMLSelectElement): void {
    const fragment = document.createDocumentFragment();

    // 建立 1 ~ 15 級距的選項節點
    LEVELS.forEach((level) => {
        fragment.appendChild(new Option(level.text, String(level.value)));
    });

    // 填入散戶選單 (複製節點) 與大戶選單
    retailSelect.appendChild(fragment.cloneNode(true));
    whaleSelect.appendChild(fragment);
}

/**
 * 更新指定進度條的寬度並觸發脈衝動畫效果
 * 
 * @param progressElement - 進度條 DOM 元素
 * @param value - 進度百分比數值 (0 ~ 100)
 */
function updateProgressBar(progressElement: HTMLElement, value: number): void {
    const percentage = clampPercentage(value);
    progressElement.style.width = `${percentage}%`;

    // 藉由移除 class、讀取 offsetWidth 觸發 reflow、再重新加入 class 來重起動畫
    progressElement.classList.remove("stk-updated");
    void progressElement.offsetWidth;
    progressElement.classList.add("stk-updated");
}

/**
 * 擴充功能主啟動程式 (Bootstrap)
 * 負責注入樣式、建立 UI 面板、綁定事件與監聽 DOM 變化
 */
function bootstrap(): void {
    // 確保頁面 body 存在
    if (!document.body) {
        return;
    }

    // 1. 注入 CSS 樣式並清理可能已存在的舊面板
    injectStyles();
    removeExistingPanel();

    // 2. 建立新面板並掛載到頁面 body
    const panel = createPanel();
    document.body.appendChild(panel);
    const elements = getPanelElements(panel);

    // 3. 初始化下拉選單選項並帶入預設值
    initializeLevelOptions(elements.retailSelect, elements.whaleSelect);
    elements.retailSelect.value = String(CONFIG.defaultRetailLevel);
    elements.whaleSelect.value = String(CONFIG.defaultWhaleLevel);

    /**
     * 更新面板上的狀態提示文字
     * 
     * @param rowCount - 當前解析到的有效級距列數
     */
    const updateStatus = (rowCount: number): void => {
        if (rowCount === 0) {
            elements.status.textContent = "等待 TDCC 資料...";
            elements.dataStatus.textContent = "尚未取得資料";
            return;
        }

        elements.status.textContent = "資料已同步";
        elements.dataStatus.textContent = `已取得 ${rowCount} 個級距`;
    };

    /**
     * 重新解析表格資料、計算持股比例並更新 UI
     */
    const refresh = (): void => {
        const data = getStockData();

        // 若無資料，將顯示重設為預設狀態
        if (data.length === 0) {
            elements.retailResult.textContent = "-- %";
            elements.whaleResult.textContent = "-- %";
            updateProgressBar(elements.retailProgress, 0);
            updateProgressBar(elements.whaleProgress, 0);
            updateStatus(0);
            return;
        }

        // 讀取當前選定的散戶與大戶級距門檻
        const retailLevel = Number(elements.retailSelect.value);
        const whaleLevel = Number(elements.whaleSelect.value);

        // 核心計算
        const totals = calculateTotals(data, retailLevel, whaleLevel);

        // 更新畫面數值與進度條
        elements.retailResult.textContent = `${totals.retailTotal.toFixed(2)} %`;
        elements.whaleResult.textContent = `${totals.whaleTotal.toFixed(2)} %`;
        updateProgressBar(elements.retailProgress, totals.retailTotal);
        updateProgressBar(elements.whaleProgress, totals.whaleTotal);
        updateStatus(data.length);
    };

    /**
     * 切換面板的展開與收合狀態
     */
    const togglePanel = (): void => {
        elements.panel.classList.toggle("stk-collapsed");
    };

    // 4. 事件監聽設定
    // 點擊標題列切換收合
    elements.header.addEventListener("click", togglePanel);

    // 切換散戶/大戶級距門檻時自動重新計算
    elements.retailSelect.addEventListener("change", refresh);
    elements.whaleSelect.addEventListener("change", refresh);

    // 點擊「重新計算」按鈕 (阻止事件冒泡以免觸發標題收合)
    elements.refreshButton.addEventListener("click", (event) => {
        event.stopPropagation();
        refresh();
    });

    // 支援按下鍵盤 ESC 鍵快速收合面板
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !elements.panel.classList.contains("stk-collapsed")) {
            togglePanel();
        }
    });

    // 5. 監聽 TDCC 頁面 DOM 變動 (例如切換股票代號或日期重新載入表格時自動重算)
    let refreshScheduled = false;
    const observer = new MutationObserver(() => {
        if (refreshScheduled) {
            return;
        }

        refreshScheduled = true;

        // 使用 requestAnimationFrame 防抖節流，避免頻繁觸發
        requestAnimationFrame(() => {
            refreshScheduled = false;
            refresh();
        });
    });

    // 監聽整個 body 下的子節點變化
    observer.observe(document.body, { childList: true, subtree: true });

    // 6. 初始立即執行一次計算
    refresh();
}

// 啟動擴充功能
bootstrap();
