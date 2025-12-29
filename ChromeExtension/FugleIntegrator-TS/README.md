# 富果整合器 - TypeScript 版本

這是富果整合器的 TypeScript 重構版本，提供更好的類型安全和程式碼維護性。

## 專案結構

```
FugleIntegrator-TS/
├── src/                         # TypeScript 原始碼
│   ├── background.ts            # Background Service Worker
│   ├── content.ts               # Content Script 主入口
│   ├── config/
│   │   └── constants.ts         # 常數與 API 配置
│   ├── services/
│   │   └── database.ts          # 股票資料庫服務
│   ├── types/
│   │   └── index.ts             # TypeScript 類型定義
│   ├── ui/
│   │   ├── components.ts        # UI 元件
│   │   ├── modals.ts            # Modal 對話框
│   │   └── styles.ts            # 樣式注入
│   └── utils/
│       └── helpers.ts           # 工具函式
├── dist/                        # 編譯輸出目錄 (Chrome 擴充功能載入此目錄)
│   ├── background.js            # 編譯後的 Background Script
│   ├── content.js               # 編譯後的 Content Script
│   ├── manifest.json            # Chrome 擴充功能配置
│   └── stock-data.json          # 股票資料庫 (從原始專案複製)
├── package.json                 # NPM 配置
├── tsconfig.json                # TypeScript 編譯配置
└── README.md                    # 本文件
```

## 開發環境設置

### 安裝依賴

```bash
cd ChromeExtension/FugleIntegrator-TS
npm install
```

### 編譯 TypeScript

```bash
# 單次編譯 (會自動複製 stock-data.json)
npm run build

# 監聽模式（開發時使用）
npm run watch

# 僅執行類型檢查
npm run typecheck
```

### 載入擴充功能

1. 執行 `npm run build` 編譯 TypeScript
2. 開啟 Chrome，前往 `chrome://extensions/`
3. 啟用「開發者模式」
4. 點擊「載入未封裝項目」，選擇 `dist/` 目錄
5. 前往 https://www.fugle.tw/ai/2330 測試擴充功能

## 類型定義

所有 API 回應和資料結構都有明確的 TypeScript 類型定義，位於 `src/types/index.ts`：

-   `EsunResultSet<T>` - 玉山 API 標準回應結構
-   `StockBasicInfo` - 股票基本資料
-   `RelationItem` - 關係企業項目
-   `RatingItem` - 機構評等項目
-   `ETFHoldingItem` - ETF 持股項目
-   `MajorRatioResult` - 主力買賣比率計算結果
-   更多類型請參閱原始碼

## 模組說明

### `config/constants.ts`

定義所有 API 端點 URL 和常數設定（超時時間、緩存時間等）。

### `utils/helpers.ts`

通用工具函式，包括：

-   防抖動/節流函式
-   數值格式化
-   網路請求封裝
-   主力買賣比率計算

### `services/database.ts`

本地 JSON 資料庫操作，提供概念股、產業、集團查詢功能。

### `ui/components.ts`

UI 元件產生函式，負責產生各區塊的 HTML 內容。

### `ui/modals.ts`

Modal 對話框，包括 Token 設定和搜尋功能。

### `ui/styles.ts`

CSS 樣式注入函式。

## 與 JavaScript 版本的差異

1. **類型安全** - 所有變數和函式都有明確的類型定義
2. **模組化** - 程式碼拆分為多個模組，更易於維護
3. **編譯時錯誤檢查** - TypeScript 編譯器可在開發時發現潛在錯誤
4. **更好的 IDE 支援** - 完整的自動補全和類型提示

## 注意事項

-   Chrome 擴充功能需要載入編譯後的 `dist/` 目錄
-   修改 TypeScript 後需重新編譯
-   `stock-data.json` 需要手動複製到 `dist/` 目錄
