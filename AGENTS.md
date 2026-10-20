# AGENTS.md: Accounted

Swedish accounting SaaS: double-entry bookkeeping under Swedish accounting law (Bokföringslagen) for sole traders (enskild firma) and limited companies (aktiebolag). Multi-tenant: users belong to companies via `company_members`; `teams` group companies for consultants.

This file is the entry point for Codex and other agents that do not read `CLAUDE.md` on their own. It deliberately does not duplicate the project rules: an earlier copy drifted from `CLAUDE.md` within weeks (missing the inline-rättelse correction path, a stale tenancy resolution order, an outdated MCP tool count). Read `CLAUDE.md` first and follow it as written.

## Source of truth: `CLAUDE.md`

`CLAUDE.md` at the repo root holds everything that applies to every agent, and it wins whenever this file and it disagree:

- **Hard Rules**: the seven accounting invariants (the two sanctioned correction paths, storno and inline rättelse; engine-only journal writes; balanced entries; period locks; document retention; money math; account numbers as strings) and the general prohibitions (migrations, extension imports, dependencies, the gnubok → Accounted rename, `.env.local`, diff scope, no em or en dashes).
- **When Uncertain**: stop and ask; Swedish domain questions go through the `swedish-*` skills, never training data.
- **Definition of Done**: every item, including last-mile verification in-session (migration applied, PR merged, routine observed firing, or the final output states exactly what is not live yet) and the three answers from **Fix From First Principles** in the PR body.
- **Commands**, **Architecture** (tenancy resolution, application-side MFA plus server-enforced session limits, event bus, Supabase clients, extensions, the 150+ MCP tools), **Repository Map**, **Testing**, and the **Decision Log** (`DECISIONS.md`).

Do not copy sections from `CLAUDE.md` into this file; link to them instead.

## Codex-specific working constraints

These apply to Codex sessions run by Emil (Mattsson) and were added 2026-07-21; they are not in `CLAUDE.md` because they describe one operator's environment rather than the product. Keep them here.

- **Apply migrations only to the `erp-base` Supabase project's `staging` branch.** Never apply migrations to a local database or a locally hosted Supabase instance.
- **Never write to the `erp-base` Supabase production database without Emil's explicit approval for the specific write.** Production reads are allowed, including fetching data for a requested account, but no INSERT, UPDATE, DELETE, DDL, migration, mutating RPC, repair, seed, or other state-changing operation may run until Emil has clearly said okay. Do not infer approval from a request to investigate, diagnose, fix code, or fetch data.
- **Never write directly to the `main` branch without Emil's explicit approval.** Do not commit, push, merge, or otherwise update `main`; use a feature branch unless Emil clearly approves the specific main-branch write.
- **Never open, start, or run Docker locally.** Do not run Docker commands or commands that start Docker-managed services.

The Emil / `erp-base` rules above do **not** apply to a separate self-hosted fork database (for example an Oracle or Docker Supabase stack that is not the hosted `erp-base` project). For those, follow [Fork / self-host: migrations sync](#fork--self-host-migrations-sync) when the operator asks to sync or when schema drift is blocking the live app.

## Fork / self-host: migrations sync

A git merge of `erp-mafia/accounted` into a fork, and a typical self-host app deploy (`docker compose up --build`, image pull, `git pull` of the app), update **application code only**. They do **not** run `supabase/migrations/`. Schema drift is therefore the default failure mode after a fork sync: PostgREST answers with "Could not find the column/function/table in the schema cache", MCP tools fail, and booking/invoice paths break while the UI still looks current.

`docs/SELF-HOSTING.md` covers a clean first install (bootstrap, then every file in order). This section is the **catch-up** path for a long-lived fork DB that already has data and may have no reliable `supabase_migrations.schema_migrations` history (or only a partial one).

### When to run it

- After merging upstream `main` into the fork, or after deploying a newer app image, when the operator asks to sync migrations / fix schema errors.
- When live errors name missing columns, RPCs, or tables that exist in `supabase/migrations/` on the deployed revision.

### Hard rules (same as `CLAUDE.md`)

- Never edit an existing file under `supabase/migrations/`.
- Never invent DDL that is not already in a committed migration: apply the repo SQL (or the remainder of a file after an already-applied `ADD COLUMN`).
- Do not backfill a fake contiguous `schema_migrations` history from a half-applied DB: that lies to future `supabase db push` / branching. Prefer an operator log on the host (for example `~/accounted/ops/applied-migrations.log` with one `OK <filename>` line per successful file).
- Keep local WIP out of the sync commit; stash before merge if needed.
- Do not mass-apply every missing file blindly when the DB is not a clean prefix of the migration list: probe first, apply in dependency order, continue past independent failures, stop and investigate when a failure is mid-chain (SIE job backbone, bank booking locks, assets).

### Procedure

1. **Code sync first.** On the fork checkout: `git fetch upstream main` (and `origin`), merge or rebase per the fork's practice, push the fork remote if the operator asked to ship. Confirm the self-host checkout is on the same app revision the container runs (`git rev-parse HEAD` on the host vs deploy).
2. **Inventory drift.** Against the live Postgres (usually `docker exec … psql` into `supabase-db`), probe for objects that migrations in the deployed tree create: tables (`to_regclass`), functions (`to_regprocedure` / `pg_proc`), and columns (`information_schema.columns`). A practical window is "migrations newer than the oldest missing sentinel" (recently: roughly `20260911` onward when SIE/inbox/invoice columns were absent while later columns like `email_digest_frequency` already existed).
3. **Apply missing files in filename order**, from the host checkout that matches the running app:

   ```bash
   # Example shape; keep a durable OK/FAIL log on the host.
   for f in supabase/migrations/<needed>.sql; do
     docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <"$f" \
       && echo "OK $(basename "$f")" >> ops/applied-migrations.log \
       || echo "FAIL $(basename "$f")" >> ops/applied-migrations.log
     docker exec supabase-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"
   done
   ```

4. **Partial files.** If an earlier hand-fix already added some columns (`ADD COLUMN` without `IF NOT EXISTS`), apply the rest of that migration (functions, indexes, grants) rather than re-running the whole file and aborting. Prefer `CREATE OR REPLACE` only where the migration itself uses it or the object already exists and the file uses bare `CREATE FUNCTION`.
5. **Verify.** Reload PostgREST (`NOTIFY pgrst, 'reload schema'`). Re-hit the failing path: MCP `accounted_get_agent_briefing`, a report that uses `acquire_sie_period_read`, create/send invoice, categorize. Confirm `is_balanced` / HTTP 200 rather than schema-cache errors.
6. **Record.** Append a one-line note to `DECISIONS.md` only when the catch-up path itself changed (new host log location, new probe script). Per-file apply noise stays in the host log, not in git.

### What "done" means for a fork sync

Git is merged **and** the live DB has the migrations the new code needs for the workflows in use. Shipping an app image without the SQL catch-up is an incomplete sync. Remaining failures that need an older dependency (for example a column added in an earlier unapplied file) are listed to the operator with the blocking migration name; do not leave the session claiming the fork is synced while schema-cache errors remain on the reported paths.

## Path-specific guidance (`.claude/rules/`)

The files below are the shared source of truth for path-specific guidance. Claude Code loads them through their `paths` frontmatter. Codex does not interpret that frontmatter, so before reading, editing, reviewing, or otherwise working with a matching path, read and follow the listed rule. Do not duplicate the rule bodies here.

- `.claude/rules/design.md`: design system, locked tokens (`src/app/**`, `src/components/**`)
- `.claude/rules/i18n.md`: sv/en conventions, "stays Swedish" surfaces
- `.claude/rules/api-routes.md`: `withRouteContext` route pattern, endpoint map (`src/app/api/**`)
- `.claude/rules/database.md`: migration rules, key tables/RPCs/triggers, pg-real (`supabase/migrations/**`)
- `.claude/rules/mcp-server.md`: MCP tool authoring, staged-operation pattern, OAuth 2.1 connector auth
- `.claude/rules/bookkeeping.md`: BAS accounts, VAT treatments/rutor, `src/lib/core/` services
- `.claude/rules/legal-forms.md`: capability profiles, never `=== 'aktiebolag'` at call sites; contract in `docs/LEGAL-FORMS.md` (`src/lib/company/**`, templates, year-end, import)
