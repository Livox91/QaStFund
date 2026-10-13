import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, stringToHex } from "viem";

describe("EmployeeLendingEscrowV2", async () => {
  const { viem } = await network.create();
  const [lender, borrower, authorizer, secondBorrower] =
    await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const principal = 10_000_000n;
  let usdc: Awaited<ReturnType<typeof viem.deployContract>>;
  let escrow: Awaited<ReturnType<typeof viem.deployContract>>;
  let sequence = 0;

  beforeEach(async () => {
    sequence = 0;
    usdc = await viem.deployContract("MockUSDC");
    escrow = await viem.deployContract("EmployeeLendingEscrowV2", [
      usdc.address,
      authorizer.account.address,
    ]);
    await usdc.write.mint([lender.account.address, principal]);
    await usdc.write.approve([escrow.address, principal], {
      account: lender.account,
    });
    await escrow.write.createOffer(
      [principal, 0n, 90n * 86_400n, keccak256(stringToHex("offer-v2"))],
      { account: lender.account },
    );
  });

  async function authorization(
    amount: bigint,
    account = borrower,
    duration = 30n * 86_400n,
  ) {
    const expiry = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
    const authorizationId = keccak256(stringToHex(`borrow-v2-${sequence++}`));
    const signature = await authorizer.signTypedData({
      account: authorizer.account,
      domain: {
        name: "EmployeeLendingEscrowV2",
        version: "2",
        chainId,
        verifyingContract: escrow.address,
      },
      types: {
        BorrowAuthorization: [
          { name: "offerId", type: "uint256" },
          { name: "borrower", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "duration", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "authorizationId", type: "bytes32" },
        ],
      },
      primaryType: "BorrowAuthorization",
      message: {
        offerId: 1n,
        borrower: account.account.address,
        principal: amount,
        duration,
        expiry,
        authorizationId,
      },
    });
    return { amount, account, duration, expiry, authorizationId, signature };
  }

  async function accept(amount: bigint, account = borrower) {
    const auth = await authorization(amount, account);
    await escrow.write.acceptOffer(
      [
        1n,
        auth.amount,
        auth.duration,
        auth.expiry,
        auth.authorizationId,
        auth.signature,
      ],
      { account: account.account },
    );
  }

  it("accepts part of an offer and leaves the remainder available", async () => {
    await accept(4_000_000n);
    const offer = await escrow.read.offers([1n]);
    const loan = await escrow.read.loans([1n]);
    assert.equal(offer[2], principal);
    assert.equal(offer[3], 6_000_000n);
    assert.equal(offer[6], true);
    assert.equal(loan[4], 4_000_000n);
    assert.equal(await escrow.read.totalReserved(), 6_000_000n);
  });

  it("supports multiple borrowers without exceeding the offer", async () => {
    await accept(4_000_000n);
    await accept(6_000_000n, secondBorrower);
    const offer = await escrow.read.offers([1n]);
    assert.equal(offer[3], 0n);
    assert.equal(offer[6], false);
    assert.equal(await escrow.read.offerLoanCount([1n]), 2n);
    assert.equal(await escrow.read.totalReserved(), 0n);
  });

  it("rejects zero, excessive, and tampered acceptance amounts", async () => {
    const zero = await authorization(0n);
    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer(
        [
          1n,
          0n,
          zero.duration,
          zero.expiry,
          zero.authorizationId,
          zero.signature,
        ],
        { account: borrower.account },
      ),
      escrow,
      "InvalidPrincipal",
    );
    const excessive = await authorization(principal + 1n);
    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer(
        [
          1n,
          excessive.amount,
          excessive.duration,
          excessive.expiry,
          excessive.authorizationId,
          excessive.signature,
        ],
        { account: borrower.account },
      ),
      escrow,
      "InvalidPrincipal",
    );
    const signed = await authorization(4_000_000n);
    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer(
        [
          1n,
          5_000_000n,
          signed.duration,
          signed.expiry,
          signed.authorizationId,
          signed.signature,
        ],
        { account: borrower.account },
      ),
      escrow,
      "InvalidAuthorization",
    );
  });

  it("records partial and exact repayments", async () => {
    await accept(4_000_000n);
    await usdc.write.approve([escrow.address, 4_000_000n], {
      account: borrower.account,
    });
    await escrow.write.repayLoan(
      [1n, 1_500_000n, keccak256(stringToHex("pay-1"))],
      { account: borrower.account },
    );
    let loan = await escrow.read.loans([1n]);
    assert.equal(loan[7], 1_500_000n);
    assert.equal(loan[10], 0);
    await escrow.write.repayLoan(
      [1n, 2_500_000n, keccak256(stringToHex("pay-2"))],
      { account: borrower.account },
    );
    loan = await escrow.read.loans([1n]);
    assert.equal(loan[7], 4_000_000n);
    assert.equal(loan[10], 1);
  });

  it("rejects overpayment and duplicate repayment ids", async () => {
    await accept(4_000_000n);
    await usdc.write.approve([escrow.address, 5_000_000n], {
      account: borrower.account,
    });
    const repaymentId = keccak256(stringToHex("same-payment"));
    await escrow.write.repayLoan([1n, 1_000_000n, repaymentId], {
      account: borrower.account,
    });
    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan([1n, 1_000_000n, repaymentId], {
        account: borrower.account,
      }),
      escrow,
      "DuplicateRepayment",
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan(
        [1n, 3_000_001n, keccak256(stringToHex("too-much"))],
        { account: borrower.account },
      ),
      escrow,
      "RepaymentExceedsOutstanding",
    );
  });

  it("returns only the unaccepted remainder when an offer is cancelled", async () => {
    await accept(4_000_000n);
    await escrow.write.cancelOffer([1n], { account: lender.account });
    assert.equal(
      await usdc.read.balanceOf([lender.account.address]),
      6_000_000n,
    );
    assert.equal(await escrow.read.totalReserved(), 0n);
  });
});
