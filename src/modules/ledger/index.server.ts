import "server-only";

import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  InvalidFundingAmountError,
  WalletNotFoundError,
} from "@/modules/ledger/application/errors/ledger-errors";
import {
  fundEmployeeWallet,
  loadWallet,
} from "@/modules/ledger/infrastructure/prisma-wallet-repository";

export async function getWalletForActor(actor: AuthenticatedActor | null) {
  const employee = requireEmployee(actor);
  const wallet = await loadWallet({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });
  if (!wallet) throw new WalletNotFoundError();
  return wallet;
}

export async function fundWalletForActor(
  actor: AuthenticatedActor | null,
  input: { amountMinorUnits: bigint; requestId: string },
  now = new Date(),
) {
  if (process.env.NODE_ENV === "production") throw new WalletNotFoundError();
  const employee = requireEmployee(actor);
  if (input.amountMinorUnits <= 0n) throw new InvalidFundingAmountError();
  const posting = await fundEmployeeWallet({
    organizationId: employee.organizationId,
    userId: employee.userId,
    amountMinorUnits: input.amountMinorUnits,
    requestId: input.requestId,
    now,
  });
  if (!posting) throw new WalletNotFoundError();
  return posting;
}
