# Gemini URL Prompt - TypeScript 版本

自動讀取網址參數並填入 Google Gemini 對話框的 Chrome 擴充功能。

## 功能

-   ✍️ 自動從 URL 參數 `?p=` 提取提示詞
-   🔗 使用 XPath 定位 Gemini SPA 的輸入框
-   ⏳ 支援非同步 DOM 渲染（輪詢機制）
-   🚀 自動送出提示詞

## 結構

```
GeminiUrlPrompt-TS/
├── src/
│   ├── content.ts          # Content script 入口點
│   └── utils/
│       ├── xpath.ts        # XPath 工具函式
│       └── constants.ts    # 常數定義
├── dist/                   # 編譯輸出
│   └── content.js
├── manifest.json           # 擴充功能配置
├── package.json
├── tsconfig.json
└── README.md
```

## 開發

### 安裝依賴

```bash
npm install
```

### 編譯

```bash
npm run build
```

### 監視模式

```bash
npm run watch
```

### 型別檢查

```bash
npm run typecheck
```

## 核心概念

### XPath 查詢

Gemini 是基於 Angular 的 SPA，DOM 結構通過 JavaScript 動態渲染。Content Script 使用 XPath 而非 CSS 選擇器，因為：

1. **靈活性**: XPath 支援層級遍歷，適合深層嵌套的 DOM
2. **精確定位**: 可精確定位特定深度的元素
3. **穩健性**: 對 CSS 類名變更較不敏感

### 輪詢機制

由於 Gemini 的 DOM 非同步渲染，使用 `waitForXPath()` 函式：

```typescript
const element = await waitForXPath(xpath, timeout);
```

-   每 300ms 檢查一次 XPath 元素是否出現
-   超過 10000ms 則拋出超時錯誤
-   Promise 機制確保 DOM 準備完成後再執行填入操作

### InputEvent 觸發

寫入 `.textContent` 後需觸發 `InputEvent`，讓 Angular 的雙向綁定感知變更：

```typescript
inputElement.dispatchEvent(
    new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: message,
    })
);
```

## URL 參數格式

使用格式：

```
https://gemini.google.com/gem/[chatId]?p=股票代碼%20公司名稱
```

例如：

```
https://gemini.google.com/gem/1QUXOXLuTZt54GwWAClfuBcs7Q4LlFRsc?p=2330%20台積電
```

## 許可

MIT
