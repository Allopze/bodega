/**
 * lib/__tests__/pdtp-execution-integrity.test.ts
 *
 * Regresiones de la auditoría de production readiness del 2026-09-26
 * (qa/reports/2026-09-26-prevencion-production-readiness.md):
 *
 * - PREV-B02: "Se hizo" exige un archivo real salvo que la actividad declare
 *   explícitamente que basta la observación (`manualEvidencePolicy`), y la
 *   aprobación vuelve a comprobarlo.
 * - PREV-B03: un envío pendiente de otra persona no se sobrescribe, y la
 *   evidencia de un intento anterior sigue referenciada (descargable y a salvo
 *   del GC) cuando llega otra.
 * - PREV-I03: con una asignación nominal vigente, sólo la persona asignada
 *   registra la actividad en esa faena.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
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
const tmpEvidenceRoot = join(tmpdir(), `pdtp-execution-integrity-${Date.now()}`)
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

const { year: YEAR, month: CURRENT_MONTH } = chileDateParts()
const PROGRAM_ID = "pdtp-integrity-v1"
const WS = "ws-integrity"
const ACT_ID = `${PROGRAM_ID}-a-001`
const USER_A = "user-integrity-a"
const USER_B = "user-integrity-b"
const APPROVER = "user-integrity-approver"

function evidenceFile(name: string): string {
  writeFileSync(join(tmpEvidenceRoot, "pdtp-evidence", name), "%PDF-1.4 test")
  return `storage/pdtp-evidence/${name}`
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

beforeEach(async () => {
  // PREV-I04: cada transición escribe en `audit_log`, que referencia a `users`.
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.operationalActivityEvents)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteAssignees)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([USER_A, USER_B, APPROVER].map((id) => ({
    id, name: id, email: `${id}@test`, hashedPassword: "x",
  })))
  await inMemoryDb.insert(schema.worksites).values({ id: WS, name: "Faena integridad", code: "FI", isActive: true })
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: YEAR, title: `PDTP ${YEAR} integridad`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedAt: `${YEAR}-01-01T00:00:00.000Z`, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID, programId: PROGRAM_ID, n: 1, activity: "Charla de seguridad", program: "Prevención",
    responsibleSlugs: [], responsibleDisplay: "Supervisor", scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed", mechanism: "enganche",
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })
})

describe("PREV-B02 — evidencia obligatoria para 'Se hizo'", () => {
  it("rechaza una ejecución con cantidad sin archivo ni observación, aunque la actividad no declare requisito", async () => {
    await expect(markPdtpExecution(cell(), USER_A, "all")).rejects.toThrow(/adjunta un archivo/i)
    expect(await executionRow()).toBeUndefined()
  })

  it("una observación sola no basta por defecto", async () => {
    await expect(markPdtpExecution(cell({ evidenceText: "Se hizo la charla" }), USER_A, "all"))
      .rejects.toThrow(/adjunta un archivo/i)
  })

  it("una ruta con formato válido pero sin archivo físico no cuenta como evidencia", async () => {
    await expect(markPdtpExecution(cell({ evidenceUrl: "storage/pdtp-evidence/no-existe.pdf" }), USER_A, "all"))
      .rejects.toThrow(/adjunta un archivo/i)
  })

  /* Revisión final 2026-09-27 (hallazgo 2): el GC puede haber borrado un
   * upload que se vinculó tarde. Una ruta NUEVA sin archivo ya no se descarta
   * en silencio —el envío salía con la evidencia de otro intento o sin ella—:
   * falla y dice qué pasó. */
  it("una ruta nueva sin archivo físico falla con un mensaje claro, aunque venga otra evidencia real", async () => {
    const real = evidenceFile("real-con-fantasma.pdf")
    await expect(markPdtpExecution(cell({ evidenceUrl: "storage/pdtp-evidence/fantasma.pdf", evidencePhotos: [real] }), USER_A, "all"))
      .rejects.toThrow(/"fantasma\.pdf" ya no está en el almacenamiento/)
    await expect(markPdtpExecution(cell({ evidenceUrl: real, evidencePhotos: ["storage/pdtp-evidence/foto-fantasma.jpg"] }), USER_A, "all"))
      .rejects.toThrow(/"foto-fantasma\.jpg" ya no está en el almacenamiento/)
    expect(await executionRow()).toBeUndefined()
  })

  it("una ruta ya guardada cuyo archivo desapareció se sigue tolerando al reenviar", async () => {
    const first = evidenceFile("guardado-y-perdido.pdf")
    await markPdtpExecution(cell({ evidenceUrl: first }), USER_A, "all")
    await rejectPdtpExecution((await executionRow())!.id, APPROVER, "Falta la firma", "all")
    rmSync(join(tmpEvidenceRoot, "pdtp-evidence", "guardado-y-perdido.pdf"))
    const second = evidenceFile("reemplazo.pdf")
    const row = await markPdtpExecution(cell({ evidenceUrl: first, evidencePhotos: [second] }), USER_A, "all")
    expect(row.status).toBe("submitted")
    expect(row.evidenceUrl).toBe(first)
    expect(row.evidencePhotos).toEqual([second])
  })

  it("acepta la ejecución con un archivo real", async () => {
    const url = evidenceFile("acta-a.pdf")
    await markPdtpExecution(cell({ evidenceUrl: url }), USER_A, "all")
    expect((await executionRow())?.evidenceUrl).toBe(url)
  })

  it("con la excepción declarada basta la observación, pero nunca vacío", async () => {
    await inMemoryDb.update(schema.pdtpActivities).set({ manualEvidencePolicy: "declaration_allowed" })
      .where(eq(schema.pdtpActivities.id, ACT_ID))
    await expect(markPdtpExecution(cell(), USER_A, "all")).rejects.toThrow(/observación/i)
    await markPdtpExecution(cell({ evidenceText: "Registro en expediente físico" }), USER_A, "all")
    expect((await executionRow())?.status).toBe("submitted")
  })

  it("una cantidad cero no declara cumplimiento y no exige evidencia", async () => {
    await markPdtpExecution(cell({ executedQuantity: 0 }), USER_A, "all")
    expect((await executionRow())?.executedQuantity).toBe(0)
  })

  it("aprobar vuelve a exigir el archivo: una ejecución enviada sin evidencia no se aprueba", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-imported", activityId: ACT_ID, worksiteId: WS, year: YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, status: "submitted", origin: "xlsx_import", evidenceText: "Migrado sin evidencia adjunta",
      executedByUserId: USER_A, createdAt: now, updatedAt: now,
    })
    await expect(approvePdtpExecution("exec-imported", APPROVER, "all")).rejects.toThrow(/sin evidencia/i)
  })

  it("aprobar rechaza una evidencia cuyo archivo ya no existe en disco", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-missing-file", activityId: ACT_ID, worksiteId: WS, year: YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, status: "submitted", origin: "manual", evidenceUrl: "storage/pdtp-evidence/borrado.pdf",
      executedByUserId: USER_A, createdAt: now, updatedAt: now,
    })
    await expect(approvePdtpExecution("exec-missing-file", APPROVER, "all")).rejects.toThrow(/sin evidencia/i)
  })
})

describe("PREV-M03 — evidence_status refleja la evidencia real", () => {
  it("una carga con archivo queda 'provided' y una cantidad cero 'not_required'", async () => {
    await markPdtpExecution(cell({ evidenceUrl: evidenceFile("estado-archivo.pdf") }), USER_A, "all")
    expect((await executionRow())?.evidenceStatus).toBe("provided")
    await inMemoryDb.delete(schema.pdtpExecutions)
    await markPdtpExecution(cell({ executedQuantity: 0 }), USER_A, "all")
    expect((await executionRow())?.evidenceStatus).toBe("not_required")
  })

  async function seedImported() {
    await inMemoryDb.update(schema.pdtpActivities).set({ manualEvidencePolicy: "declaration_allowed" })
      .where(eq(schema.pdtpActivities.id, ACT_ID))
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-migrada", activityId: ACT_ID, worksiteId: WS, year: YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, status: "submitted", origin: "xlsx_import",
      evidenceText: "Migrado desde planilla.xlsx, celda F12; sin evidencia adjunta.",
      evidenceStatus: "migrated_without_attachment", executedByUserId: USER_A, createdAt: now, updatedAt: now,
    })
  }

  it("una fila migrada sin adjunto no se aprueba por su texto automático, aunque la actividad admita declaración", async () => {
    await seedImported()
    await expect(approvePdtpExecution("exec-migrada", APPROVER, "all")).rejects.toThrow(/sin evidencia/i)
  })

  it("reenviada con una declaración propia, deja de estar 'migrada' y se puede aprobar", async () => {
    await seedImported()
    await markPdtpExecution(cell({ evidenceText: "Registro en el expediente físico de la faena" }), USER_A, "all")
    const row = await executionRow()
    expect(row?.evidenceStatus).toBe("provided")
    await approvePdtpExecution(row!.id, APPROVER, "all")
    expect((await executionRow())?.status).toBe("approved")
  })
})

describe("W1-N01 — una acreditación de integración no presta su archivo a la carga manual", () => {
  async function seedIntegration(status: "submitted" | "approved") {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: `exec-integration-${status}`, activityId: ACT_ID, worksiteId: WS, year: YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, status, origin: "integration", sourceType: "capacitacion_ocurrencia", sourceId: "occ-1",
      idempotencyKey: `pdtp-accredit:${ACT_ID}:${WS}:capacitacion_ocurrencia:occ-1-${status}`,
      evidenceUrl: evidenceFile(`integracion-${status}.pdf`), executedByUserId: null, createdAt: now, updatedAt: now,
    })
  }

  it("una carga manual sin archivo sigue rechazada aunque la integración de la celda tenga uno", async () => {
    await seedIntegration("submitted")
    await expect(markPdtpExecution(cell(), USER_A, "all")).rejects.toThrow(/adjunta un archivo/i)
  })

  it("con una integración aprobada en la celda, la fila manual nace sin heredar sus archivos", async () => {
    await seedIntegration("approved")
    const own = evidenceFile("manual-propio.pdf")
    await markPdtpExecution(cell({ evidenceUrl: own }), USER_A, "all")
    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(and(eq(schema.pdtpExecutions.activityId, ACT_ID), eq(schema.pdtpExecutions.origin, "manual")))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.evidenceUrl).toBe(own)
    expect(rows[0]!.evidencePhotos).toEqual([])
  })
})

describe("PREV-B03 — un envío ajeno no se sobrescribe y la evidencia previa se conserva", () => {
  it("otra persona no puede reemplazar un envío pendiente ajeno", async () => {
    const urlA = evidenceFile("acta-a2.pdf")
    await markPdtpExecution(cell({ evidenceUrl: urlA, evidenceText: "A" }), USER_A, "all")
    const urlB = evidenceFile("acta-b2.pdf")
    await expect(markPdtpExecution(cell({ evidenceUrl: urlB, executedQuantity: 3 }), USER_B, "all"))
      .rejects.toThrow(/otra persona/i)
    const row = await executionRow()
    expect(row?.executedByUserId).toBe(USER_A)
    expect(row?.evidenceUrl).toBe(urlA)
    expect(row?.executedQuantity).toBe(1)
  })

  it("quien administra el programa puede corregirlo, y la evidencia anterior sigue referenciada", async () => {
    const urlA = evidenceFile("acta-a3.pdf")
    await markPdtpExecution(cell({ evidenceUrl: urlA }), USER_A, "all")
    const urlB = evidenceFile("acta-b3.pdf")
    await markPdtpExecution(cell({ evidenceUrl: urlB }), USER_B, "all", { canActForOthers: true })
    const row = await executionRow()
    expect(row?.evidenceUrl).toBe(urlB)
    expect(row?.evidencePhotos).toContain(urlA)
  })

  it("el mismo autor reemplaza su archivo sin perder el anterior", async () => {
    const first = evidenceFile("propio-1.pdf")
    await markPdtpExecution(cell({ evidenceUrl: first }), USER_A, "all")
    const second = evidenceFile("propio-2.pdf")
    await markPdtpExecution(cell({ evidenceUrl: second }), USER_A, "all")
    const row = await executionRow()
    expect(row?.evidenceUrl).toBe(second)
    expect(row?.evidencePhotos).toContain(first)
  })

  it("tras un rechazo, el reenvío conserva la evidencia rechazada y deja el motivo en la historia", async () => {
    const first = evidenceFile("rechazada.pdf")
    await markPdtpExecution(cell({ evidenceUrl: first }), USER_A, "all")
    const row = await executionRow()
    await rejectPdtpExecution(row!.id, APPROVER, "El acta no tiene firmas", "all")
    const second = evidenceFile("corregida.pdf")
    await markPdtpExecution(cell({ evidenceUrl: second }), USER_A, "all")

    const after = await executionRow()
    expect(after?.evidencePhotos).toContain(first)
    const events = await inMemoryDb.select().from(schema.operationalActivityEvents)
      .where(eq(schema.operationalActivityEvents.entityId, row!.id))
    const resubmitted = events.find((event) => event.eventType === "pdtp.execution_resubmitted")
    expect(resubmitted?.payload).toMatchObject({
      previousStatus: "rejected",
      previousRejectionReason: "El acta no tiene firmas",
      previousEvidenceUrl: first,
      previousExecutedByUserId: USER_A,
    })
    const rejected = events.find((event) => event.eventType === "pdtp.execution_rejected")
    expect(rejected?.payload).toMatchObject({ reason: "El acta no tiene firmas" })
  })

  it("aprobar y rechazar quedan en el control de cambios del programa", async () => {
    const url = evidenceFile("para-aprobar.pdf")
    await markPdtpExecution(cell({ evidenceUrl: url }), USER_A, "all")
    const row = await executionRow()
    await approvePdtpExecution(row!.id, APPROVER, "all")
    const log = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(eq(schema.pdtpChangeLog.programId, PROGRAM_ID))
    expect(log.some((entry) => entry.section === `execution:${row!.id}`)).toBe(true)
  })
})

describe("PREV-I03 — la asignación nominal se respeta al registrar", () => {
  async function assign(userId: string) {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values({
      id: `assignee-${userId}`, activityId: ACT_ID, worksiteId: WS, userId,
      validFrom: `${YEAR}-01-01`, createdAt: now, updatedAt: now,
    })
  }

  it("con una asignación vigente a otra persona, no se puede registrar", async () => {
    await assign(USER_A)
    await expect(markPdtpExecution(cell({ evidenceUrl: evidenceFile("no-asignado.pdf") }), USER_B, "all"))
      .rejects.toThrow(/asignada a otra persona/i)
  })

  it("la persona asignada sí registra", async () => {
    await assign(USER_A)
    await markPdtpExecution(cell({ evidenceUrl: evidenceFile("asignado.pdf") }), USER_A, "all")
    expect((await executionRow())?.executedByUserId).toBe(USER_A)
  })

  it("quien administra el programa puede registrar por la persona asignada", async () => {
    await assign(USER_A)
    await markPdtpExecution(cell({ evidenceUrl: evidenceFile("override.pdf") }), USER_B, "all", { canActForOthers: true })
    expect((await executionRow())?.executedByUserId).toBe(USER_B)
  })

  it("una asignación vencida ya no restringe", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values({
      id: "assignee-old", activityId: ACT_ID, worksiteId: WS, userId: USER_A,
      validFrom: `${YEAR - 1}-01-01`, validUntil: `${YEAR - 1}-12-31`, createdAt: now, updatedAt: now,
    })
    await markPdtpExecution(cell({ evidenceUrl: evidenceFile("vencida.pdf") }), USER_B, "all")
    expect((await executionRow())?.executedByUserId).toBe(USER_B)
  })
})

describe("PREV-B02 — la misma regla al reportar una obligación manual", () => {
  const EVENT_ACT_ID = `${PROGRAM_ID}-a-002`

  async function manualObligation(policy: "file_required" | "declaration_allowed") {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: EVENT_ACT_ID, programId: PROGRAM_ID, n: 2, activity: "Investigar un incidente", program: "Prevención",
      responsibleSlugs: [], responsibleDisplay: "Prevencionista", scheduleMode: "on_demand",
      scheduleClassificationStatus: "confirmed", dueDays: 5, indicatorMode: "closed_on_time", mechanism: "enganche", manualEvidencePolicy: policy,
      evidenceRequirement: "Informe de investigación",
      sourceSheetRow: 2, createdAt: now, updatedAt: now,
    })
    const { obligation } = await createPdtpObligation({
      activityId: EVENT_ACT_ID, worksiteId: WS, origin: "manual",
      manualReason: "Incidente registrado en terreno", clientRequestId: `req-${policy}`, userId: USER_A, scope: "all",
    } as Parameters<typeof createPdtpObligation>[0])
    return obligation
  }

  it("una obligación manual no se reporta con sólo una observación", async () => {
    const obligation = await manualObligation("file_required")
    await expect(reportPdtpObligation({
      obligationId: obligation.id, executedQuantity: 1, evidenceText: "Informe en carpeta", userId: USER_A, scope: "all",
    })).rejects.toThrow(/adjunta un archivo/i)
  })

  it("con la excepción declarada, la observación basta", async () => {
    const obligation = await manualObligation("declaration_allowed")
    const result = await reportPdtpObligation({
      obligationId: obligation.id, executedQuantity: 1, evidenceText: "Informe en carpeta física", userId: USER_A, scope: "all",
    })
    expect(result.execution.status).toBe("submitted")
  })
})
