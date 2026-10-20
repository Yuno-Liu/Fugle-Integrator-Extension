#!/usr/bin/env node
/**
 * ============================================================================
 * 🌉 Antigravity CLI Local Bridge Server (本地橋接伺服器)
 * ============================================================================
 *
 * 本伺服器作為 Chrome 擴充套件與本機安裝之 Antigravity CLI (agy) 之間的安全橋樑。
 * 提供 Chrome Extension 透過標準 HTTP/JSON 協議調度本機強大的 LLM 進行網頁全站翻譯。
 *
 * 📌 特性亮點：
 * - 零第三方依賴：僅使用 Node.js 核心模組 (node:http, node:child_process, node:url)
 * - 支援全功能 CORS Preflight 與跨域請求
 * - 預設極速配置：gemini-3.8-flash 模型，推理深度 low
 * - 自動偵測 Windows/macOS/Linux 平台下之 agy 執行檔路徑
 * - 逾時熔斷保護與強健容錯解析機制
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";

// ============================================================================
// ⚙️ 預設常態配置 (Default Configurations)
// ============================================================================
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18765;
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_EFFORT = "low";
const DEFAULT_TIMEOUT_SEC = 90;
// Windows CreateProcess 命令列長度與模型單次最大輸出 Token 安全字元上限
const MAX_SAFE_CHARS_PER_CLI_CALL = 25000;
const MAX_SAFE_ITEMS_PER_CLI_CALL = 1000;

// 解析 CLI 命令列參數 --port 或環境變數 PORT
function getListeningPort() {
    const portArgIndex = process.argv.indexOf("--port");
    if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
        const parsed = parseInt(process.argv[portArgIndex + 1], 10);
        if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
            return parsed;
        }
    }
    if (process.env.PORT) {
        const parsed = parseInt(process.env.PORT, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
            return parsed;
        }
    }
    return DEFAULT_PORT;
}

const PORT = getListeningPort();
const HOST = process.env.HOST || DEFAULT_HOST;

// ============================================================================
// 🎨 風格預設指示詞 (Style System Instructions)
// ============================================================================
const STYLE_INSTRUCTIONS = {
    natural: "請以符合目標語言母語人士的日常閱讀習慣進行翻譯，行文流暢自然、語調得體，避免生硬死板的逐字直譯。",
    technical: "你是一位資深軟體工程專家。翻譯請使用精確專業的電腦科學與技術工程術語；對於業界習慣保留英文的縮寫或術語（如 API, React, async/await 等），請保留原文或適當加註。",
    financial: "你是一位專業財經分析師與商務口譯。翻譯時請採用標準證券、金融財務與商業經營術語（例如 EPS 翻譯為每股盈餘、YoY 翻譯為年增率），語調保持客觀嚴謹且精準。",
    academic: "請以正式學術期刊規範的嚴謹典雅風格進行翻譯，保持邏輯結構分明，術語對照嚴格一致，符合學術研究專著之論述口吻。",
    concise: "請以精簡洗鍊的文筆進行翻譯，在完全不失原意的前提下去除冗贅語詞，確保文字短小精幹，利於快速掃讀瀏覽。",
    custom: "請遵循使用者提供的自訂規則與特殊語氣要求進行翻譯。"
};

const AVAILABLE_MODELS_LIST = [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (推薦・極速翻譯)", badge: "預設" },
    { id: "gemini-4-argon", label: "Gemini 4 Argon (深度語意與長文)", badge: "高階" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (自然文學語感)", badge: "進階" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 (最高精準度)", badge: "旗艦" },
    { id: "gpt-oss-120b", label: "GPT-OSS 120B (開放模型)", badge: "開源" }
];

const AVAILABLE_EFFORTS_LIST = ["low", "medium", "high", "xhigh", "max"];

// ============================================================================
// 🛠️ CLI 執行器與輔助工具 (CLI Execution & Helpers)
// ============================================================================

/**
 * 尋找最佳可執行檔指令（自動相容 Windows 的 agy.exe 與 agy）
 */
function resolveCliCommand(userCliPath) {
    if (userCliPath && userCliPath.trim().length > 0) {
        return userCliPath.trim();
    }
    return process.platform === "win32" ? "agy.exe" : "agy";
}

/**
 * 執行子進程並收集 stdout/stderr
 */
function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const timeoutMs = (options.timeoutSec || DEFAULT_TIMEOUT_SEC) * 1000;
        let stdout = "";
        let stderr = "";
        let isTimedOut = false;

        // 若為 .cmd 或 .bat 才需使用 shell，.exe 檔案直接執行以避免 DEP0190 警告與命令列長度截斷
        const needsShell =
            process.platform === "win32" &&
            (command.toLowerCase().endsWith(".cmd") || command.toLowerCase().endsWith(".bat"));

        const child = spawn(command, args, {
            shell: needsShell,
            windowsHide: true,
            env: process.env
        });

        const timer = setTimeout(() => {
            isTimedOut = true;
            try {
                child.kill("SIGKILL");
            } catch {
                // ignore
            }
            reject(new Error(`命令執行逾時 (${options.timeoutSec}s): ${command}`));
        }, timeoutMs);

        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });

        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            if (!isTimedOut) {
                reject(err);
            }
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            if (isTimedOut) return;
            if (code !== 0) {
                const errMessage = stderr.trim() || stdout.trim() || `進程退出碼: ${code}`;
                reject(new Error(errMessage));
            } else {
                resolve({ stdout, stderr, code });
            }
        });
    });
}

/**
 * 組裝批次翻譯 Prompt
 */
function buildBatchPrompt({ items, sourceLang, targetLang, style, customPrompt, glossary }) {
    const sourceDesc = sourceLang === "auto" ? "原文語言（自動偵測）" : `來源語言：${sourceLang}`;
    const targetDesc = `目標語言：${targetLang}`;
    const styleInstruction = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.natural;

    let glossarySection = "";
    const activeGlossary = (glossary || []).filter((g) => g.enabled && g.source?.trim());
    if (activeGlossary.length > 0) {
        const gList = activeGlossary.map((g) => `  - "${g.source}" => "${g.target}"`).join("\n");
        glossarySection = `\n【專有名詞強制術語表】\n${gList}\n`;
    }

    let customSection = "";
    if (customPrompt?.trim()) {
        customSection = `\n【使用者特殊指示】\n${customPrompt.trim()}\n`;
    }

    const payloadObj = {};
    for (const item of items) {
        payloadObj[item.id] = item.text;
    }

    return `你是一位世界頂級的專業全站網頁翻譯引擎。
請將下方 JSON 物件中的所有 Value 從 ${sourceDesc} 翻譯為 ${targetDesc}。

【翻譯風格與核心原則】
1. 風格指引：${styleInstruction}
2. 保持網頁排版格式：保留 HTML 實體符號、空格結構與原始標點習慣，切勿刪除任何格式標籤。
3. 程式碼與識別碼保護：變數名稱、程式碼片段、URL 與品牌專有名詞請保持原樣或專業慣例。${glossarySection}${customSection}
【輸出格式規範 (至關重要)】
- 請僅輸出一個合法的 JSON 物件。
- JSON 的 Key 必須嚴格保持與輸入相同的 ID（如 "0", "1", "2"...）。
- JSON 的 Value 為翻譯完成後的譯文字串。
- 絕對不要在 JSON 前後輸出任何開場白、感謝詞、結語或額外解釋說明！

【待翻譯 JSON 輸入】：
${JSON.stringify(payloadObj)}`;
}

/**
 * 將超大項目清單切分為符合 Windows 命令列與模型輸出上限的安全子批次
 */
function splitOversizedItems(items) {
    const chunks = [];
    let current = [];
    let currentChars = 0;

    for (const item of items) {
        const len = (item.text || "").length;
        if (
            current.length > 0 &&
            (current.length >= MAX_SAFE_ITEMS_PER_CLI_CALL ||
                currentChars + len > MAX_SAFE_CHARS_PER_CLI_CALL)
        ) {
            chunks.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(item);
        currentChars += len;
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks;
}

/**
 * 容錯解析 CLI 輸出之 JSON 結果
 */
function parseCliOutput(rawOutput, expectedItems) {
    const result = {};
    if (!rawOutput || typeof rawOutput !== "string") return result;

    let candidate = rawOutput.trim();
    // 策略 1: 提取 Markdown code block
    const cbMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (cbMatch && cbMatch[1]) {
        candidate = cbMatch[1].trim();
    }

    // 策略 2: 標準 JSON.parse
    try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === "object" && parsed !== null) {
            if (Array.isArray(parsed)) {
                parsed.forEach((val, idx) => {
                    if (expectedItems[idx] && typeof val === "string") {
                        result[expectedItems[idx].id] = val;
                    }
                });
                if (Object.keys(result).length > 0) return result;
            } else {
                for (const [k, v] of Object.entries(parsed)) {
                    result[String(k)] = typeof v === "string" ? v : String(v);
                }
                if (Object.keys(result).length > 0) return result;
            }
        }
    } catch {
        // 進入 fallback
    }

    // 策略 3: 提取最外層 { ... }
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
            const sub = candidate.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(sub);
            if (typeof parsed === "object" && parsed !== null) {
                for (const [k, v] of Object.entries(parsed)) {
                    result[String(k)] = typeof v === "string" ? v : String(v);
                }
                if (Object.keys(result).length > 0) return result;
            }
        } catch {
            // fallback
        }
    }

    // 策略 4: 正則表達式抽取鍵值
    const kvRegex = /(?:["']([\w-]+)["']|(?:\b(\d+)\b))\s*:\s*["']((?:\\.|[^"'\\])*)["']/g;
    let m;
    while ((m = kvRegex.exec(candidate)) !== null) {
        const k = m[1] || m[2];
        let v = m[3];
        try {
            v = JSON.parse(`"${v}"`);
        } catch {
            // keep raw
        }
        result[k] = v;
    }
    if (Object.keys(result).length > 0) return result;

    // 策略 5: 逐行匹配 [0] 譯文
    const lines = candidate.split(/\r?\n/);
    const lineRegex = /^\s*\[?(\w+)\]?[\s.:\-]+(.*)$/;
    for (const l of lines) {
        const lm = l.match(lineRegex);
        if (lm && expectedItems.some((it) => it.id === lm[1])) {
            result[lm[1]] = lm[2].trim();
        }
    }
    if (Object.keys(result).length > 0) return result;

    // 策略 6: 單一項 fallback
    if (expectedItems.length === 1 && candidate.length > 0) {
        result[expectedItems[0].id] = candidate;
    }

    return result;
}

// ============================================================================
// 🌐 HTTP 伺服器與路由處理 (HTTP Server & Routing)
// ============================================================================

/**
 * 統一發送 JSON 回應
 */
function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With"
    });
    res.end(body);
}

/**
 * 讀取請求 Body
 */
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 20 * 1024 * 1024) {
                // 限制 20MB
                req.destroy();
                reject(new Error("Request body too large"));
            }
        });
        req.on("end", () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}

const server = http.createServer(async (req, res) => {
    // 處理 CORS Preflight (OPTIONS)
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
            "Access-Control-Max-Age": "86400"
        });
        return res.end();
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const pathname = reqUrl.pathname;

    // ------------------------------------------------------------------------
    // 端點 1: GET /health (伺服器健康狀態與 CLI 檢查)
    // ------------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/health") {
        const cliPath = resolveCliCommand(reqUrl.searchParams.get("cliPath"));
        try {
            const { stdout } = await runCommand(cliPath, ["--version"], { timeoutSec: 5 });
            const version = stdout.trim();
            return sendJson(res, 200, {
                ok: true,
                status: "ready",
                cliPath,
                defaultModel: DEFAULT_MODEL,
                defaultEffort: DEFAULT_EFFORT,
                availableModels: AVAILABLE_MODELS_LIST.map((m) => m.id),
                version
            });
        } catch (err) {
            return sendJson(res, 200, {
                ok: false,
                status: "cli_unavailable",
                cliPath,
                defaultModel: DEFAULT_MODEL,
                defaultEffort: DEFAULT_EFFORT,
                availableModels: AVAILABLE_MODELS_LIST.map((m) => m.id),
                error: `無法執行 Antigravity CLI (${cliPath}): ${err.message}`
            });
        }
    }

    // ------------------------------------------------------------------------
    // 端點 2: GET /models (可用模型與推理深度清單)
    // ------------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/models") {
        return sendJson(res, 200, {
            models: AVAILABLE_MODELS_LIST,
            efforts: AVAILABLE_EFFORTS_LIST,
            defaultModel: DEFAULT_MODEL,
            defaultEffort: DEFAULT_EFFORT
        });
    }

    // ------------------------------------------------------------------------
    // 端點 3: POST /translate (批次或單句翻譯)
    // ------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/translate") {
        const startTime = Date.now();
        let payload;
        try {
            payload = await readRequestBody(req);
        } catch (err) {
            return sendJson(res, 400, {
                success: false,
                error: `請求解析失敗: ${err.message}`,
                translations: {},
                modelUsed: "",
                effortUsed: DEFAULT_EFFORT,
                durationMs: 0
            });
        }

        // 整理待翻譯 items
        let items = payload.items || [];
        if (payload.text && items.length === 0) {
            items = [{ id: "0", text: String(payload.text) }];
        }

        if (items.length === 0) {
            return sendJson(res, 200, {
                success: true,
                translations: {},
                modelUsed: payload.model || DEFAULT_MODEL,
                effortUsed: payload.effort || DEFAULT_EFFORT,
                durationMs: 0
            });
        }

        const model = payload.model || DEFAULT_MODEL;
        const effort = payload.effort || DEFAULT_EFFORT;
        const sourceLang = payload.sourceLang || "auto";
        const targetLang = payload.targetLang || "zh-TW";
        const style = payload.style || "natural";
        const customPrompt = payload.customPrompt || "";
        const glossary = payload.glossary || [];
        const timeoutSec = Math.max(5, payload.timeoutSec || DEFAULT_TIMEOUT_SEC);
        const cliPath = resolveCliCommand(payload.cliPath);
        const extraFlags = payload.extraCliFlags?.trim()
            ? payload.extraCliFlags.trim().split(/\s+/)
            : [];

        // 1. 對請求內所有 items 進行原文去重與短索引 ("0", "1"...) 壓縮，最大化單次可塞入的 Token 容量
        const uniqueItems = [];
        const textToShortId = new Map();
        const shortIdToOrigIds = new Map();

        for (const item of items) {
            const normText = String(item.text || "").trim();
            const origId = String(item.id);
            if (!normText) continue;

            const existingShortId = textToShortId.get(normText);
            if (existingShortId !== undefined) {
                shortIdToOrigIds.get(existingShortId).push(origId);
            } else {
                const shortId = String(uniqueItems.length);
                textToShortId.set(normText, shortId);
                shortIdToOrigIds.set(shortId, [origId]);
                uniqueItems.push({ id: shortId, text: normText });
            }
        }

        // 2. 檢查是否超出單次命令列/輸出安全上限；絕大多數網頁 (<=25,000 字元) 直接 1 次 CLI 呼叫完成
        const subBatches = splitOversizedItems(uniqueItems);

        try {
            const batchResults = await Promise.all(
                subBatches.map(async (subItems) => {
                    const prompt = buildBatchPrompt({
                        items: subItems,
                        sourceLang,
                        targetLang,
                        style,
                        customPrompt,
                        glossary
                    });

                    const cliArgs = [
                        "--model",
                        model,
                        "--effort",
                        effort,
                        "--disable-slash-commands",
                        "-p",
                        prompt,
                        ...extraFlags
                    ];

                    const { stdout } = await runCommand(cliPath, cliArgs, { timeoutSec });
                    return parseCliOutput(stdout, subItems);
                })
            );

            // 3. 合併並展開回所有原始節點 ID
            const translations = {};
            for (const subParsed of batchResults) {
                for (const [shortId, translatedText] of Object.entries(subParsed)) {
                    const origIds = shortIdToOrigIds.get(String(shortId));
                    if (origIds) {
                        for (const oid of origIds) {
                            translations[oid] = translatedText;
                        }
                    } else {
                        translations[shortId] = translatedText;
                    }
                }
            }

            const durationMs = Date.now() - startTime;

            return sendJson(res, 200, {
                success: true,
                translations,
                modelUsed: model,
                effortUsed: effort,
                durationMs
            });
        } catch (err) {
            const durationMs = Date.now() - startTime;
            return sendJson(res, 500, {
                success: false,
                error: `CLI 執行失敗: ${err.message}`,
                translations: {},
                modelUsed: model,
                effortUsed: effort,
                durationMs
            });
        }
    }

    // 404 Not Found
    return sendJson(res, 404, {
        error: `Not Found: ${req.method} ${pathname}`
    });
});

// ============================================================================
// 🚀 啟動伺服器並顯示啟動橫幅 (Startup Banner)
// ============================================================================
server.listen(PORT, HOST, () => {
    const banner = `
========================================================================
  🚀 Antigravity CLI Local Bridge Server (本地翻譯橋接伺服器)
========================================================================
  * 監聽網址:      http://${HOST}:${PORT}
  * 健康度檢查:    http://${HOST}:${PORT}/health
  * 模型清單:      http://${HOST}:${PORT}/models
  * 預設推薦模型:  ${DEFAULT_MODEL}
  * 預設推理深度:  ${DEFAULT_EFFORT} (極速低延遲)
  * Chrome 擴充:   已就緒，可隨時接收翻譯請求 (CORS 全開放)
========================================================================
  提示: 按 Ctrl+C 可隨時終止伺服器。
`;
    console.log(banner);
});

// 捕捉未處理例外避免崩潰
process.on("uncaughtException", (err) => {
    console.error("[Bridge Server Error] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("[Bridge Server Error] Unhandled Rejection:", reason);
});
