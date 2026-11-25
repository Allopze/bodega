import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { daysAgo, IDS, seedMantFixtures } from "@/lib/__tests__/mantencion-sync-fixtures"

// Los camiones de producción pasan a horas en Mantención y los de Biodiversa se quedan en km (2026-11-25).
// Las fixtures importan `@/db` estáticamente: se sustituye por la base PGlite antes de que se evalúe.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const ACTOR = `${IDS.jefe}@chome.test`
const NO_PROFILE = "v-sin-perfil"

async function load() { return import("../apply-medidor-camiones-2026-11") }

async function profileOf(vehicleId: string) {
  const [row] = await inMemoryDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, vehicleId))
  return row!
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(inMemoryDb as unknown as DB)
  // Biodiversa se identifica por el código de su faena, y «Camión» es de la familia de camiones.
  await inMemoryDb.update(schema.worksites).set({ code: "BIODIVERSA" }).where(eq(schema.worksites.id, IDS.wsBio))
  await inMemoryDb.update(schema.fuelEquipmentTypes).set({ performanceFamily: "camiones" }).where(eq(schema.fuelEquipmentTypes.id, "fet-test-km"))
  // Un camión de Cholguán sin ficha de Mantención: no se toca.
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id: NO_PROFILE, code: "KA-777", plate: "WXYZ-77", type: "Camión", equipmentTypeId: "fet-test-km", worksiteId: IDS.wsCho, model: "R450", year: 2021, brand: "Scania",
  })
  // Una preventiva en km vigente de KA-200 (Cholguán): debe quedar intacta como historia.
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.mantRecords).values({
    id: "rec-km", folio: "MP-KA200-KM1", kind: "P", vehicleId: IDS.truckCho,
    equipmentSnapshot: { code: "KA-200", plate: "BCDF-12", noPlate: false, type: "Camión", brand: "Volvo", model: "R450", year: 2021, worksite: "Cholguán", unit: "km" },
    worksiteId: IDS.wsCho, reading: 20_500, unit: "km", workDate: daysAgo(15),
    registeredBy: IDS.mecCho, executorKind: "yo", executorUserId: IDS.mecCho, executorName: "Pedro Cholguán",
    signedAt: now, receivedAt: now, status: "vigente", notes: "Sin novedad",
    scheduleId: IDS.schKm, scheduleVersion: 1, scheduleNameSnapshot: "Camiones y tractos", intervalValue: 10_000, suggestedIntervalValue: 10_000,
  })
}, 120_000)

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe.sequential("camiones de producción a horas (Mantención)", () => {
  it("la simulación informa y no escribe nada", async () => {
    const { applyMedidorCamiones } = await load()
    const report = await applyMedidorCamiones({ actorEmail: ACTOR })
    // KA-200 (Cholguán) y KA-300 (Arauco) se mueven; KA-135 es de Biodiversa; KA-999 está de baja; KA-777 no tiene ficha.
    expect(report.outcomes.map((o) => o.code).sort()).toEqual(["KA-200", "KA-300"])
    expect(report.outcomes.every((o) => o.result === "dry-run")).toBe(true)
    expect(report.keptInKm).toBe(1)
    expect(report.withoutProfile).toBe(1)
    expect((await profileOf(IDS.truckCho)).unit).toBeNull()
    expect((await profileOf(IDS.truckCho)).scheduleId).toBe(IDS.schKm)
    const history = await inMemoryDb.select().from(schema.mantEquipmentHistory).where(eq(schema.mantEquipmentHistory.vehicleId, IDS.truckCho))
    expect(history).toHaveLength(0)
  })

  it("con --apply pasa a horas, suelta la pauta en km, carga la lectura y conserva los registros y Combustible", async () => {
    const { applyMedidorCamiones } = await load()
    const meterBefore = (await inMemoryDb.select({ id: schema.fuelVehicles.id, meterType: schema.fuelVehicles.meterType, performanceUnit: schema.fuelVehicles.performanceUnit }).from(schema.fuelVehicles))
    const report = await applyMedidorCamiones({
      actorEmail: ACTOR,
      apply: true,
      scheduleName: "Maquinaria pesada",
      readings: { "KA-200": { reading: 6_638, date: daysAgo(2) } },
    })
    expect(report.outcomes.filter((o) => o.result === "aplicado").map((o) => o.code).sort()).toEqual(["KA-200", "KA-300"])

    const cho = await profileOf(IDS.truckCho)
    expect(cho).toMatchObject({ unit: "h", scheduleId: IDS.schH, initialReading: 6_638, initialReadingDate: daysAgo(2) })
    // Sin lectura en el archivo, el equipo queda sin lectura inicial (la de km ya no vale).
    expect(await profileOf(IDS.truckAra)).toMatchObject({ unit: "h", scheduleId: IDS.schH, initialReading: null, initialReadingDate: null })
    // Los de Biodiversa, de baja o sin ficha no se tocan.
    expect((await profileOf(IDS.truckBio)).unit).toBeNull()
    expect((await profileOf(IDS.retired)).unit).toBeNull()
    expect((await inMemoryDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, NO_PROFILE)))).toHaveLength(0)

    // El registro en km sigue vigente, con su unidad: es historia.
    const [record] = await inMemoryDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, "rec-km"))
    expect(record).toMatchObject({ unit: "km", status: "vigente", reading: 20_500 })

    // Combustible no cambia: ni el medidor ni el rendimiento de ningún vehículo.
    const meterAfter = await inMemoryDb.select({ id: schema.fuelVehicles.id, meterType: schema.fuelVehicles.meterType, performanceUnit: schema.fuelVehicles.performanceUnit }).from(schema.fuelVehicles)
    expect(meterAfter).toEqual(meterBefore)

    // Bitácora de equipo y auditoría con el motivo.
    const history = await inMemoryDb.select().from(schema.mantEquipmentHistory).where(eq(schema.mantEquipmentHistory.vehicleId, IDS.truckCho))
    expect(history).toHaveLength(1)
    expect(history[0]!.summary).toContain("Cambio de unidad de medida")
    const audits = await inMemoryDb.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "mant_equipment"), eq(schema.auditLog.entityId, IDS.truckCho)))
    expect(audits).toHaveLength(1)
  })

  it("una segunda corrida no cambia nada", async () => {
    const { applyMedidorCamiones } = await load()
    const before = await profileOf(IDS.truckCho)
    const report = await applyMedidorCamiones({ actorEmail: ACTOR, apply: true, scheduleName: "Maquinaria pesada" })
    expect(report.outcomes.every((o) => o.result === "ya estaba")).toBe(true)
    expect(await profileOf(IDS.truckCho)).toEqual(before)
    expect(await inMemoryDb.select().from(schema.mantEquipmentHistory).where(eq(schema.mantEquipmentHistory.vehicleId, IDS.truckCho))).toHaveLength(1)
  })

  it("rechaza una pauta en km, una pauta inexistente y un actor desconocido sin escribir", async () => {
    const { applyMedidorCamiones } = await load()
    await expect(applyMedidorCamiones({ actorEmail: ACTOR, apply: true, scheduleName: "Camiones y tractos" })).rejects.toThrow(/kilómetros, no en horas/)
    await expect(applyMedidorCamiones({ actorEmail: ACTOR, apply: true, scheduleName: "No existe" })).rejects.toThrow(/no existe/)
    await expect(applyMedidorCamiones({ actorEmail: "nadie@chome.test", apply: true })).rejects.toThrow(/No hay un usuario activo/)
  })

  it("se detiene si la faena de Biodiversa no existe con ese código", async () => {
    const { applyMedidorCamiones } = await load()
    await inMemoryDb.update(schema.worksites).set({ code: "BIO-OTRO" }).where(eq(schema.worksites.id, IDS.wsBio))
    try {
      await expect(applyMedidorCamiones({ actorEmail: ACTOR, apply: true })).rejects.toThrow(/No existe la faena con código BIODIVERSA/)
    } finally {
      await inMemoryDb.update(schema.worksites).set({ code: "BIODIVERSA" }).where(eq(schema.worksites.id, IDS.wsBio))
    }
  })
})
