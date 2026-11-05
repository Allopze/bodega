/**
 * Serie canónica del combustible: candado por equipo, decisiones que se reabren
 * y orden de cargas del mismo instante (auditoría 2026-11-05, 2.1, 3.1, 3.2 y 3.4).
 *
 * - **A1/A3** `recomputeVehicleSeries` toma el candado del equipo —el mismo del
 *   alta en terreno— antes de leer, y dos recálculos del mismo equipo se
 *   serializan. PGlite tiene una sola conexión: el segundo `db.transaction`
 *   espera al COMMIT del primero aunque no hubiera candado, así que la prueba
 *   fija dos cosas distintas: la propiedad observable (el segundo recálculo
 *   espera y la serie final es la que corresponde a los datos confirmados) y que
 *   el candado se toma de verdad, con la clave de `submit.ts`. Lo que el candado
 *   aporta en Postgres —que la lectura no quede vieja mientras se espera— no es
 *   observable en PGlite.
 * - **A2** `projectWithStaleDecisions` reabre las decisiones que cambiaron de
 *   base, incluida la de una carga del MISMO instante que la modificada (el
 *   `gte` que corrige el sub-caso del hallazgo 3.1).
 * - **A4** cambiar medidor o unidad del equipo recalcula la serie en la misma
 *   transacción y reabre las decisiones tomadas con los valores viejos.
 * - **A5** dos cargas del mismo instante se ordenan por lectura física y no por
 *   el id que les tocó.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq, sql } from "drizzle-orm"
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
vi.mock("@/lib/services/notifications", () => ({ notifyAfterCommit: vi.fn(), notifySafe: vi.fn(), notifyManyUser: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import type { Tx } from "@/db"
import { lockVehicleSeries, recomputeVehicleSeries } from "@/lib/combustibles/control/projection-series"
import { projectWithStaleDecisions, STALE_DECISION_REASON } from "@/lib/combustibles/control/stale-decisions"
import { decideFlaggedLoad } from "@/lib/combustibles/control/review"
import { updateFuelVehicleAction } from "@/app/(app)/combustibles/actions-module/vehicles"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function session(permissions: string[], worksiteIds = ["ws-a"]): Session {
  return {
    user: {
      id: "reviewer", name: "Jefa", email: "jefa@example.com", roles: ["jefa_chome"], permissions,
      worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true, isGlobal: false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

/** `pg_locks` no tiene tipos que Drizzle conozca: se lee como en `actions-thresholds.ts`. */
async function advisoryLockCount(tx: Tx): Promise<number> {
  const result = await tx.execute(sql`
    select count(*)::int as held from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
  `) as unknown
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ held: number }>
  return Number(rows[0]?.held ?? 0)
}

/** Una carga de la serie con id elegido: el id no debe decidir el orden físico. */
async function seedLoad(
  id: string,
  occurredAt: string,
  meterReading: number,
  extra: Partial<typeof schema.fuelEquipmentLoads.$inferInsert> = {},
) {
  const submissionId = `sub-${id}`
  const liters = Number(extra.liters ?? 50)
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id: submissionId,
    clientSubmissionId: `c-${id}`,
    publicResultToken: `t-${id}`,
    worksiteId: "ws-a",
    vehicleId: "veh-1",
    productId: "prod-diesel",
    equipmentCodeSnapshot: "CAM-01",
    loadedAt: occurredAt,
    submittedAt: occurredAt,
    driverNameSnapshot: "Conductor",
    supervisorNameSnapshot: "Supervisor",
    meterType: "odometer",
    meterReading,
    liters,
  })
  await inMemoryDb.insert(schema.fuelEquipmentLoads).values({
    id,
    source: "field",
    taeSubmissionId: submissionId,
    vehicleId: "veh-1",
    worksiteId: "ws-a",
    occurredAt,
    month: occurredAt.slice(0, 7),
    liters,
    meterType: "odometer",
    meterReading,
    performanceStatus: "first_load",
    reviewStatus: "ok",
    ...extra,
  })
}

const loads = () => inMemoryDb.select().from(schema.fuelEquipmentLoads)
  .orderBy(asc(schema.fuelEquipmentLoads.occurredAt), sql`${schema.fuelEquipmentLoads.meterReading} asc nulls last`, asc(schema.fuelEquipmentLoads.id))
const loadById = async (id: string) => (await inMemoryDb.select().from(schema.fuelEquipmentLoads).where(eq(schema.fuelEquipmentLoads.id, id)))[0]
const auditsOf = (loadId: string) => inMemoryDb.select().from(schema.auditLog)
  .where(eq(schema.auditLog.entityId, loadId))
  .orderBy(asc(schema.auditLog.createdAt))

/** Recalcula fuera de una transacción explícita: sirve para dejar la serie lista antes de cada escenario. */
const recompute = async (vehicleId = "veh-1") => {
  await inMemoryDb.transaction(async (t) => { await recomputeVehicleSeries(t as unknown as Tx, vehicleId) })
}

describe("serie de combustible: concurrencia, decisiones y orden", () => {
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
      id: "veh-1", plate: "AAAA11", type: "camion", equipmentTypeId: "fet-test", worksiteId: "ws-a",
      meterType: "odometer", performanceUnit: "km_per_liter",
    })
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  describe("A1/A3 · candado por equipo", () => {
    it("el recálculo toma el candado del equipo, con la clave del alta en terreno", async () => {
      await seedLoad("l-1", "2026-03-01T12:00:00.000Z", 1000)
      await seedLoad("l-2", "2026-03-02T12:00:00.000Z", 1500)

      await inMemoryDb.transaction(async (t) => {
        const inner = t as unknown as Tx
        expect(await advisoryLockCount(inner)).toBe(0)
        await recomputeVehicleSeries(inner, "veh-1")
        expect(await advisoryLockCount(inner)).toBe(1)

        // Misma clave que `submit.ts`: volver a tomarla no agrega un candado.
        await lockVehicleSeries(inner, "veh-1")
        expect(await advisoryLockCount(inner)).toBe(1)

        // Y es por equipo: otro equipo pide otro candado.
        await recomputeVehicleSeries(inner, "veh-2")
        expect(await advisoryLockCount(inner)).toBe(2)
      })
    })

    it("dos recálculos concurrentes del mismo equipo se serializan y la serie final es consistente", async () => {
      await seedLoad("l-1", "2026-03-01T12:00:00.000Z", 1000)
      await seedLoad("l-2", "2026-03-02T12:00:00.000Z", 1500)
      await seedLoad("l-3", "2026-03-03T12:00:00.000Z", 2000)

      const order: string[] = []
      const first = inMemoryDb.transaction(async (t) => {
        order.push("a:inicio")
        await recomputeVehicleSeries(t as unknown as Tx, "veh-1")
        order.push("a:serie")
        await sleep(60)
      })
      await sleep(10)
      const second = inMemoryDb.transaction(async (t) => {
        order.push("b:inicio")
        await recomputeVehicleSeries(t as unknown as Tx, "veh-1")
        order.push("b:serie")
      })
      await Promise.all([first, second])

      // El segundo no empieza hasta que el primero cerró su transacción.
      expect(order).toEqual(["a:inicio", "a:serie", "b:inicio", "b:serie"])

      // La serie final corresponde a los datos confirmados: recalcularla otra vez
      // no cambia ninguna fila (ni `updatedAt`).
      const settled = await loads()
      expect(settled.map((row) => [row.id, row.anchorLoadId, row.meterDelta, row.accumulatedLiters, row.performanceValue])).toEqual([
        ["l-1", null, null, null, null],
        ["l-2", "l-1", 500, 50, 10],
        ["l-3", "l-2", 500, 50, 10],
      ])
      await recompute()
      expect(await loads()).toEqual(settled)
    })
  })

  describe("A2 · decisiones que cambiaron de base", () => {
    it("reabre la decisión de una carga del mismo instante que la que cambió (gte)", async () => {
      await seedLoad("l-1", "2026-03-01T00:00:00.000Z", 1000)
      await seedLoad("l-2", "2026-03-02T00:00:00.000Z", 1500)
      // Misma instante que l-2: el `gt` de antes la dejaba fuera de la foto.
      await seedLoad("l-3", "2026-03-02T00:00:00.000Z", 2000, {
        reviewStatus: "approved", reviewNote: "Carga confirmada por el operador",
        reviewedBy: "reviewer", reviewedAt: "2026-03-03T00:00:00.000Z",
      })
      await recompute()
      expect((await loadById("l-3"))!.reviewStatus).toBe("approved")

      const reopened = await inMemoryDb.transaction(async (t) => {
        const inner = t as unknown as Tx
        return projectWithStaleDecisions(inner, "veh-1", "2026-03-02T00:00:00.000Z", { userId: "reviewer" }, async () => {
          // Corrección de una carga del mismo instante que la decidida.
          await inner.update(schema.fuelEquipmentLoads).set({ meterReading: 1400 }).where(eq(schema.fuelEquipmentLoads.id, "l-2"))
          await recomputeVehicleSeries(inner, "veh-1")
        })
      })

      expect(reopened).toEqual(["l-3"])
      expect(await loadById("l-3")).toMatchObject({ reviewStatus: "ok", reviewedBy: null, reviewedAt: null, reviewNote: null })
      const trail = await auditsOf("l-3")
      expect(trail.at(-1)).toMatchObject({ action: "status_change", reason: STALE_DECISION_REASON, worksiteId: "ws-a" })
      expect(JSON.parse(trail.at(-1)!.oldState!)).toMatchObject({ reviewStatus: "approved", reviewNote: "Carga confirmada por el operador" })
    })

    it("aprobar una duplicada reabre la decisión de las siguientes del equipo", async () => {
      await seedLoad("l-1", "2026-03-01T12:00:00.000Z", 1000)
      // Mismos litros y cinco minutos después, por otro canal: duplicada.
      await seedLoad("l-2", "2026-03-01T12:05:00.000Z", 1500, { source: "legacy_tae" })
      await seedLoad("l-3", "2026-03-02T12:00:00.000Z", 2000, {
        reviewStatus: "approved", reviewNote: "Confirmada con el supervisor",
        reviewedBy: "reviewer", reviewedAt: "2026-03-03T12:00:00.000Z",
      })
      await recompute()
      expect(await loadById("l-2")).toMatchObject({ reviewStatus: "flagged", duplicateOfId: "l-1", performanceStatus: "excluded" })
      // Sin la duplicada en la serie, l-3 se mide contra l-1.
      expect(await loadById("l-3")).toMatchObject({ anchorLoadId: "l-1", meterDelta: 1000, performanceValue: 20 })

      const result = await decideFlaggedLoad(session(["combustibles:approve_flagged"]), {
        loadId: "l-2", decision: "approve", note: "Son dos cargas distintas del mismo día",
      })
      expect(result).toEqual({ ok: true })
      // Aprobada vuelve a la serie: l-3 cambia de ancla y su decisión ya no describe
      // la serie que ve la plataforma.
      expect(await loadById("l-2")).toMatchObject({ reviewStatus: "approved", duplicateOfId: null, performanceStatus: "computed" })
      expect(await loadById("l-3")).toMatchObject({ reviewStatus: "ok", reviewedBy: null, anchorLoadId: "l-2", performanceValue: 10 })
      expect((await auditsOf("l-3")).at(-1)).toMatchObject({ reason: STALE_DECISION_REASON })
    })
  })

  describe("A4 · cambio de medidor, unidad o capacidad", () => {
    it("pasa 3 cargas de km/L a L/h, recalcula los valores y reabre las decisiones", async () => {
      await seedLoad("l-1", "2026-03-01T12:00:00.000Z", 1000)
      await seedLoad("l-2", "2026-03-02T12:00:00.000Z", 1500)
      await seedLoad("l-3", "2026-03-03T12:00:00.000Z", 2000, {
        reviewStatus: "approved", reviewNote: "Confirmada con el supervisor",
        reviewedBy: "reviewer", reviewedAt: "2026-03-04T12:00:00.000Z",
      })
      await recompute()
      expect((await loads()).map((row) => row.performanceValue)).toEqual([null, 10, 10])

      mockAuth.mockResolvedValue(session(["admin:fleet_vehicles"]))
      const form = new FormData()
      form.set("id", "veh-1")
      form.set("meterType", "hour_meter")
      form.set("performanceUnit", "liters_per_hour")
      form.set("tankCapacityLiters", "200")
      form.append("compatibleProductIds", "prod-diesel")
      const result = await updateFuelVehicleAction({ ok: false }, form)
      expect(result).toEqual({ ok: true, message: "Vehículo actualizado" })

      // Ninguna carga se borra: se recalcula qué vale cada una con la unidad nueva.
      const rows = await loads()
      expect(rows).toHaveLength(3)
      expect(rows.map((row) => row.performanceUnit)).toEqual(["liters_per_hour", "liters_per_hour", "liters_per_hour"])
      expect(rows.map((row) => row.meterType)).toEqual(["hour_meter", "hour_meter", "hour_meter"])
      expect(rows.map((row) => row.performanceValue)).toEqual([null, 0.1, 0.1])
      // La decisión de l-3 se tomó con 10 km/L: vuelve a revisarse.
      expect(rows[2]).toMatchObject({ reviewStatus: "ok", reviewedBy: null, reviewNote: null })
      expect((await auditsOf("l-3")).at(-1)).toMatchObject({ reason: STALE_DECISION_REASON })
    })

    it("un cambio que no toca el cálculo (el nombre del modelo) no reabre decisiones", async () => {
      await seedLoad("l-1", "2026-03-01T12:00:00.000Z", 1000)
      await seedLoad("l-2", "2026-03-02T12:00:00.000Z", 1500, {
        reviewStatus: "approved", reviewNote: "Confirmada con el supervisor",
        reviewedBy: "reviewer", reviewedAt: "2026-03-03T12:00:00.000Z",
      })
      await recompute()

      mockAuth.mockResolvedValue(session(["admin:fleet_vehicles"]))
      const form = new FormData()
      form.set("id", "veh-1")
      form.set("model", "CAT 320")
      form.append("compatibleProductIds", "prod-diesel")
      expect(await updateFuelVehicleAction({ ok: false }, form)).toEqual({ ok: true, message: "Vehículo actualizado" })
      expect(await loadById("l-2")).toMatchObject({ reviewStatus: "approved", performanceValue: 10 })
    })
  })

  describe("A5 · orden de dos cargas del mismo instante", () => {
    it("ordena por lectura y no por id: la de 5.000 va antes que la de 5.200", async () => {
      await seedLoad("l-0", "2026-03-11T00:00:00.000Z", 1000)
      // Los ids están al revés a propósito: con `order by occurred_at, id` la de
      // 5.200 iba primero y la de 5.000 salía como retroceso espurio.
      await seedLoad("a-5200", "2026-03-12T00:00:00.000Z", 5200)
      await seedLoad("b-5000", "2026-03-12T00:00:00.000Z", 5000)

      await recompute()

      const rows = await loads()
      expect(rows.map((row) => row.id)).toEqual(["l-0", "b-5000", "a-5200"])
      // El valor sintético puede caer fuera del rango plausible; lo que no puede
      // pasar es que la carga de 5.000 salga como retroceso.
      expect(rows.flatMap((row) => row.flagReasons)).not.toContain("meter_regression")
      expect(rows.map((row) => row.performanceStatus)).toEqual(["first_load", "computed", "computed"])
      expect(rows[1]).toMatchObject({ anchorLoadId: "l-0", meterDelta: 4000, accumulatedLiters: 50, performanceValue: 80 })
      expect(rows[2]).toMatchObject({ anchorLoadId: "b-5000", meterDelta: 200, accumulatedLiters: 50, performanceValue: 4 })
    })
  })
})
