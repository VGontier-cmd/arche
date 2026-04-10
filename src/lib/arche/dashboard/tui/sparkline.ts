const BLOCKS = "▁▂▃▄▅▆▇█";

/**
 * Single-row block-element sparkline (terminal-friendly).
 * Maps the last `width` samples into height blocks.
 */
export function blockSparkline(values: number[], width: number): string {
  if (width <= 0) {
    return "";
  }
  if (values.length === 0) {
    return "·".repeat(width);
  }
  if (values.length === 1) {
    const v = values[0] ?? 0;
    const ch = v === 0 ? "·" : "▄";
    return ch.repeat(width);
  }
  const slice = values.slice(-width);
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const span = max - min || 1;
  return slice
    .map((v) => {
      const t = (v - min) / span;
      const idx = Math.min(7, Math.floor(t * 8));
      return BLOCKS[idx] ?? "▁";
    })
    .join("");
}

/**
 * Two-row sparkline; avoids duplicate rows of ▁ (looks like underscores) when variance is tiny.
 */
export function dualRowSparkline(values: number[], width: number): [string, string] {
  if (values.length < 2) {
    const row = blockSparkline(values, width);
    return [row, "·".repeat(width)];
  }
  const smoothed = values.map((v, i, arr) =>
    i === 0 ? v : (v + arr[i - 1]!) / 2,
  );
  const top = blockSparkline(smoothed, width);
  const bottom = blockSparkline(values, width);
  if (top === bottom && /^▁+$/.test(top)) {
    return ["·".repeat(width), bottom];
  }
  return [top, bottom];
}
