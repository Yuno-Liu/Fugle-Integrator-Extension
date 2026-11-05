/**
 * 測試資料載入。
 * tests/fixtures 內的 JSON 皆擷取自真實 API 回應（2026-11-05，已裁剪），
 * 檔名含 .synthetic 者為依官方欄位格式自行建構的樣本（來源受 Cloudflare 保護無法擷取）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "tests", "fixtures");

export function fixtureText(name: string): string {
    return readFileSync(join(DIR, name), "utf8");
}

export function fixture<T = unknown>(name: string): T {
    return JSON.parse(fixtureText(name)) as T;
}

/** 建立 JSON 回應 */
export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(typeof data === "string" ? data : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}
