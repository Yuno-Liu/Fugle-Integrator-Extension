/**
 * 端對端冒煙測試：把 dist/ 載入 Chromium，實際開啟 www.fugle.tw 驗證主要功能。
 *
 * 需求（只需做一次）：
 *   npx playwright-core install chromium
 *
 * 執行：
 *   npm run build && npm run e2e
 *   node scripts/e2e.mjs --headed            # 顯示瀏覽器視窗
 *   node scripts/e2e.mjs --stock 2454        # 指定起始股票
 *   CHROMIUM_PATH=/path/to/chrome node scripts/e2e.mjs   # 使用自備的 Chromium / Chrome for Testing
 *
 * 📌 依賴真實網站與網路，結果可能因富果改版或資料來源異常而變動，因此不放在 CI。
 * 📌 Google Chrome 正式版已不支援 --load-extension，請使用 Chromium 或 Chrome for Testing。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const EXT = resolve(option("ext", join(root, "dist")));
const OUT = resolve(option("out", join(root, ".e2e-output")));
const STOCK = option("stock", "2330");
const HEADED = argv.includes("--headed");

let chromium;
try {
    ({ chromium } = await import("playwright-core"));
} catch {
    console.error("找不到 playwright-core，請先執行 npm install");
    process.exit(2);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const shot = (p, name, opts = {}) => p.screenshot({ path: join(OUT, `${name}.png`), ...opts });

const ctx = await chromium.launchPersistentContext(join(OUT, "profile"), {
    headless: !HEADED,
    channel: process.env.CHROMIUM_PATH ? undefined : "chromium",
    executablePath: process.env.CHROMIUM_PATH || undefined,
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const errors = [];
const page = await ctx.newPage();
// 只計入本擴充功能造成的例外（富果網站本身的錯誤不算）
page.on("pageerror", (e) => {
    if (/chrome-extension:\/\//.test(e.stack ?? "")) errors.push(e.message);
});
page.on("console", (m) => {
    if (m.type() === "error" && /富果整合器/.test(m.text())) errors.push(m.text());
});

/** 以 pushState + popstate 觸發富果的 SPA 導覽；富果偶爾沒回應時重試一次 */
async function spaNavigate(id) {
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.evaluate((code) => {
            history.pushState({}, "", `/ai/${code}`);
            dispatchEvent(new PopStateEvent("popstate"));
        }, id);
        const ok = await page
            .waitForFunction((t) => document.querySelector(".card-group-header__info__symbol")?.textContent.trim() === t, id, { timeout: 8000 })
            .then(() => true, () => false);
        if (ok) return;
        await page.evaluate(() => history.back());
        await page.waitForTimeout(500);
    }
    throw new Error(`SPA 導覽到 ${id} 失敗`);
}

const settled = () =>
    page.waitForFunction(
        () => {
            const s = [...document.querySelectorAll("#fi-card .fi-section")];
            return s.length > 0 && s.every((x) => x.dataset.state !== "loading");
        },
        null,
        { timeout: 40_000 }
    );
const stockOnPage = (id) => page.waitForFunction((t) => document.querySelector(".card-group-header__info__symbol")?.textContent.trim() === t, id, { timeout: 30_000 });
const cardFor = (id) => page.waitForFunction((t) => document.querySelector("#fi-card")?.dataset.stockId === t, id, { timeout: 15_000 });

try {
    // 1. 首次載入
    const t0 = Date.now();
    await page.goto(`https://www.fugle.tw/ai/${STOCK}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await stockOnPage(STOCK);
    const tSymbol = Date.now() - t0;
    await page.waitForSelector("#fi-card", { timeout: 15_000 });
    const tCard = Date.now() - t0;
    await settled();
    const tAll = Date.now() - t0;
    check("資訊卡在股票代碼出現後迅速顯示", tCard - tSymbol < 3000, `代碼 ${tSymbol}ms → 卡片 ${tCard}ms → 全部區塊 ${tAll}ms`);

    const info = await page.evaluate(() => {
        const card = document.querySelector("#fi-card");
        const rect = (el) => el?.getBoundingClientRect().toJSON();
        return {
            id: card.dataset.stockId,
            states: Object.fromEntries([...card.querySelectorAll(".fi-section")].map((s) => [s.dataset.section, s.dataset.state])),
            text: card.innerText,
            summary: [...card.querySelectorAll(".fi-summary__item")].map((x) => x.textContent.trim()),
            majorRows: card.querySelectorAll('[data-section="major"] tbody tr').length,
            barWidths: [...card.querySelectorAll(".fi-bar, .fi-mix__track")].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect().width),
            toolbar: rect(document.querySelector("#fi-toolbar")),
            cardRect: rect(card),
            theme: document.documentElement.dataset.fiTheme,
            toolbarCount: document.querySelectorAll("#fi-toolbar").length,
            clock: !!document.querySelector("#fi-clock"),
        };
    });
    check("卡片對應目前個股", info.id === STOCK);
    check("所有區塊皆已完成（無載入中）", Object.values(info.states).every((s) => s !== "loading"), JSON.stringify(info.states));
    check("卡片內沒有 undefined / NaN", !/undefined|NaN/.test(info.text));
    check("主力買賣表格 5 列", info.majorRows === 5);
    check("可見的長條圖都有實際寬度", info.barWidths.length > 0 && info.barWidths.every((w) => w > 0), info.barWidths.join(","));
    check("重點摘要列", info.summary.length >= 2, info.summary.join(" / "));
    check("工具列與時鐘各一個", info.toolbarCount === 1 && info.clock);
    const t = info.toolbar;
    const c = info.cardRect;
    const overlap = t && c && !(c.left >= t.right || c.right <= t.left || c.top >= t.bottom || c.bottom <= t.top);
    check("浮動卡片不遮住工具列", !overlap, `toolbar bottom ${Math.round(t?.bottom)} / card top ${Math.round(c?.top)}`);
    check("淺色模式偵測", info.theme === "light", info.theme);
    await shot(page, "01-stock-light");

    // 2. 深色模式跟隨
    await page.evaluate(() => (document.querySelector(".body") || document.body).classList.add("dark-theme"));
    await page.waitForFunction(() => document.documentElement.dataset.fiTheme === "dark", null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const cardBg = await page.evaluate(() => getComputedStyle(document.querySelector("#fi-card")).backgroundColor);
    check("跟隨富果深色模式", cardBg === "rgb(31, 32, 35)", cardBg);
    await shot(page, "02-stock-dark");
    await page.evaluate(() => (document.querySelector(".body") || document.body).classList.remove("dark-theme"));
    await page.waitForFunction(() => document.documentElement.dataset.fiTheme === "light", null, { timeout: 5000 });

    // 3. 由相關個股切換（SPA）：在頁面放一個標記，切換後標記仍在才代表沒有整頁重新載入
    const link = await page.$('#fi-card [data-section="related"] a[data-fi-nav]');
    const next = link ? await link.getAttribute("data-fi-nav") : null;
    if (link && next) {
        await page.evaluate(() => {
            window.__fiSpaMarker = "kept";
        });
        await link.click();
        await stockOnPage(next);
        await cardFor(next);
        await settled();
        const after = await page.evaluate(() => ({
            cards: document.querySelectorAll("#fi-card").length,
            toolbars: document.querySelectorAll("#fi-toolbar").length,
            marker: window.__fiSpaMarker,
        }));
        check("點相關個股以 SPA 切換並更新資訊卡（未整頁重新載入）", after.cards === 1 && after.toolbars === 1 && after.marker === "kept", `→ ${next}，${JSON.stringify(after)}`);
    } else check("相關個股連結存在", false);

    // 4. ETF（沒有基本資料）不得殘留上一檔的資訊
    const previous = await page.evaluate(() => ({
        name: document.querySelector("#fi-card [data-role='name']")?.textContent ?? "",
        sub: document.querySelector("#fi-card [data-role='sub']")?.textContent ?? "",
    }));
    await spaNavigate("0050");
    await cardFor("0050");
    await settled();
    const etf = await page.evaluate(() => ({
        name: document.querySelector("#fi-card [data-role='name']")?.textContent ?? "",
        sub: document.querySelector("#fi-card [data-role='sub']")?.textContent ?? "",
        code: document.querySelector("#fi-card [data-role='code']")?.textContent ?? "",
    }));
    const stale = (previous.name && etf.name === previous.name) || (previous.sub && etf.sub.includes(previous.sub));
    check("ETF 頁面不殘留上一檔的資訊", etf.code.startsWith("0050") && !stale, `${etf.name} / ${etf.code}（上一檔：${previous.name}）`);

    // 5. 搜尋視窗
    await page.goto(`https://www.fugle.tw/ai/${STOCK}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#fi-toolbar [data-action='search']", { timeout: 30_000 });
    await page.click("#fi-toolbar [data-action='search']");
    await page.waitForSelector("#fi-search-modal .fi-search__input");
    await page.keyboard.type("聯發科");
    await page.waitForSelector('#fi-search-modal [role="option"]', { timeout: 10_000 });
    const first = await page.$eval('#fi-search-modal [role="option"]', (e) => e.textContent);
    check("搜尋結果排序（聯發科在第一筆）", /聯發科/.test(first), first.replace(/\s+/g, " ").trim());
    await shot(page, "03-search");
    await page.keyboard.press("Enter");
    const navigated = await cardFor("2454").then(
        () => true,
        () => false
    );
    check("搜尋結果按 Enter 前往個股", navigated && (await page.evaluate(() => location.pathname)) === "/ai/2454");
    await page.click("#fi-toolbar [data-action='search']");
    await page.waitForSelector("#fi-search-modal .fi-search__input");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    check("Esc 關閉搜尋視窗", !(await page.$("#fi-search-modal")));

    // 6. 快捷鍵
    await page.keyboard.press("Alt+KeyQ");
    await page.waitForTimeout(300);
    check("Alt+Q 聚焦富果搜尋框", await page.evaluate(() => document.activeElement?.classList.contains("search-bar__input")));

    // 7. 位置切換、隱藏 / 顯示
    for (const [pos, expect] of [
        ["left", "fi-card--left"],
        ["default", null],
        ["right", "fi-card--right"],
    ]) {
        await page.click(`#fi-toolbar [data-position="${pos}"]`);
        await page.waitForTimeout(150);
        const state = await page.evaluate(() => ({ cls: document.querySelector("#fi-card").className, embedded: !!document.querySelector(".card-group-header #fi-card") }));
        check(`位置：${pos}`, expect ? state.cls.includes(expect) : state.embedded, state.cls);
        if (pos === "default") await shot(page, "04-embedded");
    }
    await page.click("#fi-card [data-action='hide-card']");
    check("✕ 隱藏卡片並同步工具列開關", await page.evaluate(() => document.querySelector("#fi-card").hidden && !document.querySelector("#fi-toolbar input[data-action='visible']").checked));
    await page.click("#fi-toolbar .fi-switch");
    check("工具列開關重新顯示卡片", !(await page.evaluate(() => document.querySelector("#fi-card").hidden)));

    // 8. 彈出視窗
    const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 10_000 }), page.click("#fi-toolbar [data-action='popout']")]);
    await popup.waitForSelector("#fi-card .fi-section", { timeout: 10_000 });
    check("彈出視窗鏡像資訊卡", (await popup.$$("#fi-card .fi-section")).length >= 8);
    check("彈出時頁面上的卡片暫時隱藏", await page.evaluate(() => document.querySelector("#fi-card").hidden));
    await shot(popup, "05-popup");
    await popup.close();
    await page.waitForTimeout(800);
    check("關閉彈出視窗後恢復顯示", !(await page.evaluate(() => document.querySelector("#fi-card").hidden)));

    // 8b. 富果路由器沒有回應站內導覽時，4 秒後自動改用一般頁面載入
    //     模擬方式：在富果的腳本之前註冊 popstate 監聽器並攔下事件。
    //     📌 直接派送到 window 的事件依「註冊順序」呼叫監聽器（capture 不會優先），
    //        所以必須以 init script 搶先註冊；以 sessionStorage 旗標控制只在這一步生效。
    await page.addInitScript(() => {
        try {
            if (sessionStorage.getItem("__fiBlockPopstate") !== "1") return;
        } catch {
            return;
        }
        window.addEventListener("popstate", (e) => e.stopImmediatePropagation(), true);
    });
    const fallbackFrom = await page.evaluate(() => {
        sessionStorage.setItem("__fiBlockPopstate", "1");
        return document.querySelector(".card-group-header__info__symbol")?.textContent.trim() ?? "";
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await stockOnPage(fallbackFrom);
    await cardFor(fallbackFrom);
    await settled();
    const fallbackTarget = await page.evaluate((current) => {
        const link = [...document.querySelectorAll('#fi-card [data-section="related"] a[data-fi-nav]')].find((a) => a.dataset.fiNav !== current);
        return link?.dataset.fiNav ?? null;
    }, fallbackFrom);
    if (fallbackTarget) {
        await page.evaluate(() => {
            window.__fiSpaMarker = "kept";
        });
        const tNav = Date.now();
        await page.click(`#fi-card [data-section="related"] a[data-fi-nav="${fallbackTarget}"]`);
        await page.waitForTimeout(1500);
        const stuck = await page.evaluate(() => ({ path: location.pathname, symbol: document.querySelector(".card-group-header__info__symbol")?.textContent.trim() }));
        const recovered = await stockOnPage(fallbackTarget).then(
            () => true,
            () => false
        );
        const reloaded = recovered && (await page.evaluate(() => window.__fiSpaMarker === undefined));
        // 卡住時富果會把網址改回原個股，因此只檢查畫面：先停在原個股，之後經一般頁面載入顯示目標
        check(
            "站內導覽被忽略時自動改用一般頁面載入",
            stuck.symbol === fallbackFrom && reloaded,
            `→ ${fallbackTarget}，${Date.now() - tNav}ms 後顯示；卡住時 ${JSON.stringify(stuck)}`
        );
        await cardFor(fallbackTarget).catch(() => undefined);
    } else check("相關個股連結存在（導覽備援）", false);
    await page.evaluate(() => sessionStorage.removeItem("__fiBlockPopstate"));

    // 9. 離開個股頁
    await page.goto("https://www.fugle.tw/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    check("非個股頁不顯示工具列與資訊卡", await page.evaluate(() => !document.querySelector("#fi-card") && !document.querySelector("#fi-toolbar")));

    // 10. 設定頁
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const options = await ctx.newPage();
    await options.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
    await options.waitForSelector("#shortcut-input");
    check("設定頁正常顯示", (await options.$$("input[data-link]")).length === 8);
    await shot(options, "06-options", { fullPage: true });
} catch (error) {
    check("執行過程未發生例外", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    await shot(page, "error").catch(() => undefined);
} finally {
    check("沒有 JavaScript 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));
    writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
    await ctx.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通過；截圖與結果位於 ${OUT}`);
process.exit(failed.length ? 1 : 0);
