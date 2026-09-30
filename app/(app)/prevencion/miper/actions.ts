"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import { scheduleGeneratedDocumentDrain } from "@/lib/services/generated-documents/schedule"
import { resolveRiskReviewTrigger, verifyRiskControl } from "@/lib/services/prevention-risk-legal"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { deleteMiperControl, deleteMiperEntry, duplicateMiperEntry, saveMiperControl, saveMiperEntry } from "@/lib/services/miper/entries"
import { createMiper, discardMiperDraft, updateMiperHeader } from "@/lib/services/miper/matrices"
import { addMiperObservation, reopenMiperObservation, resolveMiperObservation, respondMiperObservation } from "@/lib/services/miper/observations"
import { saveRiskFactor, setRiskFactorActive } from "@/lib/services/miper/risk-factors"
import type { MiperAccess } from "@/lib/services/miper/shared"
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
  if (error instanceof ZodError) return actionErrorResult(error, "Revisa los campos marcados.")
  return unexpectedActionError(error, "prevencion/miper/actions")
}

async function guarded<T>(permission: Permission, input: unknown, operation: (access: MiperAccess) => Promise<T>, options: { revalidate?: boolean; data?: (result: T) => Record<string, unknown>; success?: string; after?: (session: Session) => Promise<void> } = {}): Promise<ActionState> {
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
    // El mensaje de éxito es de la acción y no genérico: con `feedback: "toast"`,
    // el hook notifica `result.message`, así que sin esto guardar antecedentes,
    // enviar a revisión y sellar una versión se anunciaban igual.
    return { ok: true, ...(options.success ? { message: options.success } : {}), ...(data ? { data } : {}) }
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
