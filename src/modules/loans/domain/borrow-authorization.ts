import {
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { ARC_TESTNET_CHAIN_ID } from "@/integrations/arc/arc-testnet";

export const BORROW_AUTHORIZATION_DOMAIN = {
  name: "EmployeeLendingEscrow",
  version: "1",
} as const;

export const borrowAuthorizationTypes = {
  BorrowAuthorization: [
    { name: "offerId", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "expiry", type: "uint256" },
    { name: "authorizationId", type: "bytes32" },
  ],
} as const;

export type BorrowAuthorization = Readonly<{
  offerId: bigint;
  borrower: Address;
  expiry: bigint;
  authorizationId: Hex;
}>;

export function borrowRequestIdToAuthorizationId(requestId: string): Hex {
  return keccak256(stringToHex(`borrow:${requestId}`));
}

export function borrowAuthorizationTypedData(
  authorization: BorrowAuthorization,
  contractAddress: Address,
  chainId = ARC_TESTNET_CHAIN_ID,
) {
  return {
    domain: {
      ...BORROW_AUTHORIZATION_DOMAIN,
      chainId,
      verifyingContract: getAddress(contractAddress),
    },
    types: borrowAuthorizationTypes,
    primaryType: "BorrowAuthorization" as const,
    message: authorization,
  };
}
