import { sql } from "drizzle-orm"
import type { DB } from "@/db"
import { generateCode } from "@/lib/id"

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0]

/**
 * DB-01: Atomically reserves the next code value via the native Postgres
 * SEQUENCE created by migration 0014 (`next_document_code` function).
 *
 * Trade-off vs. the previous INSERT…ON CONFLICT approach (S-01):
 * - PRO: removes row-level contention — native sequences use an internal
 *   lock-free mechanism that scales to thousands of calls per second.
 * - CON: nextval() is non-transactional — if the surrounding DB transaction
 *   rolls back, the sequence value is consumed and creates a gap in the
 *   document series (e.g. OC-2026-005 → OC-2026-007). This is acceptable
 *   for internal OC/solicitud codes; Chilean tax documents (DTE) are issued
 *   by the SII and are not affected.
 *
 * The `code_sequences` table is kept as a migration reference/fallback but
 * is no longer written by the application hot path.
 */
export async function nextCodeTx(tx: Tx, prefix: string, year = new Date().getFullYear()) {
  const result = await tx.execute<{ next_document_code: number }>(
    sql`SELECT next_document_code(${prefix}, ${year})`
  )
  // Normalize: drizzle PGlite adapter returns { rows: [...] } while
  // the postgres.js driver returns an array. Handle both.
  const rows = Array.isArray(result)
    ? result
    : (result as { rows: { next_document_code: number }[] }).rows
  const row = rows?.[0]

  if (!row) {
    throw new Error(`Failed to reserve next code for ${prefix}-${year}`)
  }
  return generateCode(prefix, row.next_document_code, year)
}
