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
})
