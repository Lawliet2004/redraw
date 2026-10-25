# Redraw

Local infinite-canvas whiteboard (Tauri v2 + React + Excalidraw).

**Desktop** (Windows / macOS / Linux) and **Android** (phones & tablets). iOS build needs a Mac.

## Download

Get installers and the Android APK from **[GitHub Releases](https://github.com/Lawliet2004/redraw/releases)**.

| Platform | What to grab |
|----------|----------------|
| **Android** (7+, arm64) | `Redraw-android-arm64.apk` or `Redraw-*-arm64-debugsigned.apk` |
| Windows | `.exe` setup (NSIS) |
| Linux | `.AppImage` or `.deb` |
| macOS | `.dmg` |
| iOS | Build on a Mac (see below) — no public IPA without Apple signing |

### Android install (phone / tablet)

1. Open the release page on your phone and download the APK  
2. Allow **Install unknown apps** for your browser/Files app  
3. Tap the APK → Install → Open  

USB from a PC: `adb install -r Redraw-android-arm64.apk`

## Develop

```bash
npm install
npm run tauri dev
```

## Desktop installer

```bash
npm run dist
```

Packages: `src-tauri/target/release/bundle/`

## Mobile

Touch UI: no window chrome, safe-area insets, large tabs, long-press tab to rename. Auto-saves when backgrounded.

### Android

Needs JDK 17+, Android SDK (`ANDROID_HOME`), NDK 26+, Rust `aarch64-linux-android`.

```bash
npm install
rustup target add aarch64-linux-android
npm run android:init   # once (already in repo under src-tauri/gen/android)
npm run android:apk    # arm64 release APK
npm run android:dev    # device / emulator
```

APK path: `src-tauri/gen/android/app/build/outputs/apk/arm64/release/`

Windows: paths with spaces break the NDK linker — `android:apk` uses `CARGO_TARGET_DIR=C:\src\redraw-target`. Prefer NDK 26 via `NDK_HOME`. minSdk 24.

### iOS (macOS only)

Needs Xcode, CocoaPods, Apple Developer signing for device/TestFlight.

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run ios:init
npm run ios:dev
npm run ios:build
```

## Releases (maintainers)

Push a version tag to build desktop + Android and attach files to the GitHub Release:

```bash
git tag v0.1.8
git push origin v0.1.8
```

Workflow: `.github/workflows/release.yml`

## Notes

- Data: app local data dir → `canvas.db` (Android: app sandbox)
- Offline fonts under `public/fonts`
- App size is mostly `@excalidraw/excalidraw`

## Workspace and AI

- **Settings → Workspace** selects horizontal or vertical tabs, density, system/light/dark theme, and graphite/indigo/forest accents. Vertical tabs support pinning, drag reordering, keyboard-accessible move actions, and a collapsible rail. **Ctrl+K** searches pages and commands. Closing a tab keeps its page.
- **Settings → Canvas** controls each page’s paper color, plain/dots/grid/ruled pattern, and spacing. Optionally use that paper for new pages. UI theme does not invert drawing colors. **Export image…** exports PNG/SVG with the paper or transparency. Native Excalidraw scene export remains available for compatibility; custom paper metadata is stored in Redraw’s database and is not included in that native file format.
- **Ctrl+Shift+P** toggles compact properties; **Ctrl+Shift+F** enters focus mode; **Escape** restores the workspace. Stroke presets are 0.5 / 1 / 2 with a numeric override. Advanced properties retain Excalidraw controls.
- **Ctrl+Enter** opens a general AI prompt. Ask questions, solve problems, explain/rewrite content, create editable diagrams, or create flat illustrations. Illustrations are validated static SVG rendered to PNG; this does not provide photorealistic image-model access. Responses preview before one undoable **Apply to canvas** operation. Source changes invalidate pending results.
- **Smart Ink** converts handwriting to editable styled text entirely on-device — enable it with the **Ink** button beside the canvas tools (it also activates the pen). Write with mouse, trackpad, stylus or touch; after a pause the recognized text converts **directly in place** — no prompt. Blocks below the confidence threshold still surface an editable preview card rather than committing guesses. **Preview** mode always asks first; **Manual** converts the current selection via the toolbar button or **Ctrl+Shift+T**. Font family (including bundled handwriting faces), size, bold/italic/underline/strikethrough, color, highlight, alignment, line height and letter spacing apply on conversion and restyle selected ink text afterwards; **⋯ → Save style** stores presets. Conversion is a single undoable step — undo restores the original strokes. Recognition uses a bundled ~8 MB PaddleOCR PP-OCRv5 ONNX model in a web worker (verified SHA-256, cached after first use); nothing is uploaded and no subscription is involved. Settings live under **Settings → Ink**.
- **Settings → AI** offers Off, Assist, and Auto-answer. Inline suggestions use selected text/handwriting/images after a 650 ms pause. **Tab** accepts, **Escape** dismisses. Auto-answer inserts directly; undo removes it. Ordinary arithmetic runs locally using a bounded parser without executable evaluation. Other requests use your subscription. To watch a defined area, select a rectangle/frame and choose **Use selection as AI area** in the assistant; content inside it becomes the inline context. Clear the area from the same control.
- Subscription connections are **ChatGPT through Codex App Server** and **Grok through Grok Build ACP** only. Install the official CLI, restart Redraw, open **Settings → AI → ChatGPT and Grok subscriptions**, and choose **Connect in browser**. Refresh status after completing sign-in. Redraw uses separate provider-owned account directories; it never reads tokens or falls back to API keys. Existing legacy API settings are no longer used.
- Subscription access requires the account’s relevant entitlement and available usage. ChatGPT accepts image selections. The installed Grok ACP reports no image-input capability and displays an actionable error for images. Model lists and account status come from the official clients; Grok does not currently expose equivalent usage reporting.
- Generation streams from isolated, cancellable official CLI processes with tools disabled, a 120-second overall timeout, and a 45-second response idle timeout. Stop, source changes in inline mode, panel closure, and page switches cancel pending work. Windows process jobs also terminate child helpers. Provider startup, network latency, and model speed remain variable.
- Connections require desktop CLI availability. Local arithmetic remains usable without a subscription. Live authenticated inference must be verified after the user signs in; automated tests do not spend subscription usage.

Official protocol references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Grok Build](https://docs.x.ai/build/overview).

### Verification

```bash
npm test
npm run build
npm run test:rust
```

The UI smoke test uses an isolated browser session with a fake database module and deterministic AI responses. It does not touch the real canvas database or call a paid provider. Start `npm run dev -- --port 1422`, install Playwright for the test environment (or set `PLAYWRIGHT_PATH` to its installed module), and run `npm run test:ui`. It uses headless Microsoft Edge and saves screenshots in `artifacts/`.

Smart Ink ships two focused suites: `node scripts/smartink.test.mjs` (pure-module unit tests via esbuild transpilation) and `node scripts/smartink.smoke.mjs` (end-to-end in real Chrome against the dev server on port 1420 — engine init, drawn-stroke recognition, preview, commit, persistence and undo).
