/**
 * lib/__tests__/migration-preflight-pdtp-active.test.ts
 *
 * El chequeo `duplicateActiveYears` del preflight se prueba contra SQL real,
 * no sólo la aserción sobre un reporte fabricado: si la consulta tuviera un
 * error (un estado mal escrito, agrupar por la clave equivocada) devolvería 0
 * siempre, y la migración 0329 abortaría a mitad del despliegue con una
 * violación opaca del índice único.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { inspectMigrationPreconditions } from "../../scripts/migration-preflight.mjs"

const pg = new PGlite()
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
// Estado previo a 0329: sin el índice, dos activos del mismo año caben.
await pg.exec(`DROP INDEX IF EXISTS "pdtp_programs_one_active_per_year_unique"`)

afterAll(async () => { await pg.close() })

/** Lo mínimo del cliente `postgres` que usa el preflight: template tag y `unsafe`. */
function pgliteSql() {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "")
    return pg.query(text, values).then((result) => result.rows)
  }
  return Object.assign(tag, { unsafe: (text: string) => pg.query(text).then((result) => result.rows) })
}

async function insertProgram(id: string, year: number, version: number, status: string) {
  await pg.query(
    `insert into pdtp_programs (id, year, version, status, title, elaborated_by_name, elaborated_by_title, created_at, updated_at)
     values ($1, $2, $3, $4, 'T', 'X', 'Y', now(), now())`,
    [id, year, version, status],
  )
}

describe("preflight: años con dos programas PDTP activos", () => {
  it("cuenta un activo más un borrador del mismo año como sin conflicto", async () => {
    await insertProgram("p-a1", 2071, 1, "active")
    await insertProgram("p-a2", 2071, 2, "draft")
    const report = await inspectMigrationPreconditions(pgliteSql() as never)
    expect(report.pdtp.duplicateActiveYears).toBe(0)
  })

  it("detecta dos versiones activas del mismo año", async () => {
    await insertProgram("p-b1", 2072, 1, "active")
    await insertProgram("p-b2", 2072, 2, "active")
    const report = await inspectMigrationPreconditions(pgliteSql() as never)
    expect(report.pdtp.duplicateActiveYears).toBe(1)
  })
})
