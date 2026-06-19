/**
 * PGlite-compatible migration runner.
 *
 * The drizzle PGlite migrator sends each migration file as a single prepared
 * statement via pg.exec(). PGlite chokes on files that contain multiple SQL
 * statements separated by ";", which is common in production-focused
 * migrations (DO blocks, function definitions followed by backfill, etc.).
 *
 * This helper reads each migration file via the Drizzle journal, splits
 * top-level statements (respecting $$ dollar-quoting), and executes them
 * individually. It is idempotent: it tracks already-applied migrations in a
 * `_pglite_migrations` table so repeated calls skip previously applied files.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import type { PGlite } from "@electric-sql/pglite"

/**
 * Split SQL text into individual top-level statements.
 *
 * Handles:
 * - Dollar-quote blocks ($$ ... $$, $tag$ ... $tag$)
 * - Single-line comments (--)
 * - Multi-line comments (/ * ... * /)
 * - Standard single-quote strings ('...')
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ""
  let i = 0

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1] ?? ""

    // Single-line comment
    if (ch === "-" && next === "-") {
      current += "--"
      i += 2
      while (i < sql.length && sql[i] !== "\n") { current += sql[i]; i++ }
      continue
    }

    // Multi-line comment
    if (ch === "/" && next === "*") {
      current += "/*"
      i += 2
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) { current += sql[i]; i++ }
      if (i < sql.length) { current += "*/"; i += 2 }
      continue
    }

    // Single-quote string
    if (ch === "'") {
      current += "'"
      i++
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === "\\") { current += sql[i] + (sql[i + 1] ?? ""); i += 2 }
        else { current += sql[i]; i++ }
      }
      if (i < sql.length) { current += "'"; i++ }
      continue
    }

    // Dollar-quote block ($$ or $tag$)
    if (ch === "$") {
      const quoteStart = i
      i++
      let tag = ""
      while (i < sql.length) {
        const char = sql[i]
        if (char === undefined || char === "$" || char === "(" || /[\s;]/.test(char)) break
        tag += char
        i++
      }
      if (i < sql.length && sql[i] === "$") {
        i++
        const closer = "$" + tag + "$"
        current += sql.slice(quoteStart, i)
        const closeIdx = sql.indexOf(closer, i)
        if (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + closer.length)
          i = closeIdx + closer.length
        }
      } else {
        i = quoteStart + 1
        current += "$"
      }
      continue
    }

    // Statement terminator
    if (ch === ";") {
      const trimmed = (current + ";").trim()
      if (trimmed && trimmed !== ";") statements.push(trimmed)
      current = ""
      i++
      continue
    }

    current += ch
    i++
  }

  const trimmed = current.trim()
  if (trimmed) statements.push(trimmed.endsWith(";") ? trimmed : trimmed + ";")

  return statements
}

/**
 * Apply Drizzle migrations to a PGlite instance.
 * Idempotent via _pglite_migrations tracking table.
 */
export async function migratePGlite(pg: PGlite, migrationsFolder: string): Promise<void> {
  // Ensure tracking table exists
  await pg.exec([
    "CREATE TABLE IF NOT EXISTS _pglite_migrations (",
    "  tag TEXT PRIMARY KEY,",
    "  applied_at TEXT NOT NULL DEFAULT (now())",
    ")",
  ].join("\n"))

  const metaDir = path.join(migrationsFolder, "meta")
  const journalPath = path.join(metaDir, "_journal.json")
  const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
    entries: { idx: number; tag: string; when: number; breakpoints: boolean }[]
  }

  // Read already-applied migrations
  const applied = new Set<string>()
  try {
    const result = await pg.exec("SELECT tag FROM _pglite_migrations")
    for (const queryResult of result) {
      for (const row of queryResult.rows ?? []) applied.add(String(row.tag))
    }
  } catch {
    /* first call - table is empty */
  }

  for (const entry of journal.entries) {
    if (applied.has(entry.tag)) continue

    const filePath = path.join(migrationsFolder, entry.tag + ".sql")
    const sql = await fs.readFile(filePath, "utf8")
    const statements = splitSqlStatements(sql)

    // Transaction: all statements succeed or roll back together
    await pg.exec("BEGIN")
    try {
      for (const stmt of statements) {
        if (stmt.trim()) await pg.exec(stmt)
      }
      await pg.exec("INSERT INTO _pglite_migrations (tag) VALUES ('" + entry.tag.replace(/'/g, "''") + "')")
      await pg.exec("COMMIT")
    } catch (e) {
      await pg.exec("ROLLBACK")
      throw e
    }
  }

  // ── Post-migration patch: PGlite-compatible next_document_code function ──
  // Migration 0014 creates a function backed by native SEQUENCE objects via
  // EXECUTE format(...) with DDL, which PGlite does not support. Replace it
  // with the old INSERT...ON CONFLICT approach that uses the code_sequences
  // table (kept as a reference/fallback as documented in the migration).
  await pg.exec(`
    CREATE OR REPLACE FUNCTION next_document_code(p_prefix text, p_year int)
    RETURNS int
    LANGUAGE sql
    AS $$
      INSERT INTO code_sequences (prefix, year, next_value)
      VALUES (p_prefix, p_year, 2)
      ON CONFLICT (prefix, year)
      DO UPDATE SET next_value = code_sequences.next_value + 1
      RETURNING next_value - 1
    $$;
  `).catch(() => {
    /* code_sequences table might not exist in some PGlite setups */
  })
}

export { splitSqlStatements }
