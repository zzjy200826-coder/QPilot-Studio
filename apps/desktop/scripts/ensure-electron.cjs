const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const electronPackageJson = require.resolve("electron/package.json");
const electronRoot = path.dirname(electronPackageJson);
const installScript = path.join(electronRoot, "install.js");

const electronBinary =
  process.platform === "win32"
    ? path.join(electronRoot, "dist", "electron.exe")
    : process.platform === "darwin"
      ? path.join(electronRoot, "dist", "Electron.app")
      : path.join(electronRoot, "dist", "electron");

if (fs.existsSync(electronBinary)) {
  process.exit(0);
}

console.log("[desktop] Electron binary not found. Downloading it now...");
const result = spawnSync(process.execPath, [installScript], {
  cwd: electronRoot,
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
