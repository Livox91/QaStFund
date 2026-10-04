import { describe, expect, it } from "vitest";

const restoredSuite =
  process.env.DR_RESTORE_VERIFICATION === "true" ? describe : describe.skip;

restoredSuite("restored database reconciliation state", () => {
  it("resumes from the cursor restored by the verified backup", async () => {
    const [{ prisma }, { prismaReconciliationRepository }] = await Promise.all([
      import("@/infrastructure/database/prisma"),
      import("@/modules/blockchain-reconciliation/infrastructure/prisma-reconciliation-repository"),
    ]);
    const leaseOwner = "00000000-0000-4000-8000-000000000043";
    try {
      const cursor = await prismaReconciliationRepository.acquireLease({
        chainId: 5_042_002,
        contractAddress: "0x1111111111111111111111111111111111111111",
        leaseOwner,
        leaseExpiresAt: new Date("2026-10-04T12:05:00.000Z"),
        now: new Date("2026-10-04T12:00:00.000Z"),
        startBlock: 1n,
      });

      expect(cursor).toEqual({ nextBlock: 4243n });
      await prismaReconciliationRepository.releaseLease({
        chainId: 5_042_002,
        contractAddress: "0x1111111111111111111111111111111111111111",
        leaseOwner,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
