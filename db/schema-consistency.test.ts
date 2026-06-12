import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

function configuredDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL ?? "./db/chome.db"
  return path.resolve(process.cwd(), databaseUrl)
}

describe("database schema consistency", () => {
  it("has office receiving columns required by the runtime schema", () => {
    const dbPath = configuredDatabasePath()
    expect(fs.existsSync(dbPath), `${dbPath} should exist`).toBe(true)

    const sqlite = new Database(dbPath, { readonly: true })
    try {
      const columns = sqlite
        .prepare("pragma table_info(purchase_order_items)")
        .all()
        .map((column) => (column as { name: string }).name)

      expect(columns).toContain("quantity_office_received")
    } finally {
      sqlite.close()
    }
  })
})
