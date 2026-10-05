import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { configureEmployeeDirectoryCredentials } from "@/modules/employee-directory/application/configure-employee-directory-credentials";
import type {
  EmployeeDirectoryRepository,
  StoredDirectoryIntegration,
} from "@/modules/employee-directory/application/ports/employee-directory-repository";
import { encryptEmployeeDirectorySecret } from "@/modules/employee-directory/infrastructure/encrypted-secret-provider";

const actor: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@example.test",
  name: "Admin",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

const configuration = {
  baseUrl: "http://localhost:8000",
  apiPath: "/api/resource",
  apiVersion: "v1",
  authMethod: "token" as const,
  timeoutMs: 5_000,
  statusMapping: { active: null },
};

describe("ERPNext credential handling", () => {
  it("encrypts credentials with authenticated, nondeterministic ciphertext", () => {
    const key = randomBytes(32).toString("base64");
    const secret = {
      method: "token" as const,
      apiKey: "key-that-must-not-appear",
      apiSecret: "secret-that-must-not-appear",
    };
    const first = encryptEmployeeDirectorySecret({
      organizationId: actor.organizationId,
      secret,
      key,
    });
    const second = encryptEmployeeDirectorySecret({
      organizationId: actor.organizationId,
      secret,
      key,
    });

    expect(first).toMatch(/^v1\./);
    expect(first).not.toBe(second);
    expect(first).not.toContain(secret.apiKey);
    expect(first).not.toContain(secret.apiSecret);
  });

  it("generates and persists only an opaque reference for new credentials", async () => {
    const saveIntegration = vi.fn(async () => {});
    const storeSecret = vi.fn(async () => "managed:generated-reference");
    const deleteSecret = vi.fn(async () => {});
    const repository = {
      getIntegration: vi.fn(async () => null),
      saveIntegration,
    } as unknown as EmployeeDirectoryRepository;

    await configureEmployeeDirectoryCredentials(
      actor,
      {
        ...configuration,
        credential: {
          method: "token",
          apiKey: "erp-api-key",
          apiSecret: "erp-api-secret",
        },
      },
      {
        repository,
        storeSecret,
        deleteSecret,
        allowLocalDevelopment: true,
      },
    );

    expect(storeSecret).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      secret: {
        method: "token",
        apiKey: "erp-api-key",
        apiSecret: "erp-api-secret",
      },
    });
    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: actor.organizationId,
        credentialReference: "managed:generated-reference",
      }),
    );
    expect(JSON.stringify(saveIntegration.mock.calls)).not.toContain(
      "erp-api-secret",
    );
  });

  it("keeps an existing credential when fields are blank", async () => {
    const existing = {
      ...configuration,
      id: "integration-a",
      organizationId: actor.organizationId,
      provider: "erpnext",
      credentialReference: "managed:existing-reference",
      connectionStatus: "connected",
      lastConnectionCode: null,
      lastTestedAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncStatus: null,
      lastSyncErrorCode: null,
      scheduledSyncPausedAt: null,
      schedulePauseCode: null,
    } satisfies StoredDirectoryIntegration;
    const saveIntegration = vi.fn(async () => {});
    const storeSecret = vi.fn(async () => "managed:unused");
    const repository = {
      getIntegration: vi.fn(async () => existing),
      saveIntegration,
    } as unknown as EmployeeDirectoryRepository;

    await configureEmployeeDirectoryCredentials(actor, configuration, {
      repository,
      storeSecret,
      deleteSecret: vi.fn(async () => {}),
      allowLocalDevelopment: true,
    });

    expect(storeSecret).not.toHaveBeenCalled();
    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialReference: "managed:existing-reference",
      }),
    );
  });
});
