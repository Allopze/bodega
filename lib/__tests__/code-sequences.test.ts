import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { nextCodeTx } from "@/lib/code-sequences"

let sqlite: Database.Database | null = null

function makeDb() {
  sqlite = new Database(":memory:")
  sqlite.exec(`
    create table code_sequences (
      prefix text not null,
      year integer not null,
      next_value integer not null default 1,
      updated_at text not null default (datetime('now')),
      primary key (prefix, year)
    );
  `)
  return drizzle(sqlite, { schema })
}

afterEach(() => {
  sqlite?.close()
  sqlite = null
})

describe("nextCodeTx", () => {
  it("issues sequential codes per prefix and year inside a transaction", () => {
    const db = makeDb()
    const codes = db.transaction((tx) => [
      nextCodeTx(tx, "SOL", 2026),
      nextCodeTx(tx, "SOL", 2026),
      nextCodeTx(tx, "OC", 2026),
      nextCodeTx(tx, "SOL", 2027),
    ])

    expect(codes).toEqual([
      "SOL-2026-0001",
      "SOL-2026-0002",
      "OC-2026-0001",
      "SOL-2027-0001",
    ])
  })
})
