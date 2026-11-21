import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": src(""), "server-only": src("test/server-only.ts") } },
  test: { include: ["src/**/*.test.ts"], testTimeout: 60000 },
});
