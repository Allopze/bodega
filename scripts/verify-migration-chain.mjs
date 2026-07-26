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
  tags.add(entry.tag)
  previousWhen = entry.when
}

const latest = entries.at(-1)
console.log(`[migrations] verified ${entries.length} entries through ${latest.tag}`)
