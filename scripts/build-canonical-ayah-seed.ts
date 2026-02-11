import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

type CliArgs = {
  tanzilPath: string;
  metadataPath: string;
  outPath: string;
  allowPartial: boolean;
};

type TanzilAyah = {
  surahNumber: number;
  ayahNumber: number;
  textUthmani: string;
};

type AyahMetadata = {
  surahNumber: number;
  ayahNumber: number;
  juzNumber: number;
  pageNumber: number;
  hizbQuarter?: number;
};

type CanonicalAyah = {
  id: number;
  surahNumber: number;
  ayahNumber: number;
  juzNumber: number;
  pageNumber: number;
  hizbQuarter?: number;
  textUthmani: string;
};

const metadataSchema = z.object({
  surahNumber: z.number().int().min(1).max(114),
  ayahNumber: z.number().int().positive(),
  juzNumber: z.number().int().min(1).max(30),
  pageNumber: z.number().int().min(1).max(604),
  hizbQuarter: z.number().int().positive().optional()
});

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, value);
    i += 1;
  }

  const tanzilPath = args.get("--tanzil") ?? path.resolve("prisma", "seeds", "tanzil-uthmani.txt");
  const metadataPath =
    args.get("--metadata") ?? path.resolve("prisma", "seeds", "ayah-metadata.template.json");
  const outPath = args.get("--out") ?? path.resolve("prisma", "seeds", "ayahs.full.json");
  const allowPartial = args.get("--allow-partial") === "true";

  return {
    tanzilPath: path.resolve(tanzilPath),
    metadataPath: path.resolve(metadataPath),
    outPath: path.resolve(outPath),
    allowPartial
  };
}

function keyOf(surahNumber: number, ayahNumber: number): string {
  return `${surahNumber}:${ayahNumber}`;
}

function readNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function parseMetadataRows(raw: unknown): AyahMetadata[] {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidates = ["rows", "items", "ayahs", "data"];
    for (const candidate of candidates) {
      if (Array.isArray(obj[candidate])) {
        rows = obj[candidate] as unknown[];
        break;
      }
    }
  }

  if (rows.length === 0) {
    throw new Error(
      "Metadata file did not contain an array. Expected either a root array or one of: rows/items/ayahs/data."
    );
  }

  return rows.map((row, idx) => {
    if (!row || typeof row !== "object") {
      throw new Error(`Invalid metadata row at index ${idx}: not an object`);
    }
    const item = row as Record<string, unknown>;
    const normalized = {
      surahNumber: readNumber(item, ["surahNumber", "surah_number", "surah", "surah_id"]),
      ayahNumber: readNumber(item, ["ayahNumber", "ayah_number", "ayah", "verse_number"]),
      juzNumber: readNumber(item, ["juzNumber", "juz_number", "juz"]),
      pageNumber: readNumber(item, ["pageNumber", "page_number", "page"]),
      hizbQuarter: readNumber(item, ["hizbQuarter", "hizb_quarter", "rub_el_hizb"])
    };
    return metadataSchema.parse(normalized);
  });
}

function parseTanzilText(raw: string): TanzilAyah[] {
  const rows = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const parsed: TanzilAyah[] = [];
  for (const line of rows) {
    const firstSep = line.indexOf("|");
    const secondSep = line.indexOf("|", firstSep + 1);
    if (firstSep <= 0 || secondSep <= firstSep + 1) {
      throw new Error(`Invalid Tanzil line format: ${line}`);
    }
    const surahRaw = line.slice(0, firstSep);
    const ayahRaw = line.slice(firstSep + 1, secondSep);
    const text = line.slice(secondSep + 1);
    const surahNumber = Number(surahRaw);
    const ayahNumber = Number(ayahRaw);
    if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber) || text.length === 0) {
      throw new Error(`Invalid Tanzil line values: ${line}`);
    }
    parsed.push({
      surahNumber,
      ayahNumber,
      textUthmani: text
    });
  }

  return parsed;
}

function ensureNoDuplicates<T extends { surahNumber: number; ayahNumber: number }>(
  rows: T[],
  label: string
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row.surahNumber, row.ayahNumber);
    if (seen.has(key)) {
      throw new Error(`Duplicate ${label} ayah key: ${key}`);
    }
    seen.add(key);
  }
}

function mergeCanonicalRows(
  textRows: TanzilAyah[],
  metadataRows: AyahMetadata[],
  allowPartial: boolean
): CanonicalAyah[] {
  ensureNoDuplicates(textRows, "Tanzil text");
  ensureNoDuplicates(metadataRows, "metadata");

  const textByKey = new Map<string, TanzilAyah>();
  for (const row of textRows) {
    textByKey.set(keyOf(row.surahNumber, row.ayahNumber), row);
  }
  const metadataByKey = new Map<string, AyahMetadata>();
  for (const row of metadataRows) {
    metadataByKey.set(keyOf(row.surahNumber, row.ayahNumber), row);
  }

  const textOnly = [...textByKey.keys()].filter((key) => !metadataByKey.has(key));
  const metadataOnly = [...metadataByKey.keys()].filter((key) => !textByKey.has(key));
  if (textOnly.length > 0 || metadataOnly.length > 0) {
    const textOnlyPreview = textOnly.slice(0, 5).join(", ");
    const metadataOnlyPreview = metadataOnly.slice(0, 5).join(", ");
    throw new Error(
      `Text/metadata mismatch. textOnly=${textOnly.length} [${textOnlyPreview}] metadataOnly=${metadataOnly.length} [${metadataOnlyPreview}]`
    );
  }

  const keys = [...textByKey.keys()].sort((a, b) => {
    const [surahA, ayahA] = a.split(":").map(Number);
    const [surahB, ayahB] = b.split(":").map(Number);
    if (surahA !== surahB) {
      return surahA - surahB;
    }
    return ayahA - ayahB;
  });

  const canonical = keys.map((key, idx) => {
    const text = textByKey.get(key)!;
    const metadata = metadataByKey.get(key)!;
    return {
      id: idx + 1,
      surahNumber: metadata.surahNumber,
      ayahNumber: metadata.ayahNumber,
      juzNumber: metadata.juzNumber,
      pageNumber: metadata.pageNumber,
      hizbQuarter: metadata.hizbQuarter,
      textUthmani: text.textUthmani
    };
  });

  if (!allowPartial && canonical.length !== 6236) {
    throw new Error(
      `Canonical merge produced ${canonical.length} ayahs. Expected exactly 6236. Use --allow-partial for local fixture work.`
    );
  }

  return canonical;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const [textRaw, metadataRaw] = await Promise.all([
    fs.readFile(args.tanzilPath, "utf8"),
    fs.readFile(args.metadataPath, "utf8")
  ]);

  const textRows = parseTanzilText(textRaw);
  const metadataRows = parseMetadataRows(JSON.parse(metadataRaw) as unknown);
  const canonicalRows = mergeCanonicalRows(textRows, metadataRows, args.allowPartial);

  await fs.mkdir(path.dirname(args.outPath), { recursive: true });
  await fs.writeFile(args.outPath, JSON.stringify(canonicalRows, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(
    `Built ${canonicalRows.length} canonical ayahs at ${args.outPath} using Tanzil text + metadata map.`
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
