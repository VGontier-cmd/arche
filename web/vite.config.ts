import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/dashboard/",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:8787",
      "/health": "http://localhost:8787",
      "/ready": "http://localhost:8787",
    },
  },
});
