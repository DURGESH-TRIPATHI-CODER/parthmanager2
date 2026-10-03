import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "electron/shared"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
