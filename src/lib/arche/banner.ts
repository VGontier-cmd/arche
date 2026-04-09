const ARCHE_BANNER = [
  " ______     ______     ______     __  __     ______    ",
  "/\\  __ \\   /\\  == \\   /\\  ___\\   /\\ \\_\\ \\   /\\  ___\\   ",
  "\\ \\  __ \\  \\ \\  __<   \\ \\ \\____  \\ \\  __ \\  \\ \\  __\\   ",
  " \\ \\_\\ \\_\\  \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\_\\ \\_\\  \\ \\_____\\ ",
  "  \\/_/\\/_/   \\/_/ /_/   \\/_____/   \\/_/\\/_/   \\/_____/ ",
].join("\n");

let bannerPrinted = false;

export function renderArcheBanner() {
  return ARCHE_BANNER;
}

export function printArcheBanner(stream: NodeJS.WritableStream = process.stderr) {
  if (bannerPrinted || !isInteractiveStream(stream)) {
    return;
  }

  stream.write(`${ARCHE_BANNER}\n`);
  bannerPrinted = true;
}

function isInteractiveStream(stream: NodeJS.WritableStream) {
  return "isTTY" in stream && Boolean((stream as NodeJS.WriteStream).isTTY);
}
