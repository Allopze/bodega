/**
 * lib/__tests__/prevention-program-slots-pglite.test.ts
 *
 * Las casillas del programa nacen con la faena.
 *
 * Lo que se protege no es que las tablas existan: es que activar una faena
 * deje las treinta casillas —24 de capacitación, 2 de simulacro, 4 de CGRD— y
 * que reejecutar no cree ninguna más ni pise el estado de las existentes.
 *
 * El modo de falla que esto vigila es el que motivó el agregador: alguien
 * agrega un cuarto punto de alta de faena, pre-genera sólo capacitación, y la
 * faena queda sin casillas de simulacro ni de CGRD — invisible hasta que llega
 * una fiscalización y nadie puede mostrar qué se esperaba que ocurriera.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const WORKSITE_ID = "slots-worksite"
const USER_ID = "slots-user"

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionGrdMeetingSlots)
  await inMemoryDb.delete(schema.preventionEmergencyDrillSlots)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "slots@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID, name: "Faena Casillas", code: "SLOTS", isActive: true,
  })
})

describe("pre-generación de las casillas del programa", () => {
  it("una faena activa recibe las treinta casillas, y reejecutar no crea ninguna más", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")

    const first = await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    expect(first).toEqual({ training: 24, drills: 2, grdMeetings: 4 })

    const second = await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    expect(second).toEqual({ training: 0, drills: 0, grdMeetings: 0 })
  })

  it("las casillas nacen pendientes y en los meses que el programa declara", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)

    const drills = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    expect(drills.map((row) => row.slotKey).sort()).toEqual(["m03-w3", "m09-w3"])
    expect(drills.every((row) => row.status === "pending")).toBe(true)
    expect(drills.every((row) => row.drillId === null)).toBe(true)

    const meetings = await inMemoryDb.select().from(schema.preventionGrdMeetingSlots)
    expect(meetings.map((row) => row.slotKey).sort()).toEqual(["m02-w1", "m03-w1", "m04-w1", "m05-w1"])
    expect(meetings.every((row) => row.status === "pending")).toBe(true)
  })

  it("reejecutar no pisa el estado de una casilla ya resuelta", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)

    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    await inMemoryDb.update(schema.preventionEmergencyDrillSlots).set({
      status: "not_applicable",
      notApplicableAt: new Date().toISOString(),
      notApplicableByUserId: USER_ID,
      notApplicableReason: "La faena no tiene instalaciones que evacuar.",
      version: 2,
    }).where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))

    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)

    const [after] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))
    expect(after).toMatchObject({ status: "not_applicable", version: 2 })
  })

  /* El CHECK de la casilla, no el servicio: una marca de "hecha" sin el
   * registro que la cumple sería una casilla en verde sin hecho detrás. */
  it("la base rechaza una casilla hecha sin el simulacro que la cumple", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)

    await expect(inMemoryDb.update(schema.preventionEmergencyDrillSlots).set({
      status: "completed",
      completedAt: new Date().toISOString(),
      completedByUserId: USER_ID,
    }).where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))).rejects.toThrow()
  })

  it("la base exige motivo de al menos diez caracteres para declarar no aplica", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionGrdMeetingSlots)

    await expect(inMemoryDb.update(schema.preventionGrdMeetingSlots).set({
      status: "not_applicable",
      notApplicableAt: new Date().toISOString(),
      notApplicableByUserId: USER_ID,
      notApplicableReason: "no va",
    }).where(eq(schema.preventionGrdMeetingSlots.id, slot!.id))).rejects.toThrow()
  })
})
