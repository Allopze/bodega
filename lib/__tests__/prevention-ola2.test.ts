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
// @ts-expect-error PGlite es compatible en runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.behavioralObservations)
  await inMemoryDb.delete(schema.inspectionItems)
  await inMemoryDb.delete(schema.inspectionRuns)
  await inMemoryDb.delete(schema.inspectionTemplates)
  await inMemoryDb.delete(schema.equipmentReportReviews)
  await inMemoryDb.delete(schema.equipmentDailyReports)
  await inMemoryDb.delete(schema.equipmentChecklists)
  await inMemoryDb.delete(schema.alcoholTests)
  await inMemoryDb.delete(schema.sanitizationControls)
  await inMemoryDb.delete(schema.eppPositionMatrix)
  await inMemoryDb.delete(schema.eppRecambioLog)
  await inMemoryDb.delete(schema.eppLifecyclePolicies)
  await inMemoryDb.delete(schema.eppStockThresholds)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-2",
    name: "Faena B",
    code: "FB",
    isActive: true,
  })
})

/* ── Inspection tests ─────────────────────────────────────────────────────── */
describe("prevention inspections service", () => {
  it("creates a template and starts an inspection run with items", async () => {
    const { createInspectionTemplate, createInspectionRun, getInspectionRun } = await import("@/lib/services/prevention-inspections")

    await createInspectionTemplate({
      code: "INS-DS594",
      title: "Inspección DS 594",
      scope: "Condiciones ambientales",
      items: [
        { key: "iluminacion", label: "Iluminación", expected: "Niveles adecuados según DS 594" },
        { key: "ventilacion", label: "Ventilación", expected: "Sistema funcionando" },
      ],
      frequency: "mensual",
      requiresPhoto: false,
    })

    const templates = await inMemoryDb.select().from(schema.inspectionTemplates)
    expect(templates).toHaveLength(1)

    const run = await createInspectionRun({ templateId: templates[0]!.id, worksiteId: "ws-1" }, "user-1", ["ws-1"])
    expect(run).toBeDefined()
    expect(run.status).toBe("open")

    const detail = await getInspectionRun(run.id, ["ws-1"])
    expect(detail).not.toBeNull()
    expect(detail!.items).toHaveLength(2)
  })

  it("rejects inspection run on out-of-scope worksite", async () => {
    const { createInspectionTemplate, createInspectionRun } = await import("@/lib/services/prevention-inspections")

    await createInspectionTemplate({
      code: "TMPL-01",
      title: "Test",
      scope: "Test",
      items: [{ key: "a", label: "A", expected: "A" }],
      frequency: "mensual",
      requiresPhoto: false,
    })
    const templates = await inMemoryDb.select().from(schema.inspectionTemplates)

    await expect(async () => {
      await createInspectionRun({ templateId: templates[0]!.id, worksiteId: "ws-2" }, "user-1", ["ws-1"])
    }).rejects.toThrow("Sin acceso")
  })

  it("closes a run where every item was legitimately evaluated as ok", async () => {
    const { createInspectionTemplate, createInspectionRun, updateInspectionItem, closeInspectionRun } = await import("@/lib/services/prevention-inspections")

    await createInspectionTemplate({
      code: "ALL-OK-01",
      title: "Todo conforme",
      scope: "Test",
      items: [
        { key: "item1", label: "Item 1", expected: "OK" },
        { key: "item2", label: "Item 2", expected: "OK" },
      ],
      frequency: "mensual",
      requiresPhoto: false,
    })
    const templates = await inMemoryDb.select().from(schema.inspectionTemplates)
      .where(eq(schema.inspectionTemplates.code, "ALL-OK-01"))
    const run = await createInspectionRun({ templateId: templates[0]!.id, worksiteId: "ws-1" }, "user-1", ["ws-1"])

    const items = await inMemoryDb.select().from(schema.inspectionItems).where(eq(schema.inspectionItems.runId, run.id))
    for (const item of items) {
      await updateInspectionItem({ itemId: item.id, status: "ok", observed: "Cumple" }, ["ws-1"])
    }

    const closed = await closeInspectionRun({ runId: run.id }, "user-1", ["ws-1"])
    expect(closed!.status).toBe("closed")
  })

  it("blocks closing a run with unevaluated items", async () => {
    const { createInspectionTemplate, createInspectionRun, closeInspectionRun } = await import("@/lib/services/prevention-inspections")

    await createInspectionTemplate({
      code: "PENDING-01",
      title: "Pendiente",
      scope: "Test",
      items: [{ key: "item1", label: "Item 1", expected: "OK" }],
      frequency: "mensual",
      requiresPhoto: false,
    })
    const templates = await inMemoryDb.select().from(schema.inspectionTemplates)
      .where(eq(schema.inspectionTemplates.code, "PENDING-01"))
    const run = await createInspectionRun({ templateId: templates[0]!.id, worksiteId: "ws-1" }, "user-1", ["ws-1"])

    await expect(closeInspectionRun({ runId: run.id }, "user-1", ["ws-1"]))
      .rejects.toThrow(/sin evaluar/i)
  })

  it("updates inspection items and closes run", async () => {
    const { createInspectionTemplate, createInspectionRun, updateInspectionItem, closeInspectionRun } = await import("@/lib/services/prevention-inspections")

    await createInspectionTemplate({
      code: "CLOSE-01",
      title: "Close test",
      scope: "Test",
      items: [{ key: "item1", label: "Item 1", expected: "OK" }],
      frequency: "mensual",
      requiresPhoto: false,
    })
    const templates = await inMemoryDb.select().from(schema.inspectionTemplates)
    const run = await createInspectionRun({ templateId: templates[0]!.id, worksiteId: "ws-1" }, "user-1", ["ws-1"])

    const items = await inMemoryDb.select().from(schema.inspectionItems).where(eq(schema.inspectionItems.runId, run.id))
    expect(items).toHaveLength(1)

    await updateInspectionItem({ itemId: items[0]!.id, status: "no_conforme", observed: "No cumple", note: "Requiere acción" }, ["ws-1"])

    const closed = await closeInspectionRun({ runId: run.id, signature: "firma123" }, "user-1", ["ws-1"])
    expect(closed).toBeDefined()
    expect(closed!.status).toBe("closed")
    expect(closed!.signature).toBe("firma123")
  })

  it("adds behavioral observations", async () => {
    const { addBehavioralObservation, listBehavioralObservations } = await import("@/lib/services/prevention-inspections")

    await addBehavioralObservation({
      worksiteId: "ws-1",
      antecedent: "Trabajador sin casco",
      behavior: "Caminando bajo carga suspendida",
      consequence: "Riesgo de golpe en la cabeza",
      severity: "critico",
    }, "user-1", ["ws-1"])

    const obs = await listBehavioralObservations(["ws-1"])
    expect(obs).toHaveLength(1)
    expect(obs[0]!.severity).toBe("critico")
  })
})

/* ── Equipment reports tests ──────────────────────────────────────────────── */
describe("prevention equipment service", () => {
  beforeEach(async () => {
    await inMemoryDb.insert(schema.workers).values({
      id: "worker-1",
      firstName: "Juan",
      lastName: "Perez",
      rut: "11111111-1",
      worksiteId: "ws-1",
    })
  })

  it("creates equipment daily report and reviews it", async () => {
    const { createEquipmentReport, listEquipmentReports, reviewEquipmentReport } = await import("@/lib/services/prevention-equipment")

    const report = await createEquipmentReport({
      worksiteId: "ws-1",
      equipmentId: "eqp-camion-01",
      operatorWorkerId: "worker-1",
      shift: "diurno",
      status: "ok",
      odometer: 15000,
      checklist: { luces: true, frenos: true, neumaticos: true },
    }, "user-1", ["ws-1"])
    expect(report).toBeDefined()
    expect(report!.status).toBe("ok")

    const list = await listEquipmentReports(["ws-1"])
    expect(list).toHaveLength(1)

    const review = await reviewEquipmentReport({
      reportId: report!.id,
      status: "aprobado",
      findings: {},
    }, "user-1", ["ws-1"])
    expect(review).toBeDefined()
    expect(review!.status).toBe("aprobado")
  })

  it("creates equipment checklist and closes it", async () => {
    const { createEquipmentChecklist, listEquipmentChecklists, closeEquipmentChecklist } = await import("@/lib/services/prevention-equipment")

    const chk = await createEquipmentChecklist({
      worksiteId: "ws-1",
      kind: "contenedor",
      assetCode: "CONT-001",
      items: { estructura: "ok", puertas: "ok" },
      status: "ok",
      closeRequired: true,
    }, "user-1", ["ws-1"])
    expect(chk).toBeDefined()
    expect(chk!.kind).toBe("contenedor")

    const list = await listEquipmentChecklists(["ws-1"])
    expect(list).toHaveLength(1)

    const closed = await closeEquipmentChecklist(chk!.id, ["ws-1"])
    expect(closed).toBeDefined()
    expect(closed!.closedAt).not.toBeNull()
  })
})

/* ── Alcohol tests ─────────────────────────────────────────────────────────── */
describe("prevention alcohol tests service", () => {
  it("registers and lists alcohol tests", async () => {
    const { registerAlcoholTest, listAlcoholTests, markAlcoholTestSent } = await import("@/lib/services/prevention-alcohol-tests")

    const test = await registerAlcoholTest({
      worksiteId: "ws-1",
      shift: "diurno",
      result: "negativo",
    }, "user-1", ["ws-1"])
    expect(test).toBeDefined()
    expect(test!.result).toBe("negativo")
    expect(test!.procedureCode).toBe("DO-48")

    const list = await listAlcoholTests(["ws-1"])
    expect(list).toHaveLength(1)

    const sent = await markAlcoholTestSent(test!.id, ["ws-1"])
    expect(sent).toBeDefined()
    expect(sent!.sentAt).not.toBeNull()
  })
})

/* ── EPP matrix tests ──────────────────────────────────────────────────────── */
describe("prevention EPP matrix service", () => {
  it("sets EPP position entry, lifecycle policy and stock thresholds", async () => {
    const { setEppPositionEntry, setEppLifecyclePolicy, getEppMatrix, getEppLifecyclePolicy, setEppStockThreshold, getStockThresholds } = await import("@/lib/services/prevention-epp-matrix")

    await setEppLifecyclePolicy({
      eppProductId: "epp-casco",
      lifespanDays: 180,
      maxReuses: 1,
      inspectionChecklist: {},
    })

    const policy = await getEppLifecyclePolicy("epp-casco")
    expect(policy).not.toBeNull()
    expect(policy!.lifespanDays).toBe(180)

    await setEppPositionEntry({
      worksiteId: "ws-1",
      position: "Operador",
      eppProductId: "epp-casco",
      requiredSince: "2026-01-01",
    }, "user-1", ["ws-1"])

    const matrix = await getEppMatrix("ws-1", ["ws-1"])
    expect(matrix).toHaveLength(1)
    expect(matrix[0]!.position).toBe("Operador")

    await setEppStockThreshold({
      worksiteId: "ws-1",
      eppProductId: "epp-guantes",
      minStock: 50,
      criticalStock: 10,
    }, ["ws-1"])

    const thresholds = await getStockThresholds("ws-1", ["ws-1"])
    expect(thresholds).toHaveLength(1)
    expect(thresholds[0]!.minStock).toBe(50)
  })

  it("filters expired EPP deliveries by worksite via the worker's faena", async () => {
    const { setEppLifecyclePolicy, logEppDelivery, getExpiredEpp } = await import("@/lib/services/prevention-epp-matrix")

    await inMemoryDb.insert(schema.workers).values([
      { id: "worker-ws1", firstName: "A", lastName: "B", rut: "1-9", worksiteId: "ws-1" },
      { id: "worker-ws2", firstName: "C", lastName: "D", rut: "2-7", worksiteId: "ws-2" },
    ])

    await setEppLifecyclePolicy({ eppProductId: "epp-guantes", lifespanDays: 1, maxReuses: 1, inspectionChecklist: {} })

    await logEppDelivery({ workerId: "worker-ws1", eppProductId: "epp-guantes", deliveredAt: "2020-01-01T00:00:00.000Z", evidenceUrl: "/actas/acta-1.pdf" })
    await logEppDelivery({ workerId: "worker-ws2", eppProductId: "epp-guantes", deliveredAt: "2020-01-01T00:00:00.000Z", evidenceUrl: "/actas/acta-2.pdf" })

    const expiredWs1 = await getExpiredEpp("ws-1", ["ws-1"])
    expect(expiredWs1).toHaveLength(1)
    expect(expiredWs1[0]!.workerId).toBe("worker-ws1")

    const expiredWs2 = await getExpiredEpp("ws-2", ["ws-2"])
    expect(expiredWs2).toHaveLength(1)
    expect(expiredWs2[0]!.workerId).toBe("worker-ws2")
  })

  it("requires a signed acta (evidenceUrl) to log an EPP delivery and supports worker acknowledgement (P3.17)", async () => {
    const { setEppLifecyclePolicy, logEppDelivery, acknowledgeEppDelivery, getWorkerActiveEpp } = await import("@/lib/services/prevention-epp-matrix")

    await setEppLifecyclePolicy({ eppProductId: "epp-guantes", lifespanDays: 90, maxReuses: 1, inspectionChecklist: {} })
    await inMemoryDb.insert(schema.workers).values({ id: "worker-acta", firstName: "E", lastName: "F", rut: "3-5", worksiteId: "ws-1" })

    await expect(logEppDelivery({ workerId: "worker-acta", eppProductId: "epp-guantes" })).rejects.toThrow()

    const delivery = await logEppDelivery({ workerId: "worker-acta", eppProductId: "epp-guantes", evidenceUrl: "/actas/acta-3.pdf" })
    expect(delivery!.evidenceUrl).toBe("/actas/acta-3.pdf")
    expect(delivery!.acknowledgedAt).toBeNull()

    const acknowledged = await acknowledgeEppDelivery(delivery!.id)
    expect(acknowledged.acknowledgedAt).not.toBeNull()

    const active = await getWorkerActiveEpp("worker-acta")
    expect(active[0]!.acknowledgedAt).not.toBeNull()
  })
})
