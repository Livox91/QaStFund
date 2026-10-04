import "server-only";

import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { validateTestnetEnvironment } from "@/infrastructure/config/environment";
import {
  borrowAuthorizationTypedData,
  type BorrowAuthorization,
} from "@/modules/loans/domain/borrow-authorization";
import { ApplicationError } from "@/shared/errors/application-error";

export type SignedBorrowAuthorization = BorrowAuthorization &
  Readonly<{
    signerAddress: Address;
    signature: Hex;
  }>;

export async function signBorrowAuthorization(
  authorization: BorrowAuthorization,
  contractAddress: Address,
): Promise<SignedBorrowAuthorization> {
  let privateKey: `0x${string}`;
  try {
    privateKey = validateTestnetEnvironment()
      .ARC_BORROW_AUTHORIZER_PRIVATE_KEY as `0x${string}`;
  } catch (error) {
    throw new ApplicationError(
      "BORROW_AUTHORIZER_NOT_CONFIGURED",
      "Borrowing authorization is not configured.",
      503,
      { cause: error },
    );
  }
  const account = privateKeyToAccount(privateKey as Hex);
  const signature = await account.signTypedData(
    borrowAuthorizationTypedData(authorization, contractAddress),
  );
  return { ...authorization, signerAddress: account.address, signature };
}
