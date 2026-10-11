import { beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitExceededError } from "@/shared/errors/rate-limit-error";

const { enforceUserRateLimit, resendInvitation } = vi.hoisted(() => ({
  enforceUserRateLimit: vi.fn(),
  resendInvitation: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/config/environment", () => ({
  validateEnvironment: () => ({ APP_URL: "http://localhost:3000" }),
}));
vi.mock("@/infrastructure/rate-limit/rate-limit", () => ({
  enforceUserRateLimit,
}));
vi.mock("@/modules/auth/infrastructure/auth-guard", () => ({
  requireEmployerAdminPage: vi.fn(async () => ({
    userId: "11111111-1111-4111-8111-111111111111",
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "EMPLOYER_ADMIN",
  })),
}));
vi.mock("@/modules/policies/index.server", () => ({
  updateEmployeeAccessForActor: vi.fn(),
}));
vi.mock(
  "@/modules/employee-invitations/infrastructure/invitation-service",
  () => ({
    resendInvitation,
    revokeInvitation: vi.fn(),
  }),
);
vi.mock("@/modules/notifications/infrastructure/http-email-sender", () => ({
  emailSender: {},
}));

import { resendEmployeeInvitationAction } from "@/app/(employer)/employer/employees/actions";

describe("employee invitation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an inline retry message instead of throwing a rate-limit error", async () => {
    enforceUserRateLimit.mockRejectedValueOnce(new RateLimitExceededError(42));
    const formData = new FormData();
    formData.set("employeeId", "22222222-2222-4222-8222-222222222222");

    await expect(
      resendEmployeeInvitationAction({ status: "idle", message: "" }, formData),
    ).resolves.toEqual({
      status: "error",
      message: "Too many invitation requests. Try again in 42 seconds.",
    });
    expect(resendInvitation).not.toHaveBeenCalled();
  });
});
