import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    exclude: [
      "contracts-test/**",
      "node_modules/**",
      "tests/live/**",
      "tests/local-chain.test.ts",
    ],
    setupFiles: ["dotenv/config"],
    testTimeout: 10_000,
  },
});
