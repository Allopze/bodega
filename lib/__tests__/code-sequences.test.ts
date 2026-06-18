import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { nextCodeTx } from "@/lib/code-sequences"
import type { Tx } from "@/db"

let pg: PGlite | null = null

async function makeDb() {
  pg = new PGlite()
  await pg.exec(`
    create table code_sequences (
      prefix text not null,
      year integer not null,
      next_value integer not null default 1,
      updated_at timestamptz not null default now(),
      primary key (prefix, year)
    );
  `)
  return drizzle(pg, { schema })
}

afterEach(async () => {
  await pg?.close()
  pg = null
})

describe("nextCodeTx", () => {
  it("issues sequential codes per prefix and year inside a transaction", async () => {
    const db = await makeDb()
    const codes = await db.transaction(async (tx) => [
      await nextCodeTx(tx as unknown as Tx, "SOL", 2026),
      await nextCodeTx(tx as unknown as Tx, "SOL", 2026),
      await nextCodeTx(tx as unknown as Tx, "OC", 2026),
      await nextCodeTx(tx as unknown as Tx, "SOL", 2027),
    ])

    expect(codes).toEqual([
      "SOL-2026-0001",
      "SOL-2026-0002",
      "OC-2026-0001",
      "SOL-2027-0001",
    ])
  })

  it("never issues the same code twice under concurrent transactions (S-01 regression)", async () => {
    const db = await makeDb()

    // Run 20 concurrent transactions each requesting 5 codes for the same prefix.
    // The set of all returned codes must be exactly 100 unique values.
    const CONCURRENCY = 20
    const PER_TX = 5

    const allResults = await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const codes: string[] = []
        await db.transaction(async (tx) => {
          for (let i = 0; i < PER_TX; i++) {
            codes.push(await nextCodeTx(tx as unknown as Tx, "RACE", 2026))
          }
        })
        return codes
      }),
    )

    const flat = allResults.flat()
    expect(flat).toHaveLength(CONCURRENCY * PER_TX)
    expect(new Set(flat).size).toBe(flat.length)

    // Codes must be sequential 1..100 (no gaps, no duplicates).
    const numbers = flat
      .map((c) => Number(c.split("-").pop()))
      .sort((a, b) => a - b)
    expect(numbers).toEqual(
      Array.from({ length: CONCURRENCY * PER_TX }, (_, i) => i + 1),
    )
  })
})
