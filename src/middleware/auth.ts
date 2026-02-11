import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/authTokens";
import { HttpError } from "../lib/http";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.header("authorization");
  if (!raw || !raw.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }
  const token = raw.slice("Bearer ".length).trim();
  try {
    req.authUser = verifyAccessToken(token);
    next();
  } catch {
    throw new HttpError(401, "Invalid access token");
  }
}
