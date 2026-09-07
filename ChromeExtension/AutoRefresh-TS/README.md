# 網頁自動刷新器 (Auto Refresh - TS)

一個現代、輕量且高效的 Chrome 擴充套件，允許使用者針對當前分頁自訂秒數自動重新整理網頁，並提供即時倒數計時、網頁懸浮小工具與防快取重新整理等豐富功能。

---

## ✨ 核心特色與功能

1. **⏱️ 高度自訂刷新頻率**
   - 支援精確到秒的自訂間隔（從 1 秒至數萬秒皆可）。
   - 支援 `+1`、`+5`、`-1`、`-5` 秒快捷微調按鈕。
   - 提供常用預設膠囊按鈕：`5秒`、`10秒`、`30秒`、`1分鐘`、`5分鐘`、`10分鐘`，一鍵切換。

2. **📑 分頁獨立運作（Tab-Isolated）**
   - 每個瀏覽器分頁皆具備完全獨立的計時器與設定狀態。
   - A 分頁設定 10 秒刷新，B 分頁設定 60 秒刷新，彼此互不影響。
   - 分頁關閉時自動清理計時器與暫存，不佔用系統資源。

3. **📊 即時倒數與動態進度**
   - 彈跳視窗（Popup）內建大字體即時倒數顯示與平滑動態進度條。
   - 即時統計：顯示當前分頁「累計刷新次數」與「上次刷新時間」。

4. **📌 網頁懸浮倒數小工具（Floating Widget）**
   - 在網頁右上角注入極簡、毛玻璃質感（Glassmorphism）的懸浮膠囊。
   - 採用 **Shadow DOM** 技術，樣式完全隔離，絕不影響或受制於原網頁樣式。
   - **支援自由拖曳**：可拖動至螢幕任意位置，並自動記住拖曳位置。
   - 顯示即時秒數與累計次數，並附帶一鍵停止按鈕。
   - 可在設定中自由開啟或關閉。

5. **🏷️ 工具列圖示即時 Badge 顯示**
   - 擴充套件圖示即時顯示剩餘倒數秒數（例如 `8s`、`3s`），綠色背景醒目提示。
   - 無需打開彈跳視窗，隨時掌握目前分頁是否正在自動刷新。

6. **⚙️ 實用進階選項**
   - **強制重新整理（略過快取）**：開啟後每次刷新直接向伺服器請求最新資源，避免讀取到舊的瀏覽器 Cache。
   - **隨機浮動秒數（Jitter）**：支援設定 `±N` 秒的隨機波動，避免固定規律請求，降低被網站伺服器識別為機器人或限速的風險。
   - **一鍵立即重新整理**：無需等待計時結束，點擊即可立即觸發一次重新整理。

---

## 🚀 安裝說明

### 載入未封裝項目（開發者模式）

1. 開啟 Chrome 瀏覽器，在網址列輸入 `chrome://extensions/` 並按 Enter。
2. 開啟右上角的「**開發人員模式**」（Developer mode）。
3. 點擊左上角的「**載入未封裝項目**」（Load unpacked）。
4. 選擇本專案編譯後的目錄：`ChromeExtension/AutoRefresh-TS/dist`。
5. 安裝完成後，即可在 Chrome 工具列看見「網頁自動刷新器」圖示，建議點擊圖釘圖示將其固定在工具列以便隨時操作。

---

## 🛠️ 開發與編譯指南

本擴充套件採用 **TypeScript** 與 **esbuild** 構建，輕量且極速。

### 常用指令

進入本目錄：
```bash
cd ChromeExtension/AutoRefresh-TS
```

安裝相依套件：
```bash
npm install
```

編譯生產版本（產出至 `dist/` 資料夾）：
```bash
npm run build
```

開發監聽模式（程式碼變更時自動即時打包）：
```bash
npm run watch
```

TypeScript 語法與型別檢查：
```bash
npm run typecheck
```

清除編譯產物：
```bash
npm run clean
```

---

## 📂 目錄結構

```
AutoRefresh-TS/
├── dist/                     # 編譯輸出目錄（載入此資料夾至 Chrome）
│   ├── background.js
│   ├── content.js
│   ├── popup.js
│   ├── popup.html
│   └── manifest.json
├── src/
│   ├── background.ts         # Service Worker：管理全域分頁狀態、Badge 與 Alarms 備援
│   ├── content.ts            # Content Script：網頁端秒級計時、Shadow DOM 懸浮小工具
│   ├── popup.ts              # 彈跳控制視窗邏輯：秒數控制、狀態同步、事件監聽
│   └── types.ts              # TypeScript 型別定義與共用常數工具
├── manifest.json             # Manifest V3 配置
├── popup.html                # 彈跳視窗 HTML 介面與樣式
├── package.json              # 專案相依性與 npm scripts
├── tsconfig.json             # TypeScript 配置
└── README.md                 # 說明文件
```

---

## 📜 授權

本專案採用 **MIT 授權**。
