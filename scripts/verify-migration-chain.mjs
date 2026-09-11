#!/usr/bin/env node

/**
 * Fail fast before a deploy if Drizzle's journal and SQL files diverge.
 *
 * This does not inspect the database. It verifies the release artifact that
 * will be used by `db:migrate`, so a production database at migration 0096
 * can safely advance through every pending migration up to the release head.
 */
import { readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationsDir = join(root, "db", "migrations")
const journalPath = join(migrationsDir, "meta", "_journal.json")

const journal = JSON.parse(readFileSync(journalPath, "utf8"))
const entries = journal.entries
if (!Array.isArray(entries) || entries.length === 0) {
  throw new Error("Drizzle journal has no migration entries")
}

const sqlFiles = new Set(
  readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => basename(file, ".sql")),
)

const tags = new Set()
let previousWhen = -Infinity
for (const [position, entry] of entries.entries()) {
  if (entry.idx !== position) {
    throw new Error(`Migration journal index discontinuity at position ${position}: got ${entry.idx}`)
  }
  if (typeof entry.tag !== "string" || tags.has(entry.tag)) {
    throw new Error(`Migration journal contains a missing or duplicated tag at index ${position}`)
  }
  if (typeof entry.when !== "number" || entry.when <= previousWhen) {
    throw new Error(`Migration journal timestamps are not strictly increasing at ${entry.tag}`)
  }
  if (!sqlFiles.has(entry.tag)) {
    throw new Error(`Migration SQL file is missing for journal entry ${entry.tag}`)
  }
  // Drizzle nombra el snapshot por `idx`, pero el archivo .sql por su tag. Si
  // el prefijo del tag se desalinea del idx, dos migraciones distintas pueden
  // compartir prefijo y la segunda pisa el snapshot de la primera — que es
  // exactamente cómo se perdió el de 0264_eminent_shiver_man.
  const tagPrefix = Number(entry.tag.slice(0, entry.tag.indexOf("_")))
  if (!Number.isInteger(tagPrefix) || tagPrefix !== entry.idx) {
    throw new Error(`Migration tag prefix does not match its index: ${entry.tag} is at idx ${entry.idx}`)
  }
  tags.add(entry.tag)
  previousWhen = entry.when
}

const latest = entries.at(-1)

// Postgres trunca en silencio todo identificador a 63 bytes (NAMEDATALEN-1).
// Un constraint declarado con un nombre más largo existe en la base con OTRO
// nombre, así que un futuro `DROP CONSTRAINT "<nombre largo>"` generado por
// drizzle falla en el deploy. Este chequeo congela el problema donde está: no
// corrige los nombres heredados, pero impide que nazcan nuevos.
const MAX_IDENTIFIER_LENGTH = 63
const LEGACY_OVERLONG_IDENTIFIERS = 261

const latestSnapshot = join(migrationsDir, "meta", `${String(latest.idx).padStart(4, "0")}_snapshot.json`)
let overlong = []
try {
  const snapshot = JSON.parse(readFileSync(latestSnapshot, "utf8"))
  for (const [tableName, table] of Object.entries(snapshot.tables ?? {})) {
    for (const group of ["foreignKeys", "indexes", "checkConstraints", "compositePrimaryKeys", "uniqueConstraints"]) {
      for (const name of Object.keys(table[group] ?? {})) {
        if (name.length > MAX_IDENTIFIER_LENGTH) overlong.push(`${tableName}.${name} (${name.length})`)
      }
    }
  }
} catch (error) {
  throw new Error(`Could not read the latest snapshot at ${latestSnapshot}: ${error.message}`)
}

if (overlong.length > LEGACY_OVERLONG_IDENTIFIERS) {
  const nuevos = overlong.length - LEGACY_OVERLONG_IDENTIFIERS
  throw new Error(
    `${nuevos} new identifier(s) exceed ${MAX_IDENTIFIER_LENGTH} chars and would be truncated by Postgres. ` +
    `Rename them (shorter table/column names, or an explicit constraint name). Total: ${overlong.length}, ` +
    `allowed legacy baseline: ${LEGACY_OVERLONG_IDENTIFIERS}.`,
  )
}

console.log(
  `[migrations] verified ${entries.length} entries through ${latest.tag}` +
  ` (${overlong.length}/${LEGACY_OVERLONG_IDENTIFIERS} legacy over-long identifiers)`,
)
