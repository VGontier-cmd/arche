import { afterEach, describe, expect, it, vi } from "vitest";

import { printArcheBanner, renderArcheBanner } from "../src/lib/arche/banner";

describe("arche banner", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("renders the banner text without ANSI codes", () => {
    expect(renderArcheBanner()).toContain("/_/   \\_\\");
    expect(renderArcheBanner()).toContain("|_| |_| ");
  });

  it("prints a colorful banner on tty streams", () => {
    let output = "";
    const stream = {
      isTTY: true,
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    printArcheBanner(stream);

    expect(output).toContain("\u001B[");
    expect(output).toContain("Arche");
    expect(output).toContain("Self-hosted AI dev agent orchestrator");
  });
});
