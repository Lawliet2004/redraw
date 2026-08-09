/**
 * Windows-friendly arm64 release APK.
 * Needs: ANDROID_HOME, NDK (set NDK_HOME), JDK 17+, rust aarch64-linux-android target.
 * Avoids NDK linker crash on paths with spaces via CARGO_TARGET_DIR.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoTarget = process.env.CARGO_TARGET_DIR || "C:\\src\\redraw-target";
const ndkHome =
  process.env.NDK_HOME ||
  path.join(process.env.ANDROID_HOME || "C:\\src\\android-sdk", "ndk", "26.1.10909125");
const androidHome = process.env.ANDROID_HOME || "C:\\src\\android-sdk";

function run(cmd, args, env = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.env.ANDROID_HOME && !existsSync(androidHome)) {
  console.error("Set ANDROID_HOME to your Android SDK");
  process.exit(1);
}

run("npm", ["run", "build"]);

// Build Rust .so (may fail after compile on Windows symlink — that's ok)
const so = path.join(
  cargoTarget,
  "aarch64-linux-android",
  "release",
  "libtauri_app_lib.so",
);
if (!existsSync(so)) {
  const tauri = path.join(root, "node_modules", ".bin", "tauri");
  const r = spawnSync(
    tauri,
    ["android", "android-studio-script", "--release", "--target", "aarch64"],
    {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: cargoTarget,
        NDK_HOME: ndkHome,
        ANDROID_HOME: androidHome,
      },
    },
  );
  if (!existsSync(so)) {
    console.error("Rust lib missing after build:", so);
    process.exit(r.status ?? 1);
  }
}
const jniDir = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "jniLibs",
  "arm64-v8a",
);
const assets = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "assets",
);
const apkGlob = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "build",
  "outputs",
  "apk",
);

mkdirSync(jniDir, { recursive: true });
if (existsSync(so)) {
  copyFileSync(so, path.join(jniDir, "libtauri_app_lib.so"));
}

const dist = path.join(root, "dist");
if (existsSync(dist)) {
  rmSync(assets, { recursive: true, force: true });
  mkdirSync(assets, { recursive: true });
  cpSync(dist, assets, { recursive: true });
}

writeFileSync(
  path.join(root, "src-tauri", "gen", "android", "app", "tauri.properties"),
  "tauri.android.versionCode=1\ntauri.android.versionName=0.1.0\n",
);

const gradlew = path.join(root, "src-tauri", "gen", "android", "gradlew.bat");
run(
  gradlew,
  [
    "-p",
    path.join(root, "src-tauri", "gen", "android"),
    ":app:assembleArm64Release",
    "-PabiList=arm64-v8a",
    "-PtargetList=aarch64",
  ],
  {
    REDRAW_SKIP_RUST: "1",
    CARGO_TARGET_DIR: cargoTarget,
    NDK_HOME: ndkHome,
    ANDROID_HOME: androidHome,
  },
);

console.log("\nAPK under:", apkGlob);
