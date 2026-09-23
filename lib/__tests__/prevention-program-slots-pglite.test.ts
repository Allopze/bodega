/**
 * lib/__tests__/prevention-program-slots-pglite.test.ts
 *
 * Las casillas del programa nacen con la faena.
 *
 * Lo que se protege no es que las tablas existan: es que activar una faena
 * deje las 428 filas —390 casillas de capacitación (102: 52 de Task 5 + 42 de
 * la Task 8, que cerró la brecha de instrumento de las N°16, 37, 51, 57, 59 y
 * 60, + 8 de la Task 13, CAM-07/N°88; más 288 de la Task 16, CAP-21/N°53 y
 * las 5 réplicas de N°38, 6 ítems × 48 celdas), 2 de simulacro, 4 de CGRD, 23
 * de alcotest, los 8 protocolos MINSAL sin pronunciar y la evaluación
 * cuantitativa anual de higiene (N°45)— y que reejecutar no cree ninguna más
 * ni pise el estado de las existentes.
 *
 * El modo de falla que esto vigila es el que motivó el agregador: alguien
 * agrega un cuarto punto de alta de faena, pre-genera sólo capacitación, y la
 * faena queda sin casillas de simulacro ni de CGRD — invisible hasta que llega
 * una fiscalización y nadie puede mostrar qué se esperaba que ocurriera.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
/**
 * Task 3 — M0.2: sólo se sustituye `onEmergencyDrillCompleted`, para poder
 * inspeccionar el `plannedPeriod` que `completeEmergencyDrill` arma a partir
 * de la casilla, sin depender de un programa PDTP activo ni de en qué mes
 * real caiga la corrida (`executedAt` está acotado a "no futuro", así que no
 * se puede fijar un mes calendario arbitrario para la ejecución sin repetir
 * el problema de EMERGENCIAS-06 en `prevention-emergency-postgres.test.ts`).
 * Ningún test existente de este archivo cablea `pdtpActivityNumbers` en su
 * plan, así que el conector real nunca se invocaba antes de este mock.
 */
vi.mock("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors")>()),
  onEmergencyDrillCompleted: vi.fn(async () => {}),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const WORKSITE_ID = "slots-worksite"
const USER_ID = "slots-user"
const WORKER_ID = "slots-worker"
const APPROVER_ID = "slots-approver"

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionHygieneMeasurementSlots)
  await inMemoryDb.delete(schema.preventionProtocolApplicabilities)
  await inMemoryDb.delete(schema.preventionAlcotestSlotEvidence)
  await inMemoryDb.delete(schema.preventionAlcotestSlots)
  await inMemoryDb.delete(schema.preventionGrdMeetingSlots)
  await inMemoryDb.delete(schema.preventionEmergencyDrillSlots)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.preventionEmergencyDrillEvidence)
  await inMemoryDb.delete(schema.preventionEmergencyDrills)
  await inMemoryDb.delete(schema.preventionEmergencyRoles)
  await inMemoryDb.delete(schema.preventionEmergencyScenarios)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: USER_ID, name: "Prevencionista", email: "slots@example.test", hashedPassword: "x" },
    // Quien redacta el plan no lo aprueba: `approveEmergencyPlan` lo rechaza.
    { id: APPROVER_ID, name: "Jefatura", email: "slots-approver@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID, name: "Faena Casillas", code: "SLOTS", isActive: true,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_ID, firstName: "Ana", lastName: "Pérez", position: "Operadora",
    worksiteId: WORKSITE_ID, isActive: true,
  })
})

describe("pre-generación de las casillas del programa", () => {
  it("una faena activa recibe las 428 filas, y reejecutar no crea ninguna más", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")

    const first = await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    expect(first).toEqual({ training: 390, drills: 2, grdMeetings: 4, alcotest: 23, protocols: 8, hygieneMeasurements: 1 })

    const second = await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    expect(second).toEqual({ training: 0, drills: 0, grdMeetings: 0, alcotest: 0, protocols: 0, hygieneMeasurements: 0 })
  })

  it("las casillas nacen pendientes y en los meses que el programa declara", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)

    const drills = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    expect(drills.map((row) => row.slotKey).sort()).toEqual(["m03-w3", "m09-w3"])
    expect(drills.every((row) => row.status === "pending")).toBe(true)
    expect(drills.every((row) => row.drillId === null)).toBe(true)

    const alcotest = await inMemoryDb.select().from(schema.preventionAlcotestSlots)
    expect(alcotest.filter((row) => row.kind === "control")).toHaveLength(12)
    expect(alcotest.filter((row) => row.kind === "envio")).toHaveLength(11)
    expect(alcotest.every((row) => row.status === "pending")).toBe(true)

    /* Los ocho protocolos existen EN LA BASE, no rellenados en memoria por la
     * pantalla: es la diferencia entre "nadie se pronunció" y "no hay nada que
     * mirar", y es lo único que hace que un export los vea. */
    const protocolos = await inMemoryDb.select().from(schema.preventionProtocolApplicabilities)
    expect(protocolos).toHaveLength(8)
    expect(protocolos.every((row) => row.status === "pending_assessment")).toBe(true)
    expect(protocolos.every((row) => row.justification === null)).toBe(true)

    const meetings = await inMemoryDb.select().from(schema.preventionGrdMeetingSlots)
    expect(meetings.map((row) => row.slotKey).sort()).toEqual(["m02-w1", "m03-w1", "m04-w1", "m05-w1"])
    expect(meetings.every((row) => row.status === "pending")).toBe(true)

    /* N°45: una sola celda al año, febrero semana 2, sin medición detrás. */
    const hygiene = await inMemoryDb.select().from(schema.preventionHygieneMeasurementSlots)
    expect(hygiene).toHaveLength(1)
    expect(hygiene[0]).toMatchObject({
      worksiteId: WORKSITE_ID, year: 2026, slotKey: "m02-w2",
      scheduledMonth: 2, scheduledWeek: 2, status: "pending", measurementId: null,
    })
  })

  it("reejecutar no pisa el estado de una casilla ya resuelta", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)

    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    await inMemoryDb.update(schema.preventionEmergencyDrillSlots).set({
      status: "not_applicable",
      notApplicableAt: new Date().toISOString(),
      notApplicableByUserId: USER_ID,
      notApplicableReason: "La faena no tiene instalaciones que evacuar.",
      version: 2,
    }).where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))

    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)

    const [after] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))
    expect(after).toMatchObject({ status: "not_applicable", version: 2 })
  })

  /* El CHECK de la casilla, no el servicio: una marca de "hecha" sin el
   * registro que la cumple sería una casilla en verde sin hecho detrás. */
  it("la base rechaza una casilla hecha sin el simulacro que la cumple", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)

    await expect(inMemoryDb.update(schema.preventionEmergencyDrillSlots).set({
      status: "completed",
      completedAt: new Date().toISOString(),
      completedByUserId: USER_ID,
    }).where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))).rejects.toThrow()
  })

  it("la base rechaza una casilla de higiene hecha sin la medición que la cumple", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionHygieneMeasurementSlots)

    await expect(inMemoryDb.update(schema.preventionHygieneMeasurementSlots).set({
      status: "completed",
      completedAt: new Date().toISOString(),
      completedByUserId: USER_ID,
    }).where(eq(schema.preventionHygieneMeasurementSlots.id, slot!.id))).rejects.toThrow()
  })

  it("la base exige motivo de al menos diez caracteres para declarar no aplica", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionGrdMeetingSlots)

    await expect(inMemoryDb.update(schema.preventionGrdMeetingSlots).set({
      status: "not_applicable",
      notApplicableAt: new Date().toISOString(),
      notApplicableByUserId: USER_ID,
      notApplicableReason: "no va",
    }).where(eq(schema.preventionGrdMeetingSlots.id, slot!.id))).rejects.toThrow()
  })
})

/* El vínculo casilla↔hecho. `prevention-emergency-postgres.test.ts` cubre el
 * simulacro contra Postgres real y no corre en CI sin base, así que lo que se
 * protege acá es específicamente que la casilla siga al hecho: que se cumpla
 * con él, y que vuelva atrás cuando el hecho se deshace. */
describe("la casilla sigue al simulacro que la cumple", () => {
  const APPROVER = {
    userId: APPROVER_ID,
    scope: { mode: "all", ids: [] } as WorksiteScope,
    permissions: ["prevention:emergency:approve"],
  }
  const MANAGER = {
    userId: USER_ID,
    scope: { mode: "all", ids: [] } as WorksiteScope,
    permissions: ["prevention:emergency:manage", "prevention:emergency:approve", "prevention:emergency:drill_execute"],
  }

  async function planAprobadoConSimulacro() {
    const service = await import("@/lib/services/prevention-emergency")
    const plan = await service.createEmergencyPlan({ worksiteId: WORKSITE_ID, title: "Plan de casillas" }, MANAGER)
    await service.addEmergencyScenario({
      planId: plan.id, type: "incendio_estructural", title: "Incendio",
      responseProcedure: "Activar alarma y evacuar por la ruta señalizada del sector.",
    }, MANAGER)
    await service.addEmergencyRole({
      planId: plan.id, roleName: "Jefe de emergencia", assigneeWorkerId: WORKER_ID,
    }, MANAGER)
    const approved = await service.approveEmergencyPlan({ planId: plan.id, expectedVersion: plan.version }, APPROVER)
    const drill = await service.scheduleEmergencyDrill({
      planId: plan.id, scenarioType: "incendio_estructural",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    }, MANAGER)
    await inMemoryDb.insert(schema.preventionEmergencyDrillEvidence).values({
      id: `evidencia-${drill.id}`,
      drillId: drill.id,
      fileName: "acta.pdf",
      storagePath: `storage/prevention-drill-evidence/acta-${drill.id}.pdf`,
      mimeType: "application/pdf",
      fileSizeBytes: 256,
      sha256: "a".repeat(64),
      state: "active",
      uploadedByUserId: USER_ID,
    })
    return { service, drill, plan: approved }
  }

  it("completar un simulacro contra una casilla la deja cumplida y apuntando a él", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    const { service, drill } = await planAprobadoConSimulacro()

    await service.completeEmergencyDrill({
      drillId: drill.id, expectedVersion: drill.version,
      executedAt: new Date().toISOString(), outcome: "satisfactory",
      slotId: slot!.id,
    }, MANAGER)

    const [cumplida] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))
    expect(cumplida).toMatchObject({ status: "completed", drillId: drill.id, completedByUserId: USER_ID })
  })

  /*
   * Task 3 — M0.2: antes, `completeEmergencyDrill` acreditaba el PDTP con el
   * mes de `executedAt` (el cierre), no con la celda que la casilla ya tenía
   * planificada. Un simulacro registrado tarde pagaba entonces un mes que no
   * le correspondía y el mes realmente planificado seguía en cero.
   *
   * Se verifica el `plannedPeriod` que llega al conector (mockeado arriba del
   * archivo) en vez del `pdtpExecutions` real, porque `executedAt` está
   * acotado a "no futuro" contra el reloj real y no hay forma de fijar un mes
   * calendario arbitrario para el cierre sin repetir el problema que
   * EMERGENCIAS-06 ya documentó en `prevention-emergency-postgres.test.ts`.
   */
  it("completar un simulacro pasa el `plannedPeriod` de la casilla al conector PDTP, no el mes del cierre", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    const connectors = await import("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors")
    const accredit = vi.mocked(connectors.onEmergencyDrillCompleted)
    accredit.mockClear()

    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.slotKey, "m03-w3"))
    expect(slot).toMatchObject({ scheduledMonth: 3, scheduledWeek: 3 })

    const { service, drill, plan } = await planAprobadoConSimulacro()
    // Sin esto la acreditación es un no-op (ningún número cableado) y el
    // conector jamás se invoca — lo que ya cubren los otros tests de este
    // describe. Acá interesa justamente lo que se le pasa cuando sí acredita.
    await service.setEmergencyPlanPdtpActivities({
      planId: plan.id, expectedVersion: plan.version, pdtpActivityNumbers: [84],
    }, MANAGER)

    await service.completeEmergencyDrill({
      drillId: drill.id, expectedVersion: drill.version,
      executedAt: new Date().toISOString(), outcome: "satisfactory",
      slotId: slot!.id,
    }, MANAGER)

    expect(accredit).toHaveBeenCalledTimes(1)
    expect(accredit.mock.calls[0]![0]).toMatchObject({
      drillId: drill.id, worksiteId: WORKSITE_ID,
      plannedPeriod: { year: slot!.year, month: 3, week: 3 },
    })
  })

  it("cancelar el simulacro libera su casilla en vez de dejarla en verde", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    const { service, drill } = await planAprobadoConSimulacro()

    await service.completeEmergencyDrill({
      drillId: drill.id, expectedVersion: drill.version,
      executedAt: new Date().toISOString(), outcome: "satisfactory",
      slotId: slot!.id,
    }, MANAGER)

    // Cancelar exige estado "scheduled"; se fuerza por la misma razón que en
    // los tests de revocación: lo que se prueba es el cableado de la vuelta
    // atrás, no el guard que hoy la hace inalcanzable.
    await inMemoryDb.update(schema.preventionEmergencyDrills)
      .set({ status: "scheduled" })
      .where(eq(schema.preventionEmergencyDrills.id, drill.id))
    const [actual] = await inMemoryDb.select().from(schema.preventionEmergencyDrills)
      .where(eq(schema.preventionEmergencyDrills.id, drill.id))

    await service.cancelEmergencyDrill({
      drillId: drill.id, expectedVersion: actual!.version,
      reason: "El simulacro se registró por error en esta faena.",
    }, MANAGER)

    const [liberada] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))
    expect(liberada).toMatchObject({ status: "pending", drillId: null, completedAt: null })
  })

  it("una casilla cumplida no se desmarca por la vía de la casilla", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
    const { recordDrillSlotStatus } = await import("@/lib/services/prevention-emergency")
    await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    const { service, drill } = await planAprobadoConSimulacro()
    await service.completeEmergencyDrill({
      drillId: drill.id, expectedVersion: drill.version,
      executedAt: new Date().toISOString(), outcome: "satisfactory",
      slotId: slot!.id,
    }, MANAGER)

    const [cumplida] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.id, slot!.id))
    await expect(recordDrillSlotStatus({
      slotId: slot!.id, expectedVersion: cumplida!.version, status: "not_completed",
    }, MANAGER)).rejects.toThrow(/cancela el simulacro/i)
  })
})
