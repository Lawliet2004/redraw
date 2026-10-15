import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
let responseGate = null;
let requestArrived = null;
let subscriptionCalls = 0;
page.on("pageerror", (e) => errors.push(e.message));
const dbMock = `
const empty=()=>({elements:[],appState:{},files:{}});
const state=window.__redrawSmokeDb ||= JSON.parse(sessionStorage.getItem('redraw-smoke')||'null') || {pages:[{id:'one',name:'Product flow',position:1},{id:'two',name:'Ideas',position:2},{id:'three',name:'Notes',position:3}],scenes:{},meta:{}};
const persist=()=>sessionStorage.setItem('redraw-smoke',JSON.stringify(state));
export const getMeta=async k=>state.meta[k]||null;
export const setMeta=async(k,v)=>{state.meta[k]=v;persist()};
export const listPages=async()=>[...state.pages];
export const getPageScene=async id=>state.scenes[id]||JSON.stringify(empty());
export const updatePageScene=async(id,payload)=>{state.scenes[id]=payload;persist()};
export const parseScene=raw=>JSON.parse(raw);
export const bootstrapPages=async()=>({pages:state.pages,theme:state.meta.theme||'light',activeId:state.meta.last_active_page_id||'one',activeScene:await getPageScene(state.meta.last_active_page_id||'one')});
export const createPage=async name=>{const p={id:crypto.randomUUID(),name,position:state.pages.length+1};state.pages=[...state.pages,p];persist();return p};
export const renamePage=async(id,name)=>{state.pages=state.pages.map(p=>p.id===id?{...p,name}:p);persist()};
export const reorderPages=async ids=>{state.pages=ids.map(id=>state.pages.find(p=>p.id===id));persist()};
export const deletePage=async id=>{state.pages=state.pages.filter(p=>p.id!==id);persist()};
`;
await page.route("**/src/db.ts*", (route) =>
  route.fulfill({ contentType: "text/javascript", body: dbMock }),
);
await page.route("**/src/subscriptions.ts*", (route) =>
  route.fulfill({
    contentType: "text/javascript",
    body: `
import {getMeta,setMeta} from '/src/db.ts';
export const DEFAULT_SUBSCRIPTION={provider:'chatgpt',model:''};
export const loadSubscription=async()=>JSON.parse(await getMeta('subscription_config')||'null')||DEFAULT_SUBSCRIPTION;
export const saveSubscription=async c=>setMeta('subscription_config',JSON.stringify(c));
export const providerLabel=p=>p==='chatgpt'?'ChatGPT':p==='grok'?'Grok':'API key';
export const subscriptionStatus=async p=>({available:true,authenticated:true,message:p+' connected',models:[{id:'test',name:'Test model'}]});
export const subscriptionLogin=async()=>({message:'Sign in opened'});export const subscriptionLogout=async()=>{};
export const streamSubscription=async opts=>{const response=await fetch('/mock-subscription',{method:'POST',body:JSON.stringify(opts),signal:opts.signal});const text=await response.text();opts.onDelta(text);return text;};
`,
  }),
);
await page.route("**/mock-subscription", async (route) => {
  subscriptionCalls++;
  const req = route.request().postDataJSON();
  requestArrived?.();
  if (responseGate) await responseGate;
  const output = req.systemPrompt.includes("flat vector illustration")
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#eaf2ef"/><circle cx="150" cy="100" r="60" fill="#237554"/></svg>'
    : req.systemPrompt.includes("nodes")
      ? JSON.stringify({
          nodes: [
            { id: "a", label: "Start", shape: "ellipse" },
            { id: "b", label: "Review", shape: "rectangle" },
            { id: "c", label: "Done", shape: "ellipse" },
          ],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "c" },
          ],
        })
      : "New Delhi";
  await route.fulfill({ body: output });
});
await mkdir("artifacts", { recursive: true });
try {
  await page.goto("http://localhost:1422");
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  await page.getByRole("complementary", { name: "Sidebar" }).waitFor();
  await page.screenshot({ path: "artifacts/workspace-desktop.png" });
  await page.getByLabel("Actions for Product flow").click();
  await page.getByRole("button", { name: "Pin tab", exact: true }).click();
  await page.getByRole("button", { name: "Unpin tab", exact: true }).waitFor();
  await page.getByRole("button", { name: "Unpin tab", exact: true }).click();
  await page.getByRole("button", { name: "Move down", exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator(".page-select").first().getAttribute("title"),
    "Ideas",
  );
  await page.getByRole("button", { name: "Move up", exact: true }).click();
  await page.waitForTimeout(100);
  await page.getByLabel("Actions for Product flow").click();

  await page.getByLabel("Actions for Product flow").click();
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await page.getByText("Closed · click to reopen").waitFor();
  await page
    .getByRole("button", { name: "▤ Product flow Closed · click to reopen" })
    .click();
  await page.getByText("Current page").waitFor();
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  assert.equal(
    await page
      .locator(".app-rail")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    52,
  );
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide properties", exact: true })
    .first()
    .click();
  assert.equal(
    await page.getByRole("region", { name: "Properties", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.keyboard.press("Control+Shift+F");
  await page.getByRole("button", { name: "Exit focus" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("complementary", { name: "Sidebar" }).waitFor();
  await page.reload();
  await page.getByRole("complementary", { name: "Sidebar" }).waitFor();
  await page
    .getByRole("button", { name: "AI assistant", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "AI instruction" })
    .fill("Explain a simple workflow");
  await page.getByRole("button", { name: "Generate", exact: false }).click();
  await page.getByRole("button", { name: "Apply to canvas" }).waitFor();
  await page.screenshot({ path: "artifacts/ai-preview.png" });
  await page.getByRole("button", { name: "Apply to canvas" }).click();
  await page.getByText("Applied · undo on the canvas to restore").waitFor();
  await page.locator(".ai-options summary").click();
  await page.getByLabel("Response type").selectOption("diagram");
  await page
    .getByRole("textbox", { name: "AI instruction" })
    .fill("Make a three-step workflow");
  await page.getByRole("button", { name: "Generate", exact: false }).click();
  await page.getByRole("button", { name: "Apply to canvas" }).waitFor();
  await page.getByRole("button", { name: "Apply to canvas" }).click();
  await page.getByRole("button", { name: "Close AI assistant" }).click();
  await page.waitForTimeout(1200);
  const count = await page.evaluate(
    async () =>
      JSON.parse(
        await (await import("/src/db.ts")).getPageScene("one"),
      ).elements.filter((el) => !el.isDeleted).length,
  );
  assert.ok(count >= 9, "editable diagram and text inserted");
  await page.screenshot({ path: "artifacts/diagram-applied.png" });
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1200);
  const afterUndo = await page.evaluate(
    async () =>
      JSON.parse(
        await (await import("/src/db.ts")).getPageScene("one"),
      ).elements.filter((el) => !el.isDeleted).length,
  );
  assert.equal(afterUndo, 1, "one undo removes entire diagram");
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("Control+a");
  await page
    .getByRole("button", { name: "AI assistant", exact: true })
    .click();
  await page.locator(".ai-options summary").click();
  await page.getByLabel("Response type").selectOption("explain");
  let release;
  responseGate = new Promise((resolve) => {
    release = resolve;
  });
  const arrived = new Promise((resolve) => {
    requestArrived = resolve;
  });
  await page.getByRole("button", { name: "Generate", exact: false }).click();
  await arrived;
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("Delete");
  release();
  responseGate = null;
  requestArrived = null;
  await page.getByRole("button", { name: "Apply to canvas" }).waitFor();
  await page.getByRole("button", { name: "Apply to canvas" }).click();
  await page
    .getByText(
      "The selection changed while AI was working. Generate again to use the latest content.",
    )
    .waitFor();
  await page.getByRole("button", { name: "Close AI assistant" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page
    .getByRole("button", { name: "ChatGPT and Grok subscriptions" })
    .click();
  await page.getByText("chatgpt connected", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Grok · Build" }).click();
  await page.getByText("grok connected", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/ai-settings.png" });
  await page.getByRole("button", { name: "Close dialog" }).click();
  for (const width of [1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.screenshot({ path: "artifacts/workspace-" + width + ".png" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, "no document overflow at " + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("complementary", { name: "Sidebar" }).waitFor();
  await page.getByLabel("Actions for Notes").click();
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await page.getByText("Closed · click to reopen").waitFor();
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search pages and commands").fill("Notes");
  await page.keyboard.press("Enter");
  await page.getByText("Current page").waitFor();
  await page.evaluate(async () => {
    const db = await import("/src/db.ts");
    await db.setMeta(
      "preferences",
      JSON.stringify({
        ...JSON.parse(await db.getMeta("preferences")),
        appTheme: "dark",
      }),
    );
    const raw = JSON.parse(await db.getPageScene("one"));
    raw.appState.theme = "dark";
    await db.updatePageScene("one", JSON.stringify(raw));
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  await page.locator(".main-menu-trigger").waitFor();
  await page.getByRole("region", { name: "Properties", exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/workspace-dark.png" });
  const menu = page.locator(".main-menu-trigger");
  await menu.click();
  assert.equal(await page.getByText("GitHub", { exact: true }).count(), 0);
  assert.equal(
    await page.getByText("Discord chat", { exact: true }).count(),
    0,
  );
  await page.screenshot({ path: "artifacts/menu-clean.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page
    .getByRole("button", { name: "Paper #fff8e7", exact: true })
    .click();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  assert.ok(
    await page
      .locator(".paper-background")
      .evaluate((el) => getComputedStyle(el).backgroundImage.includes("svg")),
  );
  await page.screenshot({ path: "artifacts/paper-grid.png" });
  await page.waitForTimeout(1000);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".paper-background")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 248, 231)",
  );
  await page.evaluate(async () => {
    const { validateIllustration } = await import("/src/illustration.ts");
    for (const bad of [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://evil.example/a"/></svg>',
    ]) {
      let rejected = false;
      try {
        validateIllustration(bad);
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("Unsafe SVG accepted");
    }
    const db = await import("/src/db.ts");
    const { convertToExcalidrawElements } = await import(
      "/node_modules/.vite/deps/@excalidraw_excalidraw.js"
    );
    const elements = convertToExcalidrawElements([
      {
        id: "math-source",
        type: "text",
        x: 300,
        y: 200,
        text: "2 + 3 =",
        fontSize: 24,
      },
    ]);
    await db.setMeta("last_active_page_id", "one");
    await db.setMeta(
      "preferences",
      JSON.stringify({
        ...JSON.parse(await db.getMeta("preferences")),
        aiMode: "assist",
      }),
    );
    await db.updatePageScene(
      "one",
      JSON.stringify({
        elements,
        appState: { selectedElementIds: { "math-source": true } },
        files: {},
        paper: { color: "#fff8e7", pattern: "grid", spacing: 24 },
      }),
    );
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("button", { name: "Assist", exact: true }).click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  const callsBeforeMath = subscriptionCalls;
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("Control+a");
  const inline = page.getByRole("complementary", {
    name: "Inline AI suggestion",
  });
  await inline.getByText("5", { exact: true }).waitFor();
  assert.equal(
    subscriptionCalls,
    callsBeforeMath,
    "arithmetic must not call subscription",
  );
  await page.screenshot({ path: "artifacts/inline-math.png" });
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(1100);
  const readScene = () =>
    page.evaluate(async () =>
      JSON.parse(await (await import("/src/db.ts")).getPageScene("one")),
    );
  assert.equal(
    (await readScene()).elements.filter(
      (el) => !el.isDeleted && el.type === "text",
    ).length,
    2,
  );
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1100);
  assert.equal(
    (await readScene()).elements.filter(
      (el) => !el.isDeleted && el.type === "text",
    ).length,
    1,
    "inline answer undone in one step",
  );
  await page.keyboard.press("Escape");
  await page.locator(".main-menu-trigger").click();
  await page.getByText("Export image…", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs("artifacts/export-paper.png");
  await page
    .getByRole("button", { name: "Export PNG", exact: true })
    .waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "AI assistant", exact: true })
    .click();
  await page.locator(".ai-options summary").click();
  await page.getByLabel("Response type").selectOption("image");
  await page
    .getByLabel("AI instruction")
    .fill("Create a green circle illustration");
  await page.getByRole("button", { name: "Generate", exact: false }).click();
  await page.getByAltText("Generated illustration preview").waitFor();
  await page.getByRole("button", { name: "Apply to canvas" }).click();
  await page.waitForTimeout(1100);
  assert.equal(
    (await readScene()).elements.filter(
      (el) => !el.isDeleted && el.type === "image",
    ).length,
    1,
  );
  await page.screenshot({ path: "artifacts/illustration-applied.png" });

  await page.getByRole("button", { name: "Close AI assistant" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("button", { name: "Auto-answer", exact: true }).click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search pages and commands").fill("New page");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("t");
  await page.mouse.click(700, 350);
  await page.keyboard.type("7 + 8 =");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1800);
  const autoTexts = await page.evaluate(async () => {
    const db = await import("/src/db.ts");
    return JSON.parse(
      await db.getPageScene(await db.getMeta("last_active_page_id")),
    )
      .elements.filter((el) => !el.isDeleted && el.type === "text")
      .map((el) => el.text);
  });
  assert.deepEqual(
    autoTexts,
    ["7 + 8 =", "15"],
    "auto-answer responds to newly typed math",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Workspace smoke passed: tabs/pins/reordering, quick search, themes/paper/export, local inline math and auto-answer, AI preview/stale guard/undo, safe illustration, subscription UI, responsive sizes.",
  );
} finally {
  await page.screenshot({ path: "artifacts/last-state.png" }).catch(() => {});
  if (errors.length) console.log("Browser errors:", errors);
  await browser.close();
}
