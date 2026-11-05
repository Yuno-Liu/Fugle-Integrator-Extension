/**
 * 測試腳本
 *
 * 以 esbuild 將 tests/**\/*.test.ts（連同被測的 src 模組）打包成 ESM，
 * 再用 Node 內建的 node:test 執行。不需額外的 TypeScript 執行器。
 *
 *   node scripts/test.mjs                         執行全部測試
 *   node scripts/test.mjs utils core              只執行路徑包含關鍵字的測試（相對於 tests/，例如 unit/utils）
 *   node scripts/test.mjs content/card            Windows 也可用 "/" 分隔
 *   node scripts/test.mjs card -- --test-name-pattern=重試   "--" 之後的參數直接交給 node --test
 */
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(root, "tests");
const outdir = join(root, ".test-dist");

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const filters = (separator >= 0 ? argv.slice(0, separator) : argv).map((f) => f.replace(/\\/g, "/"));
const passThrough = separator >= 0 ? argv.slice(separator + 1) : [];

function findTests(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "fixtures" || entry.name === "helpers" ? [] : findTests(full);
        return entry.name.endsWith(".test.ts") ? [full] : [];
    });
}

// 篩選條件比對「相對於 tests/ 的路徑」（統一使用 "/"）
const tests = findTests(testsDir).filter((file) => {
    const rel = relative(testsDir, file).replace(/\\/g, "/");
    return filters.length === 0 || filters.some((f) => rel.includes(f));
});
if (tests.length === 0) {
    console.error(`找不到符合條件的測試檔：${filters.join(" ")}`);
    process.exit(1);
}

rmSync(outdir, { recursive: true, force: true });
await esbuild.build({
    entryPoints: tests,
    outdir,
    outbase: testsDir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: "inline",
    packages: "external",
    loader: { ".css": "text" },
    define: { __DEV__: "false" },
    logLevel: "warning",
    banner: { js: "import { createRequire as __fiCreateRequire } from 'node:module'; const require = __fiCreateRequire(import.meta.url);" },
});

const outputs = tests.map((file) => join(outdir, relative(testsDir, file)).replace(/\.ts$/, ".mjs"));
const result = spawnSync(process.execPath, ["--enable-source-maps", "--test", "--test-reporter=spec", ...passThrough, ...outputs], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
