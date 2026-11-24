import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./desktop/renderer", import.meta.url)),
  base: "./",
  build: { outDir: "../../dist-desktop", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
