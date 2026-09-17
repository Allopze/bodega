/**
 * Desvíos por celda (deviations.ts) contra Postgres real (PGlite): las
 * validaciones de `recordPdtpDeviation`, la exclusión mutua con ejecuciones,
 * y — el punto central de la tarea 3.2 — que el efecto de cada tipo se
 * propaga a través de la costura única (`loadProgramScheduleAndExecutions`)
 * hasta el indicador de cumplimiento y el documento RE-36, sin que la huella
 * firmada del programa se entere.
 *
 * Import dinámico dentro de cada `it()`: un import estático del barrel
 * resuelve `@/db` antes de que `globalThis.__db` quede asignado más abajo.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true },
    { id: "user-2", name: "U2", email: "u2@test", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "prevencionista", displayName: "Prevencionista", kind: "role" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena 1", code: "F1", isActive: true },
    { id: "ws-2", name: "Faena 2", code: "F2", isActive: true },
  ])
})

/** Programa activo con una actividad `on_demand` (sin recurrencia auto-proyectada) y su celda planificada. */
async function createActiveProgramWithScheduledCell(
  year: number,
  cell: { month: number; week: number; plannedQuantity: number },
) {
  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createLegacyPdtpProgramForTests({ year, title: `Programa ${year}`, userId: "user-1" })
  const activity = await addPdtpActivity({
    programId: program.id,
    activity: "Charla de seguridad",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, "user-1")
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
    id: `${activity.id}-s-${year}-${String(cell.month).padStart(2, "0")}-${cell.week}`,
    activityId: activity.id,
    year,
    month: cell.month,
    week: cell.week,
    plannedQuantity: cell.plannedQuantity,
    sourceColumn: "test",
  })
  await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))
  const [activated] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))
  return { program: activated!, activity }
}

describe("recordPdtpDeviation: efecto de cada tipo a través de la costura única", () => {
  it("not_applicable baja `planned` del indicador y del documento RE-36 en esa faena, no en otra", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    const { program, activity } = await createActiveProgramWithScheduledCell(2060, { month: 3, week: 1, plannedQuantity: 4 })

    // Membresía de hoja para que la fila aparezca en el documento RE-36.
    const [sheet] = await inMemoryDb.select().from(schema.pdtpSheets).where(eq(schema.pdtpSheets.programId, program.id))
    await inMemoryDb.insert(schema.pdtpSheetActivities).values({
      id: "membership-1", sheetId: sheet!.id, sheetCode: "pdtp_general", activityId: activity.id, sheetRow: 1, displayOrder: 1,
    })

    await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2060, month: 3, week: 1,
      kind: "not_applicable", reason: "No aplica: la faena no opera esa semana por paro programado.",
    }, "user-1", "all")

    const ws1Indicators = await getPdtpComplianceIndicators(program.id, "ws-1")
    expect(ws1Indicators!.monthly[2]!.planned).toBe(0) // marzo = índice 2

    // Otra faena, sin el desvío: el planificado sigue intacto.
    const ws2Indicators = await getPdtpComplianceIndicators(program.id, "ws-2")
    expect(ws2Indicators!.monthly[2]!.planned).toBe(4)

    const re36ws1 = await buildPdtpRe36Document({ programId: program.id, worksiteId: "ws-1", scope: "all" })
    const re36ws2 = await buildPdtpRe36Document({ programId: program.id, worksiteId: "ws-2", scope: "all" })
    const cellIndex = (3 - 1) * 4 + (1 - 1) // (month-1)*4 + (week-1)
    expect(re36ws1.sheets[0]!.rows[0]!.cells[cellIndex]!.p).toBeNull()
    expect(re36ws2.sheets[0]!.rows[0]!.cells[cellIndex]!.p).toBe(4)
  })

  it("reprogrammed mueve P de mar S2 a abr S1 y una ejecución aprobada en abr S1 acredita", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { program, activity } = await createActiveProgramWithScheduledCell(2061, { month: 3, week: 2, plannedQuantity: 3 })

    await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2061, month: 3, week: 2,
      kind: "reprogrammed", reason: "Se reprograma por indisponibilidad del relator asignado.",
      targetMonth: 4, targetWeek: 1,
    }, "user-1", "all")

    const execution = await markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: 2061, month: 4, week: 1, executedQuantity: 3,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(execution.id, "user-2", ["ws-1"])

    const indicators = await getPdtpComplianceIndicators(program.id, "ws-1")
    expect(indicators!.monthly[2]!.planned).toBe(0) // marzo ya no exige nada
    expect(indicators!.monthly[3]!.planned).toBe(3) // abril hereda el planificado movido
    expect(indicators!.monthly[3]!.executed).toBe(3)
    expect(indicators!.monthly[3]!.percent).toBe(1) // fracción 0-1, no 0-100
  })

  it("not_performed mantiene P, E=0 y cuenta en zeroActivities", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    // Período pasado real (no futuro): `not_performed` no se declara a futuro.
    const { program, activity } = await createActiveProgramWithScheduledCell(2024, { month: 1, week: 1, plannedQuantity: 2 })

    await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2024, month: 1, week: 1,
      kind: "not_performed", reason: "No se realizó: el relator se accidentó camino a la faena.",
    }, "user-1", "all")

    const indicators = await getPdtpComplianceIndicators(program.id, "ws-1")
    expect(indicators!.monthly[0]!.planned).toBe(2) // enero sigue exigiendo el planificado
    expect(indicators!.monthly[0]!.executed).toBe(0)
    expect(indicators!.monthly[0]!.zeroActivities).toBe(1)
    expect(indicators!.monthly[0]!.zeroActivityIds).toEqual([activity.id])
  })

  it("no se puede registrar not_applicable sobre celda con ejecución aprobada", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { activity } = await createActiveProgramWithScheduledCell(2062, { month: 5, week: 1, plannedQuantity: 1 })

    const execution = await markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: 2062, month: 5, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(execution.id, "user-2", ["ws-1"])

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2062, month: 5, week: 1,
      kind: "not_applicable", reason: "Se intenta declarar no aplicable tras la aprobación.",
    }, "user-1", "all")).rejects.toThrow(/ejecución/)

    // Lo mismo con reprogrammed sobre la misma celda ya acreditada.
    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2062, month: 5, week: 1,
      kind: "reprogrammed", reason: "Se intenta reprogramar tras la aprobación.",
      targetMonth: 6, targetWeek: 1,
    }, "user-1", "all")).rejects.toThrow(/ejecución/)

    // Y a la inversa: con un desvío activo no-`not_performed` sobre otra celda, la ejecución también se rechaza.
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `${activity.id}-s-2062-06-01`, activityId: activity.id, year: 2062, month: 6, week: 1, plannedQuantity: 1, sourceColumn: "test",
    })
    await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2062, month: 6, week: 1,
      kind: "not_applicable", reason: "No aplica esta celda para la faena.",
    }, "user-1", "all")
    await expect(markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: 2062, month: 6, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])).rejects.toThrow(/desvío activo/)
  })

  it("registrar ejecución sobre not_performed lo retira con changelog propio", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { activity } = await createActiveProgramWithScheduledCell(2025, { month: 2, week: 1, plannedQuantity: 1 })

    const deviation = await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2025, month: 2, week: 1,
      kind: "not_performed", reason: "No se realizó por corte de suministro eléctrico.",
    }, "user-1", "all")

    await markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: 2025, month: 2, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])

    const [reloaded] = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.id, deviation.id))
    expect(reloaded!.status).toBe("withdrawn")
    expect(reloaded!.withdrawReason).toBe("Ejecución registrada posteriormente")

    const changeLog = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(eq(schema.pdtpChangeLog.section, `deviation:${activity.n}`))
    expect(changeLog.some((entry) => entry.note?.includes("retirado automáticamente"))).toBe(true)

    // Una ejecución con cantidad 0 no retira el desvío: nada ocurrió todavía.
    const { program: program2, activity: activity2 } = await createActiveProgramWithScheduledCell(2026, { month: 2, week: 1, plannedQuantity: 1 })
    void program2
    const deviation2 = await recordPdtpDeviation({
      activityId: activity2.id, worksiteId: "ws-1", year: 2026, month: 2, week: 1,
      kind: "not_performed", reason: "No se realizó por ausencia del relator asignado.",
    }, "user-1", "all")
    await markPdtpExecution({
      activityId: activity2.id, worksiteId: "ws-1", year: 2026, month: 2, week: 1, executedQuantity: 0,
    }, "user-1", ["ws-1"])
    const [stillActive] = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.id, deviation2.id))
    expect(stillActive!.status).toBe("active")
  })

  it("la huella del programa no cambia al registrar desvíos", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { computePdtpProgramContentDigest } = await import("@/lib/services/pdtp/content-digest")
    const { program, activity } = await createActiveProgramWithScheduledCell(2063, { month: 7, week: 1, plannedQuantity: 5 })

    const baseline = await computePdtpProgramContentDigest(program.id)

    await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2063, month: 7, week: 1,
      kind: "not_applicable", reason: "No aplica esta semana por cierre temporal de faena.",
    }, "user-1", "all")

    const afterDeviation = await computePdtpProgramContentDigest(program.id)
    expect(afterDeviation.digest).toBe(baseline.digest)
  })
})

describe("recordPdtpDeviation: validaciones de entrada", () => {
  it("rechaza declarar no aplicable o reprogramar sobre una celda sin planificado efectivo", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { addPdtpActivity, createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")
    const program = await createLegacyPdtpProgramForTests({ year: 2064, title: "Programa 2064", userId: "user-1" })
    const activity = await addPdtpActivity({
      programId: program.id, activity: "Actividad sin planificación", program: "Guía",
      responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista", sheetCodes: [], scheduleMode: "on_demand",
    }, "user-1")
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2064, month: 1, week: 1,
      kind: "not_applicable", reason: "No hay nada planificado en esta celda todavía.",
    }, "user-1", "all")).rejects.toThrow(/no hay nada/i)
  })

  it("rechaza un destino de reprogramación fuera del horizonte parcial del programa", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { program, activity } = await createActiveProgramWithScheduledCell(2065, { month: 3, week: 1, plannedQuantity: 2 })
    // Programa de período parcial (semestre 1): el horizonte deja de ser el
    // año calendario completo (ver `deriveScheduleHorizon`, recurrence.ts).
    await inMemoryDb.update(schema.pdtpPrograms).set({ periodEnd: "2065-06-30" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2065, month: 3, week: 1,
      kind: "reprogrammed", reason: "Se reprograma a un mes fuera del horizonte parcial del programa.",
      targetMonth: 9, targetWeek: 1,
    }, "user-1", "all")).rejects.toThrow(/horizonte/)
  })

  it("rechaza declarar not_performed en un período futuro", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { activity } = await createActiveProgramWithScheduledCell(2099, { month: 1, week: 1, plannedQuantity: 2 })

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2099, month: 1, week: 1,
      kind: "not_performed", reason: "No se realizó, según se anticipa desde ya.",
    }, "user-1", "all")).rejects.toThrow(/aún no ocurre/)
  })

  it("rechaza un segundo desvío activo sobre la misma celda; retirar el primero habilita registrar otro", async () => {
    const { recordPdtpDeviation, withdrawPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { activity } = await createActiveProgramWithScheduledCell(2066, { month: 2, week: 2, plannedQuantity: 2 })

    const first = await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2066, month: 2, week: 2,
      kind: "not_applicable", reason: "Primer desvío registrado sobre esta celda.",
    }, "user-1", "all")

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2066, month: 2, week: 2,
      kind: "not_applicable", reason: "Segundo intento sobre la misma celda activa.",
    }, "user-1", "all")).rejects.toThrow(/ya existe un desvío activo/i)

    await withdrawPdtpDeviation({ deviationId: first.id, reason: "Se revirtió: la faena sí opera esa semana." }, "user-1", "all")

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2066, month: 2, week: 2,
      kind: "not_applicable", reason: "Tercer intento, ya con el primero retirado.",
    }, "user-1", "all")).resolves.toBeDefined()
  })

  it("rechaza reprogramar hacia un período anterior a la activación del programa", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { program, activity } = await createActiveProgramWithScheduledCell(2072, { month: 7, week: 1, plannedQuantity: 2 })
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ activatedAt: "2072-06-05T12:00:00.000Z" })
      .where(eq(schema.pdtpPrograms.id, program.id))

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2072, month: 7, week: 1,
      kind: "reprogrammed", reason: "Se intenta reprogramar hacia atrás, antes de la activación.",
      targetMonth: 3, targetWeek: 1,
    }, "user-1", "all")).rejects.toThrow(/anterior a la activación del programa/)
  })

  it("rechaza reprogramar hacia un período donde la actividad ya está retirada", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { activity } = await createActiveProgramWithScheduledCell(2073, { month: 3, week: 1, plannedQuantity: 2 })
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ status: "retired", retiredEffectiveFrom: "2073-06-01", retiredAt: new Date().toISOString(), retiredReason: "Actividad retirada a mitad de año por cambio normativo." })
      .where(eq(schema.pdtpActivities.id, activity.id))

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2073, month: 3, week: 1,
      kind: "reprogrammed", reason: "Se intenta reprogramar a un mes donde la actividad ya no rige.",
      targetMonth: 8, targetWeek: 1,
    }, "user-1", "all")).rejects.toThrow(/retirada para el período de destino/)
  })
})

describe("desvíos y vigencia por retiro (costura única, dos pasadas)", () => {
  it("un `reprogrammed` con ORIGEN en un período ya retirado no traslada planificado fantasma al destino", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { loadProgramScheduleAndExecutions } = await import("@/lib/services/pdtp/helpers")
    const { program, activity } = await createActiveProgramWithScheduledCell(2074, { month: 3, week: 1, plannedQuantity: 4 })
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ status: "retired", retiredEffectiveFrom: "2074-03-01", retiredAt: new Date().toISOString(), retiredReason: "Actividad retirada desde marzo por cambio normativo." })
      .where(eq(schema.pdtpActivities.id, activity.id))

    // Desvío histórico: registrado cuando la actividad aún regía en marzo, con
    // destino en febrero (dentro de la vigencia). Hoy `recordPdtpDeviation` lo
    // rechazaría por el origen retirado, así que se inserta directo.
    await inMemoryDb.insert(schema.pdtpExecutionDeviations).values({
      id: "dev-origen-retirado", activityId: activity.id, worksiteId: "ws-1",
      year: 2074, month: 3, week: 1, kind: "reprogrammed",
      reason: "Reprogramación histórica desde una celda que luego quedó retirada.",
      targetMonth: 2, targetWeek: 1, status: "active",
      createdByUserId: "user-1", createdAt: new Date().toISOString(),
    })

    const indicators = await getPdtpComplianceIndicators(program.id, "ws-1")
    expect(indicators!.monthly[2]!.planned).toBe(0) // marzo: retirada, no exige nada
    expect(indicators!.monthly[1]!.planned).toBe(0) // febrero: NO hereda planificado de una celda retirada

    // Minor 8: el desvío de una celda ya descartada tampoco se devuelve.
    const loaded = await loadProgramScheduleAndExecutions([activity.id], 2074, "ws-1")
    expect(loaded.deviationRows).toEqual([])
  })

  it("un retiro posterior a un `reprogrammed` legítimo conserva el planificado en el origen en vez de evaporarlo", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { program, activity } = await createActiveProgramWithScheduledCell(2075, { month: 3, week: 1, plannedQuantity: 4 })

    // Desvío válido al registrarse: la actividad todavía rige todo el año.
    await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2075, month: 3, week: 1,
      kind: "reprogrammed", reason: "Se reprograma a agosto por disponibilidad del relator.",
      targetMonth: 8, targetWeek: 1,
    }, "user-1", "all")

    // Retiro declarado después: el destino (agosto) deja de regir.
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ status: "retired", retiredEffectiveFrom: "2075-06-01", retiredAt: new Date().toISOString(), retiredReason: "Actividad retirada desde junio por cambio normativo." })
      .where(eq(schema.pdtpActivities.id, activity.id))

    const indicators = await getPdtpComplianceIndicators(program.id, "ws-1")
    expect(indicators!.monthly[7]!.planned).toBe(0) // agosto: la actividad ya no rige
    // Opción conservadora: el planificado no desaparece del denominador sin
    // dejar rastro; se conserva en su celda de origen, que sí era vigente.
    expect(indicators!.monthly[2]!.planned).toBe(4)
  })
})

describe("acreditación por integración sobre una celda con desvío activo (la evidencia gana)", () => {
  async function accreditOver(kind: "not_performed" | "not_applicable" | "reprogrammed", year: number) {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { activity } = await createActiveProgramWithScheduledCell(year, { month: 3, week: 1, plannedQuantity: 2 })

    const deviation = await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year, month: 3, week: 1, kind,
      reason: "Desvío declarado antes de que llegara la evidencia del módulo de origen.",
      ...(kind === "reprogrammed" ? { targetMonth: 5, targetWeek: 1 } : {}),
    }, "user-1", "all")

    const result = await accreditPdtpFromEvent({
      sourceType: "capacitacion",
      sourceId: `sesion-${kind}`,
      worksiteId: "ws-1",
      activityNumbers: [activity.n],
      occurredAt: `${year}-03-05T12:00:00.000Z`,
    })

    const [reloaded] = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.id, deviation.id))
    const changeLog = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(eq(schema.pdtpChangeLog.section, `deviation:${activity.n}`))
    return { result, reloaded: reloaded!, changeLog }
  }

  it("retira un `not_performed` activo y deja su entrada de changelog", async () => {
    const { result, reloaded, changeLog } = await accreditOver("not_performed", 2024)
    expect(result.accredited).toHaveLength(1)
    expect(reloaded.status).toBe("withdrawn")
    expect(reloaded.withdrawReason).toMatch(/acreditación por integración desde capacitacion/)
    expect(changeLog.some((entry) => entry.note?.includes("retirado automáticamente"))).toBe(true)
  })

  it("retira un `not_applicable` activo (planificado 0 con ejecutado > 0 sería incoherente)", async () => {
    const { result, reloaded, changeLog } = await accreditOver("not_applicable", 2025)
    expect(result.accredited).toHaveLength(1)
    expect(reloaded.status).toBe("withdrawn")
    expect(reloaded.withdrawReason).toMatch(/acreditación por integración desde capacitacion/)
    expect(changeLog.some((entry) => entry.note?.includes("retirado automáticamente"))).toBe(true)
  })

  it("retira un `reprogrammed` activo: la evidencia cayó en la celda de origen", async () => {
    const { result, reloaded, changeLog } = await accreditOver("reprogrammed", 2026)
    expect(result.accredited).toHaveLength(1)
    expect(reloaded.status).toBe("withdrawn")
    expect(reloaded.withdrawReason).toMatch(/acreditación por integración desde capacitacion/)
    expect(changeLog.some((entry) => entry.note?.includes("retirado automáticamente"))).toBe(true)
  })

  it("nunca falla por el desvío: la acreditación se completa y la ejecución queda registrada", async () => {
    const { result } = await accreditOver("not_applicable", 2027)
    expect(result.accredited).toHaveLength(1)
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(1)
    expect(executions[0]!.origin).toBe("integration")
  })
})

describe("recordPdtpDeviation: validaciones de entrada (continuación)", () => {
  it("falla cerrado fuera del alcance de faena del usuario", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { activity } = await createActiveProgramWithScheduledCell(2067, { month: 1, week: 1, plannedQuantity: 2 })

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2067, month: 1, week: 1,
      kind: "not_applicable", reason: "Un usuario fuera del alcance intenta declarar esto.",
    }, "user-1", ["ws-2"])).rejects.toThrow(/sin acceso/)
  })

  it("rechaza retirar un desvío con un motivo demasiado corto (schema, no validación a mano)", async () => {
    const { recordPdtpDeviation, withdrawPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { activity } = await createActiveProgramWithScheduledCell(2069, { month: 1, week: 1, plannedQuantity: 2 })
    const deviation = await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2069, month: 1, week: 1,
      kind: "not_applicable", reason: "Desvío que luego se intentará retirar sin motivo.",
    }, "user-1", "all")

    await expect(withdrawPdtpDeviation({ deviationId: deviation.id, reason: "corto" }, "user-1", "all"))
      .rejects.toThrow(/al menos 10 caracteres/)
    await expect(withdrawPdtpDeviation({ deviationId: "", reason: "Motivo suficientemente largo para pasar." }, "user-1", "all"))
      .rejects.toThrow(/Desvío requerido/)
  })

  it("rechaza declarar desvíos sobre una actividad excluida en esa faena", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { excludeActivityForWorksite } = await import("@/lib/services/pdtp/worksites")
    const { program, activity } = await createActiveProgramWithScheduledCell(2068, { month: 1, week: 1, plannedQuantity: 2 })
    // La exclusión sólo se puede declarar con el programa editable (draft);
    // se declara antes de activar y luego se activa el programa.
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" }).where(eq(schema.pdtpPrograms.id, program.id))
    await excludeActivityForWorksite(activity.id, "ws-1", "La actividad no corresponde a esta faena.", "user-1")
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: 2068, month: 1, week: 1,
      kind: "not_applicable", reason: "La actividad ya está excluida en esta faena.",
    }, "user-1", "all")).rejects.toThrow(/excluida/)
  })
})
