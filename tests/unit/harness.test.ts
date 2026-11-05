/**
 * 測試基礎設施自我檢查：esbuild 打包、jsdom、chrome 替身、fixture 載入。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers/fixtures";
import { installFakeChrome } from "../helpers/chrome";
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
