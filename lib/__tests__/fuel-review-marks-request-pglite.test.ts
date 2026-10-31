import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import { and, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── PostgreSQL en memoria con las migraciones reales ──────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime; postgres-js difiere sólo en el tipo HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

const mockDeciders = vi.fn(async (..._args: unknown[]): Promise<string[]> => [])
const mockNotifyMany = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermissionForWorksite: (...args: unknown[]) => mockDeciders(...args),
  notifyAfterCommit: (thunk: () => unknown) => { void Promise.resolve().then(thunk) },
  notifyManyUser: (...args: unknown[]) => mockNotifyMany(...args),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { requestLoadReview, withdrawLoadReviewRequest, REVIEW_REQUEST_NOTE_MAX, REVIEW_REQUEST_NOTE_MIN } = await import("@/lib/combustibles/fuel-log-review-request")

/**
 * «Pedir que la revisen» (rediseño 2026-10-31): `fuel_review_marks` pasó de un
 * interruptor que se borraba a un pedido con nota y ciclo de vida
 * (open → resolved | withdrawn). Aquí: pedir con nota, no duplicar un pedido
 * abierto, retirar, volver a pedir después de retirar, y el alcance de faena.
 */
function session(id: string, options: { permissions?: string[]; global?: boolean; worksiteIds?: string[] } = {}): Session {
  return {
    user: {
      id, name: id, email: `${id}@example.com`, roles: [], permissions: options.permissions ?? ["combustibles:view"],
      worksiteIds: options.worksiteIds ?? [], primaryWorksiteId: options.worksiteIds?.[0] ?? null, avatarColor: null, isActive: true, isGlobal: options.global ?? false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

const NOTE = "Los litros parecen altos para este equipo"

describe("pedir que revisen una carga (fuel_review_marks con ciclo de vida)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const requesterId = nanoid()
  const otherId = nanoid()
  const deciderId = nanoid()
  const globalId = nanoid()
  const outsiderId = nanoid()
  const productId = nanoid()
  const supplierId = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const batchId = nanoid()
  const taeA = nanoid()
  const taeB = nanoid()
  const invoiceA = nanoid()
  const recordA = nanoid()
  const recordNoWorksite = nanoid()

  const requester = () => session(requesterId, { worksiteIds: [worksiteA] })
  const other = () => session(otherId, { worksiteIds: [worksiteA] })
  const decider = () => session(deciderId, { worksiteIds: [worksiteA], permissions: ["combustibles:view", "combustibles:approve_flagged"] })
  const globalUser = () => session(globalId, { global: true })
  const outsider = () => session(outsiderId, { worksiteIds: [worksiteB] })

  const marksOf = (entityType: string, entityId: string) =>
    inMemoryDb.select().from(schema.fuelReviewMarks).where(and(eq(schema.fuelReviewMarks.entityType, entityType), eq(schema.fuelReviewMarks.entityId, entityId)))

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values([requesterId, otherId, deciderId, globalId, outsiderId].map((id) => ({ id, name: `Usuario ${id.slice(0, 4)}`, email: `${id}@example.com`, hashedPassword: "x", isActive: true })))
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `D-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: `Copec ${nanoid().slice(0, 4)}` })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `cam-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `CA${nanoid().slice(0, 4).toUpperCase()}`, code: "CA-14", type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: true })
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([taeA, taeB].map((id, index) => ({
      id, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
      worksiteId: index === 0 ? worksiteA : worksiteB, vehicleId: index === 0 ? vehicleId : null, productId, equipmentCodeSnapshot: "CA-14",
      loadedAt: "2026-10-05T12:00:00.000Z", submittedAt: "2026-10-05T12:00:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor", meterType: "odometer", liters: 40, status: "submitted",
    })))
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: invoiceA, loadDate: "2026-10-08", month: "2026-10", serviceType: "TCT", vehicleId, fuelSupplierId: supplierId, worksiteId: worksiteA,
      product: "PETROLEO DIESEL", productId, liters: 100, baseAmount: 1000, totalAmount: 1190, createdBy: requesterId,
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "consolidado.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", importadoPor: requesterId,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      { id: recordA, batchId, worksiteId: worksiteA, plate: "OPKM11", fecha: "2026-10-10", liters: 50 },
      // Faena sin vincular: sólo la ven los roles globales.
      { id: recordNoWorksite, batchId, worksiteId: null, plate: "OPKM22", fecha: "2026-10-11", liters: 30 },
    ])
  })

  beforeEach(() => {
    mockDeciders.mockReset().mockResolvedValue([])
    mockNotifyMany.mockClear()
  })

  it("pide con nota: guarda el pedido abierto con la faena de la carga y lo deja en la auditoría", async () => {
    const result = await requestLoadReview(requester(), { source: "tae_pwa", entityId: taeA, note: `  ${NOTE}  ` })
    expect(result.ok).toBe(true)
    const [mark] = await marksOf("fuel_tae_submission", taeA)
    expect(mark).toMatchObject({ status: "open", notes: NOTE, worksiteId: worksiteA, markedBy: requesterId, resolvedBy: null, resolvedAt: null })

    const audit = await inMemoryDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "fuel_tae_submission"), eq(schema.auditLog.entityId, taeA)))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: "update", userId: requesterId, reason: NOTE, worksiteId: worksiteA })
    expect(JSON.parse(audit[0]!.newState ?? "{}")).toMatchObject({ reviewRequest: "open" })
  })

  it("exige la nota: de 10 a 500 caracteres", async () => {
    const short = await requestLoadReview(requester(), { source: "invoiced", entityId: invoiceA, note: "x".repeat(REVIEW_REQUEST_NOTE_MIN - 1) })
    expect(short).toMatchObject({ ok: false, code: "invalid_note" })
    const long = await requestLoadReview(requester(), { source: "invoiced", entityId: invoiceA, note: "x".repeat(REVIEW_REQUEST_NOTE_MAX + 1) })
    expect(long).toMatchObject({ ok: false, code: "invalid_note" })
    const blank = await requestLoadReview(requester(), { source: "invoiced", entityId: invoiceA, note: " ".repeat(30) })
    expect(blank).toMatchObject({ ok: false, code: "invalid_note" })
    expect(await marksOf("fuel_load", invoiceA)).toHaveLength(0)
    const justRight = await requestLoadReview(requester(), { source: "invoiced", entityId: invoiceA, note: "x".repeat(REVIEW_REQUEST_NOTE_MIN) })
    expect(justRight.ok).toBe(true)
  })

  it("no duplica un pedido abierto: el segundo se rechaza y queda uno solo", async () => {
    const first = await requestLoadReview(requester(), { source: "operation_manual", entityId: recordA, note: NOTE })
    expect(first.ok).toBe(true)
    const second = await requestLoadReview(other(), { source: "operation_manual", entityId: recordA, note: "Otra nota distinta sobre lo mismo" })
    expect(second).toMatchObject({ ok: false, code: "already_open" })
    const marks = await marksOf("fuel_operation_record", recordA)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ status: "open", notes: NOTE })
  })

  it("lo retira quien lo pidió: pasa a «retirado», con quién y cuándo, sin borrarse; y se puede volver a pedir", async () => {
    const marks = await marksOf("fuel_tae_submission", taeA)
    const openId = marks.find((mark) => mark.status === "open")!.id

    const withdrawn = await withdrawLoadReviewRequest(requester(), openId)
    expect(withdrawn).toEqual({ ok: true, markId: openId })
    const [after] = await inMemoryDb.select().from(schema.fuelReviewMarks).where(eq(schema.fuelReviewMarks.id, openId))
    expect(after).toMatchObject({ status: "withdrawn", resolvedBy: requesterId, notes: NOTE })
    expect(after!.resolvedAt).not.toBeNull()

    const audit = await inMemoryDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "fuel_tae_submission"), eq(schema.auditLog.entityId, taeA)))
    expect(audit.map((row) => JSON.parse(row.newState ?? "{}").reviewRequest)).toEqual(expect.arrayContaining(["open", "withdrawn"]))

    // Después de retirar se puede pedir de nuevo: el índice único es sólo sobre los abiertos.
    const again = await requestLoadReview(requester(), { source: "tae_pwa", entityId: taeA, note: "Vuelvo a pedirla con más detalle" })
    expect(again.ok).toBe(true)
    const all = await marksOf("fuel_tae_submission", taeA)
    expect(all.map((mark) => mark.status).sort()).toEqual(["open", "withdrawn"])
  })

  it("retirar un pedido que ya no está abierto se rechaza", async () => {
    const withdrawn = (await marksOf("fuel_tae_submission", taeA)).find((mark) => mark.status === "withdrawn")!
    expect(await withdrawLoadReviewRequest(requester(), withdrawn.id)).toMatchObject({ ok: false, code: "not_open" })
    expect(await withdrawLoadReviewRequest(requester(), "no-existe")).toMatchObject({ ok: false, code: "not_found" })
  })

  it("un pedido resuelto (por quien decide, desde la bandeja) tampoco impide pedir de nuevo", async () => {
    const open = (await marksOf("fuel_tae_submission", taeA)).find((mark) => mark.status === "open")!
    await inMemoryDb.update(schema.fuelReviewMarks).set({ status: "resolved", resolvedBy: deciderId, resolvedAt: new Date().toISOString(), resolutionNote: "Confirmado con el supervisor" }).where(eq(schema.fuelReviewMarks.id, open.id))
    expect(await withdrawLoadReviewRequest(requester(), open.id)).toMatchObject({ ok: false, code: "not_open" })
    const again = await requestLoadReview(other(), { source: "tae_pwa", entityId: taeA, note: "Sigue sin cuadrar, revisen otra vez" })
    expect(again.ok).toBe(true)
  })

  it("sólo quien lo pidió o quien puede decidir puede retirar un pedido ajeno", async () => {
    const open = (await marksOf("fuel_tae_submission", taeA)).find((mark) => mark.status === "open")!
    expect(open.markedBy).toBe(otherId)
    // Un tercero de la misma faena, sin permiso de decidir.
    expect(await withdrawLoadReviewRequest(requester(), open.id)).toMatchObject({ ok: false, code: "forbidden" })
    expect((await inMemoryDb.select().from(schema.fuelReviewMarks).where(eq(schema.fuelReviewMarks.id, open.id)))[0]!.status).toBe("open")
    // Quien decide sobre las cargas, sí.
    expect(await withdrawLoadReviewRequest(decider(), open.id)).toMatchObject({ ok: true })
    expect((await inMemoryDb.select().from(schema.fuelReviewMarks).where(eq(schema.fuelReviewMarks.id, open.id)))[0]!).toMatchObject({ status: "withdrawn", resolvedBy: deciderId })
  })

  describe("alcance de faena", () => {
    it("quien no tiene la faena de la carga no puede pedir la revisión ni se entera de que existe", async () => {
      const result = await requestLoadReview(outsider(), { source: "tae_pwa", entityId: taeA, note: NOTE })
      expect(result).toMatchObject({ ok: false, code: "forbidden" })
      expect(await requestLoadReview(outsider(), { source: "invoiced", entityId: invoiceA, note: NOTE })).toMatchObject({ ok: false, code: "forbidden" })
    })

    it("tampoco puede retirar un pedido de una faena ajena, aunque pueda decidir en la suya", async () => {
      // La factura ya tiene un pedido abierto (el de la prueba de la nota mínima).
      const open = (await marksOf("fuel_load", invoiceA)).find((mark) => mark.status === "open")!
      expect(open.worksiteId).toBe(worksiteA)
      const decidesElsewhere = session(nanoid(), { worksiteIds: [worksiteB], permissions: ["combustibles:view", "combustibles:approve_flagged"] })
      expect(await withdrawLoadReviewRequest(decidesElsewhere, open.id)).toMatchObject({ ok: false, code: "forbidden" })
    })

    it("un rol global pide en cualquier faena, y una fila sin faena vinculada sólo la pide un rol global", async () => {
      expect((await requestLoadReview(globalUser(), { source: "tae_pwa", entityId: taeB, note: NOTE })).ok).toBe(true)
      const [mark] = await marksOf("fuel_tae_submission", taeB)
      expect(mark).toMatchObject({ worksiteId: worksiteB, status: "open" })

      expect(await requestLoadReview(requester(), { source: "operation_manual", entityId: recordNoWorksite, note: NOTE })).toMatchObject({ ok: false, code: "forbidden" })
      expect((await requestLoadReview(globalUser(), { source: "operation_manual", entityId: recordNoWorksite, note: NOTE })).ok).toBe(true)
      expect((await marksOf("fuel_operation_record", recordNoWorksite))[0]).toMatchObject({ worksiteId: null, status: "open" })
    })

    it("una carga que no existe responde «no encontrada»", async () => {
      expect(await requestLoadReview(globalUser(), { source: "tae_pwa", entityId: "no-existe", note: NOTE })).toMatchObject({ ok: false, code: "not_found" })
    })
  })

  it("avisa a quien decide en la faena (sin avisarle a quien lo pidió) con un enlace a la bandeja", async () => {
    mockDeciders.mockResolvedValue([deciderId, requesterId])
    const fresh = nanoid()
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: fresh, loadDate: "2026-10-12", month: "2026-10", serviceType: "TCT", vehicleId, fuelSupplierId: supplierId, worksiteId: worksiteA,
      product: "PETROLEO DIESEL", productId, liters: 60, baseAmount: 600, totalAmount: 714, createdBy: requesterId,
    })
    const result = await requestLoadReview(requester(), { source: "invoiced", entityId: fresh, note: NOTE })
    expect(result.ok).toBe(true)
    await vi.waitFor(() => expect(mockNotifyMany).toHaveBeenCalled())
    const [targets, payload] = mockNotifyMany.mock.calls[0] as [string[], Record<string, string>]
    expect(targets).toEqual([deciderId])
    expect(payload).toMatchObject({ entityType: "fuel_load", entityId: fresh, entityHref: "/combustibles/revisar?tipo=pedido" })
    expect(payload.body).toContain(NOTE)
    expect(mockDeciders).toHaveBeenCalledWith("combustibles:approve_flagged", worksiteA)
  })
})
