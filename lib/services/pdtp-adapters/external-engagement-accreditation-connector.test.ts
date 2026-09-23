/**
 * lib/services/pdtp-adapters/external-engagement-accreditation-connector.test.ts
 *
 * Task 12 (M2.5): cerrar una coordinación del art. 20 con la empresa mandante
 * ya no se declara aparte en Constancias — el propio cierre de la interacción
 * en "Visitas y coordinación" acredita la N°20, y sólo esa combinación exacta
 * de `kind`/`counterpartyType` lo hace.
 *
 * Ejercita `closeExternalEngagement` de punta a punta (no sólo el conector
 * aislado): es la única forma de probar que la costura real —el llamado desde
 * `prevention-external-engagements.ts`— quedó cableada.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"
import { PDTP_2026_CATALOG_ACTIVITIES } from "@/lib/services/pdtp-adapters/catalog-activities-2026"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { createExternalEngagement, closeExternalEngagement } = await import("@/lib/services/prevention-external-engagements")
const { listPdtpConstanciaActivities } = await import("@/lib/services/pdtp/constancias")

const PROGRAM_YEAR = chileDateParts().year
const USER_ID = "user-engagement-pdtp-1"
const WS_ID = "ws-engagement-pdtp-1"
const PROGRAM_ID = "pdtp-engagement-v1"
const CATALOG_ENTRY = PDTP_2026_CATALOG_ACTIVITIES.find((activity) => activity.legacyNumber === 20)!
const ACT_ID = `${PROGRAM_ID}-a-020`
const OCCURRED_ON = `${PROGRAM_YEAR}-03-05`

const access = { userId: USER_ID, scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:engagement:manage", "prevention:engagement:view"] }

async function seedProgram() {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} coordinación`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}

/** N°20, ya reclasificada a `enganche` (Task 12) — el estado que este test protege. */
async function seedActivity() {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpCatalogActivities).values({
    id: CATALOG_ENTRY.id, code: CATALOG_ENTRY.code, status: "active", currentRevision: 1,
    createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
  await inMemoryDb.insert(schema.pdtpCatalogActivityRevisions).values({
    id: `${CATALOG_ENTRY.id}-r1`, catalogActivityId: CATALOG_ENTRY.id, revision: 1,
    title: CATALOG_ENTRY.title, description: CATALOG_ENTRY.description, executionGuidance: CATALOG_ENTRY.executionGuidance,
    createdAt: now,
  }).onConflictDoNothing()
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID, programId: PROGRAM_ID, n: 20,
    catalogActivityId: CATALOG_ENTRY.id, catalogRevision: 1,
    activity: CATALOG_ENTRY.title, program: CATALOG_ENTRY.executionGuidance,
    responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "enganche", evidenceRequirement: "Acta o correo de la reunión con la empresa mandante.",
    sourceSheetRow: 20, createdAt: now, updatedAt: now,
  })
}

async function linkEvidenceDocument(engagementId: string) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.sstDocumentCategories).values({
    slug: "coordinacion-test", name: "Coordinación (test)", sortOrder: 0, isActive: true,
    createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
  await inMemoryDb.insert(schema.sstDocuments).values({
    id: "doc-engagement-1", categorySlug: "coordinacion-test", title: "Acta reunión con el mandante",
    worksiteId: WS_ID, status: "vigente", uploadedBy: USER_ID,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.sstDocumentVersions).values({
    id: "docv-engagement-1", documentId: "doc-engagement-1", version: 1, status: "vigente",
    fileName: "acta.pdf", storageName: "acta.pdf", filePath: "storage/sst-documents/coordinacion-test/acta.pdf",
    mimeType: "application/pdf", fileSize: 100, checksum: "abc123", uploadedBy: USER_ID,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.update(schema.sstDocuments).set({ currentVersionId: "docv-engagement-1" }).where(eq(schema.sstDocuments.id, "doc-engagement-1"))
  await inMemoryDb.insert(schema.sstDocumentLinks).values({
    id: "link-engagement-1", documentId: "doc-engagement-1", entityType: "external_engagement",
    entityId: engagementId, createdByUserId: USER_ID, createdAt: now,
  })
}

/** Coordinación del art. 20 con el mandante: la única combinación que acredita la N°20. */
async function createCoordinationWithMandante() {
  return createExternalEngagement({
    worksiteId: WS_ID,
    kind: "coordinacion",
    direction: "received",
    counterpartyType: "mandante",
    counterpartyName: "Empresa Mandante SpA",
    occurredOn: OCCURRED_ON,
    subject: "Coordinación de actividades preventivas DS 44 art. 20",
    infoTypes: ["riesgos"],
  }, access)
}

async function close(engagementId: string, expectedVersion: number) {
  return closeExternalEngagement({
    engagementId, expectedVersion, outcome: "Reunión realizada; se acordó el programa de trabajo conjunto.",
  }, access)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpFulfillmentEventTargets)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.sstDocumentLinks)
  await inMemoryDb.delete(schema.sstDocumentVersions)
  await inMemoryDb.delete(schema.sstDocuments)
  await inMemoryDb.delete(schema.sstDocumentCategories)
  await inMemoryDb.delete(schema.preventionExternalEngagements)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  // `pdtp_catalog_activity_revisions` es inmutable (trigger
  // `prevent_pdtp_catalog_revision_mutation`): no se borra entre tests, se
  // reinserta con `onConflictDoNothing` en `seedActivity` — el id de catálogo
  // de la N°20 es estable entre corridas.
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: USER_ID, name: "Prevencionista", email: "prev-engagement@example.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Coordinación", code: "FCO", isActive: true })
  await seedProgram()
  await seedActivity()
})

describe("closeExternalEngagement → acredita la N°20 (Task 12)", () => {
  it("coordinación con el mandante, sin documento vinculado: acredita 'submitted' con un rótulo descriptivo como evidencia declarada", async () => {
    const created = await createCoordinationWithMandante()
    await close(created.id, created.version)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({
      worksiteId: WS_ID,
      status: "submitted",
      origin: "integration",
      sourceType: "engagement",
      sourceId: `coordinacion-mandante:${created.id}`,
    })
    // Sin documento vinculado ni officialReference (no es obligatorio en una
    // coordinación): cae al rótulo descriptivo, nunca a un evidenceRef vacío.
    expect(executions[0]?.evidenceText).toContain(created.id)
    expect(executions[0]?.evidenceUrl).toBeNull()
  })

  it("coordinación con el mandante, con acta vinculada en sst_document_links: acredita 'approved' con la ruta de storage como evidencia real", async () => {
    const created = await createCoordinationWithMandante()
    await linkEvidenceDocument(created.id)
    await close(created.id, created.version)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({
      status: "approved",
      approvedByUserId: USER_ID,
      evidenceUrl: "storage/sst-documents/coordinacion-test/acta.pdf",
      evidenceText: null,
    })
  })

  it.each([
    { label: "fiscalización de la Dirección del Trabajo", kind: "fiscalizacion" as const, counterpartyType: "direccion_trabajo" as const, officialReference: "ORD-2026-001", infoTypes: undefined },
    { label: "coordinación con un contratista (no es el mandante)", kind: "coordinacion" as const, counterpartyType: "contratista" as const, officialReference: undefined, infoTypes: ["riesgos"] as const },
    { label: "visita del organismo administrador", kind: "organismo_administrador" as const, counterpartyType: "organismo_administrador" as const, officialReference: "ACHS-2026-77", infoTypes: undefined },
  ])("cerrar una interacción de otra combinación ($label) no acredita nada", async ({ kind, counterpartyType, officialReference, infoTypes }) => {
    const created = await createExternalEngagement({
      worksiteId: WS_ID, kind, direction: "received", counterpartyType,
      counterpartyName: "Contraparte de prueba", occurredOn: OCCURRED_ON,
      subject: "Interacción que no debe acreditar la N°20",
      officialReference, infoTypes,
    }, access)
    await close(created.id, created.version)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(0)
  })
})

describe("N°20 tras la reclasificación a 'enganche' (Task 12)", () => {
  it("ya no aparece en listPdtpConstanciaActivities", async () => {
    // La actividad ya se sembró como `mechanism: 'enganche'` en `seedActivity`
    // (el estado post-cambio de esta tarea): si `listPdtpConstanciaActivities`
    // siguiera trayéndola, el doble registro que Task 12 retira reaparecería.
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `${ACT_ID}-s-${PROGRAM_YEAR}-03-1`, activityId: ACT_ID, year: PROGRAM_YEAR, month: 3, week: 1,
      plannedQuantity: 1, sourceColumn: "manual",
    })
    const view = await listPdtpConstanciaActivities([WS_ID])
    expect(view?.debts.filter((debt) => debt.n === 20)).toHaveLength(0)
  })
})
