---
description: "Antigravity CLI Task Routing & Model Configuration Rules"
---

# 🤖 Antigravity CLI 任務與模型分流規範

在處理本專案的任何任務時，請根據任務的性質、類型與複雜度，自動選擇對應的模型（Model）與推理深度（Effort Level）。若任務需要拆解並派發子任務，請務必按照以下分類指派子任務的模型與參數。

---

## 🎯 任務模型與 Effort 分配規則

### 1. 🏗️ 架構規劃與複雜問題分析 (Architecture & Complex Problem Solving)
* **適用場景**：專案架構設計、系統重構規劃、複雜邏輯與演算法排查、跨模組依賴分析、深度 Debug。
* **指定模型**：`gemini-4-argon`
* **推理深度 (Effort)**：`high`
* **執行原則**：作為主代理（Primary Agent）的核心決策模型，確保提供邏輯嚴密且全盤考量的規劃方案。

### 2. 🔍 文件與檔案查詢 (Documentation & File Search Subtasks)
* **適用場景**：掃描專案目錄、檢索與閱讀檔案內容、查詢第三方 SDK/Library 文件、過濾程式碼片斷。
* **指定模型**：`gemini-3.8-flash`
* **推理深度 (Effort)**：`low`
* **執行原則**：派發平行子任務（Subtasks）進行大量文字與檔案讀取，以快速回應並節省資源與時間。

### 3. 💻 程式碼開發與編寫 (Code Implementation & Refactoring)
* **適用場景**：撰寫新功能程式碼、修改既有 Function、編寫單元測試 (Unit Tests)、執行程式碼風格重構與修復語法錯誤。
* **指定模型**：`gemini-3.8-flash`
* **推理深度 (Effort)**：`high`
* **執行原則**：在具備足夠推理深度的前提下，高效產出高品質且無語法漏洞的程式碼。

---

## ⚙️ 子任務執行注意事項
1. **平行派發**：當主代理在 `gemini-4-argon (high)` 下完成架構規劃後，若需要對多個檔案進行檢索，請將讀取與查詢任務拆解為多個子任務，並統一指定使用 `gemini-3.8-flash (low)` 執行。
2. **開發切換**：進入實際寫 Code 或修改檔案階段時，子任務或後續執行請切換至 `gemini-3.8-flash (high)`。
3. **驗證機制**：程式碼修改完成後，請透過讀取修改後的檔案內容（使用 `gemini-3.8-flash (low)`）確認變更是否正確套用。