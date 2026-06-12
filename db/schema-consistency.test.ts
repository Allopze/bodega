import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import path from "node:path"
import { describe, expect, it, afterAll } from "vitest"
import { sql } from "drizzle-orm"

const pg = new PGlite()
const db = drizzle(pg)

afterAll(async () => {
  await pg.close()
})

describe("database schema consistency", () => {
  it("has office receiving columns required by the runtime schema", async () => {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })

    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'purchase_order_items'
    `)

    const columns = result.rows.map((row) => (row as { column_name: string }).column_name)
    expect(columns).toContain("quantity_office_received")
  })

  it("has the user permissions join table required by direct RBAC grants", async () => {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })

    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_permissions'
    `)

    const columns = result.rows.map((row) => (row as { column_name: string }).column_name)
    expect(columns).toEqual(expect.arrayContaining(["user_id", "permission_id"]))
  })
})
