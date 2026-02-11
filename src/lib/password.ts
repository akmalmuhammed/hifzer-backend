import argon2 from "argon2";

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

export function hashRefreshTokenSecret(secret: string, pepper: string): Promise<string> {
  return argon2.hash(`${secret}:${pepper}`, { type: argon2.argon2id });
}

export function verifyRefreshTokenSecret(
  hash: string,
  secret: string,
  pepper: string
): Promise<boolean> {
  return argon2.verify(hash, `${secret}:${pepper}`);
}
