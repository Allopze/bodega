/**
 * lib/__tests__/pdtp-evidence-link-ownership.test.ts
 *
 * Revisión final 2026-09-27 (qa/reports/2026-09-27-prevencion-revision-final.md):
 *
 * - Hallazgo 1, toma de evidencia entre faenas: la descarga PDTP autoriza por
 *   la fila que referencia el archivo (`findPdtpEvidenceOwner`). Vincular una
 *   ruta que ya es de otra faena era apropiarse del archivo: quien opera la
 *   faena B escribía la ruta del PDF de la faena A en su celda, instancia,
 *   obligación o seguimiento CAPA, y después lo descargaba. Al vincular se
 *   rechaza una ruta que ya referencia una fila de otra faena fuera del alcance
 *   de quien vincula. Volver a vincular lo propio (reenvío, fusión de la
 *   evidencia anterior) sigue funcionando.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const previousStoragePath = process.env.STORAGE_PATH
const tmpEvidenceRoot = join(tmpdir(), `pdtp-evidence-link-${Date.now()}`)
process.env.STORAGE_PATH = tmpEvidenceRoot
mkdirSync(join(tmpEvidenceRoot, "pdtp-evidence"), { recursive: true })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  if (previousStoragePath === undefined) delete process.env.STORAGE_PATH
  else process.env.STORAGE_PATH = previousStoragePath
})

const { markPdtpExecution, rejectPdtpExecution } = await import("@/lib/services/pdtp/executions")
const { createPdtpObligation, reportPdtpObligation } = await import("@/lib/services/pdtp/obligations")
const { recordPdtpScheduledInstanceOutcome } = await import("@/lib/services/pdtp/scheduled-execution")
const { addFollowup } = await import("@/lib/services/pdtp/followups")
const { findPdtpEvidenceOwner } = await import("@/lib/services/pdtp/evidence-references")
const { addCapaEvidence } = await import("@/lib/services/prevention-capa")
const { recordPdtpEvidenceUpload } = await import("@/lib/services/pdtp/evidence-uploads")

const { year: YEAR, month: CURRENT_MONTH } = chileDateParts()
const PROGRAM_ID = "pdtp-link-v1"
const WS_A = "ws-link-a"
const WS_B = "ws-link-b"
const ACT_ID = `${PROGRAM_ID}-a-001`
const EVENT_ACT_ID = `${PROGRAM_ID}-a-002`
const USER_A = "user-link-a"
const USER_B = "user-link-b"
const APPROVER = "user-link-approver"
const CHECKSUM = "a".repeat(64)

/**
 * Un archivo en disco. PREV-M02-B (0334): por defecto también su fila en el
 * registro de subidas, como la deja `POST /api/prevencion/pdtp/evidence`;
 * `owner: null` simula un archivo sin registro (anterior a 0334 o inventado).
 */
async function evidenceFile(name: string, owner: { worksiteId: string; userId: string } | null = { worksiteId: WS_A, userId: USER_A }): Promise<string> {
  writeFileSync(join(tmpEvidenceRoot, "pdtp-evidence", name), `%PDF-1.4 ${name}`)
  const path = `storage/pdtp-evidence/${name}`
  if (owner) {
    await recordPdtpEvidenceUpload({
      path, uploadedByUserId: owner.userId, worksiteId: owner.worksiteId,
      sha256: CHECKSUM, sizeBytes: 16, mimeType: "application/pdf",
    })
  }
  return path
}

const OWNER_B = { worksiteId: WS_B, userId: USER_B }

function cell(worksiteId: string, overrides: Record<string, unknown> = {}) {
  return {
    activityId: ACT_ID, worksiteId, year: YEAR, month: CURRENT_MONTH, week: 1,
    executedQuantity: 1, evidenceText: "", evidenceUrl: "", evidencePhotos: [],
    ...overrides,
  }
}

async function executionOf(worksiteId: string) {
  const [row] = await inMemoryDb.select().from(schema.pdtpExecutions)
    .where(and(eq(schema.pdtpExecutions.activityId, ACT_ID), eq(schema.pdtpExecutions.worksiteId, worksiteId)))
  return row
}

/** El archivo de la faena A, ya vinculado a su celda. */
async function fileOfWorksiteA(name = "acta-faena-a.pdf") {
  const url = await evidenceFile(name)
  await markPdtpExecution(cell(WS_A, { evidenceUrl: url }), USER_A, [WS_A])
  return url
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpEvidenceUploads)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.operationalActivityEvents)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.preventionCapaTransitions)
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([USER_A, USER_B, APPROVER].map((id) => ({
    id, name: `Nombre ${id}`, email: `${id}@test`, hashedPassword: "x",
  })))
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FA", isActive: true },
    { id: WS_B, name: "Faena B", code: "FB", isActive: true },
  ])
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: YEAR, title: `PDTP ${YEAR} vínculos`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedAt: `${YEAR}-01-01T00:00:00.000Z`, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values([{
    id: ACT_ID, programId: PROGRAM_ID, n: 1, activity: "Charla de seguridad", program: "Prevención",
    responsibleSlugs: [], responsibleDisplay: "Supervisor", scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed", mechanism: "enganche",
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
  }, {
    id: EVENT_ACT_ID, programId: PROGRAM_ID, n: 2, activity: "Investigar un incidente", program: "Prevención",
    responsibleSlugs: [], responsibleDisplay: "Prevencionista", scheduleMode: "on_demand",
    scheduleClassificationStatus: "confirmed", dueDays: 5, indicatorMode: "closed_on_time", mechanism: "enganche",
    evidenceRequirement: "Informe de investigación",
    sourceSheetRow: 2, createdAt: now, updatedAt: now,
  }])
})

describe("hallazgo 1 — la planilla no vincula el archivo de otra faena", () => {
  it("la faena B no puede usar como evidencia principal un archivo ya vinculado en la faena A", async () => {
    const url = await fileOfWorksiteA()
    await expect(markPdtpExecution(cell(WS_B, { evidenceUrl: url }), USER_B, [WS_B]))
      .rejects.toThrow(/otra faena/i)
    expect(await executionOf(WS_B)).toBeUndefined()
    // La descarga de la faena B sigue sin encontrar dueño en su alcance.
    expect(await findPdtpEvidenceOwner("acta-faena-a.pdf", [WS_B])).toBeNull()
  })

  it("tampoco como foto", async () => {
    const url = await fileOfWorksiteA()
    const own = await evidenceFile("propia-b.pdf", OWNER_B)
    await expect(markPdtpExecution(cell(WS_B, { evidenceUrl: own, evidencePhotos: [url] }), USER_B, [WS_B]))
      .rejects.toThrow(/otra faena/i)
  })

  it("un archivo referenciado sólo por una CAPA de la faena A también es ajeno", async () => {
    const url = await evidenceFile("capa-faena-a.pdf")
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: "capa-link-a", code: "CAPA-LINK-0001", sourceType: "pdtp", sourceId: "exec-x",
      worksiteId: WS_A, finding: "Hallazgo", actionDescription: "Acción",
      targetDate: "2026-12-01", createdByUserId: USER_A, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionCapaEvidence).values({
      id: "capaev-link-a", actionId: "capa-link-a", kind: "document", reference: url,
      checksumSha256: CHECKSUM, uploadedByUserId: USER_A, createdAt: now,
    })
    await expect(markPdtpExecution(cell(WS_B, { evidenceUrl: url }), USER_B, [WS_B]))
      .rejects.toThrow(/otra faena/i)
  })

  it("reenviar el archivo propio tras un rechazo, y sumar uno nuevo, sigue funcionando", async () => {
    const first = await evidenceFile("propia-b-1.pdf", OWNER_B)
    await markPdtpExecution(cell(WS_B, { evidenceUrl: first }), USER_B, [WS_B])
    await rejectPdtpExecution((await executionOf(WS_B))!.id, APPROVER, "Falta firma", "all")
    // Mismo archivo (la fila y su historial ya lo referencian, en la misma faena).
    await markPdtpExecution(cell(WS_B, { evidenceUrl: first }), USER_B, [WS_B])
    await rejectPdtpExecution((await executionOf(WS_B))!.id, APPROVER, "El acta está ilegible", "all")
    // Archivo nuevo: el anterior pasa a las fotos (fusión append-only).
    const second = await evidenceFile("propia-b-2.pdf", OWNER_B)
    const row = await markPdtpExecution(cell(WS_B, { evidenceUrl: second }), USER_B, [WS_B])
    expect(row.evidenceUrl).toBe(second)
    expect(row.evidencePhotos).toEqual([first])
  })

  it("quien tiene las dos faenas en su alcance sí puede reutilizar el archivo", async () => {
    const url = await fileOfWorksiteA()
    const row = await markPdtpExecution(cell(WS_B, { evidenceUrl: url }), USER_A, [WS_A, WS_B])
    expect(row.evidenceUrl).toBe(url)
  })
})

describe("hallazgo 1 — obligaciones, instancias programadas y seguimiento CAPA", () => {
  it("el reporte de una obligación de la faena B rechaza el archivo de la faena A", async () => {
    const url = await fileOfWorksiteA()
    const { obligation } = await createPdtpObligation({
      activityId: EVENT_ACT_ID, worksiteId: WS_B, origin: "manual", clientRequestId: "req-link-b-0001",
      manualReason: "Incidente registrado en terreno", userId: USER_B, scope: [WS_B],
    })
    await expect(reportPdtpObligation({
      obligationId: obligation.id, executedQuantity: 1, evidenceUrl: url, userId: USER_B, scope: [WS_B],
    })).rejects.toThrow(/otra faena/i)
  })

  it("el resultado de una instancia programada de la faena B rechaza el archivo de la faena A", async () => {
    const url = await fileOfWorksiteA()
    const now = new Date().toISOString()
    const day = `${YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}-01`
    await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
      id: "inst-link-b", programId: PROGRAM_ID, activityId: ACT_ID, worksiteId: WS_B, scheduledFor: day,
      isoWeekYear: YEAR, isoWeek: 1, status: "pending", idempotencyKey: "inst-link-b-key",
      sourceMetadataJson: {}, createdAt: now, updatedAt: now,
    })
    await expect(recordPdtpScheduledInstanceOutcome({
      instanceId: "inst-link-b", action: "submit", userId: USER_B, evidenceRef: url, scope: [WS_B],
    })).rejects.toThrow(/otra faena/i)
    const [instance] = await inMemoryDb.select().from(schema.pdtpScheduledInstances)
      .where(eq(schema.pdtpScheduledInstances.id, "inst-link-b"))
    expect(instance!.status).toBe("pending")
  })

  it("el seguimiento de una acción del plan de la faena B rechaza el archivo de la faena A", async () => {
    const url = await fileOfWorksiteA()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: "capa-link-b", code: "CAPA-LINK-0002", sourceType: "pdtp", sourceId: "exec-b",
      worksiteId: WS_B, finding: "Hallazgo", actionDescription: "Acción",
      targetDate: "2026-12-01", createdByUserId: USER_B, createdAt: now, updatedAt: now,
    })
    await expect(addFollowup({
      actionPlanItemId: "capa-link-b", evidenciaUrl: url, evidenciaChecksums: { [url]: CHECKSUM },
    }, USER_B)).rejects.toThrow(/otra faena/i)
    const evidence = await inMemoryDb.select().from(schema.preventionCapaEvidence)
      .where(eq(schema.preventionCapaEvidence.actionId, "capa-link-b"))
    expect(evidence).toHaveLength(0)
  })

  it("tampoco por el módulo CAPA genérico, sobre una acción del PDTP de la faena B", async () => {
    const url = await fileOfWorksiteA()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: "capa-link-b2", code: "CAPA-LINK-0003", sourceType: "pdtp", sourceId: "exec-b2",
      worksiteId: WS_B, finding: "Hallazgo", actionDescription: "Acción",
      targetDate: "2026-12-01", createdByUserId: USER_B, createdAt: now, updatedAt: now,
    })
    await expect(addCapaEvidence({
      input: { actionId: "capa-link-b2", expectedVersion: 1, kind: "document", reference: url, checksumSha256: CHECKSUM },
      ctx: { userId: USER_B } as never,
      scope: { mode: "some", ids: [WS_B] },
      permissions: ["prevention:capa:complete"],
    })).rejects.toThrow(/otra faena/i)
  })
})

/* PREV-M02-B (0334): un archivo recién subido todavía no lo referencia ninguna
 * fila, así que la regla del hallazgo 1 no lo cubría: quien adivinara su nombre
 * (nanoid de 20) lo vinculaba desde otra faena. El registro de subidas lo
 * cierra. */
describe("M02-B — registro de dueño de las subidas", () => {
  it("un archivo recién subido en la faena A no lo vincula la faena B aunque conozca el nombre", async () => {
    const url = await evidenceFile("recien-subido-a.pdf")
    await expect(markPdtpExecution(cell(WS_B, { evidenceUrl: url }), USER_B, [WS_B]))
      .rejects.toThrow(/se subió para otra faena/i)
    expect(await executionOf(WS_B)).toBeUndefined()
  })

  it("tampoco lo usa para otra faena quien lo subió, aunque tenga las dos en su alcance", async () => {
    const url = await evidenceFile("subido-para-a.pdf")
    await expect(markPdtpExecution(cell(WS_B, { evidenceUrl: url }), USER_A, [WS_A, WS_B]))
      .rejects.toThrow(/se subió para otra faena/i)
  })

  it("en la misma faena, sólo lo vincula quien lo subió", async () => {
    const url = await evidenceFile("subido-por-a.pdf")
    await expect(markPdtpExecution(cell(WS_A, { evidenceUrl: url }), USER_B, [WS_A]))
      .rejects.toThrow(/quien lo subió/i)
    const row = await markPdtpExecution(cell(WS_A, { evidenceUrl: url }), USER_A, [WS_A])
    expect(row.evidenceUrl).toBe(url)
  })

  it("un archivo sin registro ni referencias (anterior a 0334 o inventado) se rechaza con un mensaje claro", async () => {
    const url = await evidenceFile("sin-registro.pdf", null)
    await expect(markPdtpExecution(cell(WS_A, { evidenceUrl: url }), USER_A, [WS_A]))
      .rejects.toThrow(/no tiene registro de subida/i)
  })

  it("regla heredada: un archivo sin registro que la misma faena ya referencia se sigue pudiendo vincular", async () => {
    const url = await evidenceFile("heredado-b.pdf", null)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: "capa-legacy-b", code: "CAPA-LINK-0009", sourceType: "pdtp", sourceId: "exec-legacy",
      worksiteId: WS_B, finding: "Hallazgo", actionDescription: "Acción",
      targetDate: "2026-12-01", createdByUserId: USER_B, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionCapaEvidence).values({
      id: "capaev-legacy-b", actionId: "capa-legacy-b", kind: "document", reference: url,
      checksumSha256: CHECKSUM, uploadedByUserId: USER_B, createdAt: now,
    })
    const row = await markPdtpExecution(cell(WS_B, { evidenceUrl: url }), USER_B, [WS_B])
    expect(row.evidenceUrl).toBe(url)
  })

  it("el resultado de una instancia usa el mismo registro: pasa con la subida propia, no con la ajena", async () => {
    const now = new Date().toISOString()
    const day = `${YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}-01`
    await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
      id: "inst-m02b", programId: PROGRAM_ID, activityId: ACT_ID, worksiteId: WS_B, scheduledFor: day,
      isoWeekYear: YEAR, isoWeek: 1, status: "pending", idempotencyKey: "inst-m02b-key",
      sourceMetadataJson: {}, createdAt: now, updatedAt: now,
    })
    const foreign = await evidenceFile("ajena-instancia.pdf")
    await expect(recordPdtpScheduledInstanceOutcome({
      instanceId: "inst-m02b", action: "submit", userId: USER_B, evidenceRef: foreign, scope: [WS_B],
    })).rejects.toThrow(/se subió para otra faena/i)
    const own = await evidenceFile("propia-instancia.pdf", OWNER_B)
    const updated = await recordPdtpScheduledInstanceOutcome({
      instanceId: "inst-m02b", action: "submit", userId: USER_B, evidenceRef: own, scope: [WS_B],
    })
    expect(updated.status).toBe("submitted")
  })
})
