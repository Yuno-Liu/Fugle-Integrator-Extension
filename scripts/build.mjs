/**
 * 建置腳本（esbuild）
 *
 *   node scripts/build.mjs           正式版：壓縮、無 sourcemap、移除除錯輸出
 *   node scripts/build.mjs --dev     開發版：不壓縮、inline sourcemap、保留除錯輸出
 *   node scripts/build.mjs --watch   開發版 + 監看檔案變更
 *
 * 輸出至 dist/（Chrome「載入未封裝項目」請選此資料夾）。
 * dist/manifest.json 的 version 一律取自 package.json，確保兩者一致。
 */
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const dev = watch || args.has("--dev");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function copyAssets() {
    mkdirSync(dist, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    manifest.version = pkg.version;
    writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 4) + "\n");
    for (const file of ["options.html", "stock-data.json"]) copyFileSync(join(root, file), join(dist, file));
}

/** 將 .css 匯入轉為字串模組；正式版先壓縮 */
const cssTextPlugin = {
    name: "css-text",
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, async (args) => {
            const source = readFileSync(args.path, "utf8");
            const { code } = await esbuild.transform(source, { loader: "css", minify: !dev, target: ["chrome116"] });
            return { contents: `export default ${JSON.stringify(code)};`, loader: "js" };
        });
    },
};

/** @type {esbuild.BuildOptions} */
const options = {
    plugins: [cssTextPlugin],
    entryPoints: {
        background: join(root, "src/background.ts"),
        content: join(root, "src/content.ts"),
        options: join(root, "src/options.ts"),
    },
    outdir: dist,
    bundle: true,
    format: "iife",
    target: ["chrome116"],
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    legalComments: "none",
    charset: "utf8",
    define: { __DEV__: String(dev) },
    logLevel: "info",
};

if (!watch) rmSync(dist, { recursive: true, force: true });
copyAssets();

if (watch) {
    const ctx = await esbuild.context({
        ...options,
        plugins: [cssTextPlugin, { name: "copy-assets", setup: (build) => build.onEnd(() => copyAssets()) }],
    });
    await ctx.watch();
    console.log("👀 監看中…（Ctrl+C 結束）");
} else {
    const result = await esbuild.build({ ...options, metafile: true });
    const outputs = Object.entries(result.metafile.outputs).map(([file, info]) => `  ${file.replace(/\\/g, "/").replace(/^.*\/dist\//, "dist/")}  ${(info.bytes / 1024).toFixed(1)} KB`);
    console.log(`✅ 建置完成（v${pkg.version}，${dev ? "開發版" : "正式版"}）\n${outputs.join("\n")}`);
}
