import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  root: ".",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    target: "chrome130",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "electron/shared"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
