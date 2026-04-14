import { readFileSync } from "node:fs";
import { join } from "node:path";

import { archePackageRootDir } from "../cli-helpers";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const COLORS = {
  purple: "\x1b[35m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const;

const ARCHE_BANNER_LINES = [
  "      _                 _      ",
  "     / \   _ __  _ __  | |__   ",
  "    / _ \ | '_ \| '_ \ | '_ \  ",
  "   / ___ \| | | | | | || | | | ",
  "  /_/   \_\\_| |_|_| |_||_| |_| ",
].join("\n");

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

function colorizeBanner(text: string) {
  const letters = [COLORS.purple, COLORS.blue, COLORS.cyan, COLORS.green, COLORS.yellow];
  const letterColors = new Map<string, string>([
    ["A", COLORS.purple],
    ["r", COLORS.blue],
    ["c", COLORS.cyan],
    ["h", COLORS.green],
    ["e", COLORS.yellow],
  ]);

  return text
    .split("")
    .map((char) => {
      if (char === "\n") return char;
      if (char === " ") return char;
      return `${letterColors.get(char) ?? letters[char.charCodeAt(0) % letters.length]}${char}${RESET}`;
    })
    .join("");
}

export function renderArcheBanner() {
  return ARCHE_BANNER_LINES;
}

export function printArcheBanner(stream: NodeJS.WritableStream = process.stderr) {
  if (bannerPrinted || !isInteractiveStream(stream)) {
    return;
  }

  const version = getVersion();
  const info = [
    `${colorizeBanner(ARCHE_BANNER_LINES)}`,
    `${BOLD}${COLORS.cyan}Arche${RESET} ${COLORS.yellow}v${version}${RESET} ${COLORS.purple}—${RESET} Self-hosted AI dev agent orchestrator`,
    `${COLORS.blue}node${RESET} ${process.version} ${COLORS.purple}|${RESET} ${process.platform} ${process.arch}`,
    "",
  ].join("\n");

  stream.write(info + "\n");
  bannerPrinted = true;
}

function isInteractiveStream(stream: NodeJS.WritableStream) {
  return "isTTY" in stream && Boolean((stream as NodeJS.WriteStream).isTTY);
}
