import fs from "node:fs/promises";
import path from "node:path";

type CliArgs = {
  inputPath: string;
  outputPath: string;
};

type MetadataRow = {
  surahNumber: number;
  ayahNumber: number;
  juzNumber: number;
  pageNumber: number;
  hizbQuarter: number;
};

const EXPECTED_AYAHS = 6236;
const EXPECTED_SURAHS = 114;
const EXPECTED_PAGES = 604;
const EXPECTED_JUZ = 30;
const EXPECTED_HIZB_QUARTERS = 240;

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

  return {
    inputPath: path.resolve(args.get("--in") ?? path.resolve("prisma", "seeds", "quran-data.js")),
    outputPath: path.resolve(
      args.get("--out") ?? path.resolve("prisma", "seeds", "ayah-metadata.json")
    )
  };
}

function extractArrayBlock(raw: string, arrayName: string): string {
  const regex = new RegExp(`QuranData\\.${arrayName}\\s*=\\s*\\[(.*?)\\];`, "s");
  const match = raw.match(regex);
  if (!match || !match[1]) {
    throw new Error(`Could not find QuranData.${arrayName} array in input.`);
  }
  return match[1];
}

function parseBoundaryPairs(raw: string, arrayName: string): Array<[number, number]> {
  const block = extractArrayBlock(raw, arrayName);
  const out: Array<[number, number]> = [];
  const pairRegex = /\[\s*(\d+)\s*,\s*(\d+)\s*\]/g;
  let match: RegExpExecArray | null = pairRegex.exec(block);
  while (match) {
    out.push([Number(match[1]), Number(match[2])]);
    match = pairRegex.exec(block);
  }
  if (out.length < 2) {
    throw new Error(`QuranData.${arrayName} did not contain enough boundary pairs.`);
  }
  return out;
}

function parseSuraAyahCounts(raw: string): number[] {
  const block = extractArrayBlock(raw, "Sura");
  const counts: number[] = [0];
  const rowRegex = /\[\s*(\d+)\s*,\s*(\d+)\s*,[^\]]*]/g;
  let match: RegExpExecArray | null = rowRegex.exec(block);
  while (match) {
    counts.push(Number(match[2]));
    match = rowRegex.exec(block);
  }
  if (counts.length - 1 !== EXPECTED_SURAHS) {
    throw new Error(
      `Parsed ${counts.length - 1} surah rows from QuranData.Sura. Expected ${EXPECTED_SURAHS}.`
    );
  }
  return counts;
}

function buildSurahStarts(surahAyahCounts: number[]): number[] {
  const starts: number[] = [0];
  let index = 1;
  for (let surah = 1; surah <= EXPECTED_SURAHS; surah += 1) {
    starts[surah] = index;
    index += surahAyahCounts[surah];
  }
  const totalAyahs = index - 1;
  if (totalAyahs !== EXPECTED_AYAHS) {
    throw new Error(`Sura ayah counts produced ${totalAyahs} ayahs. Expected ${EXPECTED_AYAHS}.`);
  }
  return starts;
}

function toAyahIndex(
  surah: number,
  ayah: number,
  surahAyahCounts: number[],
  surahStarts: number[]
): number {
  if (surah === 115 && ayah === 1) {
    return EXPECTED_AYAHS + 1;
  }
  if (surah < 1 || surah > EXPECTED_SURAHS) {
    throw new Error(`Invalid surah number: ${surah}`);
  }
  if (ayah < 1 || ayah > surahAyahCounts[surah]) {
    throw new Error(`Invalid ayah number ${ayah} for surah ${surah}`);
  }
  return surahStarts[surah] + ayah - 1;
}

function expandBoundaryMap(
  boundaries: Array<[number, number]>,
  surahAyahCounts: number[],
  surahStarts: number[],
  expectedUnits: number,
  label: string
): number[] {
  const units = boundaries.length - 1;
  if (units !== expectedUnits) {
    throw new Error(
      `${label} boundaries define ${units} units. Expected ${expectedUnits}.`
    );
  }

  const mapping = new Array<number>(EXPECTED_AYAHS + 1).fill(0);
  for (let i = 1; i <= units; i += 1) {
    const [startSurah, startAyah] = boundaries[i - 1];
    const [endSurah, endAyah] = boundaries[i];
    const start = toAyahIndex(startSurah, startAyah, surahAyahCounts, surahStarts);
    const endExclusive = toAyahIndex(endSurah, endAyah, surahAyahCounts, surahStarts);
    for (let idx = start; idx < endExclusive; idx += 1) {
      mapping[idx] = i;
    }
  }

  for (let idx = 1; idx <= EXPECTED_AYAHS; idx += 1) {
    if (mapping[idx] === 0) {
      throw new Error(`${label} mapping is incomplete at ayah index ${idx}.`);
    }
  }

  return mapping;
}

function buildMetadataRows(
  surahAyahCounts: number[],
  surahStarts: number[],
  juzMap: number[],
  pageMap: number[],
  hizbQuarterMap: number[]
): MetadataRow[] {
  const rows: MetadataRow[] = [];
  for (let surah = 1; surah <= EXPECTED_SURAHS; surah += 1) {
    for (let ayah = 1; ayah <= surahAyahCounts[surah]; ayah += 1) {
      const idx = toAyahIndex(surah, ayah, surahAyahCounts, surahStarts);
      rows.push({
        surahNumber: surah,
        ayahNumber: ayah,
        juzNumber: juzMap[idx],
        pageNumber: pageMap[idx],
        hizbQuarter: hizbQuarterMap[idx]
      });
    }
  }
  if (rows.length !== EXPECTED_AYAHS) {
    throw new Error(`Built ${rows.length} metadata rows. Expected ${EXPECTED_AYAHS}.`);
  }
  return rows;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(args.inputPath, "utf8");

  const surahAyahCounts = parseSuraAyahCounts(raw);
  const surahStarts = buildSurahStarts(surahAyahCounts);

  const juzBoundaries = parseBoundaryPairs(raw, "Juz");
  const pageBoundaries = parseBoundaryPairs(raw, "Page");
  const hizbQuarterBoundaries = parseBoundaryPairs(raw, "HizbQaurter");

  const juzMap = expandBoundaryMap(
    juzBoundaries,
    surahAyahCounts,
    surahStarts,
    EXPECTED_JUZ,
    "Juz"
  );
  const pageMap = expandBoundaryMap(
    pageBoundaries,
    surahAyahCounts,
    surahStarts,
    EXPECTED_PAGES,
    "Page"
  );
  const hizbQuarterMap = expandBoundaryMap(
    hizbQuarterBoundaries,
    surahAyahCounts,
    surahStarts,
    EXPECTED_HIZB_QUARTERS,
    "HizbQuarter"
  );

  const rows = buildMetadataRows(
    surahAyahCounts,
    surahStarts,
    juzMap,
    pageMap,
    hizbQuarterMap
  );

  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.outputPath, JSON.stringify(rows, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Built ${rows.length} metadata rows at ${args.outputPath} from ${args.inputPath}.`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
