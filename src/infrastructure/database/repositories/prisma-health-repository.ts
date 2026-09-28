import { prisma } from "@/infrastructure/database/prisma";
import type { HealthRepository } from "@/server/repositories/health-repository";

export const prismaHealthRepository: HealthRepository = {
  async ping(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  },
};
