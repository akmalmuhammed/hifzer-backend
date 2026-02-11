# Neon Backup and Point-in-Time Recovery (PITR) Runbook

Use this runbook for production data safety on Neon.

## Goal

- Ensure continuous backups are available.
- Be able to restore the database to a precise timestamp.
- Prove recovery works with regular drills.

## 1) Enable/verify automatic backups in Neon

In Neon Console:

1. Open your project.
2. Go to settings for backups/restore window.
3. Confirm PITR/backup retention is enabled for your plan.
4. Record retention duration in your ops notes.

Minimum policy:

- Keep PITR enabled at all times.
- Do not deploy without active backup retention.

## 2) Pre-deploy safety check

Before major schema changes:

1. Confirm current branch is healthy.
2. Ensure migrations are committed in `prisma/migrations`.
3. Run:

```bash
pnpm prisma:status
```

4. Apply migration:

```bash
pnpm prisma:deploy
```

## 3) Restore drill (recommended monthly)

Do not wait for incidents. Test recovery monthly:

1. Pick a timestamp in the recent past.
2. Create a restore branch/database from that timestamp in Neon.
3. Point a temporary `DATABASE_URL` to the restored branch.
4. Run:

```bash
pnpm db:verify
```

5. Confirm critical row counts and app connectivity.
6. Document recovery time and issues.

## 4) Incident recovery flow

If production data is corrupted:

1. Freeze writes (maintenance mode if possible).
2. Choose target restore timestamp.
3. Restore to new branch/database from timestamp.
4. Validate with:

```bash
pnpm db:verify
```

5. Switch application `DATABASE_URL` to restored branch.
6. Monitor logs, error rates, and key endpoints.

## 5) Optional API-based automation

Neon exposes restore/backups API endpoints for automation (CI/runbooks).
Use service-account/API keys stored securely (not in repo).

Official references:

- Restore endpoints: https://api-docs.neon.tech/reference/getprojectbranchrestore
- Backup endpoints: https://api-docs.neon.tech/reference/listprojectbranchbackups

## 6) Security reminders

- Never commit live database credentials.
- Rotate credentials immediately if leaked.
- Keep `DATABASE_URL` only in Render/Vercel secret stores.
