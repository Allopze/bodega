#!/usr/bin/env node

/**
 * Fail fast before a deploy if Drizzle's journal and SQL files diverge.
 *
 * This does not inspect the database. It verifies the release artifact that
 * will be used by `db:migrate`, so a production database at migration 0096
 * can safely advance through every pending migration up to the release head.
 *
 * DAT-002: además de la FORMA de la cadena (journal contra archivos), ahora
 * inspecciona el CONTENIDO de los .sql. Las tres comprobaciones y el criterio
 * por el que se eligieron —objetivas y sin falsos positivos— están
 * documentadas en `scripts/migration-sql-checks.mjs`:
 *
 *   1. Una migración ya publicada no puede reescribirse (manifiesto de
 *      checksums en `db/migrations/meta/_sql-checksums.json`).
 *   2. Ningún `DROP` de objeto sin `IF EXISTS` nuevo (lo heredado, congelado
 *      por conteo).
 *   3. Ningún .sql sin una sola sentencia ejecutable.
 *
 * Al agregar una migración hay que registrar su checksum:
 *   node scripts/verify-migration-chain.mjs --update-checksums
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  compareChecksums,
  findUnguardedDrops,
  isEffectivelyEmpty,
  sqlChecksum,
} from "./migration-sql-checks.mjs"

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

/* ── DAT-002 · inspección del SQL ─────────────────────────────────────────── */

/**
 * Cota de `DROP` de objeto sin `IF EXISTS` heredados. No se corrigen los
 * archivos existentes —reescribir una migración ya aplicada es exactamente lo
 * que la comprobación 1 prohíbe—, pero se impide que nazcan nuevos. Igual
 * criterio que `LEGACY_OVERLONG_IDENTIFIERS`.
 */
const LEGACY_UNGUARDED_DROPS = 180

const checksumsPath = join(migrationsDir, "meta", "_sql-checksums.json")
const updateChecksums = process.argv.includes("--update-checksums")

const actualChecksums = {}
const unguardedDrops = []
const emptyMigrations = []

for (const entry of entries) {
  const sqlPath = join(migrationsDir, `${entry.tag}.sql`)
  const sqlText = readFileSync(sqlPath, "utf8")
  actualChecksums[entry.tag] = sqlChecksum(sqlText)

  if (isEffectivelyEmpty(sqlText)) {
    emptyMigrations.push(entry.tag)
  }
  for (const drop of findUnguardedDrops(sqlText)) {
    unguardedDrops.push(`${entry.tag}: ${drop}`)
  }
}

if (updateChecksums) {
  writeFileSync(checksumsPath, `${JSON.stringify(sortKeys(actualChecksums), null, 2)}\n`)
  console.log(`[migrations] checksum manifest updated (${Object.keys(actualChecksums).length} entries)`)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(checksumsPath, "utf8"))
} catch (error) {
  throw new Error(
    `Could not read the SQL checksum manifest at ${checksumsPath}: ${error.message}. ` +
    "Generate it with `node scripts/verify-migration-chain.mjs --update-checksums`.",
  )
}

const { changed, missing } = compareChecksums(manifest, actualChecksums)
if (changed.length > 0) {
  throw new Error(
    `${changed.length} already-published migration(s) were rewritten: ${changed.join(", ")}. ` +
    "Rewriting an applied migration does NOT re-run it: production keeps the old shape while the " +
    "repository claims the new one. Add a NEW migration instead. If the change is intentional and " +
    "the migration was never applied anywhere, re-record it with " +
    "`node scripts/verify-migration-chain.mjs --update-checksums`.",
  )
}
if (missing.length > 0) {
  throw new Error(
    `${missing.length} published migration(s) disappeared from the tree: ${missing.join(", ")}.`,
  )
}

if (emptyMigrations.length > 0) {
  throw new Error(
    `${emptyMigrations.length} migration(s) contain no executable statement: ${emptyMigrations.join(", ")}. ` +
    "A journal entry whose SQL is empty is a packaging mistake, not a no-op.",
  )
}

if (unguardedDrops.length > LEGACY_UNGUARDED_DROPS) {
  const nuevos = unguardedDrops.length - LEGACY_UNGUARDED_DROPS
  throw new Error(
    `${nuevos} new unguarded DROP(s) without IF EXISTS. A migration that drops an object which is ` +
    "already gone aborts the whole deploy and cannot be re-applied. Add IF EXISTS. " +
    `Total: ${unguardedDrops.length}, allowed legacy baseline: ${LEGACY_UNGUARDED_DROPS}.\n` +
    unguardedDrops.slice(LEGACY_UNGUARDED_DROPS).join("\n"),
  )
}

function sortKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
}

console.log(
  `[migrations] verified ${entries.length} entries through ${latest.tag}` +
  ` (${overlong.length}/${LEGACY_OVERLONG_IDENTIFIERS} legacy over-long identifiers,` +
  ` ${unguardedDrops.length}/${LEGACY_UNGUARDED_DROPS} legacy unguarded DROPs, SQL checksums verified)`,
)
