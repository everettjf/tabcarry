import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("releases", { recursive: true });
rmSync(`releases/TabCarry-${version}.zip`, { force: true });
const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
if (manifest.version !== version)
  throw Error("Manifest/package version mismatch");
execFileSync("zip", ["-qr", `../releases/TabCarry-${version}.zip`, "."], {
  cwd: "dist",
});
execFileSync("unzip", ["-t", `releases/TabCarry-${version}.zip`], {
  stdio: "inherit",
});
