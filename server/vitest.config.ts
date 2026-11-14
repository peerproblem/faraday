import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // DB suites each create their own database; keep files in separate workers.
    fileParallelism: true,
  },
});
