# 富果整合器 - 產業鏈全視圖 (Fugle Integrator)

[![GitHub License](https://img.shields.io/github/license/Yuno-Liu/Fugle-Integrator-Extension)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![CI](https://github.com/Yuno-Liu/Fugle-Integrator-Extension/actions/workflows/ci.yml/badge.svg)](https://github.com/Yuno-Liu/Fugle-Integrator-Extension/actions/workflows/ci.yml)

這是一個用於增強 [富果 Fugle](https://www.fugle.tw/) 網站功能的 Chrome 擴充功能，旨在整合外部數據並優化使用者介面，讓投資者能更快速地掌握個股的產業鏈地位、機構評等與關鍵財務指標。

本專案提供基於 TypeScript 與 Manifest V3 開發的 **Chrome 擴充功能 (Chrome Extension)**。

---

## ✨ 主要功能

- **自動整合外部數據**：自動抓取並顯示產業鏈、概念股、集團股、營收、股本等資訊。
- **相關個股推薦**：
  - 基於同產業、同概念、同集團自動推薦相關個股。
  - 點擊相關個股可直接跳轉至對應的富果頁面。
- **公司互動關係全視圖**：
  - 供應商、客戶、競爭對手、策略聯盟。
  - 轉投資、被投資關係。
  - 點擊關係企業可直接跳轉至對應的富果頁面。
- **機構評等彙整**：
  - 顯示近 6 個月內的機構評等、目標價。
  - 自動計算目標價的最高、最低與平均值，並顯示與當前股價的乖離率。
- **關鍵財務指標儀表板**：
  - 每股淨值 (BVPS)、股價淨值比 (PB)。
  - 每股盈餘 (EPS)、本益比 (PE)。
  - 殖利率、毛利率、ROE、ROA。
  - 市值計算 (自動換算為億或兆)。
  - **市場排名指標**：自動比較個股與全市場指標，顯示該股票在全市場中的排名百分比位置。
- **主力買賣超分析**：
  - 顯示 1 日、5 日、10 日、20 日主力買賣超數據。
  - 快速掌握法人資金動向。
- **預估成交量**：
  - 根據當前盤中時間自動計算預估全日成交量。
  - 實時更新，精確到秒。
  - 支援各時段預估倍數調整（開盤時倍數最高，接近收盤時趨近 1）。
- **成交量數據**：
  - 整合最近 20 天的成交量數據視圖。
  - 支援自訂 API Token (finmindtrade) 以便抓取完整數據。
  - 可在擴充功能 UI 中設定 Token，持久化存儲於 localStorage。
- **ETF 持股分析**：
  - 顯示該股票被哪些 ETF 持有。
  - 直接跳轉至 ETF 詳細資訊頁面。
- **產能分析**：
  - 顯示公司工廠位置、生產規格與數量。
  - 幫助了解產能布局與規模。
- **即時時間顯示**：
  - 股票代碼下方自動顯示當前時間（精確到秒）。
  - 可懸停查看完整日期與星期。
- **便捷分析工具列**：
  - **全方位搜尋**：支援搜尋股票代號、名稱、概念股、產業與集團，快速查找相關個股並直接跳轉。
  - **相關股票推薦**：搜尋時自動推薦同分類（同概念、同產業、同集團）的相關股票。
  - **快速跳轉**：一鍵跳轉至 WantGoo (玩股網)、CMoney、TradingView、富邦證券 (法人/主力)、Gemini AI 分析。
  - **API Token 設定**：可直接在 UI 中設定成交量 API Token。
- **UI 優化與自定義**：
  - **資訊卡片**：整合上述所有資訊於一張卡片中，支援展開/收合。
  - **位置切換**：可將資訊卡片切換為「靠右」、「靠左」懸浮或「預設」嵌入模式。
  - **獨立視窗**：支援將資訊卡片彈出至獨立視窗，方便多螢幕使用者。資訊卡片在獨立視窗中保留所有互動功能，區塊展開/折疊狀態自動同步。
  - **顯示開關**：可隨時隱藏或顯示資訊卡片。
  - **分組摺疊**：各資訊區塊可獨立展開/摺疊，狀態自動保存至瀏覽器 localStorage。
  - **快速聚焦快捷鍵**：支援 `Alt + Q` 一鍵快速聚焦至搜尋框，可於擴充功能「選項」頁面自訂。

---

## 🚀 安裝說明

### 方式一：從 GitHub Releases 下載（推薦）

1. 前往本專案的 [Releases 頁面](https://github.com/Yuno-Liu/Fugle-Integrator-Extension/releases)。
2. 下載最新版本的 `FugleIntegrator-v*.zip`。
3. 解壓縮到任意位置。
4. 開啟 Chrome 瀏覽器，進入「擴充功能」管理頁面（輸入 `chrome://extensions/`）。
5. 開啟右上角的「**開發人員模式**」。
6. 點擊左上角的「**載入未封裝項目**」。
7. 選擇解壓縮後的 `dist` 資料夾即可完成安裝。

### 方式二：從本機原始碼安裝（開發者用）

1. 克隆本專案到本機：
   ```bash
   git clone https://github.com/Yuno-Liu/Fugle-Integrator-Extension.git
   cd Fugle-Integrator-Extension
   ```

2. 安裝依賴並編譯：
   ```bash
   npm install
   npm run build
   ```

3. 開啟 Chrome 瀏覽器，進入「擴充功能」管理頁面（輸入 `chrome://extensions/`）。
4. 開啟右上角的「**開發人員模式**」。
5. 點擊左上角的「**載入未封裝項目**」。
6. 選擇專案中的 `dist` 資料夾即可完成安裝。

---

## 📖 使用說明

1. 安裝完成後，前往 [富果 Fugle](https://www.fugle.tw/) 網站並進入任一個股頁面 (例如：台積電 2330)。
2. 頁面載入後，您會在股票名稱與價格資訊附近看到新增的「資訊卡片」與「工具按鈕組」。
3. **資訊卡片**：顯示詳細的財務與產業資訊，點擊標題列可收合/展開。
4. **工具按鈕**：
   - 點擊 `🔍 搜尋` 可開啟搜尋視窗，輸入關鍵字（如 "AI"、"2330"、"長榮"）即可快速查找個股或分類，並自動推薦同分類的相關股票。
   - 點擊 `📊 預估量` 可查看根據盤中時間計算的當日預估成交量。
   - 點擊分析網站按鈕 (`📈 WantGoo`、`💬 CMoney`、`📊 TV`、`🏛️ 法人`、`👤 主力`、`🤖 Gemini`) 可開新分頁查詢。
   - 點擊位置按鈕 (如 `➡️ 靠右`) 可切換卡片顯示位置。
   - 點擊 `❐ 彈出` 可將卡片開啟於獨立視窗（支援多螢幕使用）。
   - 點擊 `🔑 Token` 可設定成交量 API Token。
   - 使用 `資訊卡` 滑動開關可暫時隱藏或顯示資訊卡片。

---

## 🛠️ 開發與建置

### 專案結構

```
Fugle-Integrator-Extension/
├── src/                         # TypeScript 原始碼
│   ├── background.ts            # Background Service Worker
│   ├── content.ts               # Content Script 主入口
│   ├── options.ts               # 選項設定頁面腳本
│   ├── config/
│   │   └── constants.ts         # 常數與 API 配置
│   ├── services/
│   │   └── database.ts          # 股票資料庫服務
│   ├── types/
│   │   └── index.ts             # TypeScript 類型定義
│   ├── ui/
│   │   ├── components.ts        # UI 元件與卡片渲染
│   │   ├── modals.ts            # Modal 對話框
│   │   └── styles.ts            # CSS 樣式隔離注入
│   └── utils/
│       └── helpers.ts           # 工具函式 (防抖、數值格式化、主力比率)
├── dist/                        # 編譯輸出目錄 (Chrome 擴充功能載入此目錄)
├── manifest.json                # Chrome 擴充功能配置 (MV3)
├── options.html                 # 設定頁面 HTML
├── stock-data.json              # 股票分類資料庫
├── StockData.db                 # SQLite 股票資料庫
├── package.json                 # NPM 套件配置
├── tsconfig.json                # TypeScript 編譯配置
├── LICENSE                      # MIT 授權條款
└── README.md                    # 本說明文件
```

### 常用指令

```bash
# 安裝相依套件
npm install

# 單次編譯 (產出至 dist/)
npm run build

# 開發監聽模式 (程式碼變更時即時打包)
npm run watch

# 執行 TypeScript 靜態型別檢查
npm run typecheck

# 清除編譯產物
npm run clean
```

---

## 🔑 成交量 API Token 配置

**成交量數據** 需要自行配置 finmindtrade API Token，以下為配置步驟：

### 配置步驟
1. 前往 [finmindtrade.com](https://finmindtrade.com) 註冊免費帳戶。
2. 登入後進入 API 管理頁面，複製您的 API Token。
3. 在富果頁面上，點擊工具列中的 **⚙️ 設定 Token** 按鈕。
4. 將複製的 Token 貼入彈出的設置窗口並點擊 **保存 Token**。
5. Token 會自動保存至瀏覽器 `localStorage`，後續造訪富果時將自動加載數據。

---

## 🌐 相關獨立工具 (Ecosystem)

為了保持本專案的簡潔與專注，以下輔助擴充工具已拆分為獨立的 GitHub 倉庫維護：

- 🤖 **[GeminiUrlPrompt](https://github.com/Yuno-Liu/GeminiUrlPrompt)**：自動讀取 URL 參數 `?p=` 並自動填入送出至 Google Gemini 對話框的 Chrome 擴充功能，完美搭配富果整合器的 Gemini 分析按鈕。
- 💬 **[ChatGptUrlPrompt](https://github.com/Yuno-Liu/ChatGptUrlPrompt)**：自動讀取 URL 參數 `?p=` 並自動填入送出至 ChatGPT、Custom GPTs 與專案工作區（Projects），內建網址產生器與豐富選項設定中心。
- ⏱️ **[AutoRefresh](https://github.com/Yuno-Liu/AutoRefresh)**：分頁獨立計時、毛玻璃懸浮膠囊、強制略過快取與隨機浮動之網頁定時自動刷新套件。
- 🌐 **[AntigravityTranslator](https://github.com/Yuno-Liu/AntigravityTranslator)**：由 Antigravity CLI (Gemini 3.8 Flash) 驅動之全站雙語翻譯器，支援雙語對照、直接替換、懸停氣泡與專屬金融/科技術語庫。
- 📌 **[Localstorage-reader](https://github.com/Yuno-Liu/Localstorage-reader)**：快速查詢當前分頁任意指定 LocalStorage Key/Value 並提供一鍵複製之開發輔助工具。
- 📊 **[TDCC-HoldingRatio](https://github.com/Yuno-Liu/TDCC-HoldingRatio)**：臺灣集中保管結算所集保戶股權分散表之散戶與千張大戶持股比例即時動態計算工具。

---

## 📊 資訊來源

本工具整合之數據主要來自公開網路資訊，包括但不限於：
- **玉山證券 (E.SUN Securities)**：提供產業鏈、概念股、集團股、機構評等、關鍵財務指標、產能數據等。
- **FindBillion (股海尋寶)**：提供 ETF 持股分析與相關數據。
- **富果 (Fugle)**：提供基礎股價與個股頁面框架。
- **其他分析網站**：WantGoo、CMoney、TradingView、富邦證券等 (僅提供快速連結)。

---

## ⚠️ 免責聲明

- 本工具僅供個人研究與學術交流使用，**不構成任何投資建議**。
- 所有數據來源均為公開網路資訊，本工具僅進行彙整與顯示優化，不保證數據的即時性與準確性。
- 投資有風險，使用者應自行判斷並承擔風險。

---

## 📜 授權

本專案採用 **MIT 授權** (MIT License)。詳見 [LICENSE](LICENSE) 文件。

