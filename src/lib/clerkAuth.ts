import { randomUUID } from "node:crypto";
import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AccessTokenPayload } from "./authTokens";
import { HttpError } from "./http";
import { hashPassword } from "./password";
import { prisma } from "./prisma";

type ClerkClaims = jwt.JwtPayload & {
  email?: string;
  email_address?: string;
};

let jwksClientCache: ReturnType<typeof jwksClient> | null = null;

function normalizeOriginlessEmail(value: string): string {
  return value.trim().toLowerCase();
}

function fallbackEmailForClerkSub(clerkSub: string): string {
  const safe = clerkSub.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `clerk_${safe}@clerk.local`;
}

function getClaimEmail(claims: ClerkClaims): string | null {
  const email = typeof claims.email === "string" ? claims.email : claims.email_address;
  if (!email || email.trim().length === 0) {
    return null;
  }
  return normalizeOriginlessEmail(email);
}

function getJwksClient() {
  if (!env.CLERK_JWKS_URL) {
    throw new HttpError(500, "CLERK_JWKS_URL is required when CLERK_AUTH_ENABLED=true");
  }
  if (!jwksClientCache) {
    jwksClientCache = jwksClient({
      jwksUri: env.CLERK_JWKS_URL,
      cache: true,
      cacheMaxEntries: 10,
      cacheMaxAge: 10 * 60 * 1000
    });
  }
  return jwksClientCache;
}

async function verifyClerkJwt(token: string): Promise<ClerkClaims> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== "object" || !("header" in decoded)) {
    throw new HttpError(401, "Invalid Clerk token");
  }

  const kid = (decoded as { header?: { kid?: string } }).header?.kid;
  if (!kid) {
    throw new HttpError(401, "Invalid Clerk token");
  }

  const key = await getJwksClient().getSigningKey(kid);
  const signingKey = key.getPublicKey();

  const verifyOptions: jwt.VerifyOptions = {
    algorithms: ["RS256"]
  };
  if (env.CLERK_JWT_ISSUER) {
    verifyOptions.issuer = env.CLERK_JWT_ISSUER;
  }
  if (env.CLERK_JWT_AUDIENCE.length > 0) {
    verifyOptions.audience = env.CLERK_JWT_AUDIENCE as unknown as
      | string
      | RegExp
      | [string | RegExp, ...(string | RegExp)[]];
  }

  const payload = jwt.verify(token, signingKey, verifyOptions);
  if (!payload || typeof payload !== "object") {
    throw new HttpError(401, "Invalid Clerk token");
  }
  return payload as ClerkClaims;
}

async function ensureLocalUser(clerkSub: string, preferredEmail: string | null) {
  if (preferredEmail) {
    const byEmail = await prisma.user.findUnique({
      where: { email: preferredEmail },
      select: { id: true, email: true }
    });
    if (byEmail) {
      return byEmail;
    }
  }

  const fallbackEmail = fallbackEmailForClerkSub(clerkSub);
  const byFallback = await prisma.user.findUnique({
    where: { email: fallbackEmail },
    select: { id: true, email: true }
  });
  if (byFallback) {
    return byFallback;
  }

  const emailToCreate = preferredEmail ?? fallbackEmail;
  try {
    return await prisma.user.create({
      data: {
        email: emailToCreate,
        // Placeholder hash; auth is delegated to Clerk for these users.
        passwordHash: await hashPassword(randomUUID())
      },
      select: { id: true, email: true }
    });
  } catch {
    // Handle concurrent first-login race by re-reading.
    const existing = await prisma.user.findUnique({
      where: { email: emailToCreate },
      select: { id: true, email: true }
    });
    if (existing) {
      return existing;
    }
    throw new HttpError(500, "Failed to provision local user for Clerk identity");
  }
}

export async function verifyClerkTokenToLocalUser(token: string): Promise<AccessTokenPayload> {
  const claims = await verifyClerkJwt(token);
  const clerkSub = claims.sub;
  if (!clerkSub) {
    throw new HttpError(401, "Invalid Clerk token");
  }

  const preferredEmail = getClaimEmail(claims);
  const user = await ensureLocalUser(clerkSub, preferredEmail);

  return {
    sub: user.id,
    email: user.email
  };
}
