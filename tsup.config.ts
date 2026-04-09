import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    server: "src/bin/server.ts",
    "worker/main": "src/bin/worker.ts",
  },
  format: ["esm"],
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "node22",
  outDir: "dist",
});
