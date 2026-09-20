/**
 * lib/__tests__/prevention-program-slots-pglite.test.ts
 *
 * Las casillas del programa nacen con la faena.
 *
 * Lo que se protege no es que las tablas existan: es que activar una faena
 * deje las 53 casillas —24 de capacitación, 2 de simulacro, 4 de CGRD y 23 de
 * alcotest— y
 * que reejecutar no cree ninguna más ni pise el estado de las existentes.
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
  await inMemoryDb.delete(schema.preventionEmergencyHistory)
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
  it("una faena activa recibe las 53 casillas, y reejecutar no crea ninguna más", async () => {
    const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")

    const first = await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    expect(first).toEqual({ training: 24, drills: 2, grdMeetings: 4, alcotest: 23 })

    const second = await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WORKSITE_ID)
    expect(second).toEqual({ training: 0, drills: 0, grdMeetings: 0, alcotest: 0 })
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

    const meetings = await inMemoryDb.select().from(schema.preventionGrdMeetingSlots)
    expect(meetings.map((row) => row.slotKey).sort()).toEqual(["m02-w1", "m03-w1", "m04-w1", "m05-w1"])
    expect(meetings.every((row) => row.status === "pending")).toBe(true)
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
    await service.approveEmergencyPlan({ planId: plan.id, expectedVersion: plan.version }, APPROVER)
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
    return { service, drill }
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
