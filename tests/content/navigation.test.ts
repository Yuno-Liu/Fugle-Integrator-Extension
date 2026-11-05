/**
 * 站內導覽備援（src/content/navigation.ts）：
 * 合成的 popstate 偶爾會被富果的路由器忽略（畫面停在原個股，網址稍後還會被改回原個股），
 * 畫面一直沒有切換到目標個股時，改用一般頁面載入：
 * - 網址被改回原個股（路由器沒有處理）：NAV_FALLBACK_MS 後
 * - 網址仍是目標（可能仍在載入）：NAV_FALLBACK_SLOW_MS 後
 *
 * 計時以 mock.timers 控制（只模擬 setInterval；jsdom 的歷史紀錄切換仍使用真實計時器）。
 * 畫面上的代碼以擷取自富果的真實頁首（2330）為基礎。
 */
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { flush, setupFuglePage, setStockOnPage } from "../helpers/dom";
import type { DomEnv } from "../helpers/dom";
import { FUGLE } from "../../src/shared/constants";
import { NAV_FALLBACK_MS, NAV_FALLBACK_SLOW_MS, NAV_POLL_MS, cancelNavigationFallback, navigateToStock } from "../../src/content/navigation";

let env: DomEnv;
let assigned: string[];
let pops: number;
const assign = (url: string): void => {
    assigned.push(url);
};
/** 模擬富果的路由器沒有處理導覽：以 replaceState 把網址寫回原個股 */
const revert = (): void => env.window.history.replaceState({}, "", "/ai/2330?p=2379721678");

beforeEach(() => {
    mock.timers.enable({ apis: ["setInterval"] });
    env = setupFuglePage(); // 網址 /ai/2330，畫面顯示 2330
    assigned = [];
    pops = 0;
    env.window.addEventListener("popstate", () => pops++);
});

afterEach(() => {
    cancelNavigationFallback();
    mock.timers.reset();
    env.cleanup();
});

test("時限設定：網址仍是目標時等待較久", () => {
    assert.ok(NAV_FALLBACK_SLOW_MS > NAV_FALLBACK_MS);
    assert.equal(NAV_FALLBACK_MS % NAV_POLL_MS, 0);
    assert.equal(NAV_FALLBACK_SLOW_MS % NAV_POLL_MS, 0);
});

describe("navigateToStock：SPA 導覽成功", () => {
    test("時限內畫面切換到目標個股 → 不重新載入", () => {
        assert.equal(navigateToStock("2454", env.window, { assign }), true);
        assert.equal(env.window.location.pathname, "/ai/2454");
        assert.equal(pops, 1);
        mock.timers.tick(800);
        setStockOnPage(env.document, "2454", "聯發科");
        mock.timers.tick(NAV_FALLBACK_SLOW_MS * 2);
        assert.deepEqual(assigned, []);
    });

    test("轉場較慢（網址停在目標，5 秒後畫面才切換）→ 不重新載入", () => {
        navigateToStock("2454", env.window, { assign });
        env.document.querySelector(FUGLE.symbol)?.remove(); // 載入中
        mock.timers.tick(5000);
        assert.deepEqual(assigned, [], "超過 NAV_FALLBACK_MS 但網址仍是目標，繼續等待");
        const header = env.document.querySelector(".card-group-header__info") ?? env.document.body;
        const symbol = env.document.createElement("span");
        symbol.className = "card-group-header__info__symbol";
        symbol.textContent = "2454";
        header.appendChild(symbol);
        mock.timers.tick(NAV_FALLBACK_SLOW_MS * 2);
        assert.deepEqual(assigned, []);
    });

    test("切換成功後使用者立刻按上一頁（畫面回到原個股）→ 不會被拉回目標個股", () => {
        navigateToStock("2454", env.window, { assign });
        mock.timers.tick(600);
        setStockOnPage(env.document, "2454", "聯發科");
        mock.timers.tick(NAV_POLL_MS); // 下一次檢查看到目標個股
        env.window.history.replaceState({}, "", "/ai/2330");
        setStockOnPage(env.document, "2330", "台積電");
        mock.timers.tick(NAV_FALLBACK_SLOW_MS * 2);
        assert.deepEqual(assigned, []);
    });

    test("已在該個股頁（網址與畫面一致）→ 不觸發導覽、不排定備援", () => {
        assert.equal(navigateToStock("2330", env.window, { assign }), true);
        assert.equal(pops, 0);
        mock.timers.tick(NAV_FALLBACK_SLOW_MS * 2);
        assert.deepEqual(assigned, []);
    });

    test("無效代碼 → 回傳 false，不導覽也不排定備援", () => {
        assert.equal(navigateToStock("../admin", env.window, { assign }), false);
        assert.equal(env.window.location.pathname, "/ai/2330");
        mock.timers.tick(NAV_FALLBACK_SLOW_MS);
        assert.deepEqual(assigned, []);
        assert.equal(pops, 0);
    });
});

describe("navigateToStock：SPA 導覽沒有生效時改用一般頁面載入", () => {
    test("路由器忽略導覽、富果把網址改回原個股（實測行為）→ NAV_FALLBACK_MS 後載入目標個股", () => {
        navigateToStock("2454", env.window, { assign });
        mock.timers.tick(200);
        revert();
        mock.timers.tick(NAV_FALLBACK_MS - 200 - 1);
        assert.deepEqual(assigned, [], "時限前不動作");
        mock.timers.tick(1);
        assert.deepEqual(assigned, ["/ai/2454"]);
        mock.timers.tick(NAV_FALLBACK_SLOW_MS * 3);
        assert.deepEqual(assigned, ["/ai/2454"], "只載入一次");
    });

    test("網址停在目標、畫面一直是原個股 → NAV_FALLBACK_SLOW_MS 後載入目標個股", () => {
        navigateToStock("2454", env.window, { assign });
        mock.timers.tick(NAV_FALLBACK_SLOW_MS - 1);
        assert.deepEqual(assigned, []);
        mock.timers.tick(1);
        assert.deepEqual(assigned, ["/ai/2454"]);
    });

    test("畫面停在載入中（找不到代碼）→ NAV_FALLBACK_SLOW_MS 後同樣改用一般頁面載入", () => {
        navigateToStock("00632r", env.window, { assign });
        env.document.querySelector(FUGLE.symbol)?.remove();
        mock.timers.tick(NAV_FALLBACK_SLOW_MS);
        assert.deepEqual(assigned, ["/ai/00632R"]);
    });

    test("畫面沒反應時重複點擊同一檔（每次都被改回）→ 再通知路由器一次，沿用第一次的時限", () => {
        navigateToStock("2454", env.window, { assign });
        mock.timers.tick(200);
        revert();
        mock.timers.tick(2800);
        assert.equal(navigateToStock("2454", env.window, { assign }), true);
        assert.equal(env.window.location.pathname, "/ai/2454", "重新 pushState");
        assert.equal(pops, 2);
        mock.timers.tick(200);
        revert();
        mock.timers.tick(NAV_FALLBACK_MS - 3200);
        assert.deepEqual(assigned, ["/ai/2454"], "不因重複點擊而延後；自己觸發的 popstate 不會取消備援");
    });

    test("畫面沒反應時重複點擊同一檔（網址仍是目標）→ 不重複 pushState，只再觸發 popstate", () => {
        navigateToStock("2454", env.window, { assign });
        const length = env.window.history.length;
        mock.timers.tick(3000);
        assert.equal(navigateToStock("2454", env.window, { assign }), true);
        assert.equal(env.window.history.length, length);
        assert.equal(pops, 2);
        mock.timers.tick(NAV_FALLBACK_SLOW_MS - 3000);
        assert.deepEqual(assigned, ["/ai/2454"]);
    });
});

describe("navigateToStock：使用者已改看其他頁面時不介入", () => {
    test("等待期間改看另一檔 → 前一次的追蹤取消，只為最後一次導覽計時", () => {
        navigateToStock("2454", env.window, { assign });
        mock.timers.tick(1000);
        // 第二次點擊時網址還是第一個目標（尚未被改回）；之後富果寫回的是畫面上 2330 的路徑
        navigateToStock("2303", env.window, { assign });
        mock.timers.tick(200);
        revert();
        mock.timers.tick(NAV_FALLBACK_MS - 200 - 1); // 已超過第一次導覽的時限
        assert.deepEqual(assigned, [], "第一次導覽的追蹤已取消");
        mock.timers.tick(1);
        assert.deepEqual(assigned, ["/ai/2303"]);
    });

    test("等待期間畫面切換到第三檔（使用者在富果點了別的股票）→ 不重新載入", () => {
        navigateToStock("2454", env.window, { assign });
        env.window.history.pushState({}, "", "/ai/2317");
        setStockOnPage(env.document, "2317", "鴻海");
        mock.timers.tick(NAV_FALLBACK_SLOW_MS);
        assert.deepEqual(assigned, []);
    });

    test("等待期間前往非個股頁 → 不重新載入", () => {
        navigateToStock("2454", env.window, { assign });
        env.window.history.pushState({}, "", "/");
        env.document.querySelector(FUGLE.symbol)?.remove();
        mock.timers.tick(NAV_FALLBACK_SLOW_MS);
        assert.deepEqual(assigned, []);
    });

    test("使用者按上一頁（瀏覽器觸發、isTrusted 的 popstate）→ 取消備援", async () => {
        navigateToStock("2454", env.window, { assign });
        let trusted: boolean | null = null;
        env.window.addEventListener("popstate", (e) => {
            if (e.isTrusted) trusted = true;
        });
        env.window.history.back(); // jsdom 以真實計時器非同步切換歷史紀錄
        for (let i = 0; i < 50 && trusted === null; i++) await flush(5);
        assert.equal(trusted, true, "jsdom 的上一頁應觸發 isTrusted 的 popstate");
        assert.equal(env.window.location.pathname, "/ai/2330");
        mock.timers.tick(NAV_FALLBACK_SLOW_MS * 2);
        assert.deepEqual(assigned, []);
    });

    test("cancelNavigationFallback() 取消尚未執行的備援", () => {
        navigateToStock("2454", env.window, { assign });
        cancelNavigationFallback();
        mock.timers.tick(NAV_FALLBACK_SLOW_MS);
        assert.deepEqual(assigned, []);
    });

    test("可注入 readSymbol：以其回傳值判斷畫面是否已切換", () => {
        let shown = "2330";
        navigateToStock("2454", env.window, { assign, readSymbol: () => shown });
        shown = "2454";
        mock.timers.tick(NAV_FALLBACK_SLOW_MS);
        assert.deepEqual(assigned, []);
    });
});
