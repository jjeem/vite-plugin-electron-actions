import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts", "src/**/__test__/**/*.test.ts"],
    exclude: ["e2e/**"],
    testTimeout: 30000,
  },
});
