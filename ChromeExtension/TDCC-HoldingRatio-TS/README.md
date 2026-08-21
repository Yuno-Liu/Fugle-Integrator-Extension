# TDCC 持股比例統計工具 - TypeScript 版本

將原本 Tampermonkey 腳本重構為 Chrome Extension（Manifest V3）並以 TypeScript 開發。

## 功能

-   顯示固定面板計算 TDCC 持股級距的散戶/大戶比例
-   可自訂散戶（≤ 級距）與大戶（≥ 級距）判定門檻
-   顯示百分比結果與進度條動畫
-   使用 MutationObserver 在 TDCC 表格更新時自動重算
-   支援手動「重新計算」與 `ESC` 快速收合面板

## 專案結構

```
TDCC-HoldingRatio-TS/
├── src/
│   ├── content.ts              # Content Script 入口
│   ├── config/
│   │   └── constants.ts        # 常數、級距選項、預設配置
│   ├── core/
│   │   ├── calculator.ts       # 比例計算與百分比限制
│   │   └── parser.ts           # TDCC 表格資料解析
│   ├── ui/
│   │   ├── panel.ts            # 面板建立與元素快取
│   │   └── styles.ts           # CSS 注入
│   └── types/
│       └── index.ts            # 型別定義
├── tests/
│   └── calculator.test.mjs     # 核心計算測試
├── manifest.json
├── package.json
├── tsconfig.json
└── tsconfig.test.json
```

## 開發指令

```bash
npm install
npm run test
npm run build
```

## 載入方式

1. 執行 `npm run build`
2. 開啟 `chrome://extensions/`
3. 啟用開發者模式
4. 點擊「載入未封裝項目」並選擇 `dist/` 目錄
