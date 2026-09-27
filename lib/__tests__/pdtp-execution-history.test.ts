/**
 * lib/__tests__/pdtp-execution-history.test.ts
 *
 * Tanda T4 del plan de pendientes de la auditoría de Prevención
 * (qa/reports/2026-09-26-prevencion-production-readiness.md):
 *
 * - PREV-I04: cada envío, reenvío, aprobación, rechazo y reversión deja una
 *   fila en la bitácora (`audit_log`, D10) en la misma transacción, con el
 *   número de intento y las rutas de la evidencia de ese momento. Así se
 *   reconstruye qué se presentó, quién lo rechazó y por qué.
 * - W5-SHA: al vincular un archivo se calcula su sha256 en el servidor y se
 *   guarda junto a la ejecución (sin migración: `source_metadata_json`).
 * - PREV-B03 en obligaciones: reportar de nuevo una obligación rechazada no
 *   pierde el archivo del intento anterior (`mergePdtpEvidence`).
 * - PREV-M08: segregación — quien registró no aprueba, tampoco por la vía de
 *   una obligación.
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedPdtpEvidenceUpload } from "@/lib/testing/pdtp-evidence-upload-fixture"
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
const tmpEvidenceRoot = join(tmpdir(), `pdtp-execution-history-${Date.now()}`)
process.env.STORAGE_PATH = tmpEvidenceRoot
mkdirSync(join(tmpEvidenceRoot, "pdtp-evidence"), { recursive: true })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  if (previousStoragePath === undefined) delete process.env.STORAGE_PATH
  else process.env.STORAGE_PATH = previousStoragePath
})

const { markPdtpExecution, approvePdtpExecution, rejectPdtpExecution } = await import("@/lib/services/pdtp/executions")
const { createPdtpObligation, reportPdtpObligation } = await import("@/lib/services/pdtp/obligations")
const { accreditPdtpFromEvent, revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")
const { listPdtpExecutionHistory } = await import("@/lib/services/pdtp/execution-history")

const { year: YEAR, month: CURRENT_MONTH } = chileDateParts()
const PROGRAM_ID = "pdtp-history-v1"
const WS = "ws-history"
const ACT_ID = `${PROGRAM_ID}-a-001`
const EVENT_ACT_ID = `${PROGRAM_ID}-a-002`
const USER_A = "user-history-a"
const APPROVER = "user-history-approver"

/** PREV-M02-B (0334): el archivo y su fila del registro de subidas (faena de la suite). */
async function evidenceFile(name: string, content = `%PDF-1.4 ${name}`, uploader: string = USER_A): Promise<string> {
  writeFileSync(join(tmpEvidenceRoot, "pdtp-evidence", name), content)
  const path = `storage/pdtp-evidence/${name}`
  await seedPdtpEvidenceUpload(inMemoryDb, { path, worksiteId: WS, userId: uploader })
  return path
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function cell(overrides: Record<string, unknown> = {}) {
  return {
    activityId: ACT_ID, worksiteId: WS, year: YEAR, month: CURRENT_MONTH, week: 1,
    executedQuantity: 1, evidenceText: "", evidenceUrl: "", evidencePhotos: [],
    ...overrides,
  }
}

async function executionRow() {
  const [row] = await inMemoryDb.select().from(schema.pdtpExecutions)
    .where(and(eq(schema.pdtpExecutions.activityId, ACT_ID), eq(schema.pdtpExecutions.worksiteId, WS)))
  return row
}

async function auditRows(executionId: string) {
  const rows = await inMemoryDb.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, "pdtp:execution"), eq(schema.auditLog.entityId, executionId)))
    .orderBy(asc(schema.auditLog.createdAt))
  return rows.map((row) => ({
    ...row,
    before: row.oldState ? JSON.parse(row.oldState) as Record<string, unknown> : null,
    after: row.newState ? JSON.parse(row.newState) as Record<string, unknown> : null,
  }))
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.operationalActivityEvents)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([USER_A, APPROVER].map((id) => ({
    id, name: `Nombre ${id}`, email: `${id}@test`, hashedPassword: "x",
  })))
  await inMemoryDb.insert(schema.worksites).values({ id: WS, name: "Faena historial", code: "FH", isActive: true })
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: YEAR, title: `PDTP ${YEAR} historial`,
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

describe("PREV-I04 — historial de envíos en la bitácora", () => {
  it("el primer envío deja una fila 'submitted' con el intento 1 y la ruta del archivo", async () => {
    const url = await evidenceFile("hist-1.pdf")
    await markPdtpExecution(cell({ evidenceUrl: url, evidenceText: "Acta firmada" }), USER_A, "all")
    const row = await executionRow()
    const [entry, ...rest] = await auditRows(row!.id)
    expect(rest).toHaveLength(0)
    expect(entry!.userId).toBe(USER_A)
    expect(entry!.worksiteId).toBe(WS)
    expect(entry!.after).toMatchObject({
      changeType: "submitted", status: "submitted", attempt: 1, evidenceUrl: url, executedQuantity: 1,
    })
  })

  it("rechazar y reenviar deja el motivo, el archivo rechazado y el intento 2", async () => {
    const first = await evidenceFile("hist-rechazada.pdf")
    await markPdtpExecution(cell({ evidenceUrl: first }), USER_A, "all")
    const row = await executionRow()
    await rejectPdtpExecution(row!.id, APPROVER, "Falta la firma del supervisor", "all")
    const second = await evidenceFile("hist-corregida.pdf")
    await markPdtpExecution(cell({ evidenceUrl: second }), USER_A, "all")

    const entries = await auditRows(row!.id)
    expect(entries.map((entry) => entry.after?.changeType)).toEqual(["submitted", "rejected", "resubmitted"])
    const rejected = entries[1]!
    expect(rejected.userId).toBe(APPROVER)
    expect(rejected.reason).toBe("Falta la firma del supervisor")
    expect(rejected.before).toMatchObject({ status: "submitted", evidenceUrl: first })
    expect(rejected.after).toMatchObject({ status: "rejected", attempt: 1 })
    const resubmitted = entries[2]!
    expect(resubmitted.before).toMatchObject({
      status: "rejected", evidenceUrl: first, rejectionReason: "Falta la firma del supervisor", attempt: 1,
    })
    expect(resubmitted.after).toMatchObject({ status: "submitted", attempt: 2, evidenceUrl: second })
    expect(resubmitted.after?.evidencePhotos).toContain(first)
  })

  it("aprobar deja una fila 'approved' con el aprobador", async () => {
    await markPdtpExecution(cell({ evidenceUrl: await evidenceFile("hist-aprobar.pdf") }), USER_A, "all")
    const row = await executionRow()
    await approvePdtpExecution(row!.id, APPROVER, "all")
    const entries = await auditRows(row!.id)
    expect(entries.at(-1)).toMatchObject({ userId: APPROVER })
    expect(entries.at(-1)!.after).toMatchObject({ changeType: "approved", status: "approved", attempt: 1 })
  })

  it("revertir una acreditación deja una fila 'revoked' con el motivo", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-hist-integration", activityId: ACT_ID, worksiteId: WS, year: YEAR, month: CURRENT_MONTH, week: 2,
      executedQuantity: 1, status: "approved", origin: "integration", sourceType: "capacitacion_ocurrencia", sourceId: "occ-hist",
      idempotencyKey: `pdtp-accredit:${ACT_ID}:${WS}:capacitacion_ocurrencia:occ-hist`,
      approvedByUserId: APPROVER, approvedAt: now,
      evidenceUrl: "storage/prevention-training-evidence/acta.pdf", createdAt: now, updatedAt: now,
    })
    await revokePdtpAccreditation({
      sourceType: "capacitacion_ocurrencia", sourceId: "occ-hist", worksiteId: WS,
      revokedBy: APPROVER, reason: "Ocurrencia anulada",
    })
    const entries = await auditRows("exec-hist-integration")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.reason).toBe("Ocurrencia anulada")
    expect(entries[0]!.before).toMatchObject({ status: "approved", evidenceUrl: "storage/prevention-training-evidence/acta.pdf" })
    expect(entries[0]!.after).toMatchObject({ changeType: "revoked", status: "draft" })
  })

  it("una transición que falla no deja historia a medias", async () => {
    await markPdtpExecution(cell({ evidenceUrl: await evidenceFile("hist-self.pdf") }), USER_A, "all")
    const row = await executionRow()
    await expect(approvePdtpExecution(row!.id, USER_A, "all")).rejects.toThrow(/no puede aprobarlo/i)
    const entries = await auditRows(row!.id)
    expect(entries.map((entry) => entry.after?.changeType)).toEqual(["submitted"])
  })

  it("listPdtpExecutionHistory devuelve la línea de tiempo en orden, con nombres y archivos", async () => {
    const first = await evidenceFile("hist-list-1.pdf")
    await markPdtpExecution(cell({ evidenceUrl: first }), USER_A, "all")
    const row = await executionRow()
    await rejectPdtpExecution(row!.id, APPROVER, "Ilegible", "all")
    const history = await listPdtpExecutionHistory(row!.id)
    expect(history.map((entry) => entry.changeType)).toEqual(["submitted", "rejected"])
    expect(history[0]).toMatchObject({ actorName: `Nombre ${USER_A}`, attempt: 1, files: [first] })
    expect(history[1]).toMatchObject({ actorName: `Nombre ${APPROVER}`, reason: "Ilegible" })
  })
})

/* Revisión final 2026-09-27 (hallazgo 4, T4 × T3): la acreditación por
 * integración crea y actualiza ejecuciones —incluida la aprobación
 * automática y la reacreditación de una fila rechazada— y sólo la revocación
 * dejaba historial. */
describe("hallazgo 4 — la acreditación por integración deja historial", () => {
  const occurredAt = () => {
    const today = chileDateParts()
    return `${today.year}-${String(today.month).padStart(2, "0")}-01T15:00:00.000Z`
  }

  it("la aprobación automática deja una fila 'approved', sin intento previo, con quien aprueba y la fuente", async () => {
    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion", sourceId: "run-hist-auto", worksiteId: WS, activityNumbers: [1],
      occurredAt: occurredAt(), autoApproveByUserId: APPROVER, evidenceRef: "Inspección completada: run-hist-auto",
    })
    const executionId = result.accredited[0]!.executionId
    const entries = await auditRows(executionId)
    expect(entries.map((entry) => entry.after?.changeType)).toEqual(["approved"])
    expect(entries[0]!.userId).toBe(APPROVER)
    expect(entries[0]!.before).toBeNull()
    expect(entries[0]!.after).toMatchObject({ status: "approved", executedQuantity: 1, evidenceText: "Inspección completada: run-hist-auto" })
    expect(entries[0]!.reason).toMatch(/inspeccion.*run-hist-auto/)
  })

  it("sin aprobación automática deja 'submitted' sin actor humano; reacreditar tras un rechazo deja 'resubmitted'", async () => {
    const first = await accreditPdtpFromEvent({
      sourceType: "campana", sourceId: "camp-hist", worksiteId: WS, activityNumbers: [1], occurredAt: occurredAt(),
    })
    const executionId = first.accredited[0]!.executionId
    await rejectPdtpExecution(executionId, APPROVER, "La campaña no corresponde a esta faena", "all")
    await accreditPdtpFromEvent({
      sourceType: "campana", sourceId: "camp-hist", worksiteId: WS, activityNumbers: [1], occurredAt: occurredAt(),
    })
    const entries = await auditRows(executionId)
    expect(entries.map((entry) => entry.after?.changeType)).toEqual(["submitted", "rejected", "resubmitted"])
    expect(entries[0]!.userId).toBeNull()
    expect(entries[2]!.userId).toBeNull()
    expect(entries[2]!.before).toMatchObject({ status: "rejected", rejectionReason: "La campaña no corresponde a esta faena" })
    expect(entries[2]!.after).toMatchObject({ status: "submitted" })
  })

  it("un evento reentregado sobre un envío que no cambió no agrega historia", async () => {
    const input = { sourceType: "campana" as const, sourceId: "camp-hist-dup", worksiteId: WS, activityNumbers: [1], occurredAt: occurredAt() }
    const result = await accreditPdtpFromEvent(input)
    await accreditPdtpFromEvent(input)
    expect((await auditRows(result.accredited[0]!.executionId)).map((entry) => entry.after?.changeType)).toEqual(["submitted"])
  })

  it("un evento repetido sobre una ejecución ya aprobada no agrega historia", async () => {
    const input = {
      sourceType: "inspeccion" as const, sourceId: "run-hist-dup", worksiteId: WS, activityNumbers: [1],
      occurredAt: occurredAt(), autoApproveByUserId: APPROVER,
    }
    const result = await accreditPdtpFromEvent(input)
    await accreditPdtpFromEvent(input)
    expect(await auditRows(result.accredited[0]!.executionId)).toHaveLength(1)
  })
})

describe("W5-SHA — sha256 del archivo al vincularlo", () => {
  it("guarda el sha256 calculado en el servidor, por ruta, y lo copia al historial", async () => {
    const content = "%PDF-1.4 contenido firmado"
    const url = await evidenceFile("sha-1.pdf", content)
    await markPdtpExecution(cell({ evidenceUrl: url }), USER_A, "all")
    const row = await executionRow()
    expect((row!.sourceMetadataJson as Record<string, unknown>).evidenceSha256).toEqual({ [url]: sha256(content) })
    const [entry] = await auditRows(row!.id)
    expect(entry!.after?.evidenceSha256).toEqual({ [url]: sha256(content) })
  })

  it("un reenvío conserva el sha256 de los archivos anteriores y suma el del nuevo", async () => {
    const first = await evidenceFile("sha-a.pdf", "A")
    await markPdtpExecution(cell({ evidenceUrl: first }), USER_A, "all")
    const second = await evidenceFile("sha-b.pdf", "B")
    await markPdtpExecution(cell({ evidenceUrl: second }), USER_A, "all")
    const row = await executionRow()
    expect((row!.sourceMetadataJson as Record<string, unknown>).evidenceSha256).toEqual({
      [first]: sha256("A"), [second]: sha256("B"),
    })
  })
})

async function manualObligation() {
  const { obligation } = await createPdtpObligation({
    activityId: EVENT_ACT_ID, worksiteId: WS, origin: "manual",
    manualReason: "Incidente registrado en terreno", clientRequestId: "req-history", userId: USER_A, scope: "all",
  } as Parameters<typeof createPdtpObligation>[0])
  return obligation
}

describe("PREV-B03 en obligaciones — el reporte rechazado no pierde su archivo", () => {
  it("reportar de nuevo tras un rechazo conserva el archivo anterior como referencia", async () => {
    const obligation = await manualObligation()
    const first = await evidenceFile("oblig-1.pdf")
    const { execution } = await reportPdtpObligation({
      obligationId: obligation.id, executedQuantity: 1, evidenceUrl: first, userId: USER_A, scope: "all",
    })
    await rejectPdtpExecution(execution.id, APPROVER, "Informe incompleto", "all")
    const second = await evidenceFile("oblig-2.pdf", "segundo")
    const { execution: again } = await reportPdtpObligation({
      obligationId: obligation.id, executedQuantity: 1, evidenceUrl: second, userId: USER_A, scope: "all",
    })
    expect(again.evidenceUrl).toBe(second)
    expect(again.evidencePhotos).toContain(first)
    expect((again.sourceMetadataJson as Record<string, unknown>).evidenceSha256).toMatchObject({ [second]: sha256("segundo") })
    const entries = await auditRows(execution.id)
    expect(entries.map((entry) => entry.after?.changeType)).toEqual(["submitted", "rejected", "resubmitted"])
  })
})

describe("PREV-M08 — segregación: quien registró no aprueba", () => {
  it("el autor de una ejecución no puede aprobarla; otra persona sí", async () => {
    await markPdtpExecution(cell({ evidenceUrl: await evidenceFile("seg-1.pdf") }), USER_A, "all")
    const row = await executionRow()
    await expect(approvePdtpExecution(row!.id, USER_A, "all")).rejects.toThrow(/no puede aprobarlo/i)
    expect((await executionRow())?.status).toBe("submitted")
    await approvePdtpExecution(row!.id, APPROVER, "all")
    expect((await executionRow())?.status).toBe("approved")
  })

  it("quien reporta una obligación tampoco aprueba su ejecución", async () => {
    const obligation = await manualObligation()
    const { execution } = await reportPdtpObligation({
      obligationId: obligation.id, executedQuantity: 1, evidenceUrl: await evidenceFile("seg-oblig.pdf"), userId: USER_A, scope: "all",
    })
    await expect(approvePdtpExecution(execution.id, USER_A, "all")).rejects.toThrow(/no puede aprobarlo/i)
  })

  it("tras un reenvío por otra persona (administrador), el autor original sí puede aprobar y el nuevo autor no", async () => {
    await markPdtpExecution(cell({ evidenceUrl: await evidenceFile("seg-a.pdf") }), USER_A, "all")
    await markPdtpExecution(cell({ evidenceUrl: await evidenceFile("seg-b.pdf", undefined, APPROVER) }), APPROVER, "all", { canActForOthers: true })
    const row = await executionRow()
    await expect(approvePdtpExecution(row!.id, APPROVER, "all")).rejects.toThrow(/no puede aprobarlo/i)
    await approvePdtpExecution(row!.id, USER_A, "all")
    expect((await executionRow())?.status).toBe("approved")
  })
})
