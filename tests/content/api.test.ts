/**
 * content script → background 請求（src/shared/runtime.ts、src/content/api.ts）
 * send() 的錯誤分類、逾時，以及 query() 的暫時性錯誤重試與 fetchDataset()。
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeChrome } from "../helpers/chrome";
import type { FakeChromeControl } from "../helpers/chrome";
import * as runtime from "../../src/shared/runtime";
import { ApiError, ExtensionContextError, QUICK_ATTEMPT_TIMEOUT_MS, RETRY_DELAY_MS, TransientMessageError, fetchDataset, isContextValid, query, send } from "../../src/content/api";
import { MESSAGE_TIMEOUT_MS } from "../../src/shared/constants";

let fake: FakeChromeControl;

/** 讓 microtask 與 fake sendMessage 內的非同步回呼跑完（setImmediate 不受 mock.timers 影響） */
const settle = async (rounds = 3): Promise<void> => {
    for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
};

/** 追蹤 promise 狀態，方便在推進假時鐘前後檢查 */
function track<T>(p: Promise<T>): { readonly state: "pending" | "fulfilled" | "rejected"; readonly value: T | undefined; readonly error: unknown; promise: Promise<T> } {
    const out = { state: "pending" as "pending" | "fulfilled" | "rejected", value: undefined as T | undefined, error: undefined as unknown, promise: p };
    p.then(
        (v) => {
            out.state = "fulfilled";
            out.value = v;
        },
        (e) => {
            out.state = "rejected";
            out.error = e;
        }
    );
    return out;
}

const META = { fetchedAt: 1_700_000_000_000, stale: false };
const PING = { type: "ping" } as const;
const SEARCH = { type: "search", query: "台積" } as const;

beforeEach(() => {
    fake = installFakeChrome();
});

afterEach(() => {
    fake.uninstall();
});

describe("錯誤類別", () => {
    test("各錯誤類別的 name、message 與繼承關係", () => {
        const ctx = new ExtensionContextError();
        assert.ok(ctx instanceof Error);
        assert.equal(ctx.name, "ExtensionContextError");
        assert.equal(ctx.message, "擴充功能已更新，請重新整理頁面");

        const transient = new TransientMessageError("連線中斷");
        assert.ok(transient instanceof Error);
        assert.equal(transient.name, "TransientMessageError");
        assert.equal(transient.message, "連線中斷");

        const api = new ApiError("來源錯誤", "http-500");
        assert.ok(api instanceof Error);
        assert.equal(api.name, "ApiError");
        assert.equal(api.message, "來源錯誤");
        assert.equal(api.code, "http-500");
        assert.equal(new ApiError("x").code, "unknown");
    });

    test("content/api 重新匯出的是 shared/runtime 的同一份實作", () => {
        assert.equal(ApiError, runtime.ApiError);
        assert.equal(TransientMessageError, runtime.TransientMessageError);
        assert.equal(ExtensionContextError, runtime.ExtensionContextError);
        assert.equal(send, runtime.send);
        assert.equal(isContextValid, runtime.isContextValid);
    });
});

describe("isContextValid", () => {
    test("chrome.runtime.id 存在時為 true，失效後為 false", () => {
        assert.equal(isContextValid(), true);
        fake.invalidate();
        assert.equal(isContextValid(), false);
    });

    test("沒有 chrome 全域、沒有 runtime 或存取時拋錯都視為失效", () => {
        const g = globalThis as { chrome?: unknown };
        const saved = g.chrome;
        try {
            delete g.chrome;
            assert.equal(isContextValid(), false);
            g.chrome = {};
            assert.equal(isContextValid(), false);
            g.chrome = {
                get runtime(): never {
                    throw new Error("Extension context invalidated.");
                },
            };
            assert.equal(isContextValid(), false);
        } finally {
            g.chrome = saved;
        }
    });
});

describe("send", () => {
    test("成功往返：送出原始請求並解析 data", async () => {
        const received: unknown[] = [];
        fake.setHandler((msg) => {
            received.push(msg);
            return { ok: true, data: { version: "2.1.0" } };
        });
        const res = await send(PING);
        assert.deepEqual(res, { version: "2.1.0" });
        assert.deepEqual(fake.sent, [PING]);
        assert.deepEqual(received, [PING]);
    });

    test("handler 非同步回應也能解析", async () => {
        fake.setHandler(async () => {
            await settle(1);
            return { ok: true, data: { cleared: true } };
        });
        assert.deepEqual(await send({ type: "clearCache" }), { cleared: true });
    });

    test("{ok:false,error,code} → ApiError，保留 code 與訊息", async () => {
        fake.setHandler(() => ({ ok: false, error: "伺服器錯誤 500", code: "http-500" }));
        await assert.rejects(send(SEARCH), (e: unknown) => {
            assert.ok(e instanceof ApiError);
            assert.equal(e.message, "伺服器錯誤 500");
            assert.equal(e.code, "http-500");
            return true;
        });
    });

    test("{ok:false} 沒有 code 時為 unknown", async () => {
        fake.setHandler(() => ({ ok: false, error: "壞掉了" }));
        await assert.rejects(send(SEARCH), (e: unknown) => e instanceof ApiError && e.code === "unknown" && e.message === "壞掉了");
    });

    test("handler 回傳 undefined → TransientMessageError「背景服務沒有回應」", async () => {
        fake.setHandler(() => undefined);
        await assert.rejects(send(PING), (e: unknown) => e instanceof TransientMessageError && e.message === "背景服務沒有回應");
    });

    test("lastError → TransientMessageError，訊息取自 lastError", async () => {
        fake.setHandler(() => ({ ok: true, data: { version: "x" } }));
        fake.failNextMessage("Could not establish connection. Receiving end does not exist.");
        await assert.rejects(send(PING), (e: unknown) => e instanceof TransientMessageError && e.message === "Could not establish connection. Receiving end does not exist.");
        // 只影響下一則
        assert.deepEqual(await send(PING), { version: "x" });
    });

    test("lastError 沒有訊息時使用預設訊息", async () => {
        fake.chrome.runtime.sendMessage = (_msg: unknown, cb: (res: unknown) => void) => {
            queueMicrotask(() => {
                fake.chrome.runtime.lastError = { message: "" };
                try {
                    cb(undefined);
                } finally {
                    fake.chrome.runtime.lastError = undefined;
                }
            });
        };
        await assert.rejects(send(PING), (e: unknown) => e instanceof TransientMessageError && e.message === "背景服務沒有回應");
    });

    test("回呼時 context 已失效 → ExtensionContextError（即使有 lastError）", async () => {
        fake.setHandler(() => {
            fake.invalidate();
            throw new Error("The message port closed before a response was received.");
        });
        await assert.rejects(send(PING), (e: unknown) => e instanceof ExtensionContextError);
    });

    test("context 失效時立即拒絕，不呼叫 sendMessage", async () => {
        let calls = 0;
        const original = fake.chrome.runtime.sendMessage;
        fake.chrome.runtime.sendMessage = (...args: unknown[]) => {
            calls++;
            return original(...args);
        };
        fake.invalidate();
        await assert.rejects(send(PING), (e: unknown) => e instanceof ExtensionContextError && e.message === "擴充功能已更新，請重新整理頁面");
        assert.equal(calls, 0);
        assert.equal(fake.sent.length, 0);
    });

    test("context 有效但 sendMessage 同步拋錯 → TransientMessageError", async () => {
        fake.chrome.runtime.sendMessage = () => {
            throw new Error("暫時無法傳送");
        };
        await assert.rejects(send(PING), (e: unknown) => e instanceof TransientMessageError && e.message === "暫時無法傳送");
    });

    test("sendMessage 同步拋出非 Error 值時轉為字串", async () => {
        fake.chrome.runtime.sendMessage = () => {
            throw "boom";
        };
        await assert.rejects(send(PING), (e: unknown) => e instanceof TransientMessageError && e.message === "boom");
    });

    test("sendMessage 同步拋錯且 context 已失效 → ExtensionContextError", async () => {
        fake.chrome.runtime.sendMessage = () => {
            fake.invalidate();
            throw new Error("Extension context invalidated.");
        };
        await assert.rejects(send(PING), (e: unknown) => e instanceof ExtensionContextError);
    });

    test("逾時 → TransientMessageError「背景服務回應逾時」，之後才到的回應被忽略", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let answer!: (v: unknown) => void;
        let handled = 0;
        fake.setHandler(() => {
            handled++;
            return new Promise((r) => (answer = r));
        });
        const p = track(send(PING, 50));
        await settle();
        assert.equal(handled, 1);
        t.mock.timers.tick(49);
        await settle();
        assert.equal(p.state, "pending");
        t.mock.timers.tick(1);
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof TransientMessageError);
        assert.equal((p.error as Error).message, "背景服務回應逾時");

        // 遲到的成功回應：不改變結果、不拋錯
        answer({ ok: true, data: { version: "late" } });
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof TransientMessageError);
        assert.equal(fake.sent.length, 1);
    });

    test("逾時後才到的 lastError 也被忽略", async () => {
        let answer!: (v: unknown) => void;
        fake.setHandler(() => new Promise((_, reject) => (answer = () => reject(new Error("port closed")))));
        await assert.rejects(send(PING, 10), (e: unknown) => e instanceof TransientMessageError && e.message === "背景服務回應逾時");
        answer(undefined);
        await settle();
    });

    test("預設逾時為 MESSAGE_TIMEOUT_MS", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => new Promise(() => undefined));
        const p = track(send(PING));
        await settle();
        t.mock.timers.tick(MESSAGE_TIMEOUT_MS - 1);
        await settle();
        assert.equal(p.state, "pending");
        t.mock.timers.tick(1);
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof TransientMessageError);
    });

    test("及時回應後逾時計時器被清除，不會再拒絕", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => ({ ok: true, data: { version: "1" } }));
        const p = track(send(PING, 100));
        await settle();
        assert.equal(p.state, "fulfilled");
        t.mock.timers.tick(1000);
        await settle();
        assert.equal(p.state, "fulfilled");
        assert.deepEqual(p.value, { version: "1" });
    });
});

describe("query", () => {
    test("RETRY_DELAY_MS 為正數", () => {
        assert.ok(RETRY_DELAY_MS > 0);
    });

    test("暫時性錯誤：等待 RETRY_DELAY_MS 後重試一次並成功（共送出 2 則）", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => ({ ok: true, data: { stocks: [] } }));
        fake.failNextMessage("Could not establish connection. Receiving end does not exist.");
        const p = track(query(SEARCH));
        await settle();
        assert.equal(fake.sent.length, 1);
        assert.equal(p.state, "pending");

        // 重試前會等待 RETRY_DELAY_MS
        t.mock.timers.tick(RETRY_DELAY_MS - 1);
        await settle();
        assert.equal(fake.sent.length, 1);

        t.mock.timers.tick(1);
        await settle();
        assert.equal(p.state, "fulfilled");
        assert.deepEqual(p.value, { stocks: [] });
        assert.equal(fake.sent.length, 2);
        assert.deepEqual(fake.sent, [SEARCH, SEARCH]);
    });

    test("handler 沒有回應（undefined）也會重試", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let n = 0;
        fake.setHandler(() => (n++ === 0 ? undefined : { ok: true, data: [] }));
        const p = track(query({ type: "category", categoryType: "概念", name: "AI" }));
        await settle();
        t.mock.timers.tick(RETRY_DELAY_MS);
        await settle();
        assert.equal(p.state, "fulfilled");
        assert.deepEqual(p.value, []);
        assert.equal(fake.sent.length, 2);
    });

    test("預設最多嘗試 3 次：連續 3 次暫時性錯誤後拒絕最後一次的錯誤", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let n = 0;
        fake.setHandler(() => {
            n++;
            if (n <= 3) throw new Error(`第 ${n} 次失敗`);
            return { ok: true, data: { stocks: [] } };
        });
        const p = track(query(SEARCH));
        await settle();
        t.mock.timers.tick(RETRY_DELAY_MS);
        await settle();
        assert.equal(p.state, "pending", "第 2 次失敗後仍會再試");
        t.mock.timers.tick(RETRY_DELAY_MS);
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof TransientMessageError);
        assert.equal((p.error as Error).message, "第 3 次失敗");
        t.mock.timers.tick(RETRY_DELAY_MS * 5);
        await settle();
        assert.equal(fake.sent.length, 3);
    });

    test("訊息遺失（背景不回應）：QUICK_ATTEMPT_TIMEOUT_MS 後重送即取得結果", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let n = 0;
        // 第一則訊息遺失：永遠不回應；重送的訊息正常回應
        fake.setHandler(() => (n++ === 0 ? new Promise(() => undefined) : { ok: true, data: { stocks: [] } }));
        const p = track(query(SEARCH));
        await settle();
        t.mock.timers.tick(QUICK_ATTEMPT_TIMEOUT_MS - 1);
        await settle();
        assert.equal(p.state, "pending");
        assert.equal(fake.sent.length, 1);
        t.mock.timers.tick(1); // 第一次嘗試逾時
        await settle();
        t.mock.timers.tick(RETRY_DELAY_MS); // 等待後重送
        await settle();
        assert.equal(p.state, "fulfilled");
        assert.deepEqual(p.value, { stocks: [] });
        assert.equal(fake.sent.length, 2);
    });

    test("背景一直不回應：逾時依序為 QUICK、QUICK、MESSAGE_TIMEOUT_MS，之後才拒絕", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => new Promise(() => undefined));
        const p = track(query(SEARCH));
        await settle();
        // 逾時與重試前的等待分開推進：等待的計時器在逾時處理完才排定
        const attempt = async (timeoutMs: number): Promise<void> => {
            t.mock.timers.tick(timeoutMs);
            await settle();
            t.mock.timers.tick(RETRY_DELAY_MS);
            await settle();
        };
        await attempt(QUICK_ATTEMPT_TIMEOUT_MS);
        assert.equal(fake.sent.length, 2);
        await attempt(QUICK_ATTEMPT_TIMEOUT_MS);
        assert.equal(fake.sent.length, 3);
        // 最後一次給足時間（來源較慢時 background 最久約 20 秒才回應）
        assert.ok(MESSAGE_TIMEOUT_MS > QUICK_ATTEMPT_TIMEOUT_MS);
        t.mock.timers.tick(MESSAGE_TIMEOUT_MS - 1);
        await settle();
        assert.equal(p.state, "pending");
        t.mock.timers.tick(1);
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof TransientMessageError);
        assert.equal((p.error as Error).message, "背景服務回應逾時");
        assert.equal(fake.sent.length, 3);
    });

    test("retries = 0：唯一一次嘗試使用完整的 MESSAGE_TIMEOUT_MS", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => new Promise(() => undefined));
        const p = track(query(SEARCH, 0));
        await settle();
        t.mock.timers.tick(QUICK_ATTEMPT_TIMEOUT_MS);
        await settle();
        assert.equal(p.state, "pending");
        t.mock.timers.tick(MESSAGE_TIMEOUT_MS - QUICK_ATTEMPT_TIMEOUT_MS);
        await settle();
        assert.equal(p.state, "rejected");
        assert.equal(fake.sent.length, 1);
    });

    test("retries 參數控制重試次數", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let n = 0;
        fake.setHandler(() => (++n <= 2 ? undefined : { ok: true, data: { stocks: [] } }));
        const p = track(query(SEARCH, 2));
        await settle();
        t.mock.timers.tick(RETRY_DELAY_MS);
        await settle();
        assert.equal(p.state, "pending");
        t.mock.timers.tick(RETRY_DELAY_MS);
        await settle();
        assert.equal(p.state, "fulfilled");
        assert.equal(fake.sent.length, 3);
    });

    test("retries = 0 時不重試", async () => {
        fake.setHandler(() => undefined);
        await assert.rejects(query(SEARCH, 0), (e: unknown) => e instanceof TransientMessageError);
        assert.equal(fake.sent.length, 1);
    });

    test("ApiError 不重試", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => ({ ok: false, error: "查無資料", code: "http-404" }));
        const p = track(query(SEARCH));
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof ApiError);
        assert.equal((p.error as ApiError).code, "http-404");
        t.mock.timers.tick(RETRY_DELAY_MS * 3);
        await settle();
        assert.equal(fake.sent.length, 1);
    });

    test("ExtensionContextError 不重試", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.invalidate();
        const p = track(query(SEARCH));
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof ExtensionContextError);
        t.mock.timers.tick(RETRY_DELAY_MS * 3);
        await settle();
        assert.equal(fake.sent.length, 0);
    });

    test("暫時性錯誤但 context 已失效時不重試", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        // 背景不回應 → 逾時（TransientMessageError），期間擴充功能被重新載入
        fake.setHandler(() => new Promise(() => undefined));
        const p = track(query(SEARCH));
        await settle();
        fake.invalidate();
        t.mock.timers.tick(MESSAGE_TIMEOUT_MS);
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof TransientMessageError);
        t.mock.timers.tick(RETRY_DELAY_MS * 3);
        await settle();
        assert.equal(fake.sent.length, 1);
    });

    test("重試期間 context 失效：第二次嘗試以 ExtensionContextError 結束", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => ({ ok: true, data: { stocks: [] } }));
        fake.failNextMessage("連線中斷");
        const p = track(query(SEARCH));
        await settle();
        assert.equal(p.state, "pending");
        fake.invalidate();
        t.mock.timers.tick(RETRY_DELAY_MS);
        await settle();
        assert.equal(p.state, "rejected");
        assert.ok(p.error instanceof ExtensionContextError);
        assert.equal(fake.sent.length, 1);
    });
});

describe("fetchDataset", () => {
    test("送出 {type:'dataset', name, stockId, force} 並回傳 {data, meta}", async () => {
        const data = { name: "台積電", market: "上市" };
        fake.setHandler((msg) => ({ ok: true, data: { data: { ...data, echo: msg.name }, meta: META } }));
        const res = await fetchDataset("basic", "2330", true);
        assert.deepEqual(fake.sent, [{ type: "dataset", name: "basic", stockId: "2330", force: true }]);
        assert.deepEqual(res, { data: { ...data, echo: "basic" }, meta: META });
    });

    test("force 預設為 false", async () => {
        fake.setHandler(() => ({ ok: true, data: { data: ["半導體"], meta: META } }));
        const res = await fetchDataset("industry", "2303");
        assert.deepEqual(fake.sent, [{ type: "dataset", name: "industry", stockId: "2303", force: false }]);
        assert.deepEqual(res.data, ["半導體"]);
        assert.deepEqual(res.meta, META);
    });

    test("ApiError 直接傳給呼叫端", async () => {
        fake.setHandler(() => ({ ok: false, error: "資料格式錯誤", code: "payload" }));
        await assert.rejects(fetchDataset("etf", "0050"), (e: unknown) => e instanceof ApiError && e.code === "payload" && e.message === "資料格式錯誤");
        assert.equal(fake.sent.length, 1);
    });

    test("暫時性錯誤時同樣自動重試", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        fake.setHandler(() => ({ ok: true, data: { data: [], meta: { fetchedAt: 1, stale: true } } }));
        fake.failNextMessage("連線中斷");
        const p = track(fetchDataset("ratings", "2330"));
        await settle();
        t.mock.timers.tick(RETRY_DELAY_MS);
        await settle();
        assert.equal(p.state, "fulfilled");
        assert.deepEqual(p.value, { data: [], meta: { fetchedAt: 1, stale: true } });
        assert.equal(fake.sent.length, 2);
    });
});
