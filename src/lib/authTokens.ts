import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

export type ParsedRefreshToken = {
  tokenId: string;
  secret: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"]
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function createRawRefreshToken(tokenId: string): ParsedRefreshToken & { raw: string } {
  const secret = crypto.randomBytes(48).toString("base64url");
  return {
    tokenId,
    secret,
    raw: `${tokenId}.${secret}`
  };
}

export function parseRawRefreshToken(raw: string): ParsedRefreshToken | null {
  const [tokenId, secret] = raw.split(".");
  if (!tokenId || !secret) {
    return null;
  }
  return { tokenId, secret };
}

export function refreshTokenExpiryFromNow(days: number): Date {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return now;
}
