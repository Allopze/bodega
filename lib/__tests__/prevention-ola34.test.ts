import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with the app DB shape in tests.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

function assertPresent<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value == null) throw new Error(message)
}

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  const tables = [
    schema.protocolApplications, schema.minsalProtocols,
    schema.committeeAgreements, schema.committeeMeetings, schema.committeeMembers, schema.committees,
    schema.documentSignatures, schema.documentDeliveries, schema.legalDocumentVersions, schema.legalDocuments,
    schema.contractorDocuments, schema.contractorWorkers, schema.contractors,
    schema.equipmentInspections, schema.emergencyEquipment, schema.emergencyTeams,
    schema.emergencyDrills, schema.emergencyPlans,
    schema.incidentDisseminations, schema.incidentCorrectiveFollowups,
    schema.incidentInvestigations, schema.incidentStatements, schema.incidentNotifications,
    schema.healthRestrictions, schema.healthAptitudes, schema.healthExams,
    schema.kpiSnapshots, schema.laborHours,
  ]
  for (const t of tables) {
    try { await inMemoryDb.delete(t) } catch { /* ok */ }
  }
  await inMemoryDb.delete(schema.preventionIncidentActions)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.users).values({
    id: "user-2",
    name: "Trabajador",
    email: "worker@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-1",
    firstName: "Juan",
    lastName: "Perez",
    rut: "11111111-1",
    worksiteId: "ws-1",
  })
})

/* ── Health tests ─────────────────────────────────────────────────────── */
describe("prevention health service", () => {
  it("seeds MINSAL protocols and reads them back", async () => {
    const { seedMinsalProtocols, listMinsalProtocols } = await import("@/lib/services/prevention-health")
    await seedMinsalProtocols()
    const protocols = await listMinsalProtocols()
    expect(protocols).toHaveLength(7)
    expect(protocols.map((p) => p.code).sort()).toEqual([
      "estres_termico", "hiperbaria", "prexor", "psicosocial", "silice", "tmert", "uv",
    ])
  })

  it("registers health exam, aptitude and restriction", async () => {
    const { registerHealthExam, getWorkerHealthExams, setHealthAptitude, getActiveAptitude, addHealthRestriction, isRestricted } = await import("@/lib/services/prevention-health")

    await registerHealthExam({
      workerId: "worker-1",
      type: "periodico",
      performedAt: "2026-03-15",
      result: "apto_con_restricciones",
    }, ["ws-1"])

    const exams = await getWorkerHealthExams("worker-1", ["ws-1"])
    expect(exams).toHaveLength(1)
    expect(exams[0]!.result).toBe("apto_con_restricciones")

    await setHealthAptitude({
      workerId: "worker-1",
      position: "Operador",
      aptitude: "apto",
      restrictions: {},
    }, ["ws-1"])

    const apt = await getActiveAptitude("worker-1", "Operador", ["ws-1"])
    expect(apt).not.toBeNull()
    expect(apt!.aptitude).toBe("apto")

    await addHealthRestriction({
      workerId: "worker-1",
      kind: "altura",
      description: "No puede trabajar en altura mayor a 1.8m",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
    }, ["ws-1"])

    const restrictions = await isRestricted("worker-1", ["ws-1"])
    expect(restrictions).toHaveLength(1)
  })

  it("describeActiveRestrictions surfaces a warning only when a restriction is active (P3.22)", async () => {
    const { addHealthRestriction, describeActiveRestrictions } = await import("@/lib/services/prevention-health")

    expect(await describeActiveRestrictions("worker-1", ["ws-1"])).toBeNull()

    await addHealthRestriction({
      workerId: "worker-1",
      kind: "no_altura",
      description: "No puede trabajar en altura",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
    }, ["ws-1"])

    const warning = await describeActiveRestrictions("worker-1", ["ws-1"], "2026-06-01")
    expect(warning).toMatch(/restricción médica activa/i)
    expect(warning).toMatch(/no_altura/)
  })

  it("denies reading or writing health data for a worker outside worksite scope", async () => {
    const { registerHealthExam, getWorkerHealthExams, isRestricted } = await import("@/lib/services/prevention-health")

    await expect(registerHealthExam({
      workerId: "worker-1",
      type: "periodico",
      performedAt: "2026-03-15",
      result: "apto",
    }, ["ws-2"])).rejects.toThrow(/sin acceso/i)

    await expect(getWorkerHealthExams("worker-1", ["ws-2"])).rejects.toThrow(/sin acceso/i)
    await expect(isRestricted("worker-1", ["ws-2"])).rejects.toThrow(/sin acceso/i)
  })
})

/* ── Emergency tests ──────────────────────────────────────────────────── */
describe("prevention emergency service", () => {
  it("creates emergency plan, schedules and executes drill", async () => {
    const { createEmergencyPlan, getActiveEmergencyPlan, scheduleDrill, recordDrillExecution, listDrills } = await import("@/lib/services/prevention-emergency")

    await createEmergencyPlan({
      worksiteId: "ws-1",
      threats: { incendio: "alto", sismo: "medio" },
      roles: { lider: "user-1" },
      routes: { principal: "salida norte" },
    }, "user-1", ["ws-1"])

    const plan = await getActiveEmergencyPlan("ws-1", ["ws-1"])
    expect(plan).not.toBeNull()
    assertPresent(plan, "expected active emergency plan")

    const drill = await scheduleDrill({
      planId: plan.id,
      type: "incendio",
      scheduledAt: "2026-06-15T10:00:00.000Z",
    }, ["ws-1"])
    assertPresent(drill, "expected scheduled drill")

    const executed = await recordDrillExecution(drill.id, {
      attendees: 25,
      findings: { tiempo_evacuacion: "2min 15s" },
      effectiveness: "eficaz",
    }, ["ws-1"])
    assertPresent(executed, "expected executed drill")

    expect(executed.attendees).toBe(25)
    expect(executed.effectiveness).toBe("eficaz")

    const drills = await listDrills(["ws-1"])
    expect(drills).toHaveLength(1)
  })
})

/* ── Legal docs tests ─────────────────────────────────────────────────── */
describe("prevention legal docs service", () => {
  it("creates document, version, delivery and signature", async () => {
    const { createLegalDocument, addDocumentVersion, deliverDocument, acknowledgeDelivery, listLegalDocuments } = await import("@/lib/services/prevention-legal-docs")

    const doc = await createLegalDocument({
      type: "rio_hs",
      code: "RIOHS-2026",
      title: "Reglamento Interno de Orden, Higiene y Seguridad",
    })
    assertPresent(doc, "expected legal document")

    const version = await addDocumentVersion({
      documentId: doc.id,
      effectiveFrom: "2026-01-01",
      changelog: "Versión inicial 2026",
    }, "user-1")
    assertPresent(version, "expected document version")

    const delivery = await deliverDocument({
      versionId: version.id,
      workerId: "worker-1",
      method: "digital",
    })
    assertPresent(delivery, "expected document delivery")

    const sig = await acknowledgeDelivery(delivery.id, "user-2", "firma-digital-hash")
    expect(sig).toBeDefined()
    expect(sig!.signature).toBe("firma-digital-hash")

    const docs = await listLegalDocuments()
    expect(docs).toHaveLength(1)
  })
})

/* ── Committees tests ─────────────────────────────────────────────────── */
describe("prevention committees service", () => {
  it("creates committee, adds member, schedules meeting and agreements", async () => {
    const { createCommittee, addCommitteeMember, scheduleMeeting, recordMeetingAttendance, addAgreement, listCommittees } = await import("@/lib/services/prevention-committees")

    const comm = await createCommittee({ worksiteId: "ws-1", type: "cphs" }, ["ws-1"])
    assertPresent(comm, "expected committee")

    await addCommitteeMember({
      committeeId: comm.id,
      userId: "user-1",
      role: "presidente",
      startDate: "2026-01-01",
    })

    const meeting = await scheduleMeeting({
      committeeId: comm.id,
      scheduledAt: "2026-06-15T10:00:00.000Z",
      agenda: "Revisión mensual de indicadores",
      attendeeIds: ["user-1", "user-2"],
    })
    assertPresent(meeting, "expected committee meeting")

    await recordMeetingAttendance(meeting.id, ["user-1", "user-2"])

    await addAgreement({
      meetingId: meeting.id,
      description: "Realizar inspección de extintores",
      responsibleId: "user-1",
      dueDate: "2026-06-30",
    })

    const list = await listCommittees(["ws-1"])
    expect(list).toHaveLength(1)
    expect(list[0]!.type).toBe("cphs")
  })
})
