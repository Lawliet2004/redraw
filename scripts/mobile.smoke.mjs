/**
 * Mobile parity smoke (browser stand-in for the Android WebView):
 *   phone viewport + Android UA → Insert image… adds an image element →
 *   Export image… downloads a PNG → AI with API key streams an answer.
 *
 * Reuses the :1420 dev server. playwright-core with system Chrome.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const OUT = "/tmp/mobile-shots";
const API_KEY = "sk-mobile-smoke";
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const dbMock = `
const empty=()=>({elements:[],appState:{},files:{}});
const state=window.__redrawSmokeDb ||= JSON.parse(sessionStorage.getItem('redraw-smoke')||'null') || {pages:[{id:'one',name:'Ink page',position:1}],scenes:{},meta:{}};
const persist=()=>sessionStorage.setItem('redraw-smoke',JSON.stringify(state));
export const getMeta=async k=>state.meta[k]||null;
export const setMeta=async(k,v)=>{state.meta[k]=v;persist()};
export const listPages=async()=>[...state.pages];
export const getPageScene=async id=>state.scenes[id]||JSON.stringify(empty());
export const updatePageScene=async(id,payload)=>{state.scenes[id]=payload;persist()};
export const parseScene=raw=>JSON.parse(raw);
export const bootstrapPages=async()=>({pages:state.pages,theme:state.meta.theme||'light',activeId:'one',activeScene:await getPageScene('one')});
export const createPage=async name=>{const p={id:crypto.randomUUID(),name,position:state.pages.length+1};state.pages=[...state.pages,p];persist();return p};
export const renamePage=async()=>{};
export const reorderPages=async()=>{};
export const deletePage=async()=>{};
`;

const up = await fetch("http://localhost:1420/")
  .then((r) => r.ok)
  .catch(() => false);
assert.ok(up, "dev server must be running on :1420");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const readDb = () =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("redraw-smoke") || "{}"));
const readScene = async () =>
  page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem("redraw-smoke") || "{}");
    return JSON.parse(db.scenes?.one || "{}");
  });
const openMenuItem = async (label) => {
  await page.locator(".main-menu-trigger").evaluate((el) => el.click());
  const item = page.locator(".dropdown-menu-item", { hasText: label });
  await item.waitFor({ timeout: 10000 });
  await item.evaluate((el) => el.click());
};

// AI calls go to OpenAI; answer with a canned SSE stream.
let authHeader = "";
await page.route("https://api.openai.com/**", async (route) => {
  const req = route.request();
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method() === "OPTIONS")
    return route.fulfill({ status: 204, headers: cors, body: "" });
  authHeader = req.headers()["authorization"] || "";
  await route.fulfill({
    status: 200,
    headers: { ...cors, "Content-Type": "text/event-stream" },
    body:
      'data: {"choices":[{"delta":{"content":"Paris"}}]}\n\ndata: [DONE]\n\n',
  });
});

try {
  await page.route("**/src/db.ts*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: dbMock }),
  );
  await page.goto("http://localhost:1420/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".excalidraw", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-home.png` });

  // (a) Insert image… → file chooser → one image element + file
  const pngBuffer = Buffer.from(PNG_1X1, "base64");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    openMenuItem("Insert image"),
  ]);
  await chooser.setFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await page.waitForFunction(
    () => {
      const db = JSON.parse(sessionStorage.getItem("redraw-smoke") || "{}");
      const s = JSON.parse(db.scenes?.one || "{}");
      return (
        (s.elements || []).filter((e) => e.type === "image" && !e.isDeleted)
          .length === 1 && Object.keys(s.files || {}).length === 1
      );
    },
    null,
    { timeout: 15000 },
  );
  const scene = await readScene();
  const images = scene.elements.filter((e) => e.type === "image" && !e.isDeleted);
  assert.equal(images.length, 1, "expected one image element");
  assert.equal(Object.keys(scene.files).length, 1, "expected one file");
  console.log("insert image: ok", JSON.stringify({ w: images[0].width, h: images[0].height }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-image-inserted.png` });

  // (b) Export image… → PNG download
  await openMenuItem("Export image");
  await page.waitForSelector(".dialog-actions button:has-text('Export PNG')", {
    timeout: 10000,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click("button:has-text('Export PNG')"),
  ]);
  const exportPath = `${OUT}/export.png`;
  await download.saveAs(exportPath);
  assert.match(download.suggestedFilename(), /\.png$/, "download is a PNG");
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(exportPath);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", "PNG signature");
  console.log("export: ok", download.suggestedFilename(), bytes.length, "bytes");

  // (c) AI via API key: configure in Settings → AI connection, then ask
  await page.waitForSelector(".rail-open", { timeout: 10000 });
  await page.click(".rail-open");
  await page.click('.app-rail button:has-text("Settings")');
  await page.waitForSelector(".settings-dialog", { timeout: 10000 });
  await page.click('.settings-tabs button:text-is("AI")');
  await page.click('button:has-text("ChatGPT and Grok subscriptions")');
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/03-ai-settings.png` });
  await page.fill('input[type="password"]', API_KEY);
  await page.click('button:has-text("Save API key")');
  await page.waitForSelector('input[type="password"]', {
    state: "detached",
    timeout: 10000,
  });
  const saved = JSON.parse((await readDb()).meta?.llm_config || "{}");
  assert.equal(saved.apiKey, API_KEY, "API key persisted without protected store");
  console.log("api key persisted in llm_config: ok");

  // close settings dialog, reopen the rail, launch AI
  await page.keyboard.press("Escape");
  await page.waitForSelector(".rail-open", { timeout: 10000 });
  await page.click(".rail-open");
  await page.click('.app-rail button:has-text("AI assistant")');
  await page.waitForSelector(".ai-panel textarea", { timeout: 10000 });
  await page.fill(".ai-panel textarea", "capital of France");
  await page.click('.ai-panel button:has-text("Generate")');
  await page.waitForSelector('.ai-panel :text("Paris")', { timeout: 20000 });
  assert.equal(authHeader, `Bearer ${API_KEY}`, "AI request carries the API key");
  await page.screenshot({ path: `${OUT}/04-ai-answer.png` });
  console.log("ai answer: ok (Paris)");
} finally {
  await page.screenshot({ path: `${OUT}/last-state.png` }).catch(() => {});
  await writeFile(`${OUT}/console.log`, errors.join("\n") + "\n");
  await browser.close();
  console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page/console errors");
}
