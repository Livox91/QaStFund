import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, stringToHex } from "viem";

const USDC = 1_000_000n;
const DAY = 86_400n;

describe("EmployeeLendingEscrowV3", async () => {
  const { viem, networkHelpers } = await network.create();
  const [lender, borrower, authorizer, agent, mallory] =
    await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const principal = 100n * USDC;
  let sequence = 0;

  let usdc: Awaited<ReturnType<typeof viem.deployContract>>;
  let escrow: Awaited<ReturnType<typeof viem.deployContract>>;

  async function latestTimestamp() {
    return (await publicClient.getBlock()).timestamp;
  }

  async function createOffer(durationSeconds = 30n * DAY) {
    await usdc.write.mint([lender.account.address, principal]);
    await usdc.write.approve([escrow.address, principal], {
      account: lender.account,
    });
    await escrow.write.createOffer(
      [
        principal,
        500n,
        durationSeconds,
        keccak256(stringToHex(`offer-${sequence++}`)),
      ],
      { account: lender.account },
    );
    return (await escrow.read.nextOfferId()) - 1n;
  }

  async function borrow(offerId: bigint) {
    const expiry = (await latestTimestamp()) + 3_600n;
    const authorizationId = keccak256(stringToHex(`accept-${sequence++}`));
    const signature = await authorizer.signTypedData({
      account: authorizer.account,
      domain: {
        name: "EmployeeLendingEscrow",
        version: "1",
        chainId,
        verifyingContract: escrow.address,
      },
      types: {
        BorrowAuthorization: [
          { name: "offerId", type: "uint256" },
          { name: "borrower", type: "address" },
          { name: "expiry", type: "uint256" },
          { name: "authorizationId", type: "bytes32" },
        ],
      },
      primaryType: "BorrowAuthorization",
      message: {
        offerId,
        borrower: borrower.account.address,
        expiry,
        authorizationId,
      },
    });
    await escrow.write.acceptOffer(
      [offerId, expiry, authorizationId, signature],
      { account: borrower.account },
    );
    return (await escrow.read.nextLoanId()) - 1n;
  }

  async function setMandate(
    overrides: Partial<{
      agentAddress: `0x${string}`;
      maxPerRepayment: bigint;
      maxPerPeriod: bigint;
      minimumReserve: bigint;
      periodSeconds: bigint;
      earliestBeforeDueSeconds: bigint;
      expiresAt: bigint;
    }> = {},
  ) {
    const now = await latestTimestamp();
    await escrow.write.setRepaymentMandate(
      [
        overrides.agentAddress ?? agent.account.address,
        overrides.maxPerRepayment ?? 25n * USDC,
        overrides.maxPerPeriod ?? 100n * USDC,
        overrides.minimumReserve ?? 40n * USDC,
        overrides.periodSeconds ?? 30n * DAY,
        overrides.earliestBeforeDueSeconds ?? 7n * DAY,
        overrides.expiresAt ?? now + 90n * DAY,
      ],
      { account: borrower.account },
    );
    const mandate = await escrow.read.repaymentMandates([
      borrower.account.address,
    ]);
    return mandate[9] as bigint;
  }

  function repaymentId(label: string) {
    return keccak256(stringToHex(`agent:${label}`));
  }

  beforeEach(async () => {
    sequence = 0;
    usdc = await viem.deployContract("MockUSDC");
    escrow = await viem.deployContract("EmployeeLendingEscrowV3", [
      usdc.address,
      authorizer.account.address,
    ]);
  });

  it("keeps the V1 offer, acceptance and loan getter interface", async () => {
    const loanId = await borrow(await createOffer());
    const loan = await escrow.read.loans([loanId]);
    assert.equal(loan[3].toLowerCase(), borrower.account.address.toLowerCase());
    assert.equal(loan[4], principal);
    assert.equal(loan[6], 105n * USDC);
    assert.equal(loan[9], 0);
  });

  it("supports partial borrower repayments and full repayment of the remainder", async () => {
    const loanId = await borrow(await createOffer());
    await usdc.write.mint([borrower.account.address, 10n * USDC]);
    await usdc.write.approve([escrow.address, 200n * USDC], {
      account: borrower.account,
    });
    await escrow.write.repayLoanPartial(
      [loanId, 30n * USDC, repaymentId("p1")],
      {
        account: borrower.account,
      },
    );
    assert.equal(await escrow.read.repaidAmounts([loanId]), 30n * USDC);
    assert.equal((await escrow.read.loans([loanId]))[9], 0);

    await escrow.write.repayLoan([loanId], { account: borrower.account });
    const loan = await escrow.read.loans([loanId]);
    assert.equal(loan[9], 1);
    assert.equal(await escrow.read.repaidAmounts([loanId]), 105n * USDC);
    assert.equal(
      await usdc.read.balanceOf([lender.account.address]),
      105n * USDC,
    );
  });

  it("lets the mandated agent repay within every limit", async () => {
    const loanId = await borrow(await createOffer(5n * DAY));
    // Borrower holds the 100 USDC principal; reserve is 40, cap is 25.
    await usdc.write.approve([escrow.address, 100n * USDC], {
      account: borrower.account,
    });
    const nonce = await setMandate();
    await escrow.write.repayOnBehalf(
      [loanId, 25n * USDC, repaymentId("a1"), nonce],
      { account: agent.account },
    );
    assert.equal(await escrow.read.repaidAmounts([loanId]), 25n * USDC);
    assert.equal(
      await usdc.read.balanceOf([borrower.account.address]),
      75n * USDC,
    );
    const mandate = await escrow.read.repaymentMandates([
      borrower.account.address,
    ]);
    assert.equal(mandate[8], 25n * USDC);
  });

  it("rejects agent repayments that break the mandate", async () => {
    const loanId = await borrow(await createOffer(5n * DAY));
    await usdc.write.approve([escrow.address, 100n * USDC], {
      account: borrower.account,
    });
    const nonce = await setMandate({ maxPerPeriod: 40n * USDC });

    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 10n * USDC, repaymentId("x"), nonce],
        { account: mallory.account },
      ),
      escrow,
      "NotMandateAgent",
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 26n * USDC, repaymentId("x"), nonce],
        { account: agent.account },
      ),
      escrow,
      "RepaymentCapExceeded",
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 10n * USDC, repaymentId("x"), nonce + 1n],
        { account: agent.account },
      ),
      escrow,
      "MandateChanged",
    );

    await escrow.write.repayOnBehalf(
      [loanId, 25n * USDC, repaymentId("ok"), nonce],
      { account: agent.account },
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 20n * USDC, repaymentId("period"), nonce],
        { account: agent.account },
      ),
      escrow,
      "PeriodCapExceeded",
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 5n * USDC, repaymentId("ok"), nonce],
        { account: agent.account },
      ),
      escrow,
      "DuplicateRepayment",
    );
  });

  it("enforces the minimum reserve against the live wallet balance", async () => {
    const loanId = await borrow(await createOffer(5n * DAY));
    await usdc.write.approve([escrow.address, 100n * USDC], {
      account: borrower.account,
    });
    const nonce = await setMandate();
    // Borrower spends down to 60 USDC: paying 25 would leave 35 < 40 reserve.
    await usdc.write.transfer([mallory.account.address, 40n * USDC], {
      account: borrower.account,
    });
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 25n * USDC, repaymentId("reserve"), nonce],
        { account: agent.account },
      ),
      escrow,
      "ReserveViolation",
    );
    await escrow.write.repayOnBehalf(
      [loanId, 20n * USDC, repaymentId("reserve-ok"), nonce],
      { account: agent.account },
    );
    assert.equal(
      await usdc.read.balanceOf([borrower.account.address]),
      40n * USDC,
    );
  });

  it("opens the agent window only near the due date and resets the period", async () => {
    const loanId = await borrow(await createOffer(30n * DAY));
    await usdc.write.approve([escrow.address, 100n * USDC], {
      account: borrower.account,
    });
    const nonce = await setMandate({
      maxPerPeriod: 25n * USDC,
      periodSeconds: 1n * DAY,
    });
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 10n * USDC, repaymentId("early"), nonce],
        { account: agent.account },
      ),
      escrow,
      "RepaymentWindowNotOpen",
    );
    await networkHelpers.time.increase(24n * DAY);
    await escrow.write.repayOnBehalf(
      [loanId, 25n * USDC, repaymentId("w1"), nonce],
      { account: agent.account },
    );
    await networkHelpers.time.increase(1n * DAY);
    await escrow.write.repayOnBehalf(
      [loanId, 25n * USDC, repaymentId("w2"), nonce],
      { account: agent.account },
    );
    assert.equal(await escrow.read.repaidAmounts([loanId]), 50n * USDC);
  });

  it("stops the agent after revocation or expiry", async () => {
    const loanId = await borrow(await createOffer(5n * DAY));
    await usdc.write.approve([escrow.address, 100n * USDC], {
      account: borrower.account,
    });
    const nonce = await setMandate({
      expiresAt: (await latestTimestamp()) + 2n * DAY,
    });
    await networkHelpers.time.increase(3n * DAY);
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 10n * USDC, repaymentId("late"), nonce],
        { account: agent.account },
      ),
      escrow,
      "MandateExpired",
    );
    const renewed = await setMandate();
    assert.equal(renewed, nonce + 1n);
    await escrow.write.revokeRepaymentMandate({ account: borrower.account });
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf(
        [loanId, 10n * USDC, repaymentId("revoked"), renewed],
        { account: agent.account },
      ),
      escrow,
      "MandateNotActive",
    );
  });

  it("rejects invalid mandate terms", async () => {
    await viem.assertions.revertWithCustomError(
      setMandate({ agentAddress: borrower.account.address }),
      escrow,
      "InvalidMandate",
    );
    await viem.assertions.revertWithCustomError(
      setMandate({ maxPerRepayment: 50n * USDC, maxPerPeriod: 40n * USDC }),
      escrow,
      "InvalidMandate",
    );
    await viem.assertions.revertWithCustomError(
      setMandate({ periodSeconds: 60n }),
      escrow,
      "InvalidMandate",
    );
  });

  it("completes the loan when the agent pays the final remainder", async () => {
    const loanId = await borrow(await createOffer(5n * DAY));
    await usdc.write.mint([borrower.account.address, 100n * USDC]);
    await usdc.write.approve([escrow.address, 200n * USDC], {
      account: borrower.account,
    });
    const nonce = await setMandate({
      maxPerRepayment: 105n * USDC,
      maxPerPeriod: 105n * USDC,
      minimumReserve: 0n,
    });
    const hash = await escrow.write.repayOnBehalf(
      [loanId, 105n * USDC, repaymentId("final"), nonce],
      { account: agent.account },
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    const loan = await escrow.read.loans([loanId]);
    assert.equal(loan[9], 1);
    await viem.assertions.revertWithCustomError(
      escrow.write.repayOnBehalf([loanId, 1n, repaymentId("after"), nonce], {
        account: agent.account,
      }),
      escrow,
      "LoanNotActive",
    );
  });
});
