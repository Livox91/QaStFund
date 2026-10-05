import type { EmploymentStatus } from "@/generated/prisma/client";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { configureEmployeeDirectory } from "@/modules/employee-directory/application/configure-employee-directory";
import type { EmployeeDirectoryRepository } from "@/modules/employee-directory/application/ports/employee-directory-repository";
import {
  EmployeeDirectoryError,
  type EmployeeDirectoryAuthMethod,
  type EmployeeDirectoryCredentialInput,
} from "@/modules/employee-directory/domain/employee-directory";

export async function configureEmployeeDirectoryCredentials(
  actor: AuthenticatedActor | null,
  input: {
    baseUrl: string;
    apiPath: string;
    apiVersion: string;
    authMethod: EmployeeDirectoryAuthMethod;
    credential?: EmployeeDirectoryCredentialInput;
    timeoutMs: number;
    statusMapping: Readonly<Record<string, EmploymentStatus | null>>;
  },
  dependencies: {
    repository: EmployeeDirectoryRepository;
    storeSecret: (input: {
      organizationId: string;
      secret: EmployeeDirectoryCredentialInput;
    }) => Promise<string>;
    deleteSecret: (input: {
      organizationId: string;
      reference: string;
    }) => Promise<void>;
    allowLocalDevelopment?: boolean;
  },
): Promise<void> {
  const employer = requireEmployerAdmin(actor);
  const existing = await dependencies.repository.getIntegration(
    employer.organizationId,
  );
  if (
    !input.credential &&
    (!existing || existing.authMethod !== input.authMethod)
  ) {
    throw new EmployeeDirectoryError("MISSING_CREDENTIALS");
  }

  const previousReference = existing?.credentialReference;
  const credentialReference = input.credential
    ? await dependencies.storeSecret({
        organizationId: employer.organizationId,
        secret: input.credential,
      })
    : previousReference!;

  try {
    await configureEmployeeDirectory(
      actor,
      { ...input, credentialReference },
      dependencies.repository,
      { allowLocalDevelopment: dependencies.allowLocalDevelopment },
    );
  } catch (error) {
    if (input.credential) {
      await dependencies.deleteSecret({
        organizationId: employer.organizationId,
        reference: credentialReference,
      });
    }
    throw error;
  }

  if (input.credential && previousReference !== credentialReference) {
    await dependencies.deleteSecret({
      organizationId: employer.organizationId,
      reference: previousReference ?? "",
    });
  }
}
