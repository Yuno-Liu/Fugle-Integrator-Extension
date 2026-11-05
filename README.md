# 富果整合器 - 產業鏈全視圖 (Fugle Integrator)

[![GitHub License](https://img.shields.io/github/license/Yuno-Liu/Fugle-Integrator-Extension)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![CI](https://github.com/Yuno-Liu/Fugle-Integrator-Extension/actions/workflows/ci.yml/badge.svg)](https://github.com/Yuno-Liu/Fugle-Integrator-Extension/actions/workflows/ci.yml)

增強 [富果 Fugle](https://www.fugle.tw/) 個股頁的 Chrome 擴充功能：整合玉山證券、FindBillion 等公開資料，在一張資訊卡中呈現產業鏈、籌碼、機構評等與關鍵財務指標，並提供常用分析網站的快捷連結。

---

## ✨ 主要功能

### 📋 個股資訊卡

開啟任一個股頁時，資訊卡會**立即顯示**，各區塊資料到達即逐一填入（不必等全部完成）。

| 區塊 | 內容 |
| --- | --- |
| 📌 重點摘要 | 主1 買賣超占比、投信 / 外資連買連賣天數、本益比、殖利率、目標均價潛在空間（點擊可跳到對應區塊） |
| 📝 基本資料 | 營收比重長條圖、產業、概念（可點擊查看同分類個股）、董事長 / 總經理、成立與上市櫃日期、官網 |
| 💼 主力買賣 | 主1 / 主3 / 主5 / 主10 / 主20：買超、賣超、淨額（張）與占成交量比率，附正負長條 |
| 🏛️ 連續買賣超 | 投信、外資的持股比、連買 / 連賣天數（標示「轉買」「轉賣」）、當日淨買賣張數與金額 |
| 🔗 關係企業 | 集團、策略聯盟、供應商、客戶、競爭對手（台股可直接點擊前往，海外公司標示交易所） |
| 💸 投資佈局 | 轉投資、被投資 |
| 🎯 機構評等 | 近 6 個月評等明細、調升 / 調降標示、目標價區間圖、與現價的潛在空間 |
| 📦 ETF 持股 | 持有該股的 ETF、合計張數與約占發行股數比例 |
| 💹 財務指標 | 本益比（近四季虧損時顯示「—」）、股價淨值比、EPS、殖利率、每股淨值、毛利率、ROE、ROA（標示單季期別）、股本、市值 |
| 🔍 相關個股 | 同產業、同集團、同概念個股（依股本排序，可展開全部） |
| 🏭 產能分析 | 廠區、規格、產能 |

- **位置**：靠右 / 靠左浮動，或嵌入頁面；浮動時會自動避開富果的個股頁首與工具列。
- **彈出視窗**：可把資訊卡開在獨立視窗（適合多螢幕），內容與互動和頁面同步。
- **站內切換**：點擊資訊卡中的個股或搜尋結果，會直接切換富果的個股頁，不重新載入整個頁面；富果偶爾沒有反應時，會在數秒內自動改用一般頁面載入。中鍵或 Ctrl / ⌘ 點擊則在新分頁開啟。
- **折疊狀態記憶**：整張卡片與各區塊的展開 / 收合狀態會被保存。
- **錯誤處理**：單一區塊載入失敗不影響其他區塊，可在區塊內「重試」；網路異常時會改用離線快取並標示。

### 🔘 工具列

`🔍 搜尋` ｜ 位置 `靠左 / 靠右 / 嵌入` ｜ `❐ 彈出` ｜ `資訊卡` 開關 ｜ `⚙️ 設定` ｜ 外部連結：WantGoo、CMoney、處置、TV（TradingView）、富邦法人 / 主力、Gemini、ChatGPT

- 外部連結都是一般連結，可用中鍵或 Ctrl / ⌘ 點擊在背景分頁開啟；不需要的按鈕可在設定頁隱藏。
- **盤中預估量**：台北時間平日 09:00–13:30 依時段推估全日成交量（滑鼠移上可看係數），收盤後自動隱藏。
- **時鐘**：頁首顯示目前時間，滑鼠移上顯示完整日期與星期。

### 🔍 搜尋

支援股票代號、名稱，以及概念 / 產業 / 集團關鍵字；結果依相關度排序（代號完全符合 > 名稱完全符合 > 開頭符合 > 包含）。

- `↑` `↓` 選擇、`Enter` 開啟、`Esc` 關閉；支援全形數字與「臺 / 台」。
- 支援注音等輸入法：選字時按的 `Enter` 不會誤觸開啟；按下 `Enter` 後若繼續輸入，也不會開啟舊的查詢結果。
- 分類可點入查看所有成員並再篩選；保留最近 8 筆搜尋紀錄。

### 🎨 淺色 / 深色模式

工具列、資訊卡、搜尋視窗與彈出視窗會**自動跟隨富果的淺色 / 深色模式**，也可在設定頁固定為淺色或深色。

### ⌨️ 快速定位快捷鍵

預設 `Alt + Q` 跳到富果頁首的股票搜尋框（macOS 為 `Option + Q`），可在設定頁自訂。

---

## 🚀 安裝

### 從 GitHub Releases 下載（推薦）

1. 前往 [Releases](https://github.com/Yuno-Liu/Fugle-Integrator-Extension/releases) 下載最新的 `FugleIntegrator-v*.zip`。
2. 解壓縮到任意資料夾。
3. 開啟 Chrome，進入 `chrome://extensions/`，開啟右上角的「**開發人員模式**」。
4. 點擊「**載入未封裝項目**」，選取剛剛解壓縮的資料夾（資料夾內可看到 `manifest.json`）。

> 更新版本後，請重新整理已開啟的富果分頁。

### 從原始碼建置

```bash
git clone https://github.com/Yuno-Liu/Fugle-Integrator-Extension.git
cd Fugle-Integrator-Extension
npm ci
npm run build
```

接著在 `chrome://extensions/` 以「載入未封裝項目」選取專案中的 `dist` 資料夾。

---

## ⚙️ 設定

在工具列按 `⚙️`，或於 `chrome://extensions/` 點擊本擴充功能的「詳細資料 → 擴充功能選項」：

- **快捷鍵**：錄製自訂組合鍵（會阻擋 Ctrl+T、Ctrl+W 等瀏覽器保留組合）。
- **資訊卡**：位置、主題、顯示 / 收合、重設各區塊狀態。
- **工具列外部連結**：個別顯示或隱藏。
- **資料來源**：選填的 FinMind Token、清除資料快取。

### 關於 FinMind Token（選填）

主力買賣占比預設使用玉山證券資料中的區間成交量計算，**不需要任何 Token**。只有在該欄位缺漏時，才會改用 FinMind 每日成交量作為備援；設定 Token 可提高備援請求的額度。

Token 只存在擴充功能自己的儲存空間（`chrome.storage.local`），不會提供給富果網站。舊版存放在網頁 localStorage 的 Token 與設定，會在第一次執行新版時自動搬移並刪除。

---

## 🔒 隱私

- 不蒐集、不上傳任何使用資料，也沒有追蹤或分析程式。
- 設定與最近搜尋存在瀏覽器的擴充功能儲存空間（`chrome.storage`；快捷鍵設定會隨 Chrome 帳號同步）。FinMind Token 只存在本機（`chrome.storage.local`）。
- 背景服務只連線到玉山證券、FindBillion、FinMind 與 GitHub（更新股票資料庫）；FinMind Token 只會送往 FinMind。

---

## ❓ 常見問題

- **安裝或更新後沒看到工具列與資訊卡**：重新整理已開啟的富果分頁，並確認目前在個股頁（例如 `https://www.fugle.tw/ai/2330`）。
- **第一次開啟時資料載入較慢**：瀏覽器剛啟動或剛安裝時，背景服務需要時間啟動；沒有回應時會自動重送請求。之後的資料會快取，多個分頁共用。
- **某個區塊顯示錯誤**：按區塊內的「重試」；網路異常時會改顯示離線快取並標示。
- **ETF 持股只顯示連結**：FindBillion 啟用 Cloudflare 驗證時，擴充功能無法取得資料，請點連結到該站查看。
- **點擊個股後畫面沒有切換**：富果偶爾會忽略站內切換，擴充功能偵測到後會在數秒內自動改用一般頁面載入。

---

## 🛠️ 開發

### 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run build` | 正式版建置（壓縮）至 `dist/` |
| `npm run build:dev` | 開發版建置（不壓縮、含 sourcemap 與除錯紀錄） |
| `npm run watch` | 開發版 + 監看檔案變更 |
| `npm run typecheck` | TypeScript 型別檢查（原始碼與測試） |
| `npm test` | 單元與整合測試（Node 內建測試器 + jsdom） |
| `npm run check` | 型別檢查 + 測試 + 建置（CI 執行的內容） |
| `npm run e2e` | 選用：在 Chromium 中實際開啟富果做端對端檢查（第一次需先執行 `npx playwright-core install chromium` 下載瀏覽器） |
| `npm run clean` | 刪除 `dist/` 與測試暫存 `.test-dist/` |

需要 Node.js 22.x（22.22.2 以上）、24.x（24.15 以上）或 26 以上，與測試使用的 jsdom 相同；建議使用 24 LTS（CI 也使用 24）。

### 架構

```
content script（富果頁面）              background service worker
┌──────────────────────────┐ 訊息  ┌───────────────────────────────────────┐
│ app.ts      監看個股變化   │ ───▶ │ main.ts     檢查訊息來源、驗證請求格式 │
│ card.ts     漸進式資訊卡   │      │ router.ts   分派請求                   │
│ toolbar.ts  工具列         │ ◀─── │ datasets.ts 並行抓取、正規化資料       │
│ search.ts   搜尋視窗       │ 資料  │ cache.ts    記憶體 + Cache Storage      │
│ popup.ts    彈出視窗鏡像   │      │ stockdb.ts  股票資料庫索引與搜尋       │
└──────────────────────────┘      └───────────────────────────────────────┘
```

- **個股偵測**：每 400ms 讀取頁面上實際顯示的股票代碼（而非網址），涵蓋所有導覽方式；富果重繪頁首時會自動重新掛上元件，離開個股頁會自動移除。
- **站內導覽**：點擊個股以 pushState + popstate 驅動富果的路由，不重新載入頁面。路由器偶爾會忽略這次導覽，這時以畫面上顯示的代碼判斷：沒有切換時（網址被改回原個股 4 秒後；仍在載入最多 8 秒後）自動改用一般頁面載入，確保點擊一定有效；使用者按上一頁或改看其他頁面則不介入。
- **資料層在 background**：所有請求並行送出、同網址併發合併；全市場清單（約 1.6MB）只在 background 解析並建立索引，頁面只收到單一個股的結果。
- **訊息重送**：背景服務偶爾不回應訊息（實測多發生在剛安裝後第一次開啟）。頁面等待回應的時限依序為 8 秒、8 秒、25 秒，逾時就重送；背景服務會合併同一網址進行中的請求，重送不會重複抓取資料。
- **快取**：記憶體 + Cache Storage（多分頁共用、Service Worker 重啟後仍有效）。籌碼資料 20 分鐘、財務指標 6 小時、公司資料 12 小時；網路失敗時可回傳 7 天內的離線快取。
- **安全性**：background 只接受本擴充功能的訊息、只連線白名單主機，網址由 background 依資料集組成；所有外部字串都經過 HTML 跳脫。

### 專案結構

```
├── src/
│   ├── background.ts / content.ts / options.ts   # 三個進入點
│   ├── background/      # 快取、資料集、股票資料庫、訊息路由
│   ├── content/         # 頁面控制器、資訊卡、工具列、搜尋、彈出視窗、設定同步
│   ├── core/            # 純函式：API 解析、主力計算、全市場快照、台北時間、資料庫索引
│   ├── shared/          # 型別、常數（API 端點、選擇器、快取策略）、訊息協定、設定
│   ├── ui/              # 資訊卡 HTML 元件、樣式（styles.css / popup.css）
│   ├── options/         # 設定頁邏輯
│   └── utils/           # 格式化、HTML 跳脫、快捷鍵、計時工具
├── tests/
│   ├── fixtures/        # 擷取自真實 API 的裁剪資料、富果頁首 DOM
│   ├── helpers/         # chrome / Cache Storage / fetch 測試替身、jsdom 環境
│   └── **/*.test.ts     # 單元與整合測試
├── scripts/             # build.mjs、test.mjs、e2e.mjs
├── manifest.json        # Chrome 擴充功能設定（建置時版本號取自 package.json）
├── options.html         # 設定頁
├── stock-data.json      # 股票分類資料庫（內建；執行時會再從 GitHub 更新）
└── StockData.db         # 產生 stock-data.json 用的 SQLite 資料庫
```

### 測試

- `npm test`：以 Node 內建測試器（`node:test`）與 jsdom 執行單元與整合測試。資料使用擷取自真實 API 的裁剪樣本（`tests/fixtures/`）。測試涵蓋：
  - API 解析，主力與連買連賣的計算
  - 快取與離線快取，訊息驗證與重送
  - 資訊卡渲染、搜尋（含輸入法選字）、站內導覽備援
  - 彈出視窗、設定頁、淺色與深色主題
- 只執行部分測試：`node scripts/test.mjs content/card`，路徑包含關鍵字即可。`--` 之後的參數會直接交給 `node --test`，例如 `node scripts/test.mjs card -- --test-name-pattern=重試`。
- `npm run e2e`：以 playwright-core 啟動 Chromium 並載入 `dist/`，實際開啟 www.fugle.tw 檢查以下項目：
  - 資訊卡的顯示速度與內容
  - 淺色與深色模式
  - 站內切換，以及富果忽略站內切換時的導覽備援
  - 搜尋與快捷鍵、彈出視窗
  - 非個股頁與設定頁

  截圖輸出到 `.e2e-output/`。可加參數，例如 `npm run e2e -- --headed` 顯示瀏覽器視窗、`npm run e2e -- --stock 2454` 指定起始個股。需要網路連線，因此不在 CI 執行。
- Google Chrome 正式版不支援以 `--load-extension` 載入擴充功能，端對端檢查請使用 Playwright 的 Chromium。

### 發布流程

1. 更新 `package.json` 的 `version`。
2. 推送標籤 `v<版本>`（例如 `v2.1.0`），GitHub Actions 會執行檢查、建置並建立 Release；標籤須與 `package.json` 版本一致。

---

## 📝 更新紀錄

### v2.1.0

- **效能**：
  - 資料請求全部同時送出，同網址的請求會合併；實測個股代碼出現後約 0.5～0.9 秒全部區塊載入完成。原本分三批先後請求，約需 3 秒。
  - 全市場資料只在背景服務解析，頁面只收到單一個股的結果。
  - 快取跨分頁共用，網路失敗時可顯示 7 天內的離線快取。
- **資料正確性**：
  - 修正主力買賣占比公式、投信與外資連買連賣天數、股本與市值單位。
  - 修正四捨五入正負不對稱的問題，例如出現 -0。
  - 本益比為 0 或負值時改顯示「—」。
- **介面與操作**：
  - 自動跟隨富果的淺色與深色模式。
  - 新增重點摘要、載入骨架與各區塊的重試。
  - 搜尋視窗可全程用鍵盤操作，支援注音選字與最近搜尋。
  - 彈出視窗與設定頁重新設計。
- **穩定性**：富果忽略站內切換時，自動改用一般頁面載入；背景服務沒有回應時，自動重送請求。
- **安全性**：
  - FinMind Token 改存在擴充功能的儲存空間；舊版存在網頁 localStorage 的資料會自動搬移並刪除。
  - 原本在工具列上的 🔑 Token 按鈕移到設定頁。
  - 背景服務只接受本擴充功能的訊息，只連線白名單主機。
- **開發**：改為 background、content、core、shared 的模組化架構，以 esbuild 建置；新增單元與整合測試，以及在真實網站上執行的端對端檢查。

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
- **玉山證券 (E.SUN Securities)**：產業鏈、概念股、集團股、公司互動關係、機構評等、主力進出、法人連續買賣、關鍵財務指標、產能數據等。
- **FindBillion**：ETF 持股（該站啟用 Cloudflare 驗證時，資訊卡會改提供前往該站查看的連結）。
- **FinMind**：每日成交量（僅作為主力占比的備援資料）。
- **富果 (Fugle)**：基礎股價與個股頁面框架。
- **其他分析網站**：WantGoo、CMoney、TradingView、富邦證券等（僅提供快速連結）。

---

## ⚠️ 免責聲明

- 本工具僅供個人研究與學術交流使用，**不構成任何投資建議**。
- 所有數據來源均為公開網路資訊，本工具僅進行彙整與顯示優化，不保證數據的即時性與準確性。
- 投資有風險，使用者應自行判斷並承擔風險。

---

## 📜 授權

本專案採用 **MIT 授權** (MIT License)。詳見 [LICENSE](LICENSE) 文件。
