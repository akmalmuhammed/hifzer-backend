import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const dbUrlForOps = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = dbUrlForOps
  ? new PrismaClient({ datasources: { db: { url: dbUrlForOps } } })
  : new PrismaClient();

const ayahSchema = z.object({
  id: z.number().int().positive(),
  surahNumber: z.number().int().min(1).max(114),
  ayahNumber: z.number().int().positive(),
  juzNumber: z.number().int().min(1).max(30),
  pageNumber: z.number().int().positive(),
  hizbQuarter: z.number().int().positive().optional(),
  textUthmani: z.string().optional()
});

const ayahArraySchema = z.array(ayahSchema);

async function main(): Promise<void> {
  const seedPath = process.env.AYAHS_SEED_PATH
    ? path.resolve(process.env.AYAHS_SEED_PATH)
    : path.resolve(__dirname, "seeds", "ayahs.template.json");

  const fileRaw = await fs.readFile(seedPath, "utf8");
  const parsed = JSON.parse(fileRaw) as unknown;
  const ayahs = ayahArraySchema.parse(parsed);

  const seen = new Set<number>();
  const seenKeys = new Set<string>();
  for (const ayah of ayahs) {
    if (seen.has(ayah.id)) {
      throw new Error(`Duplicate ayah id found in seed file: ${ayah.id}`);
    }
    seen.add(ayah.id);

    const ayahKey = `${ayah.surahNumber}:${ayah.ayahNumber}`;
    if (seenKeys.has(ayahKey)) {
      throw new Error(`Duplicate surah/ayah key found in seed file: ${ayahKey}`);
    }
    seenKeys.add(ayahKey);
  }

  for (const ayah of ayahs) {
    await prisma.ayah.upsert({
      where: { id: ayah.id },
      create: ayah,
      update: ayah
    });
  }

  if (ayahs.length !== 6236) {
    // MVP warning only. Partial fixture data is acceptable for local dev.
    // eslint-disable-next-line no-console
    console.warn(
      `Warning: seeded ${ayahs.length} ayahs. Expected 6236 for full Qur'an metadata.`
    );
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${ayahs.length} ayahs from ${seedPath}`);
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
