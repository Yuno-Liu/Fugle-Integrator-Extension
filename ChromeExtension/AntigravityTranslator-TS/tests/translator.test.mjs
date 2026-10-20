/**
 * ============================================================================
 * 🧪 Antigravity Translator - 核心純邏輯模組單元測試 (Unit Tests)
 * ============================================================================
 *
 * 本測試套件採用 Node.js 原生測試框架 (node:test 與 node:assert/strict)，
 * 全面覆蓋以下核心邏輯模組：
 * 1. promptBuilder.ts (提示詞組裝、風格注入、術語表與極致容錯輸出解析)
 * 2. textChunker.ts (批次微切分演算法、FNV-1a 雜湊快取金鑰、術語過濾)
 * 3. domFilter.ts (文字跳過規則、數字/URL/Email 識別、網域名稱比對)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// 從編譯輸出之 dist-test 匯入待測模組
import {
    buildTranslationPrompt,
    buildSingleTranslationPrompt,
    parseTranslationOutput
} from "../dist-test/core/promptBuilder.js";

import {
    chunkTranslationItems,
    computeCacheKey,
    deduplicateTranslationItems,
    expandDeduplicatedTranslations,
    filterRelevantGlossary
} from "../dist-test/core/textChunker.js";

import {
    shouldSkipText,
    matchesDomainList
} from "../dist-test/core/domFilter.js";

import {
    DEFAULT_CONFIG,
    STYLE_PRESETS,
    SUPPORTED_LANGUAGES,
    AVAILABLE_MODELS
} from "../dist-test/config/constants.js";

// ============================================================================
// 1. 常數與設定模組測試 (Constants & Config Tests)
// ============================================================================
describe("Constants & Default Config", () => {
    it("應具備正確的預設模型、推理深度與單次最大 Token 直出模式", () => {
        assert.equal(DEFAULT_CONFIG.model, "gemini-3.8-flash");
        assert.equal(DEFAULT_CONFIG.effort, "low");
        assert.equal(DEFAULT_CONFIG.singleBatchMode, true);
        assert.equal(DEFAULT_CONFIG.bridgeUrl, "http://127.0.0.1:18765");
        assert.equal(DEFAULT_CONFIG.targetLang, "zh-TW");
        assert.equal(DEFAULT_CONFIG.displayMode, "bilingual");
    });

    it("應包含完整的支援語言與模型清單", () => {
        assert.ok(SUPPORTED_LANGUAGES.some((l) => l.code === "zh-TW"));
        assert.ok(SUPPORTED_LANGUAGES.some((l) => l.code === "auto"));
        assert.ok(AVAILABLE_MODELS.some((m) => m.id === "gemini-3.8-flash"));
        assert.ok(AVAILABLE_MODELS.some((m) => m.id === "gemini-4-argon"));
    });
});

// ============================================================================
// 2. 提示詞建構與容錯解析測試 (Prompt Builder Tests)
// ============================================================================
describe("Prompt Builder (promptBuilder.ts)", () => {
    const mockItems = [
        { id: "0", text: "Welcome to Antigravity." },
        { id: "1", text: "The latest EPS reached record highs." }
    ];

    const mockGlossary = [
        { id: "g1", source: "Antigravity", target: "Antigravity", enabled: true },
        { id: "g2", source: "EPS", target: "每股盈餘 (EPS)", enabled: true },
        { id: "g3", source: "UnusedTerm", target: "未使用", enabled: false }
    ];

    it("buildTranslationPrompt: 應正確注入 JSON、語言標籤、風格指引與啟用之術語表", () => {
        const prompt = buildTranslationPrompt({
            items: mockItems,
            sourceLang: "en",
            targetLang: "zh-TW",
            style: "financial",
            customPrompt: "請注意保持語氣專業",
            glossary: mockGlossary
        });

        // 檢驗包含語言指示
        assert.ok(prompt.includes("來源語言：en"));
        assert.ok(prompt.includes("目標語言：zh-TW"));

        // 檢驗注入財經風格指引
        assert.ok(prompt.includes(STYLE_PRESETS.financial.systemInstruction));

        // 檢驗啟用之術語表
        assert.ok(prompt.includes('"Antigravity" => "Antigravity"'));
        assert.ok(prompt.includes('"EPS" => "每股盈餘 (EPS)"'));
        // 未啟用術語不應出現
        assert.ok(!prompt.includes('"UnusedTerm"'));

        // 檢驗使用者自訂提示詞
        assert.ok(prompt.includes("請注意保持語氣專業"));

        // 檢驗 JSON 包含原文 items
        assert.ok(prompt.includes("Welcome to Antigravity."));
        assert.ok(prompt.includes("The latest EPS reached record highs."));
    });

    it("buildSingleTranslationPrompt: 應生成精簡單句翻譯提示詞", () => {
        const prompt = buildSingleTranslationPrompt(
            "Quick turnaround time.",
            "auto",
            "zh-TW",
            "technical",
            "",
            []
        );

        assert.ok(prompt.includes("Quick turnaround time."));
        assert.ok(prompt.includes("目標語言：zh-TW"));
        assert.ok(prompt.includes(STYLE_PRESETS.technical.systemInstruction));
    });

    describe("parseTranslationOutput: 多層容錯解析機制", () => {
        it("策略 1: 能解析標準 Markdown ```json 區塊", () => {
            const raw = '```json\n{\n  "0": "歡迎來到 Antigravity。",\n  "1": "最新每股盈餘 (EPS) 創下歷史新高。"\n}\n```';
            const parsed = parseTranslationOutput(raw, mockItems);
            assert.equal(parsed["0"], "歡迎來到 Antigravity。");
            assert.equal(parsed["1"], "最新每股盈餘 (EPS) 創下歷史新高。");
        });

        it("策略 2: 能解析夾帶前後問候與結尾文字的輸出", () => {
            const raw = `Here is your translation:
{
  "0": "歡迎來到 Antigravity。",
  "1": "最新每股盈餘 (EPS) 創下歷史新高。"
}
Hope this helps!`;
            const parsed = parseTranslationOutput(raw, mockItems);
            assert.equal(parsed["0"], "歡迎來到 Antigravity。");
            assert.equal(parsed["1"], "最新每股盈餘 (EPS) 創下歷史新高。");
        });

        it("策略 3: 能解析模型回傳的純 JSON 陣列格式", () => {
            const raw = '["歡迎來到 Antigravity。", "最新每股盈餘 (EPS) 創下歷史新高。"]';
            const parsed = parseTranslationOutput(raw, mockItems);
            assert.equal(parsed["0"], "歡迎來到 Antigravity。");
            assert.equal(parsed["1"], "最新每股盈餘 (EPS) 創下歷史新高。");
        });

        it("策略 4: 正則表達式能從破損或不規則格式中抽取鍵值", () => {
            const raw = 'Output: "0": "歡迎來到 Antigravity。", and "1": "最新每股盈餘 (EPS) 創下歷史新高。" done.';
            const parsed = parseTranslationOutput(raw, mockItems);
            assert.equal(parsed["0"], "歡迎來到 Antigravity。");
            assert.equal(parsed["1"], "最新每股盈餘 (EPS) 創下歷史新高。");
        });

        it("策略 5: 能解析行級備援格式 [0] 譯文", () => {
            const raw = `[0] 歡迎來到 Antigravity。\n[1] 最新每股盈餘 (EPS) 創下歷史新高。`;
            const parsed = parseTranslationOutput(raw, mockItems);
            assert.equal(parsed["0"], "歡迎來到 Antigravity。");
            assert.equal(parsed["1"], "最新每股盈餘 (EPS) 創下歷史新高。");
        });

        it("策略 6: 預期單一項目時純文字直接降級賦值", () => {
            const singleItem = [{ id: "single-1", text: "Hello" }];
            const raw = "你好";
            const parsed = parseTranslationOutput(raw, singleItem);
            assert.equal(parsed["single-1"], "你好");
        });
    });
});

// ============================================================================
// 3. 文字切分與快取演算法測試 (Text Chunker Tests)
// ============================================================================
describe("Text Chunker (textChunker.ts)", () => {
    it("chunkTranslationItems: 能依照 batchSize 數量上限正確切分", () => {
        const items = [
            { id: "1", text: "Line 1" },
            { id: "2", text: "Line 2" },
            { id: "3", text: "Line 3" },
            { id: "4", text: "Line 4" },
            { id: "5", text: "Line 5" }
        ];

        const chunks = chunkTranslationItems(items, 2, 1000);
        assert.equal(chunks.length, 3);
        assert.equal(chunks[0].length, 2);
        assert.equal(chunks[1].length, 2);
        assert.equal(chunks[2].length, 1);
    });

    it("chunkTranslationItems: 能依照 maxCharsPerBatch 字數上限正確切分", () => {
        const items = [
            { id: "1", text: "A".repeat(50) },
            { id: "2", text: "B".repeat(60) }, // 50+60 = 110 > 100，應分開
            { id: "3", text: "C".repeat(30) }
        ];

        const chunks = chunkTranslationItems(items, 10, 100);
        assert.equal(chunks.length, 2);
        assert.equal(chunks[0].length, 1);
        assert.equal(chunks[1].length, 2);
    });

    it("chunkTranslationItems: 啟用 singleBatchMode 時應以單次最大 Token 合併整頁項目", () => {
        const items = Array.from({ length: 120 }, (_, i) => ({
            id: `node_${i}`,
            text: `Paragraph content line ${i % 20}`
        }));

        // 即使傳入較小的 batchSize=20, maxCharsPerBatch=1000，開啟 singleBatchMode 後仍應合併為 1 個大批次
        const chunks = chunkTranslationItems(items, 20, 1000, true);
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].length, 120);
    });

    it("deduplicateTranslationItems & expandDeduplicatedTranslations: 應能去重相同文字並完整還原所有節點 ID", () => {
        const rawItems = [
            { id: "n1", text: "Read More" },
            { id: "n2", text: "Financial Report" },
            { id: "n3", text: "Read More" },
            { id: "n4", text: "  Read More  " },
            { id: "n5", text: "Financial Report" }
        ];

        const { uniqueItems, idGroupMap } = deduplicateTranslationItems(rawItems);
        assert.equal(uniqueItems.length, 2);
        assert.deepEqual(idGroupMap["n1"], ["n1", "n3", "n4"]);
        assert.deepEqual(idGroupMap["n2"], ["n2", "n5"]);

        const expanded = expandDeduplicatedTranslations(
            {
                n1: "閱讀更多",
                n2: "財務報告"
            },
            idGroupMap
        );

        assert.equal(expanded["n1"], "閱讀更多");
        assert.equal(expanded["n3"], "閱讀更多");
        assert.equal(expanded["n4"], "閱讀更多");
        assert.equal(expanded["n2"], "財務報告");
        assert.equal(expanded["n5"], "財務報告");
    });

    it("computeCacheKey: 相同輸入產生相同雜湊，不同參數產生不同雜湊", () => {
        const key1 = computeCacheKey("Hello", "zh-TW", "natural", "gemini-3.8-flash", "low", []);
        const key2 = computeCacheKey("Hello", "zh-TW", "natural", "gemini-3.8-flash", "low", []);
        const keyDiffText = computeCacheKey("World", "zh-TW", "natural", "gemini-3.8-flash", "low", []);
        const keyDiffLang = computeCacheKey("Hello", "ja", "natural", "gemini-3.8-flash", "low", []);
        const keyDiffEffort = computeCacheKey("Hello", "zh-TW", "natural", "gemini-3.8-flash", "high", []);

        assert.equal(key1, key2);
        assert.notEqual(key1, keyDiffText);
        assert.notEqual(key1, keyDiffLang);
        assert.notEqual(key1, keyDiffEffort);
    });

    it("filterRelevantGlossary: 僅過濾出當前批次出現且啟用的術語", () => {
        const items = [{ id: "0", text: "Deploying our React app to Kubernetes." }];
        const glossary = [
            { id: "1", source: "React", target: "React 框架", enabled: true, caseSensitive: false },
            { id: "2", source: "Kubernetes", target: "K8s", enabled: true, caseSensitive: true },
            { id: "3", source: "Vue", target: "Vue 框架", enabled: true, caseSensitive: false },
            { id: "4", source: "Docker", target: "容器", enabled: false, caseSensitive: false }
        ];

        const relevant = filterRelevantGlossary(items, glossary);
        assert.equal(relevant.length, 2);
        assert.ok(relevant.some((r) => r.source === "React"));
        assert.ok(relevant.some((r) => r.source === "Kubernetes"));
        assert.ok(!relevant.some((r) => r.source === "Vue"));
        assert.ok(!relevant.some((r) => r.source === "Docker"));
    });
});

// ============================================================================
// 4. DOM 過濾與網域規則測試 (DOM Filter Tests)
// ============================================================================
describe("DOM Filter (domFilter.ts)", () => {
    describe("shouldSkipText: 跳過規則檢驗", () => {
        it("空字串與純標點符號應跳過", () => {
            assert.equal(shouldSkipText("", true), true);
            assert.equal(shouldSkipText("   ", true), true);
            assert.equal(shouldSkipText("-", true), true);
            assert.equal(shouldSkipText("...", true), true);
            assert.equal(shouldSkipText("///", true), true);
        });

        it("純數字、貨幣、百分比應跳過 (當 skipNumbersAndCodes 為 true)", () => {
            assert.equal(shouldSkipText("12345", true), true);
            assert.equal(shouldSkipText("$1,234.56", true), true);
            assert.equal(shouldSkipText("+5.2%", true), true);
            assert.equal(shouldSkipText("NT$ 500", true), true);
            assert.equal(shouldSkipText("€99.99", true), true);
        });

        it("日期、時間、網址與 Email 應跳過", () => {
            assert.equal(shouldSkipText("2026-10-20", true), true);
            assert.equal(shouldSkipText("14:30:00", true), true);
            assert.equal(shouldSkipText("https://antigravity.google.com", true), true);
            assert.equal(shouldSkipText("www.fugle.tw", true), true);
            assert.equal(shouldSkipText("developer@example.com", true), true);
            assert.equal(shouldSkipText("v24.14.1", true), true);
        });

        it("具有實質閱讀意義之自然語言文字不應跳過", () => {
            assert.equal(shouldSkipText("Hello world", true), false);
            assert.equal(shouldSkipText("台股今日開高走低，大盤震盪走弱", true), false);
            assert.equal(shouldSkipText("Artificial Intelligence is evolving rapidly.", true), false);
        });
    });

    describe("matchesDomainList: 網域名稱比對規則", () => {
        const patterns = ["fugle.tw", "*.github.com", "news.ycombinator.com"];

        it("精確匹配與子網域自動擴展匹配", () => {
            assert.equal(matchesDomainList("fugle.tw", patterns), true);
            assert.equal(matchesDomainList("www.fugle.tw", patterns), true);
            assert.equal(matchesDomainList("api.fugle.tw", patterns), true);
        });

        it("萬用字元前綴匹配", () => {
            assert.equal(matchesDomainList("github.com", patterns), true);
            assert.equal(matchesDomainList("gist.github.com", patterns), true);
            assert.equal(matchesDomainList("raw.github.com", patterns), true);
        });

        it("不匹配未列入名單之網域", () => {
            assert.equal(matchesDomainList("google.com", patterns), false);
            assert.equal(matchesDomainList("facebook.com", patterns), false);
        });
    });
});
