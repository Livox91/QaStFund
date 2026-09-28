import { describe, expect, it } from "vitest";

import {
  ApplicationRole,
  getRoleHome,
} from "@/modules/auth/domain/application-role";
import { scryptPasswordHasher } from "@/modules/auth/infrastructure/scrypt-password-hasher";
import { signInSchema } from "@/modules/auth/schemas/sign-in.schema";

describe("authentication foundation", () => {
  it("normalizes and validates sign-in input", () => {
    expect(
      signInSchema.parse({
        email: "  EMPLOYEE@DEMO.TEST ",
        password: "Employee123!",
      }),
    ).toEqual({
      email: "employee@demo.test",
      password: "Employee123!",
    });
  });

  it("maps roles to their server-selected home route", () => {
    expect(getRoleHome(ApplicationRole.EMPLOYER_ADMIN)).toBe("/employer");
    expect(getRoleHome(ApplicationRole.EMPLOYEE)).toBe("/app");
  });

  it("hashes passwords with a salt and verifies without storing plaintext", async () => {
    const password = "SecurePassword123!";
    const firstHash = await scryptPasswordHasher.hash(password);
    const secondHash = await scryptPasswordHasher.hash(password);

    expect(firstHash).not.toBe(password);
    expect(firstHash).not.toBe(secondHash);
    await expect(
      scryptPasswordHasher.verify(password, firstHash),
    ).resolves.toBe(true);
    await expect(
      scryptPasswordHasher.verify("wrong-password", firstHash),
    ).resolves.toBe(false);
  });
});
