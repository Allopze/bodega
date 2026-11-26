import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq, inArray } from "drizzle-orm"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { syncRecordSchema, type SyncRecord } from "@/lib/mantencion/contracts"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { daysAgo, IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Pautas preventivas de los formularios externos (encargo 2026-11-26): el seed siembra A
 * (maquinaria, h), B (camiones, km) y C (camiones, h) con texto y orden exactos, es idempotente y
 * no pisa una pauta editada; y el flujo real del mecánico (registro → estado del equipo) recorre
 * cada pauta hasta cerrar el ciclo y volver al primer hito.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { seedPreventivePautas, PREVENTIVE_PAUTAS, SEED_ACTOR, itemKey } = await import("@/lib/services/mantencion/pautas-preventivas/seed")
const { ITEMS_MAQUINARIA } = await import("@/lib/services/mantencion/pautas-preventivas/items-maquinaria")
const { ITEMS_CAMIONES } = await import("@/lib/services/mantencion/pautas-preventivas/items-camiones")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { assignEquipment } = await import("@/lib/services/mantencion/schedule-assign")
const { loadFleet } = await import("@/lib/services/mantencion/fleet")
const { getUserRbacById } = await import("@/lib/auth/rbac")

const [A, B, C] = PREVENTIVE_PAUTAS.map((spec) => spec.name) as [string, string, string]

async function scheduleByName(name: string) {
  const [row] = await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.name, name))
  if (!row) throw new Error(`No existe la pauta ${name}`)
  return row
}

async function contextOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    userName: rbac.name, deviceId: "dev-test", credentialId: "cred-test",
    viewer: { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal },
  }
}

async function photos(kinds: Array<"filtros" | "sticker">) {
  const list = []
  for (const kind of kinds) {
    const id = crypto.randomUUID()
    await insertOrphanPhoto(testDb, { id, userId: IDS.mecBio, kind })
    list.push({ id, kind })
  }
  return list
}

/** Preventiva con TODOS los ítems de la pauta; el primero «No aplica» y el resto «Realizado». */
async function preventive(input: {
  vehicleId: string; scheduleName: string; items: readonly string[]; reading: number; intervalValue: number; workDate: string
  withPhotos?: boolean
}): Promise<SyncRecord> {
  const schedule = await scheduleByName(input.scheduleName)
  const spec = PREVENTIVE_PAUTAS.find((candidate) => candidate.name === input.scheduleName)!
  return syncRecordSchema.parse({
    id: crypto.randomUUID(), vehicleId: input.vehicleId, reading: input.reading, workDate: input.workDate,
    signedAt: new Date().toISOString(), offlineSince: null, deviceId: crypto.randomUUID(), appVersion: "test",
    readingJumpConfirmed: true, duplicateConfirmed: true, correctsRecordId: null,
    kind: "P", scheduleId: schedule.id, scheduleVersion: schedule.version, intervalValue: input.intervalValue,
    suggestedIntervalValue: input.intervalValue, manualScheduleReason: null,
    items: input.items.map((_, index) => ({ itemKey: itemKey(spec, index), value: index === 0 ? "NA" : "R", reason: null })),
    notes: "Sin novedad",
    // Sin el sticker la preventiva no puede cerrarse (regla 8: una de filtros + una del sticker).
    photos: await photos(input.withPhotos === false ? ["filtros"] : ["filtros", "sticker"]),
  })
}

async function statusOf(vehicleId: string) {
  const [row] = await loadFleet({ scope: "all", vehicleIds: [vehicleId] })
  if (!row) throw new Error(`Sin fila de flota para ${vehicleId}`)
  return row.status
}

/** Un equipo nuevo en Biodiversa, sin pauta, con lectura inicial 10. */
async function createVehicle(id: string, code: string, input: { typeId: string; meterType: "odometer" | "hour_meter"; unit: "km" | "h" | null }) {
  await testDb.insert(schema.fuelVehicles).values({
    id, code, plate: code, type: "Equipo", equipmentTypeId: input.typeId, worksiteId: IDS.wsBio, isActive: true, meterType: input.meterType,
  })
  await testDb.insert(schema.mantEquipmentProfiles).values({
    vehicleId: id, brandId: IDS.brandScania, unit: input.unit, initialReading: 10, initialReadingDate: daysAgo(60),
  })
}

async function assign(scheduleName: string, vehicleId: string) {
  const schedule = await scheduleByName(scheduleName)
  const outcome = await assignEquipment({ userId: IDS.jefe, email: null }, { scheduleId: schedule.id, vehicleIds: [vehicleId] })
  expect(outcome.ok).toBe(true)
}

async function sign(input: Parameters<typeof preventive>[0]) {
  const outcome = await createRecord(await preventive(input), await contextOf(IDS.mecBio))
  if (!outcome.body.ok) throw new Error(`Se esperaba éxito: ${outcome.body.message}`)
  return outcome.body
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
})

describe("seed de las pautas preventivas", () => {
  it("la simulación no deja nada escrito", async () => {
    const report = await seedPreventivePautas(testDb, { dryRun: true })
    expect(report.pautas.map((pauta) => pauta.status)).toEqual(["creada", "creada", "creada"])
    const rows = await testDb.select().from(schema.mantSchedules).where(inArray(schema.mantSchedules.name, [A, B, C]))
    expect(rows).toHaveLength(0)
  })

  it("siembra las tres pautas con medición, hitos, ciclo, texto y orden exactos", async () => {
    const report = await seedPreventivePautas(testDb)
    expect(report.changed).toBe(true)
    expect(report.pautas.map((pauta) => [pauta.name, pauta.status])).toEqual([[A, "creada"], [B, "creada"], [C, "creada"]])

    const expected = [
      { name: A, unit: "h", intervals: [300, 600, 900, 1200], items: ITEMS_MAQUINARIA, count: 37 },
      { name: B, unit: "km", intervals: [40000, 80000, 120000], items: ITEMS_CAMIONES, count: 48 },
      { name: C, unit: "h", intervals: [300, 600, 900], items: ITEMS_CAMIONES, count: 48 },
    ]
    for (const want of expected) {
      const schedule = await scheduleByName(want.name)
      expect(schedule).toMatchObject({ unit: want.unit, cyclic: true, version: 1, deletedAt: null })
      const intervals = await testDb.select().from(schema.mantScheduleIntervals)
        .where(eq(schema.mantScheduleIntervals.scheduleId, schedule.id)).orderBy(asc(schema.mantScheduleIntervals.value))
      expect(intervals.map((row) => row.value)).toEqual(want.intervals)
      const items = await testDb.select().from(schema.mantScheduleItems)
        .where(eq(schema.mantScheduleItems.scheduleId, schedule.id)).orderBy(asc(schema.mantScheduleItems.sortOrder))
      expect(items).toHaveLength(want.count)
      expect(items.map((row) => row.name)).toEqual([...want.items])
      expect(items.map((row) => row.sortOrder)).toEqual(items.map((_, index) => index))
      const cells = await testDb.select().from(schema.mantScheduleItemIntervals)
        .where(inArray(schema.mantScheduleItemIntervals.itemId, items.map((row) => row.id)))
      expect(cells).toHaveLength(want.count * want.intervals.length)
      expect(cells.every((cell) => cell.applies)).toBe(true)
      const [version] = await testDb.select().from(schema.mantScheduleVersions).where(eq(schema.mantScheduleVersions.scheduleId, schedule.id))
      expect(version?.snapshot).toMatchObject({ cyclic: true, intervals: want.intervals, unit: want.unit })
    }
    // El ítem compartido entre maquinaria y camiones conserva el mismo texto.
    expect(ITEMS_MAQUINARIA).toContain("Prueba de baterías")
    expect(ITEMS_CAMIONES).toContain("Prueba de baterías")

    const audit = await testDb.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "mant_schedule"), eq(schema.auditLog.userEmail, SEED_ACTOR)))
    expect(audit.map((row) => row.entityCode).sort()).toEqual([A, B, C].sort())
    expect(audit.every((row) => row.userId === null && row.action === "create")).toBe(true)
  })

  it("la segunda corrida no cambia nada", async () => {
    const before = await testDb.select().from(schema.auditLog)
    const report = await seedPreventivePautas(testDb)
    expect(report.changed).toBe(false)
    expect(report.pautas.map((pauta) => pauta.status)).toEqual(["sin_cambios", "sin_cambios", "sin_cambios"])
    expect(await testDb.select().from(schema.auditLog)).toHaveLength(before.length)
    expect(await testDb.select().from(schema.mantSchedules).where(inArray(schema.mantSchedules.name, [A, B, C]))).toHaveLength(3)
  })

  it("una pauta editada a mano no se pisa: se informa la diferencia", async () => {
    const c = await scheduleByName(C)
    await testDb.update(schema.mantScheduleItems).set({ name: "Revisión turbo y admisión" })
      .where(and(eq(schema.mantScheduleItems.scheduleId, c.id), eq(schema.mantScheduleItems.itemKey, "c46")))
    const report = await seedPreventivePautas(testDb)
    expect(report.pautas.map((pauta) => pauta.status)).toEqual(["sin_cambios", "sin_cambios", "distinta"])
    const distinct = report.pautas[2]
    expect(distinct?.status === "distinta" && distinct.differences).toEqual(["ítem 46: «Revisión turbo y admisión» (se esperaba «Revisión turbo»)"])
    const [item] = await testDb.select().from(schema.mantScheduleItems)
      .where(and(eq(schema.mantScheduleItems.scheduleId, c.id), eq(schema.mantScheduleItems.itemKey, "c46")))
    expect(item?.name).toBe("Revisión turbo y admisión")
    await testDb.update(schema.mantScheduleItems).set({ name: "Revisión turbo" }).where(eq(schema.mantScheduleItems.id, item!.id))
  })
})

describe("flujo del mecánico con las pautas cíclicas", () => {
  it("A (maquinaria, h): 300 → 600 → 900 → 1.200 y vuelve a 300 en 1.500", async () => {
    await createVehicle("v-pa", "PA-01", { typeId: "fet-test-h", meterType: "hour_meter", unit: null })
    await assign(A, "v-pa")
    expect(await statusOf("v-pa")).toMatchObject({ nextReading: 300, nextIntervalValue: 300 })

    const ctx = await contextOf(IDS.mecBio)
    const sinFotos = await createRecord(
      await preventive({ vehicleId: "v-pa", scheduleName: A, items: ITEMS_MAQUINARIA, reading: 300, intervalValue: 300, workDate: daysAgo(20), withPhotos: false }),
      ctx,
    )
    expect(sinFotos.body.ok).toBe(false)
    expect(!sinFotos.body.ok && sinFotos.body.field).toBe("photos")

    await sign({ vehicleId: "v-pa", scheduleName: A, items: ITEMS_MAQUINARIA, reading: 300, intervalValue: 300, workDate: daysAgo(20) })
    const [record] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.vehicleId, "v-pa"))
    const items = await testDb.select().from(schema.mantRecordItems).where(eq(schema.mantRecordItems.recordId, record!.id))
    expect(items).toHaveLength(37)
    expect(items.filter((item) => item.value === "NA")).toHaveLength(1)
    expect(await statusOf("v-pa")).toMatchObject({ nextReading: 600, nextIntervalValue: 600 })

    await sign({ vehicleId: "v-pa", scheduleName: A, items: ITEMS_MAQUINARIA, reading: 600, intervalValue: 600, workDate: daysAgo(15) })
    expect(await statusOf("v-pa")).toMatchObject({ nextReading: 900, nextIntervalValue: 900 })
    await sign({ vehicleId: "v-pa", scheduleName: A, items: ITEMS_MAQUINARIA, reading: 900, intervalValue: 900, workDate: daysAgo(10) })
    expect(await statusOf("v-pa")).toMatchObject({ nextReading: 1200, nextIntervalValue: 1200 })
    await sign({ vehicleId: "v-pa", scheduleName: A, items: ITEMS_MAQUINARIA, reading: 1200, intervalValue: 1200, workDate: daysAgo(5) })
    expect(await statusOf("v-pa")).toMatchObject({ nextReading: 1500, nextIntervalValue: 300 })
    // 1.800 h es el hito 600 de la segunda vuelta (con la regla 4 habría sido 900).
    await sign({ vehicleId: "v-pa", scheduleName: A, items: ITEMS_MAQUINARIA, reading: 1500, intervalValue: 300, workDate: daysAgo(3) })
    expect(await statusOf("v-pa")).toMatchObject({ nextReading: 1800, nextIntervalValue: 600 })
  })

  it("B (camiones, km): 40.000 → 80.000; tras 120.000 vuelve a 40.000 en 160.000", async () => {
    await createVehicle("v-pb", "PB-01", { typeId: "fet-test-km", meterType: "odometer", unit: null })
    await assign(B, "v-pb")
    const ctx = await contextOf(IDS.mecBio)
    const sinFotos = await createRecord(
      await preventive({ vehicleId: "v-pb", scheduleName: B, items: ITEMS_CAMIONES, reading: 40000, intervalValue: 40000, workDate: daysAgo(20), withPhotos: false }),
      ctx,
    )
    expect(!sinFotos.body.ok && sinFotos.body.field).toBe("photos")
    await sign({ vehicleId: "v-pb", scheduleName: B, items: ITEMS_CAMIONES, reading: 40000, intervalValue: 40000, workDate: daysAgo(20) })
    expect(await statusOf("v-pb")).toMatchObject({ nextReading: 80000, nextIntervalValue: 80000 })
    await sign({ vehicleId: "v-pb", scheduleName: B, items: ITEMS_CAMIONES, reading: 80000, intervalValue: 80000, workDate: daysAgo(15) })
    await sign({ vehicleId: "v-pb", scheduleName: B, items: ITEMS_CAMIONES, reading: 120000, intervalValue: 120000, workDate: daysAgo(10) })
    expect(await statusOf("v-pb")).toMatchObject({ nextReading: 160000, nextIntervalValue: 40000 })
    // El servidor sugiere el hito 40.000 en 160.000: firmarlo no pide motivo de elección manual.
    const record = await sign({ vehicleId: "v-pb", scheduleName: B, items: ITEMS_CAMIONES, reading: 160000, intervalValue: 40000, workDate: daysAgo(5) })
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, record.id))
    expect(row).toMatchObject({ intervalValue: 40000, suggestedIntervalValue: 40000, manualScheduleReason: null })
  })

  it("C (camiones, h): 300 → 600; tras 900 vuelve a 300 en 1.200", async () => {
    await createVehicle("v-pc", "PC-01", { typeId: "fet-test-km", meterType: "odometer", unit: "h" })
    await assign(C, "v-pc")
    await sign({ vehicleId: "v-pc", scheduleName: C, items: ITEMS_CAMIONES, reading: 300, intervalValue: 300, workDate: daysAgo(20) })
    expect(await statusOf("v-pc")).toMatchObject({ nextReading: 600, nextIntervalValue: 600 })
    await sign({ vehicleId: "v-pc", scheduleName: C, items: ITEMS_CAMIONES, reading: 900, intervalValue: 900, workDate: daysAgo(10) })
    expect(await statusOf("v-pc")).toMatchObject({ nextReading: 1200, nextIntervalValue: 300 })
  })
})
