import { describe, expect, it } from "vitest";

import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

describe("sensitive mutation request origins", () => {
  it("accepts the configured application origin", () => {
    const appUrl = process.env.APP_URL!;

    expect(() =>
      assertTrustedRequestOrigin(
        new Request(`${appUrl}/api/wallet/arc/challenge`, {
          method: "POST",
          headers: { origin: new URL(appUrl).origin },
        }),
      ),
    ).not.toThrow();
  });

  it.each([undefined, "https://attacker.example"])(
    "rejects an untrusted origin: %s",
    (origin) => {
      const appUrl = process.env.APP_URL!;
      const headers = new Headers();
      if (origin) headers.set("origin", origin);

      expect(() =>
        assertTrustedRequestOrigin(
          new Request(`${appUrl}/api/wallet/arc/challenge`, {
            method: "POST",
            headers,
          }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "INVALID_REQUEST_ORIGIN",
          statusCode: 403,
        }),
      );
    },
  );
});
