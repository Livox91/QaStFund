import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";

import { prisma } from "@/infrastructure/database/prisma";
import {
  EmployeeDirectoryError,
  type EmployeeDirectoryAuthMethod,
  type EmployeeDirectoryCredentialInput,
  type EmployeeDirectorySecret,
  type EmployeeDirectorySecretProvider,
} from "@/modules/employee-directory/domain/employee-directory";
import { EnvironmentEmployeeDirectorySecretProvider } from "@/modules/employee-directory/infrastructure/environment-secret-provider";

const MANAGED_REFERENCE_PREFIX = "managed:";

function encryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new EmployeeDirectoryError("CREDENTIAL_STORAGE_UNAVAILABLE");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new EmployeeDirectoryError("CREDENTIAL_STORAGE_UNAVAILABLE");
  }
  return key;
}

function additionalData(
  organizationId: string,
  authMethod: EmployeeDirectoryAuthMethod,
): Buffer {
  return Buffer.from(`erpnext:${organizationId}:${authMethod}`, "utf8");
}

export function encryptEmployeeDirectorySecret(input: {
  organizationId: string;
  secret: EmployeeDirectoryCredentialInput;
  key: string | undefined;
}): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(input.key), iv);
  cipher.setAAD(additionalData(input.organizationId, input.secret.method));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input.secret), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptEmployeeDirectorySecret(input: {
  organizationId: string;
  authMethod: EmployeeDirectoryAuthMethod;
  encryptedPayload: string;
  key: string | undefined;
}): EmployeeDirectorySecret {
  try {
    const [version, iv, tag, ciphertext, extra] =
      input.encryptedPayload.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra) {
      throw new Error("invalid payload");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(input.key),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(additionalData(input.organizationId, input.authMethod));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const value: unknown = JSON.parse(plaintext);
    if (
      input.authMethod === "token" &&
      value &&
      typeof value === "object" &&
      "method" in value &&
      value.method === "token" &&
      "apiKey" in value &&
      typeof value.apiKey === "string" &&
      value.apiKey.length > 0 &&
      "apiSecret" in value &&
      typeof value.apiSecret === "string" &&
      value.apiSecret.length > 0
    ) {
      return {
        method: "token",
        apiKey: value.apiKey,
        apiSecret: value.apiSecret,
      };
    }
    if (
      input.authMethod === "oauth_bearer" &&
      value &&
      typeof value === "object" &&
      "method" in value &&
      value.method === "oauth_bearer" &&
      "accessToken" in value &&
      typeof value.accessToken === "string" &&
      value.accessToken.length > 0
    ) {
      return { method: "oauth_bearer", accessToken: value.accessToken };
    }
  } catch {
    // Authentication failures, malformed ciphertext, and key mismatches are
    // intentionally presented as the same safe missing-credential condition.
  }
  throw new EmployeeDirectoryError("MISSING_CREDENTIALS");
}

export function isManagedCredentialReference(reference: string): boolean {
  return reference.startsWith(MANAGED_REFERENCE_PREFIX);
}

export class PrismaEncryptedEmployeeDirectorySecretProvider implements EmployeeDirectorySecretProvider {
  constructor(
    private readonly key: string | undefined,
    private readonly environmentProvider = new EnvironmentEmployeeDirectorySecretProvider(),
  ) {}

  async getSecret(input: {
    organizationId: string;
    reference: string;
    authMethod: EmployeeDirectoryAuthMethod;
  }): Promise<EmployeeDirectorySecret> {
    if (!isManagedCredentialReference(input.reference)) {
      return this.environmentProvider.getSecret(input);
    }
    const id = input.reference.slice(MANAGED_REFERENCE_PREFIX.length);
    const stored = await prisma.employeeDirectoryCredentialSecret.findUnique({
      where: {
        organizationId_id: { organizationId: input.organizationId, id },
      },
      select: { authMethod: true, encryptedPayload: true },
    });
    if (!stored || stored.authMethod.toLowerCase() !== input.authMethod) {
      throw new EmployeeDirectoryError("MISSING_CREDENTIALS");
    }
    return decryptEmployeeDirectorySecret({
      organizationId: input.organizationId,
      authMethod: input.authMethod,
      encryptedPayload: stored.encryptedPayload,
      key: this.key,
    });
  }
}

export async function storeEncryptedEmployeeDirectorySecret(input: {
  organizationId: string;
  secret: EmployeeDirectoryCredentialInput;
  key: string | undefined;
}): Promise<string> {
  const id = randomUUID();
  const encryptedPayload = encryptEmployeeDirectorySecret(input);
  await prisma.employeeDirectoryCredentialSecret.create({
    data: {
      id,
      organizationId: input.organizationId,
      authMethod: input.secret.method.toUpperCase() as "TOKEN" | "OAUTH_BEARER",
      encryptedPayload,
    },
  });
  return `${MANAGED_REFERENCE_PREFIX}${id}`;
}

export async function deleteManagedEmployeeDirectorySecret(input: {
  organizationId: string;
  reference: string;
}): Promise<void> {
  if (!isManagedCredentialReference(input.reference)) return;
  await prisma.employeeDirectoryCredentialSecret.deleteMany({
    where: {
      organizationId: input.organizationId,
      id: input.reference.slice(MANAGED_REFERENCE_PREFIX.length),
    },
  });
}
