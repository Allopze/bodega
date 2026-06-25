<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:export-rule -->
# Export Format Rule

All data exports in this app must use **XLSX** format. Never use CSV for exports. Use a library like `xlsx` or `exceljs` to generate proper `.xlsx` files with formatting support.
<!-- END:export-rule -->

<!-- BEGIN:source-of-truth -->
# Source of truth: `lib/` + `app/`, NOT frozen module scaffolding

The live business logic is in `lib/services`, `lib/auth`, `lib/validation` and the per-feature `app/(app)/<área>/actions.ts`. The old **frozen, incomplete** "monolito modular" migration (Fase 0/1) was pruned on 2026-06-14: `core/` was removed and `modules/` now keeps only the live registry/manifest surface for navigation, permission parity checks and seed/bootstrap validation.

Rules until the migration is properly resumed:

- Make every business-logic change in `lib/` + `app/`.
- `modules/registry.ts`, `modules/permissions.ts`, `modules/manifest-types.ts` and the `modules/*/manifest.ts` files are the only live module-scaffolding parts; touch those only for nav/permissions/seed/bootstrap parity.
- Do not recreate `modules/*/{services,actions,schema,validation}` or `core/*` unless the modular migration is explicitly resumed with a reconciliation plan and parity tests.
- See `modules/README.md` and the audit at `.claude/plans/shiny-scribbling-lynx.md` (finding A1) for the reconciliation plan.
<!-- END:source-of-truth -->

<!-- BEGIN:db-migrations -->
# Database migrations: never hand-edit the journal

Drizzle applies a migration only if its `when` in `db/migrations/meta/_journal.json`
is greater than the max `created_at` already recorded in `__drizzle_migrations`.
Hand-editing those timestamps once broke the whole chain — `drizzle-kit migrate`
started **silently skipping** migrations and prod ended up missing columns while
reporting "applied successfully".

Hard rules (full explanation in `db/migrations/README.md`):

- **Never edit `meta/_journal.json` by hand**, especially the `when` values. Let
  `drizzle-kit generate` produce them; they must stay strictly increasing.
- **Never edit an already-created migration `.sql`.** Change `db/schema/*.ts` and
  run `npm run db:generate` to create a NEW migration.
- **Never "force" a migration by bumping its `when`.** That is what caused the
  incident; if a migration won't apply, the journal is broken — fix the journal,
  not the timestamp.
- **Use `db:migrate`, not `db:push`, on any DB that carries history** (prod uses
  `migrate`). `push` doesn't record migrations and desyncs the journal.
- After generating, verify `npm run db:generate` then reports "No schema changes".
- Custom SQL (functions/triggers/non-RBAC data) goes appended to the generated
  migration, idempotent, separated by `--> statement-breakpoint`. RBAC is seeded
  via `npm run db:seed`, never in migrations.
<!-- END:db-migrations -->
