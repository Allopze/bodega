import { sql } from "drizzle-orm"
import type { DB } from "@/db"
import { codeSequences } from "@/db/schema"
import { generateCode } from "@/lib/id"

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0]

/**
 * Atomically reserves the next code value for (prefix, year) and returns
 * the human-readable code.
 *
 * Implementation note (security audit S-01):
 * Postgres guarantees that INSERT … ON CONFLICT … DO UPDATE … RETURNING is
 * atomic with respect to other writers — the row is locked for the duration
 * of the statement, and the returned value reflects the value that was
 * actually written by *this* transaction. Two concurrent calls cannot
 * observe the same `next_value`.
 *
 * The previous implementation did an INSERT/ON CONFLICT followed by a
 * separate SELECT, which opened a window where two transactions could
 * race and pick the same code.
 */
export async function nextCodeTx(tx: Tx, prefix: string, year = new Date().getFullYear()) {
  const [row] = await tx
    .insert(codeSequences)
    .values({ prefix, year, nextValue: 1 })
    .onConflictDoUpdate({
      target: [codeSequences.prefix, codeSequences.year],
      set: { nextValue: sql`${codeSequences.nextValue} + 1` },
    })
    .returning({ nextValue: codeSequences.nextValue })

  if (!row) {
    throw new Error(`Failed to reserve next code for ${prefix}-${year}`)
  }
  return generateCode(prefix, row.nextValue, year)
}
