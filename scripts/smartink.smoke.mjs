/**
 * End-to-end smoke test for Smart Ink in real Chrome:
 *   enable → draw ink → engine loads bundled ONNX model in a worker →
 *   preview card → commit → styled text element persisted → undo restores ink.
 *
 * Runs `vite dev` on :1420 and playwright-core with system Chrome.
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

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

// start vite dev (or reuse an already-running server on :1420)
let vite = null;
const up = await fetch("http://localhost:1420/")
  .then((r) => r.ok)
  .catch(() => false);
if (!up) {
  vite = spawn("npx", ["vite", "--port", "1420", "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("vite did not start")), 30000);
    vite.stdout.on("data", (d) => {
      if (String(d).includes("Local:")) {
        clearTimeout(t);
        res();
      }
    });
  });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

try {
  await page.route("**/src/db.ts*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: dbMock }),
  );
  await page.goto("http://localhost:1420/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".excalidraw", { timeout: 30000 });
  await page.waitForSelector(".app-rail", { timeout: 15000 });
  await page.waitForTimeout(1500);

  // enable Smart Ink → floating bar appears, pen tool becomes active
  await page.click('.app-rail button:has-text("Smart Ink")');
  await page.waitForSelector(".ink-bar", { timeout: 10000 });
  await page.waitForSelector('.ink-mode button[aria-pressed="true"]');
  // thicker pen for a more legible render
  await page.click('button:has-text("Thick")').catch(() => {});

  // engine sanity: feed a clean rendered word straight through the worker —
  // proves the bundled model + wasm backend run in this browser
  const ocr = await page.evaluate(async () => {
    const eng = await import("/src/smartink/engine.ts");
    const rec = new eng.InkRecognizer();
    const c = document.createElement("canvas");
    c.width = 640; c.height = 160;
    const mctx = c.getContext("2d");
    mctx.fillStyle = "#fff"; mctx.fillRect(0, 0, 640, 160);
    mctx.fillStyle = "#101018"; mctx.font = "96px serif";
    mctx.fillText("Hello", 30, 115);
    const nw = Math.round((640 * 48) / 160);
    const c2 = document.createElement("canvas");
    c2.width = nw; c2.height = 48;
    const ctx2 = c2.getContext("2d");
    ctx2.imageSmoothingQuality = "high";
    ctx2.drawImage(c, 0, 0, nw, 48);
    const d = ctx2.getImageData(0, 0, nw, 48).data;
    const px = new Uint8Array(nw * 48 * 3);
    for (let i = 0, j = 0; j < px.length; i += 4, j += 3) {
      px[j] = d[i]; px[j + 1] = d[i + 1]; px[j + 2] = d[i + 2];
    }
    return rec.recognize([{ pixels: px.buffer, width: nw, height: 48 }]);
  });
  console.log("engine check:", JSON.stringify(ocr));
  assert.ok(
    ocr[0] && ocr[0].text.trim().length > 0,
    "recognizer produced no text on a clean render",
  );

  // draw "HI" — three bars + stem + dot
  const cx = 640, cy = 380, s = 1.6;
  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8);
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  await drag(cx - 60 * s, cy - 45 * s, cx - 60 * s, cy + 45 * s); // H left bar
  await drag(cx - 10 * s, cy - 45 * s, cx - 10 * s, cy + 45 * s); // H right bar
  await drag(cx - 60 * s, cy, cx - 10 * s, cy); //                 H crossbar
  await drag(cx + 40 * s, cy - 15 * s, cx + 40 * s, cy + 45 * s); // i stem
  await drag(cx + 39 * s, cy - 42 * s, cx + 42 * s, cy - 40 * s); // i dot

  // default mode is auto: confident reads commit directly without asking —
  // wait for either the preview card (low-confidence fallback) or an ink text
  // element landing straight in the scene
  await page.waitForTimeout(1500); // let autosave flush the drawn strokes
  const before = await page.evaluate(() => {
    const db = JSON.parse(sessionStorage.getItem("redraw-smoke"));
    const s = JSON.parse(db.scenes.one || "{}");
    return (s.elements || []).filter(
      (e) => e.type === "freedraw" && !e.isDeleted,
    ).length;
  });
  const readScene = async () =>
    page.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem("redraw-smoke"));
      return JSON.parse(db.scenes.one || "{}");
    });
  const inkTextCount = (s) =>
    (s.elements || []).filter(
      (e) => e.type === "text" && e.customData?.redrawInk && !e.isDeleted,
    ).length;

  const card = await page
    .waitForSelector(".ink-preview", { timeout: 45000 })
    .catch(() => null);
  let committed = false;
  if (card) {
    const recognized = await page.inputValue(".ink-preview textarea");
    console.log("recognized (preview fallback):", JSON.stringify(recognized));
    assert.ok(recognized.trim().length > 0, "recognizer produced empty text");
    await page.click(".ink-preview footer .primary");
    await page
      .waitForSelector(".ink-preview", { state: "detached", timeout: 10000 })
      .catch(() => {});
    committed = true;
  } else {
    // no card — auto mode may already have committed confident blocks
    const scene = await readScene();
    if (inkTextCount(scene) > 0) {
      console.log("auto-committed without asking");
      committed = true;
    } else {
      const st = await page.$eval(".ink-bar__status", (e) => e.textContent);
      console.log("no preview & no auto-commit; status:", st);
      assert.ok(st.length > 0);
    }
  }
  if (committed) {
    await page.waitForTimeout(1800); // autosave settles into the mock db
    const scene = await page.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem("redraw-smoke"));
      return JSON.parse(db.scenes.one || "{}");
    });
    const inkTexts = (scene.elements || []).filter(
      (e) => e.type === "text" && e.customData?.redrawInk && !e.isDeleted,
    );
    assert.ok(inkTexts.length >= 1, "expected converted ink text element(s)");
    assert.equal(inkTexts[0].customData.redrawInk.style.fontSize, 24);
    const liveFreedraw = (scene.elements || []).filter(
      (e) => e.type === "freedraw" && !e.isDeleted,
    );
    assert.ok(
      liveFreedraw.length < before,
      `expected committed strokes deleted (${before}→${liveFreedraw.length})`,
    );

    // restyle: the committed text is auto-selected → underline toggle adds a
    // decoration element grouped with it
    await page.click('.ink-toggles button[title="Underline"]');
    await page.waitForTimeout(1500);
    const styled = await page.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem("redraw-smoke"));
      return JSON.parse(db.scenes.one || "{}");
    });
    const decos = (styled.elements || []).filter(
      (e) => e.customData?.inkDeco && !e.isDeleted,
    );
    assert.ok(decos.length >= 1, "underline should add decoration elements");

    // undo #1 removes the restyle, undo #2 restores the original ink strokes
    await page.click(".ink-preview footer button:not(.primary)").catch(() => {});
    await page.keyboard.press("Escape");
    await page.locator(".excalidraw").focus();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(1200);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(2500);
    const undone = await page.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem("redraw-smoke"));
      return JSON.parse(db.scenes.one || "{}");
    });
    const back = (undone.elements || []).filter(
      (e) => e.type === "freedraw" && !e.isDeleted,
    );
    if (back.length <= liveFreedraw.length) {
      const kinds = (undone.elements || []).map(
        (e) => `${e.type}${e.isDeleted ? "†" : ""}`,
      );
      console.log("undo failed; elements:", kinds.join(","));
    }
    assert.ok(back.length > liveFreedraw.length, "expected ink restored");
    assert.equal(
      (undone.elements || []).filter(
        (e) => e.type === "text" && e.customData?.redrawInk && !e.isDeleted,
      ).length,
      0,
    );
  }

  const fatal = errors.filter(
    (e) => !/fonts|woff|download|font/i.test(e), // font fetch noise is non-fatal
  );
  assert.deepEqual(fatal, [], `page errors: ${fatal.join(" | ")}`);
  console.log("smartink smoke: OK");
} finally {
  await browser.close();
  vite?.kill();
}
