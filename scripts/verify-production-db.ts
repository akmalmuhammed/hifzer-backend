import { PrismaClient } from "@prisma/client";

const dbUrlForOps = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = dbUrlForOps
  ? new PrismaClient({ datasources: { db: { url: dbUrlForOps } } })
  : new PrismaClient();

const EXPECTED_AYAHS_COUNT = 6236;
const EXPECTED_MIGRATIONS = [
  "20260211031144_init",
  "20260211071247_add_critical_features",
  "20260211092350_add_assessment_scaffolding_v2"
] as const;

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const ayahCount = await prisma.ayah.count();
  const migrationRows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    ORDER BY migration_name ASC
  `;

  const applied = new Set(migrationRows.map((row) => row.migration_name));
  const missingMigrations = EXPECTED_MIGRATIONS.filter((name) => !applied.has(name));
  const unfinishedMigrations = migrationRows
    .filter((row) => row.finished_at === null)
    .map((row) => row.migration_name);

  // eslint-disable-next-line no-console
  console.log("=== Production DB Verification ===");
  // eslint-disable-next-line no-console
  console.log(`Ayah rows: ${ayahCount}`);
  // eslint-disable-next-line no-console
  console.log(`Expected ayah rows: ${EXPECTED_AYAHS_COUNT}`);
  // eslint-disable-next-line no-console
  console.log(`Applied migrations: ${migrationRows.length}`);
  // eslint-disable-next-line no-console
  console.log(`Missing expected migrations: ${missingMigrations.length}`);
  if (missingMigrations.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  -> ${missingMigrations.join(", ")}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Unfinished migrations: ${unfinishedMigrations.length}`);
  if (unfinishedMigrations.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  -> ${unfinishedMigrations.join(", ")}`);
  }

  const isAyahCountValid = ayahCount === EXPECTED_AYAHS_COUNT;
  const isMigrationSetValid = missingMigrations.length === 0 && unfinishedMigrations.length === 0;
  const ok = isAyahCountValid && isMigrationSetValid;

  // eslint-disable-next-line no-console
  console.log(ok ? "STATUS: OK" : "STATUS: FAILED");

  if (!ok) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
