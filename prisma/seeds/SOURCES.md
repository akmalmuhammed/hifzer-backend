# Seed Sources

- Canonical Arabic text: Tanzil Uthmani export (local file, no runtime fetch).
- Metadata (page/juz/hizb): provide local JSON mapping keyed by `surahNumber + ayahNumber`.

## Required local files

1. `prisma/seeds/tanzil-uthmani.txt`
2. `prisma/seeds/ayah-metadata.json`
3. (optional source) `prisma/seeds/quran-data.js`

Both files are gitignored by default to avoid committing licensed/raw source payloads.

## Build metadata from Tanzil `quran-data.js`

```bash
curl -L -o prisma/seeds/quran-data.js "https://tanzil.net/res/text/metadata/quran-data.js"
pnpm seed:metadata -- \
  --in prisma/seeds/quran-data.js \
  --out prisma/seeds/ayah-metadata.json
```

## Build canonical JSON for Prisma seed

```bash
pnpm seed:build -- \
  --tanzil prisma/seeds/tanzil-uthmani.txt \
  --metadata prisma/seeds/ayah-metadata.json \
  --out prisma/seeds/ayahs.full.json
```

Then seed Postgres:

```bash
AYAHS_SEED_PATH=./prisma/seeds/ayahs.full.json pnpm seed
```
