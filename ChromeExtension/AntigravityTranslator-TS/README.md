# 🌐 Antigravity 網頁全站翻譯器 (Antigravity Translator TS)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Model](https://img.shields.io/badge/AI%20Model-gemini--3.8--flash-8B5CF6?logo=google&logoColor=white)](https://ai.google.dev/)
[![CLI](https://img.shields.io/badge/Powered%20by-Antigravity%20CLI-06B6D4)](https://github.com/google)

**Antigravity 網頁全站翻譯器** 是一款專為高效閱讀外語技術文件、金融財經分析與學術論文設計的現代化 Chrome 擴充套件。  
透過本地專屬的 **Antigravity CLI Bridge**，無縫調度本機安裝的 `agy` (Antigravity CLI) 工具，利用 Google **Gemini 3.8 Flash** 模型與極速低延遲推理 (`effort: low`)，實現絲滑流暢、語意精準且排版無損的全站雙語翻譯體驗。

---

## ✨ 核心功能亮點 (Key Highlights)

- 🤖 **Antigravity CLI 原生驅動**：
  - 嚴格遵循 `.agents/rules/rules.md` 規範，預設採用 `gemini-3.8-flash` 搭配 `low` 推理深度，毫秒級極速回應。
  - 同時支援 `gemini-4-argon`、`claude-sonnet-5-5`、`claude-opus-5-5`、`gpt-oss-120b` 與自訂模型名稱。
- 👁️ **三種靈活呈現模式 (Display Modes)**：
  1. **雙語對照 (Bilingual)**：於原文下方無損注入譯文，完美保留原始網頁排版，段落間距與字體大小可自訂。
  2. **直接替換 (Replace)**：以譯文精準替換原文文字節點，適合沉浸式純中文閱讀。
  3. **懸停對照 (Hover)**：游標懸停或按住 `Alt` / `Control` / `Shift` 鍵時，以懸浮氣泡顯示翻譯。
- 🎨 **深色科技感 UI 與即時視覺預覽 (Dark Cyber UI & Live Preview)**：
  - **快速 Popup 彈窗**：寬度 `380px`，具備 CLI Bridge 連線指示燈、一鍵翻譯/原文還原切換、即時節點進度條、目標語言與模式膠囊切換、網域自動開關。
  - **全螢幕設定中心 (Options Dashboard)**：雙欄式導覽，內建 **即時效果預覽卡片 (Live Preview Box)**，調整任何排版滑桿或字色即刻反應。
- 🎯 **六大專業領域翻譯風格 (Domain Presets)**：
  - `自然流暢 (Natural)`：日常母語閱讀習慣，通順得體。
  - `科技工程 (Technical)`：精準工程術語，自動保留程式碼縮寫與專有名詞。
  - `財經投資 (Financial)`：標準證券金融、商業經營與財報指標語調（如 EPS 翻為每股盈餘、YoY 翻為年增率）。
  - `學術論文 (Academic)`：正式論文嚴謹典雅風格，邏輯分明。
  - `精簡摘要 (Concise)`：去蕪存菁俐落短句，利於快速掃讀。
  - `自訂提示詞 (Custom)`：支援使用者自由輸入系統指示詞。
- 📚 **專屬術語庫與強制對照 (Custom Glossary)**：
  - 支援關鍵字強制對照、大小寫區分開關與即時搜尋過濾。
  - 內建 **「📈 一鍵載入台美股財經常用術語」** 與 **「💻 一鍵載入 AI 與軟體工程常用術語」** 快速範本。
- ⚡ **可視區域優先 (Viewport Priority) & 本地快取 (Translation Cache)**：
  - 首屏優先渲染可見範圍，滾動時懶加載翻譯；搭配 Local Cache 避免重複運算。
- 🛡️ **自動化與動態網頁監聽**：
  - 支援自動翻譯網域清單、永不翻譯黑名單、CSS 選擇器排除清單（如 `code, pre, .notranslate`）。
  - 支援 SPA 單頁應用 DOM 動態變更監聽 (MutationObserver)，自動辨識無窮滾動或動態載入內容。
- ⌨️ **鍵盤快捷鍵錄製**：
  - 全頁翻譯/還原（預設 `Alt+T`）、切換雙語/替換模式（預設 `Alt+M`）、選取文字翻譯（預設 `Alt+S`），點擊輸入框即可自訂按鍵組合。

---

## 🏗️ 系統架構與運作流程 (Architecture & Flow)

擴充套件採用安全解耦的架構，瀏覽器透過本地 HTTP 橋接服務調度 CLI：

```mermaid
flowchart LR
    subgraph Browser["🌐 瀏覽器 (Chrome Browser)"]
        Popup["📱 快速彈窗\n(popup.html / popup.ts)"]
        Options["⚙️ 設定中心\n(options.html / options.ts)"]
        CS["📄 Content Script\n(DOM 走訪 / 節點注入)"]
        SW["⚡ Background Service Worker\n(快取管理 / 請求併發排隊)"]
    end

    subgraph Host["💻 本機環境 (Local Host)"]
        Bridge["🌉 CLI Bridge Server\n(http://127.0.0.1:18765)"]
        CLI["🤖 Antigravity CLI (agy)\n--model gemini-3.8-flash --effort low"]
    end

    Popup -->|訊息通訊| SW
    Options -->|讀寫設定| SW
    CS <-->|文字單元批次| SW
    SW <-->|HTTP POST /api/translate| Bridge
    Bridge <-->|STDIN / STDOUT (JSON)| CLI
```

### 翻譯運作流程：
1. **DOM 遍歷與分批**：Content Script 掃描目前頁面文字節點，過濾純數字、標籤代碼與排除選擇器，按 `batchSize` 與 `maxCharsPerBatch` 封裝批次。
2. **快取檢索**：Background Worker 檢查本地 Storage 快取，已翻譯過的文字直接命中返回。
3. **HTTP 橋接轉發**：未命中的批次透過標準 HTTP 請求發送至本地 Bridge (`http://127.0.0.1:18765/api/translate`)。
4. **CLI 推理生成**：Bridge 組裝包含領域風格與術語庫之 Prompt，執行 `agy --model gemini-3.8-flash --effort low`，解析 Markdown/JSON 結構並回傳譯文。
5. **動態排版注入**：Content Script 依據所選模式（雙語對照、直接替換或懸停氣泡）將譯文注入網頁中。

---

## 🚀 安裝與啟動指引 (Installation & Quick Start)

### 步驟 1：建置擴充套件
在專案根目錄或套件目錄下執行相依安裝與編譯：

```bash
cd ChromeExtension/AntigravityTranslator-TS
npm install
npm run build
```

編譯完成後，所有靜態資源與腳本將輸出於 `dist/` 資料夾中。

### 步驟 2：啟動本地 Antigravity CLI 橋接服務
確保本機環境已安裝 `agy` (Antigravity CLI)，並於終端機啟動橋接服務：

```bash
npm run bridge
# 或手動執行:
node bridge/server.mjs
```

伺服器預設將監聽於 `http://127.0.0.1:18765`。終端機會顯示偵測到的 `agy` 執行路徑與健康狀態。

### 步驟 3：於 Chrome 瀏覽器載入擴充套件
1. 開啟 Chrome 瀏覽器，進入擴充功能管理頁面：`chrome://extensions/`
2. 開啟右上角 **「開發人員模式」 (Developer mode)** 開關。
3. 點選左上角 **「載入未封裝項目」 (Load unpacked)**。
4. 選取本套件的 `dist` 目錄：
   `ChromeExtension/AntigravityTranslator-TS/dist`
5. 安裝完成！點擊瀏覽器工具列的 🌐 圖示，即可開始享受全站雙語翻譯。

---

## ⚙️ 完整自訂設定選項一覽表 (Configuration Reference)

| 設定分頁 | 參數名稱 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| **CLI 與模型** | `bridgeUrl` | `http://127.0.0.1:18765` | 本地 Bridge 伺服器位址 |
| | `cliPath` | `agy` | 本機 Antigravity CLI 執行指令或路徑 |
| | `model` | `gemini-3.8-flash` | 推薦極速模型，亦可選 `gemini-4-argon` 等 |
| | `effort` | `low` | 推理深度等級 (`low` / `medium` / `high` / `xhigh` / `max`) |
| | `singleBatchMode` | `true` | 是否啟用「單次最大 Token 全頁直出（免分批）」極速模式 |
| | `batchSize` | `100` | 分批模式下單批次送入翻譯之文字節點數上限 (10~500) |
| | `maxCharsPerBatch` | `15000` | 分批模式下單批次總字元長度限制 (1000~30000) |
| | `concurrency` | `4` | 同時發送給 CLI 的並發批次數量 (1~8) |
| | `timeoutSec` | `60` | CLI 單次執行之逾時等待秒數 (15~240) |
| **語言與風格** | `sourceLang` | `auto` | 來源語言代碼（自動偵測、英文、日文等） |
| | `targetLang` | `zh-TW` | 目標語言代碼（繁體中文、簡體中文、英文等） |
| | `translationStyle` | `natural` | 領域風格 (`natural` / `technical` / `financial` / `academic` / `concise` / `custom`) |
| | `customPrompt` | `""` | 使用者自訂額外系統提示詞與特殊語氣 |
| | `preserveFormatting` | `true` | 是否嚴格保留原始段落換行與縮排 |
| | `skipNumbersAndCodes`| `true` | 是否自動略過純數字、股號與簡短代碼 |
| | `translateAttributes`| `false` | 是否翻譯 placeholder、title、aria-label 提示屬性 |
| **專屬術語庫** | `glossary` | 內建範本 | 原文與指定譯文對照清單，支援大小寫敏感切換 |
| **視覺與排版** | `displayMode` | `bilingual` | 呈現模式 (`bilingual` 雙語 / `replace` 替換 / `hover` 懸停) |
| | `highlightStyle` | `subtle-bg` | 譯文強調樣式 (`left-border` / `subtle-bg` / `dashed-underline` / `card` / `none`) |
| | `fontSizeScale` | `0.95` | 譯文字體大小縮放比例 (80% ~ 130%) |
| | `bilingualSpacing` | `4` | 雙語段落上下間距 (0px ~ 16px) |
| | `textColor` | `#2563EB` | 譯文字體自訂顏色值 |
| | `dimOriginal` | `false` | 是否將原文淡化以凸顯譯文 |
| | `showFloatingBall` | `true` | 是否在網頁邊角顯示浮動快速控制球 |
| | `floatingBallPosition`| `right` | 浮動球停靠方位 (`right` 右下 / `left` 左下) |
| **互動與快捷鍵**| `enableSelectionTranslate` | `true` | 選取文字時是否顯示劃詞翻譯氣泡 |
| | `enableHoverTranslate` | `false` | 是否啟用按住修飾鍵懸停段落翻譯 |
| | `hoverTriggerKey` | `Alt` | 懸停觸發修飾鍵 (`Alt` / `Control` / `Shift`) |
| | `shortcutTogglePage` | `Alt+T` | 全頁翻譯 / 原文還原切換快捷鍵 |
| | `shortcutToggleMode` | `Alt+M` | 切換雙語 / 替換呈現模式快捷鍵 |
| | `shortcutTranslateSelection` | `Alt+S` | 翻譯選取文字快捷鍵 |
| **網域與快取** | `autoTranslateDomains` | `[]` | 開啟網頁即自動發起翻譯的網域清單 |
| | `excludedDomains` | `[]` | 永不翻譯的排除網域黑名單 |
| | `excludedSelectors` | `[".no-translate", "[translate=\"no\"]"]` | 排除翻譯的 CSS 選擇器清單 |
| | `dynamicMutationObserve` | `true` | 是否監聽 SPA 單頁應用之動態 DOM 變更 |
| | `viewportPriorityOnly` | `false` | 是否僅優先翻譯當前視窗可視範圍 |
| | `enableCache` | `true` | 是否啟用本地翻譯快取以提升效能 |
| | `maxCacheEntries` | `5000` | 本地快取最大儲存筆數上限 |

---

## 🧪 常用開發與測試指令 (Development & Testing)

```bash
# 執行 TypeScript 型別檢查
npm run typecheck

# 執行自動化單元測試 (含 Prompt 生成、文字分塊與 DOM 過濾邏輯)
npm run test

# 重新建置擴充套件
npm run build

# 啟動熱重載開發監聽 (Watch Mode)
npm run watch

# 啟動本地 CLI 橋接伺服器
npm run bridge
```

---

## 📜 授權協議 (License)

本專案採用 **MIT License** 授權，歡迎自由研究、擴充與社群協作。
