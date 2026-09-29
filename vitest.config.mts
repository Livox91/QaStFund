import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    exclude: ["contracts-test/**", "node_modules/**"],
    setupFiles: ["dotenv/config"],
  },
});
