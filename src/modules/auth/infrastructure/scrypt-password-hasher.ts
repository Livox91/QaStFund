import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";

import type { PasswordHasher } from "@/modules/auth/application/ports/password-hasher";

const ALGORITHM = "scrypt-v1";
const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

export const scryptPasswordHasher: PasswordHasher = {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await deriveKey(password, salt);

    return [
      ALGORITHM,
      COST,
      BLOCK_SIZE,
      PARALLELIZATION,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  },

  async verify(password: string, passwordHash: string): Promise<boolean> {
    const [algorithm, cost, blockSize, parallelization, salt, storedKey] =
      passwordHash.split("$");

    if (
      algorithm !== ALGORITHM ||
      Number(cost) !== COST ||
      Number(blockSize) !== BLOCK_SIZE ||
      Number(parallelization) !== PARALLELIZATION ||
      !salt ||
      !storedKey
    ) {
      return false;
    }

    try {
      const storedKeyBuffer = Buffer.from(storedKey, "base64url");
      const derivedKey = await deriveKey(
        password,
        Buffer.from(salt, "base64url"),
      );

      return (
        storedKeyBuffer.length === derivedKey.length &&
        timingSafeEqual(storedKeyBuffer, derivedKey)
      );
    } catch {
      return false;
    }
  },
};
