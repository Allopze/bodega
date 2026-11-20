import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"
import type { ShiftActor, ShiftInput } from "./fleet-shifts"

/**
 * Registro de turnos: cruces por equipo y por operador (con edición y anulación),
 * alcance por la faena del equipo EL DÍA del turno, marcas de día y meta de ralentí.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { createShift, updateShift, voidShift, setDayMark, clearDayMark, getIdleTarget, setIdleTarget } = await import("./fleet-shifts")

const ADMIN: ShiftActor = { userId: IDS.user, email: "qa-ctl@example.cl", scope: "all" }
const SCOPED_B: ShiftActor = { userId: IDS.user, email: "qa-ctl@example.cl", scope: [IDS.wsB] }

const OP_ANA = "worker-ana"
const OP_LUIS = "worker-luis"
const OP_BEA = "worker-bea"
const OP_OFF = "worker-off"

const input = (overrides: Partial<ShiftInput> = {}): ShiftInput => ({
  vehicleId: IDS.vA,
  shiftDate: "2026-11-09",
  startHour: 22,
  endHour: 6,
  operatorWorkerId: OP_ANA,
  notes: "",
  ...overrides,
})

async function auditRows(entityType: string, entityId: string) {
  return testDb.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, entityType), eq(schema.auditLog.entityId, entityId)))
}

async function mustCreate(actor: ShiftActor, data: ShiftInput): Promise<string> {
  const result = await createShift(actor, data)
  if (!result.ok) throw new Error(result.message)
  return result.shiftId
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.workers).values([
    { id: OP_ANA, firstName: "Ana", lastName: "Pérez", worksiteId: IDS.wsA },
    { id: OP_LUIS, firstName: "Luis", lastName: "Soto", worksiteId: IDS.wsA },
    { id: OP_BEA, firstName: "Bea", lastName: "Rojas", worksiteId: IDS.wsB },
    { id: OP_OFF, firstName: "Off", lastName: "Baja", worksiteId: IDS.wsA, isActive: false },
  ])
}, 60_000)

describe("registro de turnos", () => {
  it("crea un turno con el nombre del operador y deja auditoría", async () => {
    const shiftId = await mustCreate(ADMIN, input({ shiftDate: "2026-11-01", startHour: 6, endHour: 14, notes: "  con nota  " }))
    const [row] = await testDb.select().from(schema.fleetOperationShifts).where(eq(schema.fleetOperationShifts.id, shiftId))
    expect(row).toMatchObject({ operatorNameSnapshot: "Ana Pérez", notes: "con nota", voidedAt: null, createdBy: IDS.user })
    const audit = await auditRows("fleet_operation_shift", shiftId)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: "create", worksiteId: IDS.wsA })
  })

  it("rechaza inicio igual a fin con el mensaje exacto", async () => {
    const result = await createShift(ADMIN, input({ shiftDate: "2026-11-02", startHour: 6, endHour: 6 }))
    expect(result).toEqual({ ok: false, message: "La hora de inicio y la de fin no pueden ser iguales." })
  })

  it("valida horas, fecha, notas, equipo y operador", async () => {
    expect((await createShift(ADMIN, input({ startHour: 24 }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ startHour: 1.5 }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ shiftDate: "2023-12-31" }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ shiftDate: "2026-02-30" }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ shiftDate: "2027-12-31" }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ notes: "x".repeat(501) }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ vehicleId: "no-existe" }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ operatorWorkerId: "no-existe" }))).ok).toBe(false)
    expect((await createShift(ADMIN, input({ operatorWorkerId: OP_OFF }))).ok).toBe(false)
  })

  it("rechaza un cruce por equipo (22–06 del 09 contra 02–10 del 10)", async () => {
    await mustCreate(ADMIN, input({ shiftDate: "2026-11-09", startHour: 22, endHour: 6, operatorWorkerId: OP_ANA }))
    const result = await createShift(ADMIN, input({ shiftDate: "2026-11-10", startHour: 2, endHour: 10, operatorWorkerId: OP_LUIS }))
    expect(result).toEqual({
      ok: false,
      message: "Se cruza con el turno de Ana Pérez en KA-1 (09-11 22–06). Corrige el horario o edita ese turno.",
    })
  })

  it("rechaza un cruce por operador en otro equipo", async () => {
    await mustCreate(ADMIN, input({ shiftDate: "2026-11-12", startHour: 22, endHour: 6, operatorWorkerId: OP_LUIS }))
    const result = await createShift(ADMIN, input({ vehicleId: IDS.vB, shiftDate: "2026-11-13", startHour: 2, endHour: 10, operatorWorkerId: OP_LUIS }))
    expect(result).toEqual({ ok: false, message: "Luis Soto ya tiene un turno en KA-1 (12-11 22–06)." })
  })

  it("turnos contiguos no se cruzan", async () => {
    await mustCreate(ADMIN, input({ shiftDate: "2026-11-14", startHour: 6, endHour: 14 }))
    const next = await createShift(ADMIN, input({ shiftDate: "2026-11-14", startHour: 14, endHour: 22, operatorWorkerId: OP_LUIS }))
    expect(next.ok).toBe(true)
  })

  it("editar un turno sin moverlo no choca consigo mismo", async () => {
    const shiftId = await mustCreate(ADMIN, input({ shiftDate: "2026-11-03", startHour: 6, endHour: 14 }))
    const result = await updateShift(ADMIN, shiftId, input({ shiftDate: "2026-11-03", startHour: 6, endHour: 14, notes: "cambió la nota" }))
    expect(result).toEqual({ ok: true, shiftId })
    const [row] = await testDb.select().from(schema.fleetOperationShifts).where(eq(schema.fleetOperationShifts.id, shiftId))
    expect(row?.notes).toBe("cambió la nota")
    const audit = await auditRows("fleet_operation_shift", shiftId)
    expect(audit.map((a) => a.action).sort()).toEqual(["create", "update"])
  })

  it("editar hacia el horario de otro turno del mismo equipo sí choca", async () => {
    await mustCreate(ADMIN, input({ shiftDate: "2026-11-04", startHour: 6, endHour: 14, operatorWorkerId: OP_ANA }))
    const second = await mustCreate(ADMIN, input({ shiftDate: "2026-11-04", startHour: 14, endHour: 22, operatorWorkerId: OP_LUIS }))
    const result = await updateShift(ADMIN, second, input({ shiftDate: "2026-11-04", startHour: 12, endHour: 22, operatorWorkerId: OP_LUIS }))
    expect(result).toEqual({
      ok: false,
      message: "Se cruza con el turno de Ana Pérez en KA-1 (04-11 06–14). Corrige el horario o edita ese turno.",
    })
  })

  it("editar hacia el horario de otro turno del operador nuevo choca", async () => {
    await mustCreate(ADMIN, input({ vehicleId: IDS.vB, shiftDate: "2026-11-05", startHour: 6, endHour: 14, operatorWorkerId: OP_ANA }))
    const mine = await mustCreate(ADMIN, input({ shiftDate: "2026-11-05", startHour: 8, endHour: 12, operatorWorkerId: OP_LUIS }))
    const result = await updateShift(ADMIN, mine, input({ shiftDate: "2026-11-05", startHour: 8, endHour: 12, operatorWorkerId: OP_ANA }))
    expect(result).toEqual({ ok: false, message: "Ana Pérez ya tiene un turno en KB-2 (05-11 06–14)." })
  })

  it("anular libera las horas: se registra otro turno en el mismo horario", async () => {
    const shiftId = await mustCreate(ADMIN, input({ shiftDate: "2026-11-06", startHour: 6, endHour: 14 }))
    expect((await createShift(ADMIN, input({ shiftDate: "2026-11-06", startHour: 6, endHour: 14, operatorWorkerId: OP_LUIS }))).ok).toBe(false)
    expect(await voidShift(ADMIN, shiftId, "Se cargó mal")).toEqual({ ok: true })
    expect((await createShift(ADMIN, input({ shiftDate: "2026-11-06", startHour: 6, endHour: 14, operatorWorkerId: OP_LUIS }))).ok).toBe(true)
    const audit = await auditRows("fleet_operation_shift", shiftId)
    expect(audit.find((a) => a.action === "cancel")?.reason).toBe("Se cargó mal")
  })

  it("anular exige motivo y no se anula dos veces", async () => {
    const shiftId = await mustCreate(ADMIN, input({ shiftDate: "2026-11-07", startHour: 6, endHour: 14 }))
    expect((await voidShift(ADMIN, shiftId, "mal")).ok).toBe(false)
    expect(await voidShift(ADMIN, shiftId, "Motivo válido")).toEqual({ ok: true })
    expect(await voidShift(ADMIN, shiftId, "Motivo válido")).toEqual({ ok: false, message: "El turno ya está anulado." })
    expect((await updateShift(ADMIN, shiftId, input({ shiftDate: "2026-11-07", startHour: 6, endHour: 14 }))).ok).toBe(false)
  })
})

describe("alcance por la faena del equipo ese día", () => {
  it("un actor de la faena B no registra turnos de un equipo que ese día está en A", async () => {
    const result = await createShift(SCOPED_B, input({ vehicleId: IDS.vA, shiftDate: "2026-11-08", operatorWorkerId: OP_BEA }))
    expect(result).toEqual({ ok: false, message: "No tienes acceso a la faena de ese equipo ese día." })
  })

  it("el operador debe ser de una faena del alcance", async () => {
    const result = await createShift(SCOPED_B, input({ vehicleId: IDS.vB, shiftDate: "2026-11-08", operatorWorkerId: OP_ANA }))
    expect(result.ok).toBe(false)
    expect((await createShift(SCOPED_B, input({ vehicleId: IDS.vB, shiftDate: "2026-11-08", operatorWorkerId: OP_BEA }))).ok).toBe(true)
  })

  it("un equipo trasladado: B registra antes del traslado y no después", async () => {
    await setVehicleWorksiteForTest(testDb, IDS.vB, IDS.wsA, "2026-11-18")
    expect((await createShift(SCOPED_B, input({ vehicleId: IDS.vB, shiftDate: "2026-11-16", startHour: 6, endHour: 14, operatorWorkerId: OP_BEA }))).ok).toBe(true)
    expect(await createShift(SCOPED_B, input({ vehicleId: IDS.vB, shiftDate: "2026-11-19", startHour: 6, endHour: 14, operatorWorkerId: OP_BEA })))
      .toEqual({ ok: false, message: "No tienes acceso a la faena de ese equipo ese día." })
    // Y el actor de A (que ahora tiene el equipo) no anula el turno viejo, que era de B.
    const scopedA: ShiftActor = { ...SCOPED_B, scope: [IDS.wsA] }
    const [old] = await testDb.select().from(schema.fleetOperationShifts)
      .where(and(eq(schema.fleetOperationShifts.vehicleId, IDS.vB), eq(schema.fleetOperationShifts.shiftDate, "2026-11-16")))
    expect(await voidShift(scopedA, old!.id, "No era mío")).toEqual({ ok: false, message: "No tienes acceso a la faena de ese equipo ese día." })
  })
})

describe("marcas de día", () => {
  it("dos veces el mismo día actualiza, no duplica; borrarla deja auditoría", async () => {
    expect(await setDayMark(ADMIN, { vehicleId: IDS.vA, day: "2026-11-02", reason: "sin_operacion_programada", notes: "" })).toEqual({ ok: true })
    expect(await setDayMark(ADMIN, { vehicleId: IDS.vA, day: "2026-11-02", reason: "otro", notes: "feriado local" })).toEqual({ ok: true })
    const marks = await testDb.select().from(schema.fleetOperationDayMarks)
      .where(and(eq(schema.fleetOperationDayMarks.vehicleId, IDS.vA), eq(schema.fleetOperationDayMarks.day, "2026-11-02")))
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ reason: "otro", notes: "feriado local" })
    const markId = marks[0]!.id
    expect((await auditRows("fleet_operation_day_mark", markId)).map((a) => a.action).sort()).toEqual(["create", "update"])

    expect(await clearDayMark(ADMIN, { vehicleId: IDS.vA, day: "2026-11-02" })).toEqual({ ok: true })
    expect(await testDb.select().from(schema.fleetOperationDayMarks).where(eq(schema.fleetOperationDayMarks.id, markId))).toHaveLength(0)
    expect((await auditRows("fleet_operation_day_mark", markId)).map((a) => a.action)).toContain("delete")
    expect((await clearDayMark(ADMIN, { vehicleId: IDS.vA, day: "2026-11-02" })).ok).toBe(false)
  })

  it("valida alcance y motivo", async () => {
    expect((await setDayMark(SCOPED_B, { vehicleId: IDS.vA, day: "2026-11-02", reason: "otro", notes: "" })).ok).toBe(false)
    expect((await clearDayMark(SCOPED_B, { vehicleId: IDS.vA, day: "2026-11-02" })).ok).toBe(false)
    expect((await setDayMark(ADMIN, { vehicleId: IDS.vA, day: "2026-11-02", reason: "feriado" as never, notes: "" })).ok).toBe(false)
  })
})

describe("meta de ralentí", () => {
  it("sin clave devuelve 0,3; fijarla en 25 guarda la fracción y audita", async () => {
    expect(await getIdleTarget()).toBe(0.3)
    expect(await setIdleTarget(ADMIN, 25)).toEqual({ ok: true })
    expect(await getIdleTarget()).toBe(0.25)
    const [row] = await testDb.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, "fleet.shifts.idle_target"))
    expect(row?.value).toBe("0.25")
    expect(await auditRows("system_setting", "fleet.shifts.idle_target")).toHaveLength(1)
    expect(await setIdleTarget(ADMIN, 40)).toEqual({ ok: true })
    expect(await getIdleTarget()).toBe(0.4)
  })

  it("rechaza 0, 100 y no enteros; un valor guardado inválido vuelve al de fábrica", async () => {
    expect((await setIdleTarget(ADMIN, 0)).ok).toBe(false)
    expect((await setIdleTarget(ADMIN, 100)).ok).toBe(false)
    expect((await setIdleTarget(ADMIN, 12.5)).ok).toBe(false)
    await testDb.update(schema.systemSettings).set({ value: "basura" }).where(eq(schema.systemSettings.key, "fleet.shifts.idle_target"))
    expect(await getIdleTarget()).toBe(0.3)
  })
})
