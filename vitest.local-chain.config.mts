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
    include: [
      "tests/local-chain.test.ts",
      "tests/p2p-lending-local-e2e.test.ts",
    ],
    setupFiles: ["dotenv/config"],
    testTimeout: 60_000,
  },
});
