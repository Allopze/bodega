import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { registry } from "@/modules/registry"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema })

const RETIRED_MAINTENANCE_TABLES = [
  "maintenance_plans",
  "maintenance_records",
  "maintenance_tasks",
  "maintenance_parts",
  "maintenance_labor",
  "maintenance_documents",
  "maintenance_document_policies",
] as const

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

describe("retiro del módulo antiguo de mantenciones", () => {
  it("no registra el módulo ni sus permisos", () => {
    expect(registry.some((module) => (module.id as string) === "mantenciones")).toBe(false)
    expect(ALL_MODULE_PERMISSIONS).not.toContain("mantenciones:view")
    expect(ALL_MODULE_PERMISSIONS).not.toContain("mantenciones:create")
    expect(ALL_MODULE_PERMISSIONS).not.toContain("mantenciones:edit")
    expect(ALL_MODULE_PERMISSIONS).not.toContain("mantenciones:approve_costs")
  })

  it("elimina las siete tablas antiguas", async () => {
    const tableNames = await Promise.all(RETIRED_MAINTENANCE_TABLES.map(async (table) => {
      const result = await pg.query<{ table_name: string | null }>(
        "SELECT to_regclass($1)::text AS table_name",
        [`public.${table}`],
      )
      return result.rows[0]?.table_name ?? null
    }))
    expect(tableNames).toEqual(Array(RETIRED_MAINTENANCE_TABLES.length).fill(null))
  })

  it("retira egreso_mantencion del control de tipos de movimiento", async () => {
    const result = await pg.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'inventory_movements'::regclass
        AND conname = 'inventory_movements_type_valid'
    `)
    expect(result.rows[0]?.definition).toBeTruthy()
    expect(result.rows[0]?.definition).not.toContain("egreso_mantencion")
  })

  it("rechaza destinos OnWay que creen órdenes antiguas", async () => {
    await expect(db.insert(schema.fleetGpsAlertRules).values({
      id: "rule-to-retired-maintenance",
      category: "mechanical",
      destination: "maintenance",
    })).rejects.toThrow()
  })
})
