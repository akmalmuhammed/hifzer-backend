import type { AccessTokenPayload } from "../lib/authTokens";

declare global {
  namespace Express {
    interface Request {
      authUser?: AccessTokenPayload;
    }
  }
}

export {};
