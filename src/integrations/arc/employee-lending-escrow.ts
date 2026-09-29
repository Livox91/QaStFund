import { getAddress, isAddress, keccak256, stringToHex } from "viem";

export const erc20UsdcAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const employeeLendingEscrowAbi = [
  {
    type: "function",
    name: "createOffer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "principal", type: "uint256" },
      { name: "interestBps", type: "uint32" },
      { name: "duration", type: "uint32" },
      { name: "requestId", type: "bytes32" },
    ],
    outputs: [{ name: "offerId", type: "uint256" }],
  },
  {
    type: "function",
    name: "acceptOffer",
    stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [{ name: "loanId", type: "uint256" }],
  },
  {
    type: "function",
    name: "repayLoan",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "offers",
    stateMutability: "view",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "lender", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "interestBps", type: "uint256" },
      { name: "duration", type: "uint256" },
      { name: "active", type: "bool" },
      { name: "requestId", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "loans",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "offerId", type: "uint256" },
      { name: "lender", type: "address" },
      { name: "borrower", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "interestBps", type: "uint256" },
      { name: "repaymentAmount", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "dueTime", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "repaidAt", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "OfferCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "offerId", type: "uint256" },
      { indexed: true, name: "lender", type: "address" },
      { indexed: false, name: "principal", type: "uint256" },
      { indexed: false, name: "interestBps", type: "uint32" },
      { indexed: false, name: "duration", type: "uint32" },
      { indexed: true, name: "requestId", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "LoanStarted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "offerId", type: "uint256" },
      { indexed: true, name: "lender", type: "address" },
      { indexed: false, name: "borrower", type: "address" },
      { indexed: false, name: "principal", type: "uint256" },
      { indexed: false, name: "repaymentAmount", type: "uint256" },
      { indexed: false, name: "startTime", type: "uint256" },
      { indexed: false, name: "dueTime", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "LoanRepaid",
    anonymous: false,
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: true, name: "lender", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "repaidAt", type: "uint256" },
    ],
  },
] as const;

export function getConfiguredEscrowAddress(): `0x${string}` | null {
  const value = process.env.NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS;
  return value && isAddress(value) ? getAddress(value) : null;
}

export function fundingRequestIdToBytes32(requestId: string): `0x${string}` {
  return keccak256(stringToHex(requestId));
}
