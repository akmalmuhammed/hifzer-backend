import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/hifz_os?schema=public"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(16).default("replace_me_access_secret_12345"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_TOKEN_PEPPER: z.string().min(8).default("replace_me_refresh_pepper"),
  SENTRY_DSN: z.string().default(""),
  SENTRY_ENVIRONMENT: z.string().default(""),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  OBSERVABILITY_DEBUG_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OBSERVABILITY_DEBUG_TOKEN: z.string().default(""),
  PRISMA_QUERY_LOGS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CLERK_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CLERK_JWKS_URL: z.string().default(""),
  CLERK_JWT_ISSUER: z.string().default(""),
  CLERK_JWT_AUDIENCE: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    ),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://127.0.0.1:3000,https://hifzer-frontend.vercel.app")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter((origin) => origin.length > 0)
    ),
  PROCESS_EVENTS_INLINE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);
