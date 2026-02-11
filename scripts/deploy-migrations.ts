import { execSync } from "node:child_process";
import { config } from "dotenv";

config();

// For Neon, CLI migrations are more stable on non-pooled connections.
const dbUrlForOps = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!dbUrlForOps) {
  // eslint-disable-next-line no-console
  console.error("DATABASE_URL or DIRECT_URL is required");
  process.exit(1);
}

try {
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: dbUrlForOps
    }
  });
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
}
