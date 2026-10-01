"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { db } from "@/db"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskOccurrenceEvidence, preventionRiskProcesses,
  preventionRiskProgramActions, preventionRiskProgramOccurrenceRecords,
  preventionRiskProgramOccurrences, preventionRiskPrograms,
} from "@/db/schema"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import { scheduleGeneratedDocumentDrain } from "@/lib/services/generated-documents/schedule"
import { PreventionEvidenceError, storePreventionEvidence } from "@/lib/services/prevention-evidence-upload"
import { resolveRiskReviewTrigger, verifyRiskControl } from "@/lib/services/prevention-risk-legal"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { deleteMiperControl, deleteMiperEntry, duplicateMiperEntry, saveMiperControl, saveMiperEntry } from "@/lib/services/miper/entries"
import { commitRiskImport, previewRiskImport } from "@/lib/services/miper/import"
import { createMiper, discardMiperDraft, updateMiperHeader } from "@/lib/services/miper/matrices"
import { addMiperObservation, reopenMiperObservation, resolveMiperObservation, respondMiperObservation } from "@/lib/services/miper/observations"
import { applyProgramGeneration, linkActionControls, proposeProgramActions, retireProgramAction, saveProgramAction, unlinkActionControl, updateProgramHeader } from "@/lib/services/miper/program"
import { addOccurrenceEvidence, recordOccurrence, voidOccurrenceRecord, withdrawOccurrenceEvidence } from "@/lib/services/miper/program-execution"
import { getProgramWorkspace, type ProgramWorkspace } from "@/lib/services/miper/program-queries"
import { saveRiskFactor, setRiskFactorActive } from "@/lib/services/miper/risk-factors"
import { OUT_OF_SCOPE, scopeAllows, type MiperAccess, userNames } from "@/lib/services/miper/shared"
import { approveMiperFinal, approveMiperTechnicalReview, openMiperReviewRound, requestMiperCorrections, returnMiperWithObservations, submitMiperForReview } from "@/lib/services/miper/workflow"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/miper"
type Session = NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>

function accessFrom(session: Session): MiperAccess {
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

function matrixIdOf(input: unknown) {
  return typeof input === "object" && input && "matrixId" in input ? String((input as { matrixId: unknown }).matrixId) : null
}

/**
 * El error de dominio viaja con su mensaje (le dice a la persona qué hacer);
 * Zod, con sus campos; el resto se loguea y responde genérico para no filtrar
 * detalles de driver o SQL.
 */
function fail(error: unknown): ActionState {
  if (error instanceof RiskLegalDomainError) return { ok: false, message: error.message }
  // La subida de evidencia valida el tipo real y el tamaño del archivo: su
  // mensaje es lo único que le dice a la persona qué corregir.
  if (error instanceof PreventionEvidenceError) return { ok: false, message: error.message }
  if (error instanceof ZodError) return actionErrorResult(error, "Revisa los campos marcados.")
  return unexpectedActionError(error, "prevencion/miper/actions")
}

async function guarded<T>(permission: Permission, input: unknown, operation: (access: MiperAccess) => Promise<T>, options: { revalidate?: boolean; data?: (result: T) => Record<string, unknown>; success?: string | ((result: T) => string); after?: (session: Session) => Promise<void> } = {}): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    const result = await operation(accessFrom(guard.session))
    if (options.revalidate !== false) {
      revalidatePath(BASE)
      const matrixId = matrixIdOf(input)
      if (matrixId) revalidatePath(`${BASE}/${matrixId}`)
    }
    if (options.after) await options.after(guard.session)
    const data = options.data?.(result)
    const success = typeof options.success === "function" ? options.success(result) : options.success
    // El mensaje de éxito es de la acción y no genérico: con `feedback: "toast"`,
    // el hook notifica `result.message`, así que sin esto guardar antecedentes,
    // enviar a revisión y sellar una versión se anunciaban igual.
    return { ok: true, ...(success ? { message: success } : {}), ...(data ? { data } : {}) }
  } catch (error) {
    return fail(error)
  }
}

// ── Matriz ──
export async function createMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => createMiper(input, access), { data: (result) => ({ id: result.id }), success: "MIPER creada" })
}
export async function updateMiperHeaderAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => updateMiperHeader(input, access), { data: (result) => ({ version: result.version }), success: "Antecedentes guardados" })
}
export async function discardMiperDraftAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => discardMiperDraft(input, access), { success: "Borrador descartado" })
}

// ── Filas y medidas. Guardar una celda no revalida: la grilla conserva su
//    estado y sólo necesita la versión nueva. Los cambios de estructura sí. ──
export async function saveMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => saveMiperEntry(input, access), { revalidate: false, data: (result) => ({ ...result }) })
}
export async function duplicateMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => duplicateMiperEntry(input, access), { data: (result) => ({ ...result }), success: "Riesgo duplicado" })
}
export async function deleteMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => deleteMiperEntry(input, access), { success: "Riesgo eliminado" })
}
export async function saveMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => saveMiperControl(input, access), { data: (result) => ({ ...result }), success: "Medida guardada" })
}
export async function deleteMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => deleteMiperControl(input, access), { success: "Medida eliminada" })
}

// ── Flujo ──
export async function submitMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => submitMiperForReview(input, access), { success: "MIPER enviada a revisión" })
}
/** Sólo marca la apertura; el servicio ignora a quien no revisa esa etapa. */
export async function openMiperRoundAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => openMiperReviewRound({ matrixId: matrixIdOf(input) ?? "" }, access), { revalidate: false })
}
export async function returnMiperAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => returnMiperWithObservations(input, access), { success: "MIPER devuelta con observaciones" })
}
export async function approveMiperTechnicalAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => approveMiperTechnicalReview(input, access), { success: "Revisión técnica aprobada" })
}
export async function requestMiperCorrectionsAction(input: unknown) {
  return guarded("prevention:risk:approve_legal", input, (access) => requestMiperCorrections(input, access), { success: "Correcciones solicitadas" })
}
export async function approveMiperFinalAction(input: unknown) {
  // La versión sellada se arma y archiva después de responder.
  return guarded("prevention:risk:approve_legal", input, (access) => approveMiperFinal(input, access), {
    data: (result) => ({ ...result }),
    success: "Versión sellada",
    after: (session) => scheduleGeneratedDocumentDrain(session.user.id),
  })
}

// ── Observaciones: el servicio exige el permiso de la etapa observada. ──
export async function addMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => addMiperObservation(input, access), { success: "Observación registrada" })
}
export async function respondMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => respondMiperObservation(input, access), { success: "Respuesta guardada" })
}
export async function resolveMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => resolveMiperObservation(input, access), { success: "Observación resuelta" })
}
export async function reopenMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => reopenMiperObservation(input, access), { success: "Observación reabierta" })
}

// ── Catálogo ──
export async function saveRiskFactorAction(input: unknown) {
  return guarded("prevention:risk:catalog:manage", input, (access) => saveRiskFactor(input, access), { success: "Factor guardado" })
}
export async function setRiskFactorActiveAction(input: unknown) {
  return guarded("prevention:risk:catalog:manage", input, (access) => setRiskFactorActive(input, access), { success: "Estado del factor actualizado" })
}

// ── Se conservan del módulo anterior ──
export async function resolveRiskReviewTriggerAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => resolveRiskReviewTrigger(input, access), { success: "Tarea de revisión cerrada" })
}
export async function verifyRiskControlAction(input: unknown) {
  const state = await guarded("prevention:risk:edit", input, (access) => verifyRiskControl(input, access), { success: "Control verificado" })
  // La ficha del control es una ruta dinámica.
  revalidatePath(`${BASE}/controles/[id]`, "page")
  return state
}

/* ── Programa de Trabajo Preventivo RE-04.1 (F2, §7) ──────────────────────
 * Dos permisos, y la ejecución **no** se guarda con el de ejecución del
 * programa: la regla del §6.3 es «el permiso de ejecución **o** el responsable
 * nominal de la actividad con `risk:view`», y esa segunda rama la resuelve
 * `requireExecute` dentro del servicio (`program-execution.ts`), que es donde
 * el acto conoce su actividad. Guardar con `prevention:risk:program:execute`
 * dejaría fuera al responsable nominal que el modo del espacio de trabajo
 * anuncia como capaz. La lectura se guarda con `prevention:risk:view`, el mismo
 * permiso que exige `getProgramWorkspace`.
 */

/** El panel lee todo junto: actividades, medidas por fila, avance y procesos. */
type ProgramLoad = {
  workspace: ProgramWorkspace
  /** Procesos activos de la faena (`Proceso` del RE-04.1 se elige de acá). */
  processes: Array<{ id: string; name: string }>
  /** `controlId → entryId`: el vínculo a la fila del MIPER que la vista no trae. */
  controlEntryIds: Record<string, string>
  /** `actionId → processId`: sin él, editar una actividad borraría su proceso. */
  actionProcessIds: Record<string, string>
}

function stringFieldOf(input: unknown, key: string): string | null {
  if (typeof input !== "object" || !input || !(key in input)) return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

export async function loadProgramWorkspaceAction(input: unknown) {
  return guarded<ProgramLoad>("prevention:risk:view", input, async (access) => {
    const matrixId = matrixIdOf(input)
    if (!matrixId) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
    const workspace = await getProgramWorkspace(matrixId, access)
    const worksiteId = workspace.program?.worksiteId
    if (!workspace.program || !worksiteId) return { workspace, processes: [], controlEntryIds: {}, actionProcessIds: {} }
    if (!scopeAllows(access.scope, worksiteId)) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
    const controlIds = workspace.actions.flatMap((action) => action.controls.map((control) => control.id))
    const [processes, controlRows, actionRows] = await Promise.all([
      db.select({ id: preventionRiskProcesses.id, name: preventionRiskProcesses.name }).from(preventionRiskProcesses)
        .where(and(eq(preventionRiskProcesses.worksiteId, worksiteId), eq(preventionRiskProcesses.isActive, true)))
        .orderBy(asc(preventionRiskProcesses.name)),
      controlIds.length === 0
        ? Promise.resolve([] as Array<{ controlId: string; entryId: string }>)
        : db.select({ controlId: preventionRiskControls.id, entryId: preventionRiskEntries.id }).from(preventionRiskControls)
          .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
          .where(inArray(preventionRiskControls.id, controlIds)),
      db.select({ id: preventionRiskProgramActions.id, processId: preventionRiskProgramActions.processId })
        .from(preventionRiskProgramActions).where(eq(preventionRiskProgramActions.programId, workspace.program.id)),
    ])
    const controlEntryIds: Record<string, string> = {}
    for (const row of controlRows) controlEntryIds[row.controlId] = row.entryId
    const actionProcessIds: Record<string, string> = {}
    for (const row of actionRows) if (row.processId) actionProcessIds[row.id] = row.processId
    return { workspace, processes, controlEntryIds, actionProcessIds }
  }, { revalidate: false, data: (result) => ({ ...result }) })
}

/**
 * Registros y evidencia de **una** ocurrencia: ningún contrato de consulta los
 * expone —la vista del panel trae el resultado vigente y cuánta evidencia hay,
 * no los identificadores— y anular un registro o retirar un archivo exige el
 * suyo. Se lee acá, con el alcance de faena del programa.
 */
export async function loadOccurrenceDetailAction(input: unknown) {
  return guarded("prevention:risk:view", input, async (access) => {
    const occurrenceId = stringFieldOf(input, "occurrenceId")
    if (!occurrenceId) throw new RiskLegalDomainError(OUT_OF_SCOPE)
    const [context] = await db.select({
      occurrence: preventionRiskProgramOccurrences,
      program: preventionRiskPrograms,
    }).from(preventionRiskProgramOccurrences)
      .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
      .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
      .where(eq(preventionRiskProgramOccurrences.id, occurrenceId))
      .limit(1)
    if (!context || !scopeAllows(access.scope, context.program.worksiteId)) throw new RiskLegalDomainError(OUT_OF_SCOPE)

    const records = await db.select().from(preventionRiskProgramOccurrenceRecords)
      .where(eq(preventionRiskProgramOccurrenceRecords.occurrenceId, occurrenceId))
      .orderBy(desc(preventionRiskProgramOccurrenceRecords.recordedAt))
    const evidence = records.length === 0 ? [] : await db.select().from(preventionRiskOccurrenceEvidence)
      .where(inArray(preventionRiskOccurrenceEvidence.recordId, records.map((record) => record.id)))
      .orderBy(asc(preventionRiskOccurrenceEvidence.uploadedAt))
    const names = await userNames(db, [
      ...records.flatMap((record) => [record.recordedByUserId, record.voidedByUserId]),
      ...evidence.flatMap((row) => [row.uploadedByUserId, row.withdrawnByUserId]),
    ])
    return {
      occurrenceId,
      currentRecordId: context.occurrence.currentRecordId,
      records: records.map((record) => ({
        id: record.id,
        outcome: record.outcome,
        effectiveOn: record.effectiveOn,
        late: record.late,
        reason: record.reason,
        notes: record.notes,
        recordedAt: record.recordedAt,
        recordedByName: names.get(record.recordedByUserId) ?? null,
        voidedAt: record.voidedAt,
        voidReason: record.voidReason,
        voidedByName: record.voidedByUserId ? names.get(record.voidedByUserId) ?? null : null,
        evidence: evidence.filter((row) => row.recordId === record.id).map((row) => ({
          id: row.id,
          evidenceUploadId: row.evidenceUploadId,
          fileName: row.evidenceUploadId.split("/").pop() ?? row.evidenceUploadId,
          description: row.description,
          uploadedAt: row.uploadedAt,
          uploadedByName: row.uploadedByUserId ? names.get(row.uploadedByUserId) ?? null : null,
          withdrawnAt: row.withdrawnAt,
          withdrawReason: row.withdrawReason,
        })),
      })),
    }
  }, { revalidate: false, data: (result) => ({ ...result }) })
}

/** Encabezado RE-04.1: mismo contrato de versión que los antecedentes de la matriz. */
export async function saveProgramHeaderAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => updateProgramHeader(input, access), {
    data: (result) => ({ version: result.version }),
    success: "Antecedentes del programa guardados",
  })
}

export async function saveProgramActionAction(input: unknown) {
  const editing = stringFieldOf(input, "actionId") !== null
  return guarded("prevention:risk:edit", input, (access) => saveProgramAction(input, access), {
    data: (result) => ({ ...result }),
    success: editing ? "Actividad actualizada" : "Actividad agregada",
  })
}

export async function retireProgramActionAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => retireProgramAction(input, access), { success: "Actividad retirada" })
}

export async function linkProgramControlsAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => linkActionControls(input, access), { success: "Medida vinculada a la actividad" })
}

export async function unlinkProgramControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => unlinkActionControl(input, access), { success: "Medida desvinculada de la actividad" })
}

/** Sólo lectura salvo el `ensureProgram` idempotente: no revalida la página. */
export async function proposeProgramActionsAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => proposeProgramActions(input, access), { revalidate: false, data: (result) => ({ ...result }) })
}

export async function applyProgramGenerationAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => applyProgramGeneration(input, access), {
    data: (result) => ({ ...result }),
    success: (result) => (result.created + result.linked === 0
      ? "Sin cambios: esas medidas ya tenían actividad"
      : `Programa generado: ${result.created} actividad(es) creada(s) y ${result.linked} medida(s) asociada(s)`),
  })
}

export async function recordOccurrenceAction(input: unknown) {
  // El mensaje nombra el acto registrado: «no se hizo» no se anuncia igual que
  // «se hizo», y el avance que se recalcula tampoco.
  const notDone = stringFieldOf(input, "outcome") === "not_done"
  return guarded("prevention:risk:view", input, (access) => recordOccurrence(input, access), {
    data: (result) => ({ ...result }),
    success: notDone ? "Ocurrencia registrada: no se hizo" : "Ocurrencia registrada: se hizo",
  })
}

export async function voidOccurrenceRecordAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => voidOccurrenceRecord(input, access), { success: "Avance actualizado: registro anulado" })
}

export async function addOccurrenceEvidenceAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => addOccurrenceEvidence(input, access), {
    data: (result) => ({ ...result }),
    success: "Evidencia agregada",
  })
}

export async function withdrawOccurrenceEvidenceAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => withdrawOccurrenceEvidence(input, access), { success: "Evidencia retirada" })
}

/**
 * Sube el archivo de la evidencia al almacenamiento con el dominio `miper`
 * (§7.6: PDF, JPEG, PNG, Word y Excel) y devuelve la ruta con la que el registro
 * la acredita. Es el paso previo de `recordOccurrenceAction` /
 * `addOccurrenceEvidenceAction`: reclamar la ruta para la faena exige que el
 * archivo lo haya subido la misma persona y que exista.
 *
 * El permiso es `risk:view` porque quien ejecuta sin el permiso del programa
 * —el responsable nominal— también adjunta evidencia; el vínculo real lo vuelve
 * a autorizar el servicio al acreditarla contra su registro.
 */
export async function uploadProgramEvidenceAction(form: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:view")
  if (guard.error) return guard.error
  try {
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Adjunta el archivo de la evidencia." }
    const uploaded = await storePreventionEvidence({
      domain: "miper",
      fileName: file.name,
      fileSize: file.size,
      buffer: new Uint8Array(await file.arrayBuffer()),
      uploadedByUserId: guard.session.user.id,
    })
    return { ok: true, message: "Archivo subido", data: { ...uploaded } }
  } catch (error) {
    return fail(error)
  }
}

/* ── Importación del RE-04 real (§9.3, F3) ────────────────────────────────
 * Dos pasos: la vista previa lee el `.xlsx` en memoria —no se guarda en ningún
 * directorio— y congela el lote; la carga escribe las filas que pasaron los
 * problemas por fila. La vista previa recibe `FormData` porque el archivo viaja
 * como `File`; la carga es un objeto normal y entra por `guarded`, que aplica el
 * RBAC y traduce los errores de dominio igual que el resto del módulo.
 */

/** Campo de texto de un `FormData`: cadena vacía y archivo no cuentan. */
const formText = (value: FormDataEntryValue | null) => (typeof value === "string" && value.length > 0 ? value : null)

export async function previewRiskImportAction(form: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  try {
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Adjunta el archivo del RE-04 en formato Excel (.xlsx)." }
    const period = formText(form.get("period"))
    const preview = await previewRiskImport(new Uint8Array(await file.arrayBuffer()), {
      worksiteId: formText(form.get("worksiteId")) ?? "",
      target: formText(form.get("target")) === "live" ? "live" : "draft",
      ...(period ? { period: Number(period) } : {}),
      fileName: file.name,
    }, accessFrom(guard.session))
    return {
      ok: true,
      message: `RE-04 leído: ${preview.totals.total} fila(s), ${preview.totals.ready} lista(s) para cargar`,
      data: { preview },
    }
  } catch (error) {
    return fail(error)
  }
}

export async function commitRiskImportAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => commitRiskImport(input, access), {
    data: (result) => ({ matrixId: result.matrixId, created: result.created, skipped: result.skipped }),
    success: (result) => result.created === 0
      ? "No se cargó ninguna fila: revisa los problemas por fila."
      : `${result.created} fila(s) cargada(s)${result.skipped > 0 ? ` y ${result.skipped} detenida(s)` : ""}`,
  })
}
