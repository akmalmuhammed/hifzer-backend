import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { verifyAccessToken } from "../lib/authTokens";
import { verifyClerkTokenToLocalUser } from "../lib/clerkAuth";
import { HttpError } from "../lib/http";

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const raw = req.header("authorization");
  if (!raw || !raw.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }
  const token = raw.slice("Bearer ".length).trim();

  try {
    req.authUser = verifyAccessToken(token);
    next();
    return;
  } catch {
    if (!env.CLERK_AUTH_ENABLED) {
      throw new HttpError(401, "Invalid access token");
    }
  }

  try {
    req.authUser = await verifyClerkTokenToLocalUser(token);
    next();
  } catch {
    throw new HttpError(401, "Invalid access token");
  }
}
