// Standalone migration runner for the production image.
//
// `drizzle-kit` is a devDependency and is NOT present in the Next standalone
// output, so we cannot run `drizzle-kit migrate` inside the prod container.
// Instead we use the programmatic migrator from `drizzle-orm` (a runtime
// dependency, traced into `.next/standalone/node_modules`) plus the `db/migrations`
// folder copied into the image. Run with plain `node scripts/migrate.mjs`.
//
// Idempotent: drizzle records applied migrations in its journal table, so
// re-running on every deploy is a no-op once the schema is up to date.
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import {
  assertAllMigrationsApplied,
  inspectSkippedMigrations,
  runMigrationPreflight,
} from "./migration-preflight.mjs"

const MIGRATIONS_DIR = "./db/migrations"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("[migrate] DATABASE_URL is required")
  process.exit(1)
}

const RETRIES = 10
const DELAY_MS = 3000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const isConnRefused = (err) =>
  err?.code === "ECONNREFUSED" || err?.cause?.code === "ECONNREFUSED"

for (let attempt = 1; attempt <= RETRIES; attempt++) {
  const sql = postgres(url, { max: 1 })
  try {
    console.log(`[migrate] checking migration preconditions… (attempt ${attempt}/${RETRIES})`)
    await runMigrationPreflight(sql)
    console.log(`[migrate] applying migrations… (attempt ${attempt}/${RETRIES})`)
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR })
    // El migrador decide con una sola marca de agua (`MAX(created_at)`) y no
    // informa lo que se saltó, así que declara éxito con migraciones ausentes.
    // Sin esta comprobación el deploy sigue y falla mucho después, en un script
    // de datos, contra una columna que nunca se creó.
    assertAllMigrationsApplied(await inspectSkippedMigrations(sql, MIGRATIONS_DIR))
    console.log("[migrate] done")
    await sql.end({ timeout: 5 })
    process.exit(0)
  } catch (err) {
    await sql.end({ timeout: 5 }).catch(() => {})
    // Only the DB-not-ready case is retriable; real SQL/migration errors fail fast.
    if (attempt < RETRIES && isConnRefused(err)) {
      console.warn(`[migrate] db not ready, retrying in ${DELAY_MS}ms…`)
      await sleep(DELAY_MS)
      continue
    }
    console.error("[migrate] failed:", err)
    process.exit(1)
  }
}
