import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = ["prisma", "migrate", "deploy"];

const env = {
  ...process.env,
  // For Neon, CLI migrations are more stable on non-pooled connections.
  DATABASE_URL: process.env.DIRECT_URL || process.env.DATABASE_URL
};

const child = spawn(command, args, {
  stdio: "inherit",
  env
});

child.on("error", (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
