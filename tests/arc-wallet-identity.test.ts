import { describe, expect, it, vi } from "vitest";

import {
  beginArcWalletEnrollment,
  createCircleUsername,
} from "@/modules/arc-wallet/application/arc-wallet-identity";
import type { ArcWalletRepository } from "@/modules/arc-wallet/application/ports/arc-wallet-repository";
import type { ArcWalletEnrollmentState } from "@/modules/arc-wallet/domain/arc-wallet";
import { isDuplicateCircleUsernameError } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { ApplicationRole } from "@/modules/auth/domain/application-role";

const actor = {
  userId: "c469039d-e6a0-4dca-adbe-090f84b567ce",
  email: "alice@acme.test",
  name: "Alice",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationName: "Acme",
  organizationSlug: "acme",
  role: ApplicationRole.EMPLOYEE,
} as const;

function wallet(enrollmentState: ArcWalletEnrollmentState = "REGISTERING") {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organizationId: actor.organizationId,
    userId: actor.userId,
    address: null,
    network: "ARC_TESTNET" as const,
    chainId: 5_042_002 as const,
    walletType: "CIRCLE_MODULAR" as const,
    status: "PENDING" as const,
    enrollmentState,
    createdAt: new Date("2026-09-29T12:00:00.000Z"),
    updatedAt: new Date("2026-09-29T12:00:00.000Z"),
  };
}

function repository(
  beginEnrollment: ArcWalletRepository["beginEnrollment"],
): ArcWalletRepository {
  return {
    findForEmployee: vi.fn(async () => null),
    beginEnrollment,
    markRegistrationComplete: vi.fn(async () => undefined),
    createChallenge: vi.fn(),
    findChallenge: vi.fn(),
    activateFromChallenge: vi.fn(),
  };
}

describe("Circle wallet identity lifecycle", () => {
  it("uses a stable non-email username for a new registration", async () => {
    const begin = vi.fn(async () => ({
      wallet: wallet(),
      action: "REGISTER" as const,
    }));
    const first = await beginArcWalletEnrollment(
      actor,
      "CREATE",
      repository(begin),
    );
    const second = createCircleUsername(actor.userId);

    expect(first).toEqual({
      action: "REGISTER",
      username: "employee_c469039de6a04dcaadbe090f84b567ce",
    });
    expect(first.username).toBe(second);
    expect(first.username).not.toContain(actor.email);
  });

  it("gives different application users different usernames", () => {
    expect(createCircleUsername(actor.userId)).not.toBe(
      createCircleUsername("55e1c09e-c9de-4345-bfd6-0cbfb3b80c37"),
    );
  });

  it("uses login recovery without exposing a username", async () => {
    const begin = vi.fn(async () => ({
      wallet: wallet("FAILED_RECOVERABLE"),
      action: "LOGIN" as const,
    }));
    await expect(
      beginArcWalletEnrollment(actor, "RECOVER", repository(begin)),
    ).resolves.toEqual({ action: "LOGIN", username: null });
  });

  it("uses login on retry after a persisted partial registration", async () => {
    const begin = vi.fn(async () => ({
      wallet: wallet("REGISTERING"),
      action: "LOGIN" as const,
    }));
    await expect(
      beginArcWalletEnrollment(actor, "CREATE", repository(begin)),
    ).resolves.toEqual({ action: "LOGIN", username: null });
  });

  it("recognizes Circle's duplicate registration response", () => {
    expect(
      isDuplicateCircleUsernameError(new Error("The username is duplicated.")),
    ).toBe(true);
    expect(isDuplicateCircleUsernameError(new Error("Network failed"))).toBe(
      false,
    );
  });

  it("skips registration for an existing ACTIVE wallet", async () => {
    const begin = vi.fn(async () => ({
      wallet: {
        ...wallet("ACTIVE"),
        address: "0x1111111111111111111111111111111111111111" as const,
        status: "ACTIVE" as const,
      },
      action: "LOGIN" as const,
    }));
    await expect(
      beginArcWalletEnrollment(actor, "CREATE", repository(begin)),
    ).resolves.toEqual({ action: "LOGIN", username: null });
  });
});
