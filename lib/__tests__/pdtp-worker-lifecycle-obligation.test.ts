/**
 * lib/__tests__/pdtp-worker-lifecycle-obligation.test.ts
 *
 * La entrada de una persona a la dotación abre su inducción (N°15) y su
 * habilitación (N°52).
 *
 * Antes de esto las tres acreditaban y el indicador las ignoraba:
 * `closed_on_time` cuenta obligaciones vencidas, no ejecuciones, así que cerrar
 * un acta no movía el porcentaje. Lo que estos casos fijan es el otro extremo
 * del par —quién abre el compromiso— y la regla que decide qué escritura sobre
 * `workers` cuenta como una entrada.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { chileDateParts } = await import("@/lib/utils")
const { deriveWorkerLifecycleEvents } = await import("@/lib/services/workers")
const { onWorkerEnteredDotacion } = await import("@/lib/services/pdtp-adapters/worker-lifecycle-connector")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-wlc-v1"
const USER_ID = "user-wlc-1"
const WS_A = "ws-wlc-a"
const WS_B = "ws-wlc-b"
const ENTRY_NUMBERS = [15, 52] as const
/** Declarada pero sin abridor: la N°16 espera el curso que la cierre. */
const NOT_YET_OPENED = 16
const activityId = (n: number) => `${PROGRAM_ID}-a-${String(n).padStart(3, "0")}`

function altaEvent(workerId: string, worksiteId = WS_A) {
  return {
    workerId, worksiteId, kind: "alta" as const,
    occurredAt: `${PROGRAM_YEAR}-05-06T12:00:00.000Z`,
  }
}

async function obligations() {
  return inMemoryDb.select().from(schema.pdtpObligations)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-wlc@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FA", isActive: true },
    { id: WS_B, name: "Faena B", code: "FB", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} ciclo de vida`,
    status: "active", elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedByUserId: USER_ID,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values([...ENTRY_NUMBERS, NOT_YET_OPENED].map((n) => ({
    id: activityId(n), programId: PROGRAM_ID, n,
    activity: `Actividad de entrada N°${n}`, program: "Habilitación del trabajador",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "on_demand", scheduleClassificationStatus: "confirmed",
    dueDays: 0, evidenceRequirement: "Acta de trabajador nuevo firmada.",
    indicatorMode: "closed_on_time",
    sourceSheetRow: n, createdAt: now, updatedAt: now,
  })))
})

describe("deriveWorkerLifecycleEvents", () => {
  const at = "2026-05-06T12:00:00.000Z"

  it("un alta activa es una entrada", () => {
    const events = deriveWorkerLifecycleEvents(null, { id: "w1", worksiteId: WS_A, isActive: true }, at)
    expect(events).toEqual([{ workerId: "w1", worksiteId: WS_A, kind: "alta", occurredAt: at }])
  })

  it("un alta inactiva no lo es", () => {
    expect(deriveWorkerLifecycleEvents(null, { id: "w1", worksiteId: WS_A, isActive: false }, at)).toEqual([])
  })

  it("cambiar de faena es un traslado, y recuerda la de origen", () => {
    const events = deriveWorkerLifecycleEvents(
      { worksiteId: WS_A, isActive: true },
      { id: "w1", worksiteId: WS_B, isActive: true },
      at,
    )
    expect(events).toEqual([{ workerId: "w1", worksiteId: WS_B, kind: "traslado", occurredAt: at, previousWorksiteId: WS_A }])
  })

  it("volver a activarse es una reincorporación", () => {
    const events = deriveWorkerLifecycleEvents(
      { worksiteId: WS_A, isActive: false },
      { id: "w1", worksiteId: WS_A, isActive: true },
      at,
    )
    expect(events.map((e) => e.kind)).toEqual(["reactivacion"])
  })

  it("volver y cambiar de faena es una sola entrada, no dos", () => {
    const events = deriveWorkerLifecycleEvents(
      { worksiteId: WS_A, isActive: false },
      { id: "w1", worksiteId: WS_B, isActive: true },
      at,
    )
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe("traslado")
  })

  it("una baja, un renombre o mover a alguien inactivo no son entradas", () => {
    expect(deriveWorkerLifecycleEvents({ worksiteId: WS_A, isActive: true }, { id: "w1", worksiteId: WS_A, isActive: false }, at)).toEqual([])
    expect(deriveWorkerLifecycleEvents({ worksiteId: WS_A, isActive: true }, { id: "w1", worksiteId: WS_A, isActive: true }, at)).toEqual([])
    expect(deriveWorkerLifecycleEvents({ worksiteId: WS_A, isActive: false }, { id: "w1", worksiteId: WS_B, isActive: false }, at)).toEqual([])
  })
})

describe("onWorkerEnteredDotacion", () => {
  it("un alta abre las obligaciones de entrada, con plazo cero", async () => {
    const result = await onWorkerEnteredDotacion([altaEvent("w-1")], USER_ID)

    expect(result.opened).toBe(2)
    const rows = await obligations()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.worksiteId).toBe(WS_A)
      expect(row.origin).toBe("integration")
      expect(row.sourceType).toBe("trabajador")
      expect(row.sourceId).toBe("worker:w-1:alta")
      expect(row.status).toBe("pending")
      // Plazo cero: vence en el mismo instante en que nace, que es lo que dice
      // el catálogo ("antes que ingrese la persona trabajadora").
      expect(row.dueAt).toBe(row.sourceOccurredAt)
      expect((row.sourceMetadataJson as Record<string, unknown>).subjectKey).toBe("worker:w-1")
    }
    expect(new Set(rows.map((r) => r.activityId))).toEqual(new Set(ENTRY_NUMBERS.map(activityId)))
    // La N°16 existe en el programa y a propósito no se le abre nada: todavía
    // no hay curso que pueda cerrarla.
    expect(rows.some((r) => r.activityId === activityId(NOT_YET_OPENED))).toBe(false)
  })

  it("guardar dos veces la misma alta no duplica", async () => {
    await onWorkerEnteredDotacion([altaEvent("w-1")], USER_ID)
    const second = await onWorkerEnteredDotacion([altaEvent("w-1")], USER_ID)

    expect(second.opened).toBe(0)
    expect(second.alreadyOpen).toBe(2)
    expect(await obligations()).toHaveLength(2)
  })

  it("un traslado abre en la faena destino y deja intacta la de origen", async () => {
    await onWorkerEnteredDotacion([altaEvent("w-1", WS_A)], USER_ID)
    await onWorkerEnteredDotacion([{
      workerId: "w-1", worksiteId: WS_B, kind: "traslado",
      occurredAt: `${PROGRAM_YEAR}-06-10T12:00:00.000Z`, previousWorksiteId: WS_A,
    }], USER_ID)

    const rows = await obligations()
    expect(rows.filter((r) => r.worksiteId === WS_A)).toHaveLength(2)
    expect(rows.filter((r) => r.worksiteId === WS_B)).toHaveLength(2)
    expect(rows.filter((r) => r.worksiteId === WS_B).every((r) => r.sourceId?.endsWith(`:traslado:${PROGRAM_YEAR}-06-10`))).toBe(true)
  })

  it("una tanda de importación abre por persona y resuelve una vez por faena", async () => {
    const events = [
      altaEvent("w-1", WS_A), altaEvent("w-2", WS_A),
      altaEvent("w-3", WS_B), altaEvent("w-4", WS_B),
    ]
    const result = await onWorkerEnteredDotacion(events, USER_ID)

    expect(result.events).toBe(4)
    expect(result.opened).toBe(8)
    expect(await obligations()).toHaveLength(8)
  })

  it("una actividad excluida en la faena se omite, y no es un error", async () => {
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-1", activityId: activityId(52), worksiteId: WS_A,
      reason: "La habilitación autónoma no aplica en esta faena.", createdByUserId: USER_ID,
      createdAt: new Date().toISOString(),
    })

    const result = await onWorkerEnteredDotacion([altaEvent("w-1")], USER_ID)

    expect(result.opened).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.errors).toBe(0)
    expect(await obligations()).toHaveLength(1)
  })

  it("sin programa activo no abre nada y no falla", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const result = await onWorkerEnteredDotacion([altaEvent("w-1")], USER_ID)

    expect(result.opened).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.skipped).toBe(2)
    expect(await obligations()).toHaveLength(0)
  })

  it("dos personas cuyo id es prefijo de otro no se confunden", async () => {
    // `nanoid()` produce ids con `_` y `-`, que en LIKE son comodines. Si el
    // sujeto se dedujera del `sourceId` por prefijo en vez de leerse de
    // `subjectKey`, cerrar el compromiso de `w_1` cerraría también el de
    // `w_1x`. Este caso es lo único que impide que alguien "simplifique" la
    // búsqueda a un LIKE.
    await onWorkerEnteredDotacion([altaEvent("w_1"), altaEvent("w_1x")], USER_ID)

    const rows = await obligations()
    expect(rows).toHaveLength(4)
    const keys = rows.map((r) => (r.sourceMetadataJson as Record<string, unknown>).subjectKey)
    expect(keys.filter((k) => k === "worker:w_1")).toHaveLength(2)
    expect(keys.filter((k) => k === "worker:w_1x")).toHaveLength(2)
  })

  it("sin actor humano hereda el del programa", async () => {
    await onWorkerEnteredDotacion([altaEvent("w-1")], null)
    const rows = await obligations()
    expect(rows.every((r) => r.createdByUserId === USER_ID)).toBe(true)
  })
})
