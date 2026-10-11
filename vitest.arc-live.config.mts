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
    include: ["tests/live/**/*.live.test.ts"],
    setupFiles: ["dotenv/config"],
    testTimeout: 30_000,
    sequence: { concurrent: false },
  },
});
