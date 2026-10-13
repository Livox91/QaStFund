import { describe, expect, it } from "vitest";

import { requireSafeDemoEnvironment } from "../scripts/demo/demo-environment";

const safeEnvironment: NodeJS.ProcessEnv = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL:
    "postgresql://postgres:postgres@localhost:5432/employee_lending?schema=public",
  NODE_ENV: "development",
};

describe("local demo environment guard", () => {
  it("accepts the dedicated local development database", () => {
    expect(requireSafeDemoEnvironment(safeEnvironment)).toMatchObject({
      databaseName: "employee_lending",
    });
  });

  it("rejects production mode", () => {
    expect(() =>
      requireSafeDemoEnvironment({
        ...safeEnvironment,
        NODE_ENV: "production",
      }),
    ).toThrow(/NODE_ENV=production/);
  });

  it.each([
    [
      "remote database",
      { DATABASE_URL: "postgresql://user:secret@db.example.com/qastfund" },
    ],
    [
      "unapproved local database",
      {
        DATABASE_URL: "postgresql://postgres:postgres@localhost/customer_data",
      },
    ],
    ["remote application", { APP_URL: "https://qastfund.com" }],
  ])("rejects a %s target", (_label, override) => {
    expect(() =>
      requireSafeDemoEnvironment({ ...safeEnvironment, ...override }),
    ).toThrow(/refuses/);
  });
});
