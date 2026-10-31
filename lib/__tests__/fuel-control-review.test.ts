/**
 * Revisión de cargas marcadas contra Postgres real (PGlite): permiso, alcance
 * de faena, nota obligatoria, auditoría dentro de la transacción y recálculo de
 * la serie con la decisión persistente.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
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
vi.mock("next/cache", () => ({ revalidatePath, revalidateTag: vi.fn() }))
const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import type { Tx } from "@/db"
import { decideFlaggedLoad, decideFlaggedLoads, MAX_BATCH_DECISION } from "@/lib/combustibles/control/review"
import { projectTaeSubmissions } from "@/lib/combustibles/control/projection"
import { approveFlaggedLoadAction, rejectFlaggedLoadAction } from "@/app/(app)/combustibles/control/revision/actions"

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
  const id = `sub-r-${seq}`
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id, clientSubmissionId: `c-${id}`, publicResultToken: `t-${id}`, worksiteId: "ws-a", vehicleId: "veh-1",
    productId: "prod-diesel", equipmentCodeSnapshot: "CAM-01", loadedAt, submittedAt: loadedAt,
    driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor", meterType: "odometer", meterReading, liters, ...extra,
  })
  return id
}

const loads = () => inMemoryDb.select().from(schema.fuelEquipmentLoads)
  .orderBy(asc(schema.fuelEquipmentLoads.occurredAt), asc(schema.fuelEquipmentLoads.id))

const audits = () => inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_equipment_load"))

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

describe("revisión de cargas marcadas", () => {
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

  it("aprueba con nota: queda aprobada, auditada en la faena y persiste al recalcular", async () => {
    const [, flagged] = await seriesWithRegression()
    expect(flagged).toMatchObject({ reviewStatus: "flagged", flagReasons: ["meter_regression"] })

    const result = await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    expect(result).toEqual({ ok: true })

    const after = (await loads())[1]!
    expect(after).toMatchObject({ reviewStatus: "approved", reviewNote: "Cambio de tablero confirmado", reviewedBy: "reviewer", flagReasons: ["meter_regression"] })
    const [audit] = await audits()
    expect(audit).toMatchObject({ action: "status_change", entityId: flagged!.id, reason: "Cambio de tablero confirmado", worksiteId: "ws-a", userId: "reviewer" })
    expect(JSON.parse(audit!.oldState!)).toMatchObject({ reviewStatus: "flagged" })
    expect(JSON.parse(audit!.newState!)).toMatchObject({ reviewStatus: "approved" })
  })

  it("rechaza: sale de la serie y la carga siguiente se recalcula sin ella", async () => {
    const rows = await seriesWithRegression()
    // Antes: los 30 L del retroceso se suman al tramo (500 km ÷ 50 L).
    expect(rows[2]).toMatchObject({ accumulatedLiters: 50, performanceValue: 10 })
    await decideFlaggedLoad(session(["ws-a"]), { loadId: rows[1]!.id, decision: "reject", note: "Lectura mal digitada en terreno" })
    const [, rejected, last] = await loads()
    expect(rejected).toMatchObject({ reviewStatus: "rejected", performanceStatus: "excluded" })
    expect(last).toMatchObject({ accumulatedLiters: 20, performanceValue: 25 })
  })

  it("un usuario de otra faena no puede decidir, y nada se escribe", async () => {
    const [, flagged] = await seriesWithRegression()
    const result = await decideFlaggedLoad(session(["ws-b"]), { loadId: flagged!.id, decision: "approve", note: "Intento fuera de alcance" })
    expect(result).toEqual({ ok: false, message: "La carga no existe o no está en tus faenas" })
    expect((await loads())[1]!.reviewStatus).toBe("flagged")
    expect(await audits()).toHaveLength(0)
  })

  it("exige nota de al menos 10 caracteres y el permiso de aprobar", async () => {
    const [, flagged] = await seriesWithRegression()
    const short = await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "ok" })
    expect(short.ok).toBe(false)
    const noPermission = await decideFlaggedLoad(session(["ws-a"], ["combustibles:view"]), { loadId: flagged!.id, decision: "approve", note: "Nota suficientemente larga" })
    expect(noPermission).toEqual({ ok: false, message: "No tienes permisos para revisar cargas marcadas" })
    expect(await audits()).toHaveLength(0)
  })

  it("una carga ya decidida no se vuelve a decidir", async () => {
    const [, flagged] = await seriesWithRegression()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    const again = await decideFlaggedLoad(session(["ws-a"]), { loadId: flagged!.id, decision: "reject", note: "Segunda decisión sobre lo mismo" })
    expect(again.ok).toBe(false)
    expect((await loads())[1]!.reviewStatus).toBe("approved")
  })

  it("aprobar una duplicada la devuelve a la serie y no se vuelve a marcar", async () => {
    const a = await submission("2026-03-01T12:00:00.000Z", 1000, 50)
    const b = await submission("2026-03-01T12:05:00.000Z", 1500, 50, { source: "legacy_xlsx" })
    await projectTaeSubmissions(tx, [a, b])
    const [, duplicate] = await loads()
    expect(duplicate).toMatchObject({ reviewStatus: "flagged", flagReasons: ["duplicate"] })

    await decideFlaggedLoad(session(["ws-a"]), { loadId: duplicate!.id, decision: "approve", note: "Son dos cargas distintas en el día" })
    const after = (await loads())[1]!
    expect(after).toMatchObject({ reviewStatus: "approved", duplicateOfId: null, performanceStatus: "computed", performanceValue: 10 })
  })

  /** Serie con una lectura que retrocede (2.ª carga) y, el mismo día, una posible duplicada (la última): dos cargas por decidir. */
  async function seriesWithTwoFlagged() {
    const ids = [
      await submission("2026-03-01T12:00:00.000Z", 1000),
      await submission("2026-03-02T12:00:00.000Z", 900, 30),
      await submission("2026-03-03T12:00:00.000Z", 1500, 20),
      await submission("2026-03-04T12:00:00.000Z", 1600, 50),
      await submission("2026-03-04T12:05:00.000Z", 1700, 50, { source: "legacy_xlsx" }),
    ]
    await projectTaeSubmissions(tx, ids)
    const rows = await loads()
    const flagged = rows.filter((row) => row.reviewStatus === "flagged")
    expect(flagged.map((row) => row.flagReasons)).toEqual([["meter_regression"], ["duplicate"]])
    return flagged
  }

  it("en lote: una nota común, una auditoría por carga y la duplicada vuelve a la serie", async () => {
    const [regression, duplicate] = await seriesWithTwoFlagged()
    const result = await decideFlaggedLoads(session(["ws-a"]), { loadIds: [regression!.id, duplicate!.id], decision: "approve", note: "Revisadas con el supervisor" })
    expect(result).toMatchObject({ ok: true, decided: 2, skipped: 0, worksiteIds: ["ws-a"] })

    const after = await loads()
    expect(after.filter((row) => row.reviewStatus === "approved")).toHaveLength(2)
    expect(after.find((row) => row.id === duplicate!.id)).toMatchObject({ duplicateOfId: null, performanceStatus: "computed", reviewNote: "Revisadas con el supervisor", reviewedBy: "reviewer" })
    const trail = await audits()
    expect(trail).toHaveLength(2)
    expect(trail.map((row) => row.entityId).sort()).toEqual([regression!.id, duplicate!.id].sort())
    for (const row of trail) {
      expect(row).toMatchObject({ action: "status_change", reason: "Revisadas con el supervisor", worksiteId: "ws-a", userId: "reviewer" })
      expect(JSON.parse(row.oldState!)).toMatchObject({ reviewStatus: "flagged" })
      expect(JSON.parse(row.newState!)).toMatchObject({ reviewStatus: "approved", batch: true })
    }
  })

  it("en lote, rechazar saca a todas las seleccionadas de la serie", async () => {
    const [regression, duplicate] = await seriesWithTwoFlagged()
    const result = await decideFlaggedLoads(session(["ws-a"]), { loadIds: [regression!.id, duplicate!.id], decision: "reject", note: "Lecturas mal digitadas" })
    expect(result).toMatchObject({ ok: true, decided: 2 })
    const after = await loads()
    expect(after.filter((row) => row.reviewStatus === "rejected")).toHaveLength(2)
    expect(after.filter((row) => row.reviewStatus === "rejected").every((row) => row.performanceStatus === "excluded")).toBe(true)
  })

  it("en lote, una carga que otra persona ya decidió se omite y las demás se deciden", async () => {
    const [regression, duplicate] = await seriesWithTwoFlagged()
    await decideFlaggedLoad(session(["ws-a"]), { loadId: regression!.id, decision: "reject", note: "Decidida por otra persona" })
    const result = await decideFlaggedLoads(session(["ws-a"]), { loadIds: [regression!.id, duplicate!.id], decision: "approve", note: "Son dos cargas distintas" })
    expect(result).toMatchObject({ ok: true, decided: 1, skipped: 1 })
    expect((await loads()).find((row) => row.id === regression!.id)!.reviewStatus).toBe("rejected")
    expect(await audits()).toHaveLength(2)

    const nothingLeft = await decideFlaggedLoads(session(["ws-a"]), { loadIds: [regression!.id], decision: "approve", note: "Otra vez la misma carga" })
    expect(nothingLeft).toMatchObject({ ok: false })
  })

  it("en lote, una carga fuera de tu alcance o inexistente aborta todo: nada se escribe", async () => {
    const [regression, duplicate] = await seriesWithTwoFlagged()
    const outOfScope = await decideFlaggedLoads(session(["ws-b"]), { loadIds: [regression!.id, duplicate!.id], decision: "approve", note: "Intento fuera de alcance" })
    expect(outOfScope).toEqual({ ok: false, message: "Alguna carga no existe o no está en tus faenas" })
    const missing = await decideFlaggedLoads(session(["ws-a"]), { loadIds: [regression!.id, "no-existe"], decision: "approve", note: "Una de las dos no existe" })
    expect(missing).toEqual({ ok: false, message: "Alguna carga no existe o no está en tus faenas" })
    expect((await loads()).filter((row) => row.reviewStatus === "flagged")).toHaveLength(2)
    expect(await audits()).toHaveLength(0)
  })

  it("en lote exige permiso, nota de 10 a 500 caracteres, al menos una carga y no más del tope", async () => {
    const [regression] = await seriesWithTwoFlagged()
    const input = { loadIds: [regression!.id], decision: "approve" as const, note: "Nota suficientemente larga" }
    expect(await decideFlaggedLoads(session(["ws-a"], ["combustibles:view"]), input)).toEqual({ ok: false, message: "No tienes permisos para revisar cargas marcadas" })
    expect(await decideFlaggedLoads(session(["ws-a"]), { ...input, note: "corta" })).toMatchObject({ ok: false })
    expect(await decideFlaggedLoads(session(["ws-a"]), { ...input, note: "x".repeat(501) })).toMatchObject({ ok: false })
    expect(await decideFlaggedLoads(session(["ws-a"]), { ...input, loadIds: [] })).toEqual({ ok: false, message: "Elige al menos una carga" })
    expect(await decideFlaggedLoads(session(["ws-a"]), { ...input, loadIds: Array.from({ length: MAX_BATCH_DECISION + 1 }, (_, i) => `x-${i}`) })).toMatchObject({ ok: false })
    expect(await audits()).toHaveLength(0)
  })

  it("las server actions exigen el permiso y revalidan el submódulo", async () => {
    const [, flagged] = await seriesWithRegression()
    mockAuth.mockResolvedValue(session(["ws-a"], ["combustibles:view"]))
    const denied = await approveFlaggedLoadAction({ loadId: flagged!.id, note: "Cambio de tablero confirmado" })
    expect(denied.ok).toBe(false)

    mockAuth.mockResolvedValue(session(["ws-a"]))
    const ok = await rejectFlaggedLoadAction({ loadId: flagged!.id, note: "Lectura mal digitada en terreno" })
    expect(ok).toEqual({ ok: true, message: "Carga rechazada" })
    expect(revalidatePath).toHaveBeenCalledWith("/combustibles", "layout")
    const rows = await inMemoryDb.select().from(schema.fuelEquipmentLoads)
      .where(and(eq(schema.fuelEquipmentLoads.id, flagged!.id), eq(schema.fuelEquipmentLoads.reviewStatus, "rejected")))
    expect(rows).toHaveLength(1)
  })
})
