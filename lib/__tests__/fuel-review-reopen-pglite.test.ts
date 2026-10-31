/**
 * Deshacer una decisión («Cuenta» / «No cuenta») contra Postgres real (PGlite):
 * la carga vuelve a `ok`, la serie del equipo se recalcula y lo que corresponda
 * se vuelve a marcar (la duplicada se detecta sola); permiso, alcance de faena y
 * nota de 10 a 500 caracteres; y la auditoría conserva el estado anterior.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
const revalidatePath = vi.hoisted(() => vi.fn())
const revalidateTag = vi.hoisted(() => vi.fn())
vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }))
const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/notifications", () => ({ notifyAfterCommit: vi.fn(), notifySafe: vi.fn(), notifyManyUser: vi.fn() }))
// La acción de vincular patentes arrastra los importadores: no es lo que se prueba aquí.
vi.mock("@/app/(app)/combustibles/actions-consumos", () => ({ linkConsumptionPlateAction: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import type { Tx } from "@/db"
import { decideFlaggedLoad, reopenFlaggedDecision } from "@/lib/combustibles/control/review"
import { projectTaeSubmissions } from "@/lib/combustibles/control/projection"
import { decideFlaggedLoadsAction, reopenFlaggedDecisionAction } from "@/app/(app)/combustibles/revisar/actions"

const tx = inMemoryDb as unknown as Tx

function session(worksiteIds: string[], permissions: string[] = ["combustibles:approve_flagged"]): Session {
  return {
    user: {
      id: "reviewer", name: "Jefa", email: "jefa@example.com", roles: ["jefa_chome"], permissions,
      worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true, isGlobal: false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

let seq = 0
async function submission(loadedAt: string, meterReading: number, liters = 50, extra: Partial<typeof schema.fuelTaeSubmissions.$inferInsert> = {}) {
  seq += 1
  const id = `sub-o-${seq}`
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id, clientSubmissionId: `c-${id}`, publicResultToken: `t-${id}`, worksiteId: "ws-a", vehicleId: "veh-1",
    productId: "prod-diesel", equipmentCodeSnapshot: "CAM-01", loadedAt, submittedAt: loadedAt,
    driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor", meterType: "odometer", meterReading, liters, ...extra,
  })
  return id
}

const loads = () => inMemoryDb.select().from(schema.fuelEquipmentLoads)
  .orderBy(asc(schema.fuelEquipmentLoads.occurredAt), asc(schema.fuelEquipmentLoads.id))
const audits = () => inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_equipment_load")).orderBy(asc(schema.auditLog.createdAt))

/** Dos cargas del mismo equipo con cinco minutos de diferencia, por canales distintos: la segunda es duplicada. */
async function duplicatePair() {
  const a = await submission("2026-03-01T12:00:00.000Z", 1000, 50)
  const b = await submission("2026-03-01T12:05:00.000Z", 1500, 50, { source: "legacy_xlsx" })
  await projectTaeSubmissions(tx, [a, b])
  const [first, duplicate] = await loads()
  expect(duplicate).toMatchObject({ reviewStatus: "flagged", flagReasons: ["duplicate"], duplicateOfId: first!.id })
  return { original: first!, duplicate: duplicate! }
}

/** Serie 1000 → 900 (retroceso, marcada) → 1500. */
async function seriesWithRegression() {
  const ids = [
    await submission("2026-03-01T12:00:00.000Z", 1000),
    await submission("2026-03-02T12:00:00.000Z", 900, 30),
    await submission("2026-03-03T12:00:00.000Z", 1500, 20),
  ]
  await projectTaeSubmissions(tx, ids)
  return loads()
}

describe("deshacer una decisión sobre una carga", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await inMemoryDb.delete(schema.fuelEquipmentLoads)
    await inMemoryDb.delete(schema.fuelTaeSubmissions)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await inMemoryDb.insert(schema.users).values({ id: "reviewer", name: "Jefa", email: "jefa@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-diesel", code: "DIESEL-R", name: "Diésel prueba", category: "diesel" }).onConflictDoNothing()
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-test", slug: "camion-test", name: "Camión prueba" }).onConflictDoNothing()
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: "veh-1", plate: "AAAA11", type: "camion", equipmentTypeId: "fet-test", worksiteId: "ws-a", meterType: "odometer", performanceUnit: "km_per_liter",
    })
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  it("aprobar una duplicada y deshacerla: vuelve a ser duplicada, sale de la serie y queda sin decisión", async () => {
    const { original, duplicate } = await duplicatePair()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: duplicate.id, decision: "approve", note: "Son dos cargas distintas en el día" })
    expect((await loads())[1]).toMatchObject({ reviewStatus: "approved", duplicateOfId: null, performanceStatus: "computed" })

    const result = await reopenFlaggedDecision(session(["ws-a"]), { loadId: duplicate.id, note: "Las dos eran la misma carga" })
    expect(result).toEqual({ ok: true, reviewStatus: "flagged", worksiteId: "ws-a" })

    const after = (await loads())[1]!
    expect(after).toMatchObject({
      reviewStatus: "flagged", flagReasons: ["duplicate"], duplicateOfId: original.id, performanceStatus: "excluded",
      reviewNote: null, reviewedBy: null, reviewedAt: null,
    })
  })

  it("la auditoría de deshacer guarda el estado anterior con su nota y quién la decidió", async () => {
    const { duplicate } = await duplicatePair()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: duplicate.id, decision: "approve", note: "Son dos cargas distintas en el día" })
    await reopenFlaggedDecision(session(["ws-a"]), { loadId: duplicate.id, note: "Las dos eran la misma carga" })

    const trail = await audits()
    expect(trail).toHaveLength(2)
    const undo = trail[1]!
    expect(undo).toMatchObject({ action: "status_change", entityId: duplicate.id, reason: "Las dos eran la misma carga", worksiteId: "ws-a", userId: "reviewer" })
    expect(JSON.parse(undo.oldState!)).toMatchObject({ reviewStatus: "approved", reviewNote: "Son dos cargas distintas en el día", reviewedBy: "reviewer" })
    expect(JSON.parse(undo.newState!)).toMatchObject({ reviewStatus: "flagged", flagReasons: ["duplicate"], reopened: true })
  })

  it("rechazar una lectura que retrocede y deshacerlo: la serie vuelve a marcarla", async () => {
    const [, flagged] = await seriesWithRegression()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "reject", note: "Lectura mal digitada en terreno" })
    expect((await loads())[1]).toMatchObject({ reviewStatus: "rejected", performanceStatus: "excluded" })

    expect(await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "Se confirmó que la lectura era correcta" })).toMatchObject({ ok: true, reviewStatus: "flagged" })
    const after = await loads()
    expect(after[1]).toMatchObject({ reviewStatus: "flagged", flagReasons: ["meter_regression"], reviewNote: null })
    // La carga siguiente vuelve a calcularse con los litros del retroceso sumados al tramo.
    expect(after[2]).toMatchObject({ accumulatedLiters: 50, performanceValue: 10 })
  })

  it("si la serie ya no la marca, deshacer la deja sin observaciones", async () => {
    const [first, flagged] = await seriesWithRegression()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    // La primera carga se anula: la del retroceso pasa a ser la primera de la serie y nada la contradice.
    await inMemoryDb.update(schema.fuelEquipmentLoads).set({ voidedAt: "2026-03-05T00:00:00.000Z", voidReason: "Duplicada en papel" }).where(eq(schema.fuelEquipmentLoads.id, first!.id))

    expect(await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "La serie ya no la contradice" })).toEqual({ ok: true, reviewStatus: "ok", worksiteId: "ws-a" })
    expect((await loads())[1]).toMatchObject({ reviewStatus: "ok", flagReasons: [], performanceStatus: "first_load" })
  })

  it("una carga sin equipo conserva sus marcas de origen: vuelve a «por decidir»", async () => {
    const id = await submission("2026-03-01T12:00:00.000Z", 1000, 40, { vehicleId: null, equipmentCodeSnapshot: "TR-01" })
    await inMemoryDb.insert(schema.fuelEquipmentLoads).values({
      id: "load-sin-ficha", source: "field", taeSubmissionId: id, vehicleId: null, worksiteId: "ws-a", occurredAt: "2026-03-01T12:00:00.000Z", month: "2026-03",
      liters: 40, meterType: "odometer", meterReading: 1000, performanceStatus: "not_applicable",
      reviewStatus: "approved", flagReasons: ["unknown_vehicle"], reviewNote: "Después la vinculo al equipo", reviewedBy: "reviewer", reviewedAt: "2026-03-02T12:00:00.000Z",
    })
    expect(await reopenFlaggedDecision(session(["ws-a"]), { loadId: "load-sin-ficha", note: "Todavía no tiene ficha" })).toMatchObject({ ok: true, reviewStatus: "flagged" })
    expect((await loads())[0]).toMatchObject({ reviewStatus: "flagged", reviewNote: null, reviewedBy: null })
  })

  it("una carga deshecha se puede volver a decidir", async () => {
    const [, flagged] = await seriesWithRegression()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "Falta confirmar con el operador" })
    const again = await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "reject", note: "El operador confirmó el error" })
    expect(again).toEqual({ ok: true })
    expect((await loads())[1]).toMatchObject({ reviewStatus: "rejected", reviewNote: "El operador confirmó el error" })
  })

  it("rechaza una nota corta o larga, y sólo escribe con la nota válida", async () => {
    const [, flagged] = await seriesWithRegression()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    const short = await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "corta" })
    expect(short.ok).toBe(false)
    expect((await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "   123456789   " })).ok).toBe(false)
    expect((await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "x".repeat(501) })).ok).toBe(false)
    expect((await loads())[1]!.reviewStatus).toBe("approved")
    expect(await audits()).toHaveLength(1)
    expect((await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "x".repeat(500) })).ok).toBe(true)
  })

  it("sin el permiso de aprobar no se deshace nada", async () => {
    const [, flagged] = await seriesWithRegression()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    const denied = await reopenFlaggedDecision(session(["ws-a"], ["combustibles:view"]), { loadId: flagged!.id, note: "Intento sin permiso" })
    expect(denied).toEqual({ ok: false, message: "No tienes permisos para revisar cargas marcadas" })
    expect((await loads())[1]!.reviewStatus).toBe("approved")
  })

  it("una carga de otra faena responde igual que una que no existe, y no se escribe nada", async () => {
    const [, flagged] = await seriesWithRegression()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    const outOfScope = await reopenFlaggedDecision(session(["ws-b"]), { loadId: flagged!.id, note: "Intento fuera de alcance" })
    const missing = await reopenFlaggedDecision(session(["ws-a"]), { loadId: "no-existe", note: "Esta carga no existe" })
    expect(outOfScope).toEqual({ ok: false, message: "La carga no existe o no está en tus faenas" })
    expect(missing).toEqual(outOfScope)
    expect((await loads())[1]!.reviewStatus).toBe("approved")
    expect(await audits()).toHaveLength(1)
  })

  it("no hay decisión que deshacer en una carga por decidir ni en una anulada", async () => {
    const [, flagged] = await seriesWithRegression()
    const pending = await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "Todavía nadie la decidió" })
    expect(pending.ok).toBe(false)
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    await inMemoryDb.update(schema.fuelEquipmentLoads).set({ voidedAt: "2026-03-05T00:00:00.000Z" }).where(eq(schema.fuelEquipmentLoads.id, flagged!.id))
    const voided = await reopenFlaggedDecision(session(["ws-a"]), { loadId: flagged!.id, note: "Está anulada, no hay nada" })
    expect(voided).toMatchObject({ ok: false })
    expect(await audits()).toHaveLength(1)
  })

  it("las acciones exigen el permiso, deshacen y vacían la caché de los contadores del menú", async () => {
    const [, flagged] = await seriesWithRegression()
    mockAuth.mockResolvedValue(session(["ws-a"], ["combustibles:view"]))
    expect((await decideFlaggedLoadsAction({ loadIds: [flagged!.id], decision: "approve", note: "Cambio de tablero confirmado" })).ok).toBe(false)
    expect((await reopenFlaggedDecisionAction({ loadId: flagged!.id, note: "Intento sin permiso" })).ok).toBe(false)
    expect(revalidateTag).not.toHaveBeenCalled()

    mockAuth.mockResolvedValue(session(["ws-a"]))
    expect(await decideFlaggedLoadsAction({ loadIds: [flagged!.id], decision: "approve", note: "Cambio de tablero confirmado" })).toMatchObject({ ok: true, decided: 1, message: "Carga decidida: cuenta" })
    expect(revalidatePath).toHaveBeenCalledWith("/combustibles", "layout")
    expect(revalidateTag).toHaveBeenCalledWith("badge-counts", { expire: 0 })

    revalidateTag.mockClear()
    const undone = await reopenFlaggedDecisionAction({ loadId: flagged!.id, note: "Falta confirmar con el operador" })
    expect(undone).toEqual({ ok: true, message: "Decisión deshecha: la carga volvió a «Pendientes»" })
    expect(revalidateTag).toHaveBeenCalledWith("badge-counts", { expire: 0 })
    expect((await loads())[1]!.reviewStatus).toBe("flagged")
  })
})
