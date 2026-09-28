import "dotenv/config";

import { scryptPasswordHasher } from "../src/modules/auth/infrastructure/scrypt-password-hasher";
import { prisma } from "../src/infrastructure/database/prisma";

const DEMO_ORGANIZATION = {
  name: "Demo Company",
  slug: "demo-company",
};

const DEMO_USERS = [
  {
    email: "admin@demo.test",
    name: "Demo Employer Admin",
    password: "Employer123!",
    role: "EMPLOYER_ADMIN" as const,
  },
  {
    email: "employee@demo.test",
    name: "Demo Employee",
    password: "Employee123!",
    role: "EMPLOYEE" as const,
  },
];

async function seed(): Promise<void> {
  const organization = await prisma.organization.upsert({
    where: { slug: DEMO_ORGANIZATION.slug },
    update: { name: DEMO_ORGANIZATION.name },
    create: DEMO_ORGANIZATION,
  });

  for (const demoUser of DEMO_USERS) {
    const passwordHash = await scryptPasswordHasher.hash(demoUser.password);
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        passwordHash,
      },
      create: {
        email: demoUser.email,
        name: demoUser.name,
        passwordHash,
      },
    });

    await prisma.session.deleteMany({ where: { userId: user.id } });

    await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: {
        role: demoUser.role,
        isActive: true,
      },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: demoUser.role,
      },
    });
  }
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Failed to seed demo authentication data.", error);
    await prisma.$disconnect();
    process.exit(1);
  });
