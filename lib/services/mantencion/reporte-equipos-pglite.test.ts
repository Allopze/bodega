import { eq } from "drizzle-orm"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * «Reportes de equipos» del Panel de mantención contra Postgres de verdad: la fecha del reporte (la del
 * turno, no la de la transcripción), qué se espera y qué se recibe, las firmas contra los roles del
 * snapshot de la plantilla, las horas con coma decimal y valores absurdos, las fallas abiertas (una por
 * ítem y equipo) con su antigüedad desde la detección, y el alcance del visor.
 *
 * El «hoy» es fijo (2026-11-13) para que las cifras no dependan del día en que corre la prueba.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { loadReporteEquipos } = await import("@/lib/services/mantencion/reporte-equipos")

const TODAY = "2026-11-13"
const WS = { a: "ws-re-a", b: "ws-re-b", c: "ws-re-c" } as const
const V = { a1: "v-re-a1", a2: "v-re-a2", b1: "v-re-b1" } as const
const USER = "u-re-1"
const ROLES = ["operador_entrante", "operador_saliente", "supervisor_turno"]

const GLOBAL = { userId: USER, email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true }
const SCOPED_A = { userId: USER, email: null, permissions: ["mant:records:view_worksite"], worksiteIds: [WS.a], isGlobal: false }
const SCOPED_C = { userId: USER, email: null, permissions: ["mant:records:view_worksite"], worksiteIds: [WS.c], isGlobal: false }

const QUERY = { from: "2026-11-01", to: TODAY, granularity: "day" as const, today: TODAY }

const signed = (roles: readonly string[]) => roles.map((role) => ({
  role, name: "Operador de Prueba", userId: null, verified: false, capturedByUserId: USER, signedAt: "2026-11-09T12:00:00Z",
}))

interface RunInput {
  id: string
  vehicleId: string
  worksiteId: string
  scheduledFor: string | null
  status: "planned" | "in_progress" | "completed" | "reviewed" | "cancelled"
  signatures?: ReturnType<typeof signed>
  templateId?: string
  executedAt?: string
}

async function insertRun(input: RunInput) {
  await testDb.insert(schema.preventionInspectionRuns).values({
    id: input.id, code: `INSP-${input.id}`, templateId: input.templateId ?? "tpl-re", worksiteId: input.worksiteId,
    subjectVehicleId: input.vehicleId, scheduledFor: input.scheduledFor, status: input.status,
    executedAt: input.executedAt ?? (input.status === "completed" || input.status === "reviewed" ? "2026-11-12T15:00:00Z" : null),
    closingSignatures: input.signatures ?? null, createdByUserId: USER,
  })
}

async function answer(runId: string, itemId: string, result: string, value?: string) {
  await testDb.insert(schema.preventionInspectionAnswers).values({
    id: `ans-${runId}-${itemId}`, runId, sectionId: itemId.startsWith("horometro") ? "horometro" : "estado_camion", itemId, itemLabel: itemId,
    result, value: value ?? null,
  })
  return `ans-${runId}-${itemId}`
}

async function finding(id: string, runId: string, answerId: string | null, criticality: string, status = "open") {
  await testDb.insert(schema.preventionInspectionFindings).values({
    id, runId, answerId, description: id, criticality, status,
    createdAt: "2026-11-12T15:00:00Z",
    ...(status === "closed" ? { closedByUserId: USER, closedAt: "2026-11-12T16:00:00Z" } : {}),
  })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: USER, name: USER, email: `${USER}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  const worksite = (id: string, name: string) => ({ id, name, code: id.toUpperCase(), isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([worksite(WS.a, "Faena A"), worksite(WS.b, "Faena B"), worksite(WS.c, "Faena C")])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-re", slug: "re-hr", name: "Cargador", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  const vehicle = (id: string, code: string, plate: string, worksiteId: string) => ({ id, code, plate, type: "Cargador", equipmentTypeId: "fet-re", worksiteId, model: "X", year: 2021, brand: "Marca" })
  await testDb.insert(schema.fuelVehicles).values([vehicle(V.a1, "KA-1", "AAAA-01", WS.a), vehicle(V.a2, "KA-2", "AAAA-02", WS.a), vehicle(V.b1, "CR-1", "BBBB-01", WS.b)])

  const template = (id: string, code: string, sourceDefinitionCode: string) => ({
    id, code, versionLabel: "1", name: "Plantilla", kind: "inspection", sourceDefinitionCode,
    definitionSnapshot: { closingAct: { signatureRoles: ROLES } }, contentHash: id.padEnd(64, "a"), status: "approved" as const, authorUserId: USER,
    approvedByUserId: USER, approvedAt: now,
  })
  await testDb.insert(schema.preventionInspectionTemplates).values([template("tpl-re", "reporte_equipos", "reporte_equipos"), template("tpl-otra", "otra", "inspeccion_extintores")])

  // Faena A, equipo 1: luces falla 20-oct (ya cerrado), conforme 6-nov, y falla otra vez 7 y 8-nov: la racha
  // actual arranca el 7 (6 días), no el 20-oct. El freno falla sólo el 8.
  await insertRun({ id: "r8", vehicleId: V.a1, worksiteId: WS.a, scheduledFor: "2026-10-20", status: "completed", signatures: signed(ROLES) })
  await answer("r8", "luces", "non_conforming")
  await finding("f-r8-luces", "r8", "ans-r8-luces", "high", "closed")
  await insertRun({ id: "r0", vehicleId: V.a1, worksiteId: WS.a, scheduledFor: "2026-11-06", status: "completed", signatures: signed(ROLES) })
  await answer("r0", "luces", "conforming")
  await insertRun({ id: "r1", vehicleId: V.a1, worksiteId: WS.a, scheduledFor: "2026-11-07", status: "reviewed", signatures: signed(ROLES) })
  await answer("r1", "horometro_inicio", "recorded", "100")
  await answer("r1", "horometro_termino", "recorded", "108,5")
  await finding("f-r1-luces", "r1", await answer("r1", "luces", "non_conforming"), "high")
  // Dos firmas de tres y un horómetro absurdo (un dígito de más): no cuenta como firmas completas ni suma horas.
  await insertRun({ id: "r2", vehicleId: V.a1, worksiteId: WS.a, scheduledFor: "2026-11-08", status: "completed", signatures: signed(ROLES.slice(0, 2)) })
  await answer("r2", "horometro_inicio", "recorded", "134122")
  await answer("r2", "horometro_termino", "recorded", "135120")
  await finding("f-r2-luces", "r2", await answer("r2", "luces", "non_conforming"), "high")
  await finding("f-r2-freno", "r2", await answer("r2", "freno_servicio", "non_conforming"), "critical")
  // Faena A, equipo 2: uno por recibir, uno cancelado (no se esperaba) y uno de ayer con una falla leve, sin firmas.
  await insertRun({ id: "r3", vehicleId: V.a2, worksiteId: WS.a, scheduledFor: "2026-11-08", status: "planned" })
  await insertRun({ id: "r4", vehicleId: V.a2, worksiteId: WS.a, scheduledFor: "2026-11-09", status: "cancelled" })
  await finding("f-r4-cancelado", "r4", null, "critical")
  // El día del turno es el 10, pero lo transcribieron el 12: manda el día del turno.
  await insertRun({ id: "r10", vehicleId: V.a2, worksiteId: WS.a, scheduledFor: "2026-11-10", status: "completed", executedAt: "2026-11-12T15:00:00Z" })
  await finding("f-r10-bocina", "r10", await answer("r10", "bocina", "non_conforming"), "low")
  // Futuro: aún no se espera.
  await insertRun({ id: "r5", vehicleId: V.a1, worksiteId: WS.a, scheduledFor: "2026-11-20", status: "planned" })
  // Sin fecha de turno: manda la fecha civil de Chile de cuando se transcribió. 02:30 UTC es la noche anterior
  // en Chile: r11 cae el 30-sep (no el 1-oct) y r12 el 11-nov (no el 12).
  await insertRun({ id: "r11", vehicleId: V.a2, worksiteId: WS.a, scheduledFor: null, status: "completed", executedAt: "2026-10-01T02:30:00Z" })
  await insertRun({ id: "r12", vehicleId: V.a2, worksiteId: WS.a, scheduledFor: null, status: "completed", executedAt: "2026-11-12T02:30:00Z" })
  // Otra faena, horas válidas y firmas completas.
  await insertRun({ id: "r6", vehicleId: V.b1, worksiteId: WS.b, scheduledFor: "2026-11-08", status: "completed", signatures: signed(ROLES) })
  await answer("r6", "horometro_inicio", "recorded", "50")
  await answer("r6", "horometro_termino", "recorded", "56")
  // Otra plantilla: no es un reporte de equipos.
  await insertRun({ id: "r7", vehicleId: V.a1, worksiteId: WS.a, scheduledFor: "2026-11-08", status: "completed", templateId: "tpl-otra" })
  await finding("f-r7-otra", "r7", null, "critical")
})

describe("loadReporteEquipos", () => {
  it("esperados y recibidos: sin cancelados, sin futuros, con la fecha del turno y sin otras plantillas", async () => {
    const result = await loadReporteEquipos(GLOBAL, QUERY)
    expect(result.hasRuns).toBe(true)
    // En el período: r0, r1, r2, r3, r6, r10 y r12 (r4 cancelado, r5 futuro, r7 de otra plantilla, r8 y r11 de antes).
    expect(result.coverage.expected).toBe(7)
    expect(result.coverage.received).toBe(6)
    expect(result.coverage.percent).toBeCloseTo((6 / 7) * 100)
    const day = (key: string) => result.coverage.points.find((point) => point.key === key)
    expect(day("2026-11-08")).toMatchObject({ expected: 3, received: 2 })
    // r10 se transcribió el 12 pero es del turno del 10.
    expect(day("2026-11-10")).toMatchObject({ expected: 1, received: 1 })
    // r12 no trae fecha de turno: se transcribió el 12 a las 02:30 UTC, que en Chile es el 11 a las 23:30.
    expect(day("2026-11-11")).toMatchObject({ expected: 1, received: 1 })
    expect(day("2026-11-12")).toMatchObject({ expected: 0, received: 0 })
    expect(result.coverage.points).toHaveLength(13)
  })

  it("firmas completas: contra los roles del snapshot de la plantilla, sólo de los recibidos", async () => {
    const { signatures } = await loadReporteEquipos(GLOBAL, QUERY)
    // Recibidos: r0, r1, r2, r6, r10, r12. Completas: r0, r1, r6. r2 trae dos de tres; r10 y r12, ninguna.
    expect(signatures).toMatchObject({ complete: 3, received: 6 })
    expect(signatures.percent).toBeCloseTo(50)
  })

  it("horas operadas: con coma decimal, y un valor absurdo no se suma", async () => {
    const { hours } = await loadReporteEquipos(GLOBAL, QUERY)
    expect(hours.total).toBe(14.5)
    expect(hours.measuredReports).toBe(2)
    expect(hours.byEquipment.map((row) => [row.code, row.hours])).toEqual([["KA-1", 8.5], ["CR-1", 6]])
  })

  it("fallas abiertas: una por ítem y equipo, antigüedad desde la detección, de seguridad las altas y críticas", async () => {
    const { failures } = await loadReporteEquipos(GLOBAL, QUERY)
    // Hallazgos abiertos: luces (r1 y r2, juntas), freno (r2) y bocina (r10). Los cerrados, los de un reporte
    // cancelado y los de otra plantilla no cuentan.
    expect(failures.total).toBe(3)
    expect(failures.safety).toBe(2)
    expect(failures.byEquipment.map((row) => ({ code: row.code, fresh: row.fresh, week: row.week, old: row.old, total: row.total, safety: row.safety }))).toEqual([
      // Luces desde el 7-nov (el conforme del 6 corta la racha del 20-oct): 6 días. Freno desde el 8: 5 días.
      { code: "KA-1", fresh: 0, week: 2, old: 0, total: 2, safety: 2 },
      // Bocina de un reporte del 10: 3 días.
      { code: "KA-2", fresh: 1, week: 0, old: 0, total: 1, safety: 0 },
    ])
  })

  it("una desviación sin ítem cuenta su antigüedad desde la fecha del reporte, no desde que se transcribió", async () => {
    // r0 es el reporte del 6-nov; la fila del hallazgo nace el 12 (transcripción tardía o carga del papel).
    await finding("f-r0-desviacion", "r0", null, "high")
    try {
      const { failures } = await loadReporteEquipos(GLOBAL, QUERY)
      const ka1 = failures.byEquipment.find((row) => row.code === "KA-1")!
      // Del 6 al 13: 7 días, en «4 a 7 días» junto a luces y freno; antes del arreglo salía «0 a 3 días».
      expect({ fresh: ka1.fresh, week: ka1.week, total: ka1.total }).toEqual({ fresh: 0, week: 3, total: 3 })
    } finally {
      await testDb.delete(schema.preventionInspectionFindings).where(eq(schema.preventionInspectionFindings.id, "f-r0-desviacion"))
    }
  })

  it("las fallas abiertas son de hoy: no se limitan al período", async () => {
    const { failures } = await loadReporteEquipos(GLOBAL, { ...QUERY, from: "2026-11-12", to: "2026-11-12" })
    expect(failures.total).toBe(3)
  })

  it("fallas por sistema: ocurrencias en los reportes recibidos del período", async () => {
    const { bySystem } = await loadReporteEquipos(GLOBAL, QUERY)
    // luces (r1 y r2) y bocina (r10) son eléctricas; freno_servicio de r2, frenos. La falla de r8 es de antes del período.
    expect(bySystem.map((row) => [row.label, row.count])).toEqual([["Eléctrico", 3], ["Frenos y dirección", 1]])
  })

  it("la faena elegida acota; el alcance del visor acota y el filtro nunca lo agranda", async () => {
    const onlyB = await loadReporteEquipos(GLOBAL, { ...QUERY, worksiteId: WS.b })
    expect(onlyB.coverage).toMatchObject({ expected: 1, received: 1 })
    expect(onlyB.failures.total).toBe(0)
    const scopedA = await loadReporteEquipos(SCOPED_A, QUERY)
    expect(scopedA.coverage).toMatchObject({ expected: 6, received: 5 })
    // Pedir la faena B desde un alcance que sólo ve la A no devuelve nada de la B.
    const forbidden = await loadReporteEquipos(SCOPED_A, { ...QUERY, worksiteId: WS.b })
    expect(forbidden.hasRuns).toBe(false)
  })

  it("sin ningún reporte en el alcance, la sección no se pinta", async () => {
    const result = await loadReporteEquipos(SCOPED_C, QUERY)
    expect(result.hasRuns).toBe(false)
    expect(result.coverage.expected).toBe(0)
    expect(result.failures.total).toBe(0)
  })

  it("por mes, un período largo junta los días del mes", async () => {
    const result = await loadReporteEquipos(GLOBAL, { from: "2026-10-01", to: TODAY, granularity: "month", today: TODAY })
    expect(result.coverage.points.map((point) => point.key)).toEqual(["2026-10", "2026-11"])
    // Octubre: sólo r8 (20-oct). r11 se transcribió el 1-oct a las 02:30 UTC, que en Chile es el 30-sep.
    expect(result.coverage.points[0]).toMatchObject({ expected: 1, received: 1 })
  })
})
