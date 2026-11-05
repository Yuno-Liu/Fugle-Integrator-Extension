/**
 * 測試基礎設施自我檢查：esbuild 打包、jsdom、chrome 替身、fixture 載入。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers/fixtures";
import { installFakeChrome } from "../helpers/chrome";
import { createFetch } from "../helpers/fakes";
import { setupFuglePage } from "../helpers/dom";
import { readStockContext } from "../../src/content/page";
import { esunRows } from "../../src/core/esun";

test("fixtures 可載入且為真實 API 結構", () => {
    const rows = esunRows(fixture("basic-2330.json"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.V17, "台積電");
});

test("jsdom 可載入擷取自富果的頁面並讀出個股", () => {
    const env = setupFuglePage();
    try {
        assert.deepEqual(readStockContext(), { stockId: "2330", name: "台積電", market: "上市" });
    } finally {
        env.cleanup();
    }
});

test("chrome 替身：storage 與 sendMessage 往返", async () => {
    const fake = installFakeChrome({ handler: (msg) => ({ ok: true, data: { echo: msg.type } }) });
    try {
        await chrome.storage.local.set({ a: 1 });
        assert.deepEqual(await chrome.storage.local.get("a"), { a: 1 });
        const res = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "ping" }, resolve));
        assert.deepEqual(res, { ok: true, data: { echo: "ping" } });
    } finally {
        fake.uninstall();
    }
});

test("chrome 替身 dispatch：與 Chrome 相同，任一 listener 回傳 true 就等待其非同步回應", async () => {
    const fake = installFakeChrome();
    try {
        chrome.runtime.onMessage.addListener(() => undefined); // 不處理這則訊息、也不保留通道
        chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
            setTimeout(() => sendResponse("async"), 5);
            return true;
        });
        assert.equal(await fake.dispatch({ type: "x" }), "async");
    } finally {
        fake.uninstall();
    }
});

test("chrome 替身 dispatch：沒有 listener 保留通道 → undefined；多個同步回應以第一個為準", async () => {
    const fake = installFakeChrome();
    try {
        chrome.runtime.onMessage.addListener(() => undefined);
        assert.equal(await fake.dispatch({ type: "x" }), undefined, "通道關閉，送出端收到 undefined");
        chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
            sendResponse("first");
            return false;
        });
        chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
            sendResponse("second");
            return true;
        });
        assert.equal(await fake.dispatch({ type: "y" }), "first");
    } finally {
        fake.uninstall();
    }
});

test("fetch 替身：延遲期間中止 → AbortError；signal 已中止 → 立即拒絕；正常完成後移除 abort 監聽", async (t) => {
    const { fetch } = createFetch([["/slow", { body: { ok: 1 }, delayMs: 30 }]]);

    const during = new AbortController();
    const pending = fetch("https://x.test/slow", { signal: during.signal });
    during.abort();
    await assert.rejects(pending, { name: "AbortError" });

    // 修正前：監聽器在 abort 事件之後才註冊、永遠不會觸發，延遲結束後反而正常回應
    const before = new AbortController();
    before.abort();
    await assert.rejects(fetch("https://x.test/slow", { signal: before.signal }), { name: "AbortError" });

    const normal = new AbortController();
    // t.mock 在測試結束時自動還原（斷言失敗也會）
    const removed = t.mock.method(normal.signal, "removeEventListener");
    const res = await fetch("https://x.test/slow", { signal: normal.signal });
    assert.equal(res.status, 200);
    assert.equal(removed.mock.callCount(), 1, "完成後移除 abort 監聽");
});
