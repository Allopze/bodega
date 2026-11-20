import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Restricciones de las tablas de turnos y ralentí que la base garantiza por sí
 * misma, aunque un servicio se equivoque: horas válidas, turno no vacío, una
 * marca por equipo y día, y la pantalla apagada al desplegar.
 */

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const WORKER = "worker-shift-schema"

beforeAll(async () => {
  await migratePGlite(pg, path.join(process.cwd(), "db/migrations"))
  await seedControlFixtures(db)
  await db.insert(schema.workers).values({ id: WORKER, firstName: "Ana", lastName: "Operadora", worksiteId: IDS.wsA })
}, 120_000)

let n = 0
function shift(overrides: Partial<typeof schema.fleetOperationShifts.$inferInsert> = {}): typeof schema.fleetOperationShifts.$inferInsert {
  n += 1
  return {
    id: `shift-schema-${n}`,
    vehicleId: IDS.vA,
    shiftDate: "2026-11-09",
    startHour: 6,
    endHour: 14,
    operatorWorkerId: WORKER,
    operatorNameSnapshot: "Ana Operadora",
    createdBy: IDS.user,
    updatedBy: IDS.user,
    ...overrides,
  }
}

describe("esquema de turnos y ralentí", () => {
  it("acepta un turno nocturno que termina al día siguiente", async () => {
    await expect(db.insert(schema.fleetOperationShifts).values(shift({ startHour: 22, endHour: 6 }))).resolves.toBeDefined()
  })

  it("rechaza un turno con inicio igual a fin", async () => {
    await expect(db.insert(schema.fleetOperationShifts).values(shift({ startHour: 6, endHour: 6 }))).rejects.toThrow()
  })

  it("rechaza horas fuera de 0–23", async () => {
    await expect(db.insert(schema.fleetOperationShifts).values(shift({ startHour: 24, endHour: 6 }))).rejects.toThrow()
  })

  it("rechaza una anulación a medias", async () => {
    await expect(db.insert(schema.fleetOperationShifts).values(shift({ voidedAt: "2026-11-10T12:00:00Z" }))).rejects.toThrow()
  })

  it("no admite dos marcas para el mismo equipo y día", async () => {
    const mark = { vehicleId: IDS.vA, day: "2026-11-09", reason: "sin_operacion_programada" as const, createdBy: IDS.user }
    await db.insert(schema.fleetOperationDayMarks).values({ id: "mark-1", ...mark })
    await expect(db.insert(schema.fleetOperationDayMarks).values({ id: "mark-2", ...mark })).rejects.toThrow()
  })

  it("rechaza un motivo de marca que no existe", async () => {
    await expect(db.insert(schema.fleetOperationDayMarks).values({
      id: "mark-3", vehicleId: IDS.vB, day: "2026-11-09", reason: "en_mantencion" as never, createdBy: IDS.user,
    })).rejects.toThrow()
  })

  it("la pantalla de turnos arranca apagada", async () => {
    const [row] = await db.select().from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "submodule.enabled:flota:/flota/turnos"))
    expect(row?.value).toBe("false")
  })
})
