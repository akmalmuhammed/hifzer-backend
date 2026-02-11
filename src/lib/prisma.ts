import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const logLevels: Array<"warn" | "error" | "query"> = ["warn", "error"];
  if (env.PRISMA_QUERY_LOGS) {
    logLevels.push("query");
  }

  const prisma = new PrismaClient({
    log: logLevels
  });

  return prisma;
}

export const prisma = global.__prisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}
