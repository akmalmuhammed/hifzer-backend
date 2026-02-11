import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  PROCESS_EVENTS_INLINE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);
