# Reglas de base de datos (`db/`)

Se cargan cuando se trabaja dentro de `db/`.

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
