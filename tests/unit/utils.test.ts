/**
 * src/utils/*：數值格式化、安全 HTML、快捷鍵解析、計時工具、錯誤訊息。
 */
import { describe, test, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    EMPTY,
    toNumber,
    fmtNumber,
    fmtSigned,
    fmtPercent,
    fmtLots,
    fmtSharesAsLots,
    fmtHundredMillion,
    fmtThousandTwd,
    trendOf,
} from "../../src/utils/format";
import { escapeHtml, html, raw, joinHtml, safeHttpUrl, SafeHtml } from "../../src/utils/html";
import { shortcutFromEvent, normalizeShortcut, isUsableShortcut, matchesShortcut, type ShortcutEvent } from "../../src/utils/shortcut";
import { debounce, settleWithin } from "../../src/utils/timing";
import { errorMessage } from "../../src/utils/log";

// ---------------------------------------------------------------------------
// format.ts
// ---------------------------------------------------------------------------

describe("toNumber", () => {
    const cases: Array<[unknown, number | null]> = [
        ["1,234.5", 1234.5],
        ["25,932,370", 25_932_370], // basic-2330 V3 千股
        ["-24,367,496", -24_367_496],
        ["+5", 5],
        ["-21.73%", -21.73],
        [" 3 ", 3],
        [".5", 0.5],
        ["5.", 5],
        ["1e3", 1000],
        ["0", 0],
        [42, 42],
        [-0.5, -0.5],
        ["", null],
        ["-", null],
        ["--", null],
        ["N/A", null],
        ["abc", null],
        ["12abc", null],
        ["0x10", null],
        ["Infinity", null],
        ["1e999", null],
        [Number.NaN, null],
        [Number.POSITIVE_INFINITY, null],
        [null, null],
        [undefined, null],
        [true, null],
        [{}, null],
    ];
    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input) ?? String(input)} → ${expected}`, () => {
            assert.equal(toNumber(input), expected);
        });
    }
});

describe("fmtNumber", () => {
    const cases: Array<[number | null | undefined, number | undefined, string]> = [
        [12_728_481, undefined, "12,728,481"],
        [-24_367_496, undefined, "-24,367,496"],
        [1234.567, 2, "1,234.57"],
        [0, undefined, "0"],
        [0, 2, "0.00"],
        [1.5, 0, "2"],
        [null, undefined, EMPTY],
        [undefined, undefined, EMPTY],
        [Number.NaN, undefined, EMPTY],
        [Number.POSITIVE_INFINITY, undefined, EMPTY],
    ];
    for (const [value, digits, expected] of cases) {
        test(`${String(value)} (digits=${String(digits)}) → ${expected}`, () => {
            assert.equal(fmtNumber(value, digits), expected);
        });
    }

    test("不會輸出 -0：四捨五入後為零的負值顯示 0", () => {
        assert.equal(fmtNumber(-0), "0");
        assert.equal(fmtNumber(-0.4), "0");
        assert.equal(fmtNumber(-0.001, 2), "0.00");
        assert.equal(fmtNumber(-0.004, 2), "0.00");
    });

    test(
        "負值四捨五入與正值對稱：-0.5 → -1（與 0.5 → 1 對應）",
        () => {
            assert.equal(fmtNumber(0.5), "1");
            assert.equal(fmtNumber(-0.5), "-1");
            assert.equal(fmtNumber(-0.005, 2), "-0.01");
        }
    );
});

describe("fmtSigned / fmtPercent", () => {
    const signed: Array<[number | null, number, string]> = [
        [24, 0, "+24"],
        [-19, 0, "-19"],
        [0, 0, "0"],
        [0.004, 2, "0.00"], // 顯示為零時不加 "+"
        [-0.004, 2, "0.00"], // 也不出現 "-0.00"
        [1234.5, 1, "+1,234.5"],
        [null, 0, EMPTY],
    ];
    for (const [value, digits, expected] of signed) {
        test(`fmtSigned(${String(value)}, ${digits}) → ${expected}`, () => {
            assert.equal(fmtSigned(value, digits), expected);
        });
    }

    test("fmtPercent：major1-2330 買賣超比率 -21.73%", () => {
        // (12,728,481 + -24,367,496) / 53,552,371 * 100
        const ratio = ((12_728_481 - 24_367_496) / 53_552_371) * 100;
        assert.equal(fmtPercent(ratio), "-21.73%");
        assert.equal(fmtPercent(ratio, 2, true), "-21.73%");
    });

    const pct: Array<[number | null | undefined, number | undefined, boolean | undefined, string]> = [
        [3.456, undefined, undefined, "3.46%"],
        [3.456, 1, true, "+3.5%"],
        [0, 2, true, "0.00%"],
        [-17.84, 2, true, "-17.84%"],
        [null, 2, true, EMPTY],
        [Number.NaN, 2, false, EMPTY],
    ];
    for (const [value, digits, isSigned, expected] of pct) {
        test(`fmtPercent(${String(value)}, ${String(digits)}, ${String(isSigned)}) → ${expected}`, () => {
            assert.equal(fmtPercent(value, digits, isSigned), expected);
        });
    }
});

describe("fmtLots / fmtSharesAsLots", () => {
    const lots: Array<[number | null | undefined, string]> = [
        [12_728_481, "12,728"],
        [-24_367_496, "-24,367"],
        [53_552_371, "53,552"],
        [1_499, "1"],
        [1_500, "2"],
        [400, "0"],
        [-400, "0"],
        [null, EMPTY],
        [Number.NaN, EMPTY],
    ];
    for (const [shares, expected] of lots) {
        test(`fmtLots(${String(shares)}) → ${expected}`, () => {
            assert.equal(fmtLots(shares), expected);
        });
    }

    const etf: Array<[number | null | undefined, string]> = [
        [25_000_000_000, "2,500.00 萬張"],
        [10_000_000, "1.00 萬張"],
        [9_999_400, "9,999 張"],
        [1_000, "1 張"],
        [1_600, "2 張"],
        [999, "< 1 張"],
        [1, "< 1 張"],
        [0, EMPTY],
        [-5_000, EMPTY],
        [null, EMPTY],
        [Number.POSITIVE_INFINITY, EMPTY],
    ];
    for (const [shares, expected] of etf) {
        test(`fmtSharesAsLots(${String(shares)}) → ${expected}`, () => {
            assert.equal(fmtSharesAsLots(shares), expected);
        });
    }
});

describe("fmtHundredMillion（億 / 兆）", () => {
    const cases: Array<[number | null | undefined, string]> = [
        [2_593.237_01, "2,593.24 億"], // basic-2330 股本：259,323,701 千元
        [25_000, "2.50 兆"],
        [10_000, "1.00 兆"],
        [9_999.99, "9,999.99 億"],
        [0.5, "0.50 億"],
        [0, "0.00 億"],
        [-25_000, "-2.50 兆"],
        [-123.456, "-123.46 億"],
        [null, EMPTY],
        [Number.NaN, EMPTY],
    ];
    for (const [value, expected] of cases) {
        test(`${String(value)} → ${expected}`, () => {
            assert.equal(fmtHundredMillion(value), expected);
        });
    }

    test("basic-2330 實際股本換算：千元 → 億", () => {
        const capitalThousand = 259_323_701;
        assert.equal(fmtHundredMillion(capitalThousand / 100_000), "2,593.24 億");
    });
});

describe("fmtThousandTwd（億 / 萬 / 元）", () => {
    const cases: Array<[number | null | undefined, string]> = [
        [8_432_521, "84.33 億"],
        [259_323_701, "2,593.24 億"],
        [100_000, "1.00 億"],
        [99_999, "9,999.9 萬"],
        [15, "1.5 萬"],
        [10, "1.0 萬"],
        [9.999, "9,999 元"],
        [0.5, "500 元"],
        [0, "0 元"],
        [-8_432_521, "-84.33 億"],
        [-15, "-1.5 萬"],
        [-0.5, "-500 元"],
        [null, EMPTY],
        [undefined, EMPTY],
        [Number.NaN, EMPTY],
    ];
    for (const [value, expected] of cases) {
        test(`${String(value)} 千元 → ${expected}`, () => {
            assert.equal(fmtThousandTwd(value), expected);
        });
    }
});

describe("trendOf", () => {
    const cases: Array<[number | null | undefined, "up" | "down" | "flat"]> = [
        [24, "up"],
        [0.0001, "up"],
        [-19, "down"],
        [0, "flat"],
        [-0, "flat"],
        [null, "flat"],
        [undefined, "flat"],
        [Number.NaN, "flat"],
        [Number.NEGATIVE_INFINITY, "flat"],
    ];
    for (const [value, expected] of cases) {
        test(`${String(value)} → ${expected}`, () => {
            assert.equal(trendOf(value), expected);
        });
    }
});

// ---------------------------------------------------------------------------
// html.ts
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
    test("跳脫全部 6 個特殊字元", () => {
        assert.equal(escapeHtml(`&<>"'\``), "&amp;&lt;&gt;&quot;&#39;&#96;");
    });

    test("典型 XSS 字串無法形成標籤或跳出屬性", () => {
        const out = escapeHtml(`"><img src=x onerror='alert(1)'>`);
        assert.ok(!out.includes("<") && !out.includes(">") && !out.includes('"') && !out.includes("'"));
    });

    test("& 只跳脫一次（不重複跳脫既有實體以外的字元）", () => {
        assert.equal(escapeHtml("&amp;"), "&amp;amp;");
    });

    const cases: Array<[unknown, string]> = [
        ["台積電", "台積電"],
        [null, ""],
        [undefined, ""],
        [0, "0"],
        [false, "false"],
        [2330, "2330"],
    ];
    for (const [value, expected] of cases) {
        test(`${String(value)} → ${JSON.stringify(expected)}`, () => {
            assert.equal(escapeHtml(value), expected);
        });
    }
});

describe("html tagged template", () => {
    test("插值自動跳脫（文字與屬性）", () => {
        const name = `<script>alert("x")</script>`;
        const url = `" onmouseover="alert(1)`;
        const out = html`<a href="${url}">${name}</a>`;
        assert.ok(out instanceof SafeHtml);
        assert.equal(out.value, `<a href="&quot; onmouseover=&quot;alert(1)">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</a>`);
    });

    test("null / undefined / false 輸出空字串；0 與 true 照常輸出", () => {
        assert.equal(html`[${null}|${undefined}|${false}|${0}|${true}]`.value, "[|||0|true]");
    });

    test("陣列逐項渲染並各自跳脫，可混合 SafeHtml", () => {
        const items = ["<a>", html`<b>${"&"}</b>`, null, false, 3];
        assert.equal(html`<li>${items}</li>`.value, "<li>&lt;a&gt;<b>&amp;</b>3</li>");
    });

    test("巢狀陣列", () => {
        assert.equal(html`${[["<"], [html`<i></i>`]]}`.value, "&lt;<i></i>");
    });

    test("巢狀 html 結果不會被重複跳脫", () => {
        const inner = html`<span>${"A&B"}</span>`;
        const outer = html`<div>${inner}</div>`;
        assert.equal(outer.value, "<div><span>A&amp;B</span></div>");
        assert.equal(String(outer), outer.value);
    });

    test("raw() 原樣輸出", () => {
        assert.equal(html`<p>${raw("<br>")}</p>`.value, "<p><br></p>");
    });

    test("偽造的 { value } 物件不會被當成 SafeHtml", () => {
        const fake = { value: "<img>", toString: () => "<img>" };
        assert.equal(html`${fake}`.value, "&lt;img&gt;");
    });

    test("無插值", () => {
        assert.equal(html`<hr>`.value, "<hr>");
    });
});

describe("joinHtml", () => {
    test("以 SafeHtml 分隔，略過 null/undefined/false 與空片段", () => {
        const parts: Array<SafeHtml | null | undefined | false> = [html`<b>1</b>`, null, html``, undefined, false, html`<b>2</b>`];
        assert.equal(joinHtml(parts, raw("<br>")).value, "<b>1</b><br><b>2</b>");
    });

    test("字串分隔符號會被跳脫", () => {
        assert.equal(joinHtml([raw("a"), raw("b")], " <&> ").value, "a &lt;&amp;&gt; b");
    });

    test("預設無分隔、空陣列回傳空字串", () => {
        assert.equal(joinHtml([raw("a"), raw("b")]).value, "ab");
        assert.equal(joinHtml([]).value, "");
    });
});

describe("safeHttpUrl", () => {
    const cases: Array<[string | null | undefined, string | null]> = [
        ["https://www.fugle.tw/ai/2330", "https://www.fugle.tw/ai/2330"],
        ["http://example.com", "http://example.com/"],
        ["  https://example.com/a?b=1  ", "https://example.com/a?b=1"],
        ["HTTPS://EXAMPLE.COM/Path", "https://example.com/Path"],
        ["www.tsmc.com", "https://www.tsmc.com/"],
        ["WWW.TSMC.COM/zh", "https://www.tsmc.com/zh"],
        ["javascript:alert(1)", null],
        ["JavaScript:alert(1)", null],
        ["  javascript:alert(1)", null],
        ["data:text/html,<script>alert(1)</script>", null],
        ["vbscript:msgbox(1)", null],
        ["ftp://example.com", null],
        ["//evil.com", null],
        ["/relative/path", null],
        ["relative/path", null],
        ["tsmc.com", null],
        ["https://", null],
        ["", null],
        [null, null],
        [undefined, null],
    ];
    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input) ?? "undefined"} → ${String(expected)}`, () => {
            assert.equal(safeHttpUrl(input), expected);
        });
    }
});

// ---------------------------------------------------------------------------
// shortcut.ts
// ---------------------------------------------------------------------------

function keyEvent(partial: Partial<ShortcutEvent> & Pick<ShortcutEvent, "key" | "code">): ShortcutEvent {
    return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...partial };
}

describe("shortcutFromEvent", () => {
    const cases: Array<[string, ShortcutEvent, string | null]> = [
        ["macOS Option+Q（key 為 œ）以 code 判斷 → Alt+Q", keyEvent({ key: "œ", code: "KeyQ", altKey: true }), "Alt+Q"],
        ["Windows Alt+Q", keyEvent({ key: "q", code: "KeyQ", altKey: true }), "Alt+Q"],
        ["小寫字母轉大寫", keyEvent({ key: "k", code: "KeyK", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+K"],
        ["Shift+數字以 code 判斷（key 為 !）", keyEvent({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+1"],
        ["macOS Option+2（key 為 ™）", keyEvent({ key: "™", code: "Digit2", altKey: true }), "Alt+2"],
        ["修飾鍵固定排序 Ctrl,Alt,Shift,Meta", keyEvent({ key: "x", code: "KeyX", metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }), "Ctrl+Alt+Shift+Meta+X"],
        ["Cmd+K", keyEvent({ key: "k", code: "KeyK", metaKey: true }), "Meta+K"],
        ["空白鍵 → Space", keyEvent({ key: " ", code: "Space", ctrlKey: true }), "Ctrl+Space"],
        ["功能鍵保留名稱", keyEvent({ key: "F5", code: "F5", ctrlKey: true }), "Ctrl+F5"],
        ["方向鍵保留名稱", keyEvent({ key: "ArrowUp", code: "ArrowUp", altKey: true }), "Alt+ArrowUp"],
        ["標點以 key 判斷", keyEvent({ key: "/", code: "Slash", ctrlKey: true }), "Ctrl+/"],
        ["只有 Shift 也算修飾鍵", keyEvent({ key: "A", code: "KeyA", shiftKey: true }), "Shift+A"],
        ["沒有修飾鍵 → null", keyEvent({ key: "q", code: "KeyQ" }), null],
        ["按住重複觸發 → null", keyEvent({ key: "q", code: "KeyQ", altKey: true, repeat: true }), null],
        ["輸入法組字中 → null", keyEvent({ key: "q", code: "KeyQ", altKey: true, isComposing: true }), null],
        ["只按 Control → null", keyEvent({ key: "Control", code: "ControlLeft", ctrlKey: true }), null],
        ["只按 Alt → null", keyEvent({ key: "Alt", code: "AltLeft", altKey: true }), null],
        ["只按 Shift → null", keyEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true }), null],
        ["只按 Meta → null", keyEvent({ key: "Meta", code: "MetaLeft", metaKey: true }), null],
        ["AltGraph → null", keyEvent({ key: "AltGraph", code: "AltRight", altKey: true, ctrlKey: true }), null],
        ["Dead key → null", keyEvent({ key: "Dead", code: "Backquote", altKey: true }), null],
        ["Unidentified → null", keyEvent({ key: "Unidentified", code: "", ctrlKey: true }), null],
    ];
    for (const [name, event, expected] of cases) {
        test(name, () => {
            assert.equal(shortcutFromEvent(event), expected);
        });
    }
});

describe("normalizeShortcut", () => {
    const cases: Array<[string | null | undefined, string | null]> = [
        ["Alt+Q", "Alt+Q"],
        ["alt+q", "Alt+Q"],
        [" Alt + q ", "Alt+Q"],
        ["Control+Shift+k", "Ctrl+Shift+K"],
        ["Shift+Ctrl+K", "Ctrl+Shift+K"],
        ["Cmd+Option+q", "Alt+Meta+Q"],
        ["Command+K", "Meta+K"],
        ["Opt+1", "Alt+1"],
        ["Win+E", "Meta+E"],
        ["Super+E", "Meta+E"],
        ["Meta+Shift+Alt+Ctrl+X", "Ctrl+Alt+Shift+Meta+X"],
        ["Ctrl+Ctrl+A", "Ctrl+A"],
        ["Ctrl+Space", "Ctrl+Space"],
        ["Alt+F5", "Alt+F5"],
        ["Ctrl+A+B", null],
        ["A", null],
        ["Ctrl", null],
        ["Ctrl+Alt", null],
        ["", null],
        [null, null],
        [undefined, null],
    ];
    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input) ?? "undefined"} → ${String(expected)}`, () => {
            assert.equal(normalizeShortcut(input), expected);
        });
    }
});

describe("isUsableShortcut", () => {
    const cases: Array<[string | null | undefined, boolean]> = [
        ["Alt+Q", true],
        ["Ctrl+Shift+K", true],
        ["Cmd+K", true],
        ["option+q", true],
        ["Shift+A", false],
        ["Q", false],
        ["Ctrl+A+B", false],
        ["", false],
        [null, false],
    ];
    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input)} → ${expected}`, () => {
            assert.equal(isUsableShortcut(input), expected);
        });
    }
});

describe("matchesShortcut", () => {
    test("macOS Option+Q 符合舊版設定字串 option+q", () => {
        assert.equal(matchesShortcut(keyEvent({ key: "œ", code: "KeyQ", altKey: true }), "option+q"), true);
        assert.equal(matchesShortcut(keyEvent({ key: "œ", code: "KeyQ", altKey: true }), "Alt+Q"), true);
    });

    test("修飾鍵順序不同仍符合", () => {
        assert.equal(matchesShortcut(keyEvent({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }), "Shift+Control+K"), true);
    });

    const negatives: Array<[string, ShortcutEvent, string | null | undefined]> = [
        ["多一個修飾鍵不符合", keyEvent({ key: "q", code: "KeyQ", altKey: true, shiftKey: true }), "Alt+Q"],
        ["少一個修飾鍵不符合", keyEvent({ key: "k", code: "KeyK", ctrlKey: true }), "Ctrl+Shift+K"],
        ["不同按鍵不符合", keyEvent({ key: "w", code: "KeyW", altKey: true }), "Alt+Q"],
        ["重複觸發不符合", keyEvent({ key: "q", code: "KeyQ", altKey: true, repeat: true }), "Alt+Q"],
        ["組字中不符合", keyEvent({ key: "q", code: "KeyQ", altKey: true, isComposing: true }), "Alt+Q"],
        ["無效設定不符合", keyEvent({ key: "q", code: "KeyQ", altKey: true }), "Q"],
        ["空設定不符合", keyEvent({ key: "q", code: "KeyQ", altKey: true }), null],
    ];
    for (const [name, event, shortcut] of negatives) {
        test(name, () => {
            assert.equal(matchesShortcut(event, shortcut), false);
        });
    }

    test("任何由事件錄製出的快捷鍵都能以同一事件觸發（錄製 → 比對往返）", () => {
        const events = [
            keyEvent({ key: "œ", code: "KeyQ", altKey: true }),
            keyEvent({ key: " ", code: "Space", ctrlKey: true, shiftKey: true }),
            keyEvent({ key: "F2", code: "F2", metaKey: true }),
            keyEvent({ key: "/", code: "Slash", ctrlKey: true }),
            keyEvent({ key: "-", code: "Minus", ctrlKey: true, altKey: true }),
        ];
        for (const event of events) {
            const recorded = shortcutFromEvent(event);
            assert.ok(recorded, `recorded ${event.code}`);
            assert.equal(normalizeShortcut(recorded), recorded);
            assert.equal(matchesShortcut(event, recorded), true, recorded);
        }
    });

    test(
        "「+」鍵（Ctrl+Shift+= / NumpadAdd）錄製後能被正規化與比對",
        () => {
            const events = [
                keyEvent({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }),
                keyEvent({ key: "+", code: "NumpadAdd", ctrlKey: true }),
            ];
            for (const event of events) {
                const recorded = shortcutFromEvent(event);
                assert.ok(recorded);
                assert.equal(normalizeShortcut(recorded), recorded);
                assert.equal(isUsableShortcut(recorded), true);
                assert.equal(matchesShortcut(event, recorded), true);
            }
        }
    );
});

// ---------------------------------------------------------------------------
// timing.ts（以 node:test mock timers 控制時間）
// ---------------------------------------------------------------------------

describe("debounce", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    test("停止觸發 delay 後只執行一次，且使用最後一次的參數", () => {
        const calls: Array<[string, number]> = [];
        const fn = debounce((a: string, b: number) => calls.push([a, b]), 100);
        fn("a", 1);
        mock.timers.tick(50);
        fn("b", 2);
        mock.timers.tick(99);
        assert.deepEqual(calls, []);
        fn("c", 3);
        mock.timers.tick(99);
        assert.deepEqual(calls, []);
        mock.timers.tick(1);
        assert.deepEqual(calls, [["c", 3]]);
        mock.timers.tick(1000);
        assert.equal(calls.length, 1);
    });

    test("執行後再次呼叫會重新計時", () => {
        const calls: number[] = [];
        const fn = debounce((n: number) => calls.push(n), 10);
        fn(1);
        mock.timers.tick(10);
        fn(2);
        mock.timers.tick(10);
        assert.deepEqual(calls, [1, 2]);
    });

    test("cancel 取消尚未執行的呼叫", () => {
        const calls: number[] = [];
        const fn = debounce((n: number) => calls.push(n), 100);
        fn(1);
        fn.cancel();
        mock.timers.tick(500);
        assert.deepEqual(calls, []);
        // cancel 後仍可再使用
        fn(2);
        mock.timers.tick(100);
        assert.deepEqual(calls, [2]);
    });

    test("沒有待執行呼叫時 cancel 為 no-op", () => {
        const calls: number[] = [];
        const fn = debounce((n: number) => calls.push(n), 100);
        fn.cancel();
        assert.deepEqual(calls, []);
        fn(1);
        mock.timers.tick(100);
        fn.cancel(); // 已執行，不影響結果
        assert.deepEqual(calls, [1]);
    });
});

describe("settleWithin", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
    afterEach(() => mock.timers.reset());

    test("在期限內完成 → 回傳原值", async () => {
        assert.equal(await settleWithin(Promise.resolve(42), 100), 42);
    });

    test("失敗時回傳 null（不拋錯）", async () => {
        assert.equal(await settleWithin(Promise.reject(new Error("boom")), 100), null);
    });

    test("逾時回傳 null；之後才完成的結果被忽略", async () => {
        let resolveIt: (v: number) => void = () => undefined;
        const p = settleWithin(new Promise<number>((r) => (resolveIt = r)), 50);
        mock.timers.tick(50);
        assert.equal(await p, null);
        resolveIt(7);
    });

    test("期限前完成會清除計時器", async () => {
        let resolveIt: (v: string) => void = () => undefined;
        const p = settleWithin(new Promise<string>((r) => (resolveIt = r)), 1000);
        resolveIt("ok");
        assert.equal(await p, "ok");
        mock.timers.tick(2000);
    });
});

// ---------------------------------------------------------------------------
// log.ts errorMessage
// ---------------------------------------------------------------------------

describe("errorMessage", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular["self"] = circular;

    const cases: Array<[string, unknown, string]> = [
        ["Error → message", new Error("HTTP 500"), "HTTP 500"],
        ["Error 子類別", new TypeError("Failed to fetch"), "Failed to fetch"],
        ["字串原樣回傳", "network down", "network down"],
        ["物件 → JSON", { code: "TIMEOUT", status: 504 }, `{"code":"TIMEOUT","status":504}`],
        ["數字", 404, "404"],
        ["null", null, "null"],
        ["循環參照退回 String()", circular, "[object Object]"],
        ["BigInt 無法 JSON 化退回 String()", 10n, "10"],
    ];
    for (const [name, input, expected] of cases) {
        test(name, () => {
            assert.equal(errorMessage(input), expected);
        });
    }

    test(
        "undefined / 函式 / Symbol 也回傳字串",
        () => {
            for (const value of [undefined, () => {}, Symbol("x")]) {
                assert.equal(typeof errorMessage(value), "string");
            }
        }
    );
});
