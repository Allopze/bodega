/**
 * Falla si la base apuntada tiene migraciones pendientes. No aplica ninguna.
 *
 * El workflow `Deploy` migraba producción por su cuenta, desde un runner de
 * GitHub, disparado por cada push a `main`. Eso le daba a un push la capacidad
 * de aplicar migraciones destructivas **sin respaldo**: el `pg_dump` y el
 * rescate de la historia viven en `scripts/deploy-prod.sh`, no ahí.
 *
 * Migrar pasa a ser responsabilidad de un solo camino, el que respalda primero.
 * Pero la razón por la que aquel job existía sigue en pie —la auditoría DO-01:
 * que el contenedor no arranque contra un esquema viejo y sirva 500 en cada
 * consulta—, así que en su lugar queda esta compuerta: de sólo lectura, y que
 * detiene el despliegue si el esquema no está al día.
 *
 *   DATABASE_URL=… node scripts/assert-migrations-applied.mjs
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { assertAllMigrationsApplied, inspectSkippedMigrations } from "./migration-preflight.mjs"

const MIGRATIONS_DIR = "./db/migrations"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required")
  const sql = postgres(url, { max: 1 })
  try {
    const report = await inspectSkippedMigrations(sql, MIGRATIONS_DIR)
    assertAllMigrationsApplied(report)
    console.log(`[schema] al día: ${report.appliedCount} de ${report.journalCount} migraciones aplicadas`)
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    console.error(
      "\nEl despliegue automático ya no migra. Aplica las migraciones con " +
      "`npm run deploy:prod`, que respalda la base y rescata la historia antes.",
    )
    process.exitCode = 1
  })
}
