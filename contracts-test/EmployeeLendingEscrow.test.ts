import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, stringToHex } from "viem";

describe("EmployeeLendingEscrow", async () => {
  const { viem } = await network.create();
  const [alice, bob] = await viem.getWalletClients();
  const principal = 100_000_000n;
  const requestId = keccak256(stringToHex("alice-offer-1"));

  let usdc: Awaited<ReturnType<typeof viem.deployContract>>;
  let escrow: Awaited<ReturnType<typeof viem.deployContract>>;

  beforeEach(async () => {
    usdc = await viem.deployContract("MockUSDC");
    escrow = await viem.deployContract("EmployeeLendingEscrow", [usdc.address]);
    await usdc.write.mint([alice.account.address, 500_000_000n]);
  });

  async function createAliceOffer() {
    await usdc.write.approve([escrow.address, principal], {
      account: alice.account,
    });
    await escrow.write.createOffer(
      [principal, 500n, 30n * 86_400n, requestId],
      { account: alice.account },
    );
  }

  async function createActiveLoan() {
    await createAliceOffer();
    await escrow.write.acceptOffer([1n], { account: bob.account });
  }

  it("creates a funded offer and reserves Alice's exact principal", async () => {
    await usdc.write.approve([escrow.address, principal], {
      account: alice.account,
    });
    const transaction = escrow.write.createOffer(
      [principal, 500n, 30n * 86_400n, requestId],
      { account: alice.account },
    );

    await viem.assertions.emitWithArgs(transaction, escrow, "OfferCreated", [
      1n,
      alice.account.address,
      principal,
      500n,
      2_592_000n,
      requestId,
    ]);

    assert.equal(
      await usdc.read.balanceOf([alice.account.address]),
      400_000_000n,
    );
    assert.equal(await usdc.read.balanceOf([escrow.address]), principal);
    assert.equal(await escrow.read.totalReserved(), principal);
    const offer = await escrow.read.offers([1n]);
    assert.deepEqual(
      [offer[0], offer[1].toLowerCase(), ...offer.slice(2)],
      [
        1n,
        alice.account.address.toLowerCase(),
        principal,
        500n,
        2_592_000n,
        true,
        requestId,
      ],
    );
  });

  it("does not activate or reserve an offer when funding fails", async () => {
    await usdc.write.approve([escrow.address, 600_000_000n], {
      account: alice.account,
    });
    await viem.assertions.revertWithCustomError(
      escrow.write.createOffer([600_000_000n, 500n, 2_592_000n, requestId], {
        account: alice.account,
      }),
      usdc,
      "ERC20InsufficientBalance",
    );

    assert.equal(await escrow.read.nextOfferId(), 1n);
    assert.equal(await escrow.read.totalReserved(), 0n);
    assert.equal(await usdc.read.balanceOf([escrow.address]), 0n);
  });

  it("rejects zero principal, invalid duration, and excessive interest", async () => {
    await viem.assertions.revertWithCustomError(
      escrow.write.createOffer([0n, 500n, 2_592_000n, requestId], {
        account: alice.account,
      }),
      escrow,
      "InvalidPrincipal",
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.createOffer([principal, 500n, 0n, requestId], {
        account: alice.account,
      }),
      escrow,
      "InvalidDuration",
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.createOffer([principal, 10_001n, 2_592_000n, requestId], {
        account: alice.account,
      }),
      escrow,
      "InvalidInterestRate",
    );
  });

  it("prevents duplicate execution for the same request", async () => {
    await usdc.write.approve([escrow.address, principal * 2n], {
      account: alice.account,
    });
    await escrow.write.createOffer([principal, 500n, 2_592_000n, requestId], {
      account: alice.account,
    });

    await viem.assertions.revertWithCustomError(
      escrow.write.createOffer([principal, 500n, 2_592_000n, requestId], {
        account: alice.account,
      }),
      escrow,
      "DuplicateRequest",
    );
    assert.equal(await escrow.read.nextOfferId(), 2n);
    assert.equal(await escrow.read.totalReserved(), principal);
  });

  it("prevents another employee from cancelling Alice's offer", async () => {
    await usdc.write.approve([escrow.address, principal], {
      account: alice.account,
    });
    await escrow.write.createOffer([principal, 500n, 2_592_000n, requestId], {
      account: alice.account,
    });

    await viem.assertions.revertWithCustomError(
      escrow.write.cancelOffer([1n], { account: bob.account }),
      escrow,
      "NotOfferLender",
    );
    assert.equal((await escrow.read.offers([1n]))[5], true);
  });

  it("atomically transfers Alice's escrow to Bob and creates the active loan", async () => {
    await createAliceOffer();
    await usdc.write.mint([bob.account.address, 10_000_000n]);

    await escrow.write.acceptOffer([1n], { account: bob.account });

    assert.equal(
      await usdc.read.balanceOf([bob.account.address]),
      110_000_000n,
    );
    assert.equal(await usdc.read.balanceOf([escrow.address]), 0n);
    assert.equal(await escrow.read.totalReserved(), 0n);
    assert.equal((await escrow.read.offers([1n]))[5], false);
    const loan = await escrow.read.loans([1n]);
    assert.equal(loan[0], 1n);
    assert.equal(loan[1], 1n);
    assert.equal(loan[2].toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(loan[3].toLowerCase(), bob.account.address.toLowerCase());
    assert.equal(loan[4], 100_000_000n);
    assert.equal(loan[5], 500n);
    assert.equal(loan[6], 105_000_000n);
    assert.equal(loan[8] - loan[7], 30n * 86_400n);
    assert.equal(loan[9], 0);
    assert.equal(loan[10], 0n);
    assert.equal(await escrow.read.offerLoanIds([1n]), 1n);
  });

  it("prevents double acceptance and self-borrowing", async () => {
    await createAliceOffer();
    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer([1n], { account: alice.account }),
      escrow,
      "SelfBorrowingNotAllowed",
    );
    await escrow.write.acceptOffer([1n], { account: bob.account });
    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer([1n], { account: alice.account }),
      escrow,
      "OfferNotActive",
    );
    assert.equal(await escrow.read.nextLoanId(), 2n);
  });

  it("rejects cancelled and nonexistent offers", async () => {
    await createAliceOffer();
    await escrow.write.cancelOffer([1n], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer([1n], { account: bob.account }),
      escrow,
      "OfferNotActive",
    );
    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer([99n], { account: bob.account }),
      escrow,
      "OfferNotActive",
    );
  });

  it("rolls back the loan and offer state when the USDC transfer fails", async () => {
    await createAliceOffer();
    await usdc.write.burn([escrow.address, principal]);

    await viem.assertions.revertWithCustomError(
      escrow.write.acceptOffer([1n], { account: bob.account }),
      usdc,
      "ERC20InsufficientBalance",
    );

    assert.equal((await escrow.read.offers([1n]))[5], true);
    assert.equal(await escrow.read.nextLoanId(), 1n);
    assert.equal(await escrow.read.totalReserved(), principal);
    assert.equal(await escrow.read.offerLoanIds([1n]), 0n);
  });

  it("rounds repayment interest up to the nearest base unit", async () => {
    await usdc.write.approve([escrow.address, 10_000n], {
      account: alice.account,
    });
    await escrow.write.createOffer([10_000n, 1n, 86_400n, requestId], {
      account: alice.account,
    });
    await escrow.write.acceptOffer([1n], { account: bob.account });
    assert.equal((await escrow.read.loans([1n]))[6], 10_001n);
  });

  it("repays the exact obligation directly from Bob to Alice", async () => {
    await usdc.write.mint([bob.account.address, 10_000_000n]);
    await createActiveLoan();
    await usdc.write.mint([bob.account.address, 5_000_000n]);
    await usdc.write.approve([escrow.address, 105_000_000n], {
      account: bob.account,
    });

    const transaction = await escrow.write.repayLoan([1n], {
      account: bob.account,
    });
    const loan = await escrow.read.loans([1n]);

    await viem.assertions.emitWithArgs(transaction, escrow, "LoanRepaid", [
      1n,
      bob.account.address,
      alice.account.address,
      105_000_000n,
      loan[10],
    ]);
    assert.equal(await usdc.read.balanceOf([bob.account.address]), 10_000_000n);
    assert.equal(
      await usdc.read.balanceOf([alice.account.address]),
      505_000_000n,
    );
    assert.equal(loan[9], 1);
    assert.ok(loan[10] > 0n);
  });

  it("rejects duplicate repayment and repayment by a different account", async () => {
    const [, , mallory] = await viem.getWalletClients();
    await createActiveLoan();
    await usdc.write.mint([bob.account.address, 5_000_000n]);
    await usdc.write.approve([escrow.address, 105_000_000n], {
      account: bob.account,
    });

    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan([1n], { account: mallory.account }),
      escrow,
      "NotLoanBorrower",
    );
    await escrow.write.repayLoan([1n], { account: bob.account });
    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan([1n], { account: bob.account }),
      escrow,
      "LoanNotActive",
    );
  });

  it("rejects repayment of a nonexistent loan", async () => {
    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan([99n], { account: bob.account }),
      escrow,
      "InvalidLoan",
    );
  });

  it("keeps the loan active when balance, allowance, or transfer fails", async () => {
    await createActiveLoan();
    await usdc.write.approve([escrow.address, 105_000_000n], {
      account: bob.account,
    });

    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan([1n], { account: bob.account }),
      usdc,
      "ERC20InsufficientBalance",
    );
    assert.equal((await escrow.read.loans([1n]))[9], 0);

    await usdc.write.mint([bob.account.address, 5_000_000n]);
    await usdc.write.approve([escrow.address, 0n], {
      account: bob.account,
    });
    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan([1n], { account: bob.account }),
      usdc,
      "ERC20InsufficientAllowance",
    );
    assert.equal((await escrow.read.loans([1n]))[9], 0);

    await usdc.write.approve([escrow.address, 105_000_000n], {
      account: bob.account,
    });
    await usdc.write.setTransfersBlocked([true]);
    await viem.assertions.revertWithCustomError(
      escrow.write.repayLoan([1n], { account: bob.account }),
      usdc,
      "MockTransferFailed",
    );
    const loan = await escrow.read.loans([1n]);
    assert.equal(loan[9], 0);
    assert.equal(loan[10], 0n);
  });
});
