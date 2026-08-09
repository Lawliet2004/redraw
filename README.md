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
git tag v0.1.1
git push origin v0.1.1
```

Workflow: `.github/workflows/release.yml`

## Notes

- Data: app local data dir → `canvas.db` (Android: app sandbox)
- Offline fonts under `public/fonts`
- App size is mostly `@excalidraw/excalidraw`
