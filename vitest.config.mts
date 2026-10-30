import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // Files share one test database; keep them serial so fixtures never interleave unpredictably.
    fileParallelism: false,
  },
});
