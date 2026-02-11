import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import {
  createRawRefreshToken,
  parseRawRefreshToken,
  refreshTokenExpiryFromNow,
  signAccessToken
} from "../../lib/authTokens";
import { HttpError } from "../../lib/http";
import { hashPassword, hashRefreshTokenSecret, verifyPassword, verifyRefreshTokenSecret } from "../../lib/password";
import { prisma } from "../../lib/prisma";

type AuthResponse = {
  user: {
    id: string;
    email: string;
  };
  access_token: string;
  refresh_token: string;
  refresh_token_expires_at: string;
};

async function createTokenPair(user: { id: string; email: string }, rotatedFromTokenId?: string): Promise<AuthResponse> {
  const refreshTokenId = randomUUID();
  const refreshRaw = createRawRefreshToken(refreshTokenId);
  const refreshHash = await hashRefreshTokenSecret(refreshRaw.secret, env.REFRESH_TOKEN_PEPPER);
  const expiresAt = refreshTokenExpiryFromNow(env.JWT_REFRESH_TTL_DAYS);

  await prisma.refreshToken.create({
    data: {
      id: refreshTokenId,
      userId: user.id,
      tokenHash: refreshHash,
      expiresAt,
      rotatedFromTokenId: rotatedFromTokenId ?? null
    }
  });

  return {
    user,
    access_token: signAccessToken({
      sub: user.id,
      email: user.email
    }),
    refresh_token: refreshRaw.raw,
    refresh_token_expires_at: expiresAt.toISOString()
  };
}

export async function signup(email: string, password: string): Promise<AuthResponse> {
  const existing = await prisma.user.findUnique({
    where: { email }
  });
  if (existing) {
    throw new HttpError(409, "Email already in use");
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash
    },
    select: {
      id: true,
      email: true
    }
  });
  return createTokenPair(user);
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({
    where: { email }
  });
  if (!user) {
    throw new HttpError(401, "Invalid credentials");
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    throw new HttpError(401, "Invalid credentials");
  }

  return createTokenPair({
    id: user.id,
    email: user.email
  });
}

function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return undefined;
}

function isPrismaNotFoundError(error: unknown): boolean {
  return prismaErrorCode(error) === "P2025";
}

export async function refresh(rawRefreshToken: string): Promise<AuthResponse> {
  const parsed = parseRawRefreshToken(rawRefreshToken);
  if (!parsed) {
    throw new HttpError(401, "Invalid refresh token");
  }

  const tokenRow = await prisma.refreshToken.findUnique({
    where: { id: parsed.tokenId },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });
  if (!tokenRow || tokenRow.revokedAt || tokenRow.expiresAt < new Date()) {
    throw new HttpError(401, "Refresh token expired or revoked");
  }

  const secretOk = await verifyRefreshTokenSecret(
    tokenRow.tokenHash,
    parsed.secret,
    env.REFRESH_TOKEN_PEPPER
  );
  if (!secretOk) {
    throw new HttpError(401, "Invalid refresh token");
  }

  try {
    await prisma.refreshToken.update({
      where: { id: tokenRow.id },
      data: {
        revokedAt: new Date()
      }
    });
  } catch (error) {
    if (!isPrismaNotFoundError(error)) {
      throw error;
    }
  }

  return createTokenPair(tokenRow.user, tokenRow.id);
}
