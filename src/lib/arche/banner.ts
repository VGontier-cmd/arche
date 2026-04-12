import { readFileSync } from "node:fs";
import { join } from "node:path";

import { archePackageRootDir } from "../cli-helpers";

const ARCHE_BANNER = [
  " ______     ______     ______     __  __     ______    ",
  "/\\  __ \\   /\\  == \\   /\\  ___\\   /\\ \\_\\ \\   /\\  ___\\   ",
  "\\ \\  __ \\  \\ \\  __<   \\ \\ \\____  \\ \\  __ \\  \\ \\  __\\   ",
  " \\ \\_\\ \\_\\  \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\_\\ \\_\\  \\ \\_____\\ ",
  "  \\/_/\\/_/   \\/_/ /_/   \\/_____/   \\/_/\\/_/   \\/_____/ ",
].join("\n");

// ANSI color codes
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

let bannerPrinted = false;
let cachedVersion: string | null = null;

function getVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkgPath = join(archePackageRootDir(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    cachedVersion = pkg.version ?? "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion!;
}

export function renderArcheBanner() {
  return ARCHE_BANNER;
}

export function printArcheBanner(stream: NodeJS.WritableStream = process.stderr) {
  if (bannerPrinted || !isInteractiveStream(stream)) {
    return;
  }

  const version = getVersion();
  const info = [
    `${CYAN}${ARCHE_BANNER}${RESET}`,
    `${DIM}  ${BOLD}Arche${RESET}${DIM} v${version} — Self-hosted AI dev agent orchestrator${RESET}`,
    `${DIM}  node ${process.version} | ${process.platform} ${process.arch}${RESET}`,
    "",
  ].join("\n");

  stream.write(info + "\n");
  bannerPrinted = true;
}

function isInteractiveStream(stream: NodeJS.WritableStream) {
  return "isTTY" in stream && Boolean((stream as NodeJS.WriteStream).isTTY);
}
