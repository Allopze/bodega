"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { ActionState } from "@/lib/validation/masters"
import {
  addPreventionIncidentEvidence,
  authorizePreventionIncidentRestart,
  classifyIncidentPersonForIndicators,
  confirmIncidentDiffusion,
  createPreliminaryReport,
  createPreventionIncidentCapa,
  markIncidentDiffusion,
  publishOnePageDiffusion,
  recordBiweeklyFollowup,
  recordIncidentStatement,
  recordPreventionIncidentNotification,
  reportPreventionIncident,
  savePreventionIncidentInvestigation,
  transitionPreventionIncident,
  triagePreventionIncident,
  type IncidentStatus,
} from "@/lib/services/prevention-incidents"

const ROOT = "/prevencion/incidentes"

function access(session: NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>) {
  return {
    ctx: { userId: session.user.id },
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
}

function fail(error: unknown, fallback: string): ActionState {
  return { ok: false, message: error instanceof Error ? error.message : fallback }
}

function refresh(incidentId?: string) {
  revalidatePath(ROOT)
  if (incidentId) revalidatePath(`${ROOT}/${incidentId}`)
}

export async function reportPreventionIncidentAction(input: unknown): Promise<ActionState & { incidentId?: string; idempotentReplay?: boolean }> {
  const guard = await guardPermission("prevention:incidents:report")
  if (guard.error) return guard.error
  try {
    const result = await reportPreventionIncident({ input, access: access(guard.session) })
    refresh(result.incident.id)
    return {
      ok: true,
      message: result.idempotentReplay ? "El reporte ya estaba sincronizado" : "Incidente reportado",
      incidentId: result.incident.id,
      idempotentReplay: result.idempotentReplay,
    }
  } catch (error) {
    return fail(error, "No se pudo reportar el incidente")
  }
}

export async function triagePreventionIncidentAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:triage")
  if (guard.error) return guard.error
  try {
    const incident = await triagePreventionIncident({ input, access: access(guard.session) })
    refresh(incident.id)
    return { ok: true, message: "Triage registrado" }
  } catch (error) {
    return fail(error, "No se pudo registrar el triage")
  }
}

function permissionForTransition(status: IncidentStatus) {
  if (status === "closed") return "prevention:incidents:close" as const
  if (["under_investigation", "pending_capa", "pending_verification"].includes(status)) return "prevention:incidents:investigate" as const
  return "prevention:incidents:triage" as const
}

export async function transitionPreventionIncidentAction(input: {
  incidentId: string
  expectedVersion: number
  toStatus: IncidentStatus
  reason: string
}): Promise<ActionState> {
  const guard = await guardPermission(permissionForTransition(input.toStatus))
  if (guard.error) return guard.error
  try {
    const incident = await transitionPreventionIncident({ input, access: access(guard.session) })
    refresh(incident.id)
    return { ok: true, message: "Estado del incidente actualizado" }
  } catch (error) {
    return fail(error, "No se pudo actualizar el incidente")
  }
}

export async function savePreventionIncidentInvestigationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await savePreventionIncidentInvestigation({ input, access: access(guard.session) })
    refresh(result.incident.id)
    return { ok: true, message: "Investigación guardada" }
  } catch (error) {
    return fail(error, "No se pudo guardar la investigación")
  }
}

export async function addPreventionIncidentEvidenceAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await addPreventionIncidentEvidence({ input, access: access(guard.session) })
    refresh(result.incident.id)
    return { ok: true, message: "Evidencia registrada" }
  } catch (error) {
    return fail(error, "No se pudo registrar la evidencia")
  }
}

export async function recordPreventionIncidentNotificationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:notify")
  if (guard.error) return guard.error
  try {
    const incident = await recordPreventionIncidentNotification({ input, access: access(guard.session) })
    refresh(incident.id)
    return { ok: true, message: "Presentación registrada con evidencia" }
  } catch (error) {
    return fail(error, "No se pudo registrar la presentación")
  }
}

export async function authorizePreventionIncidentRestartAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:authorize_restart")
  if (guard.error) return guard.error
  try {
    const incident = await authorizePreventionIncidentRestart({ input, access: access(guard.session) })
    refresh(incident.id)
    return { ok: true, message: "Reinicio autorizado" }
  } catch (error) {
    return fail(error, "No se pudo autorizar el reinicio")
  }
}

export async function createPreventionIncidentCapaAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await createPreventionIncidentCapa({ input, access: access(guard.session) })
    refresh(result.incident.id)
    revalidatePath("/prevencion/capa")
    return { ok: true, message: `CAPA ${result.capa.code} creada` }
  } catch (error) {
    return fail(error, "No se pudo crear la CAPA")
  }
}

export async function classifyIncidentPersonForIndicatorsAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await classifyIncidentPersonForIndicators({ input, access: access(guard.session) })
    refresh(result.incident.id)
    revalidatePath("/prevencion/indicadores")
    return { ok: true, message: "Clasificación para indicadores actualizada" }
  } catch (error) {
    return fail(error, "No se pudo actualizar la clasificación")
  }
}

export async function createPreliminaryReportAction(args: { incidentId: string; preliminaryReportText: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await createPreliminaryReport({ ...args, access: access(guard.session) })
    refresh(result.incidentId)
    return { ok: true, message: "Informe preliminar (3h) registrado y acreditado en PDTP" }
  } catch (error) {
    return fail(error, "No se pudo registrar el informe preliminar")
  }
}

export async function recordIncidentStatementAction(args: {
  incidentId: string
  kind: "involved" | "witness" | "cphs"
  deponentName: string
  deponentRole?: string
  statementText: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    await recordIncidentStatement({ ...args, access: access(guard.session) })
    refresh(args.incidentId)
    return { ok: true, message: "Declaración firmada registrada y acreditada en PDTP" }
  } catch (error) {
    return fail(error, "No se pudo registrar la declaración")
  }
}

export async function publishOnePageDiffusionAction(args: {
  incidentId: string
  onePageSummary: string
  rootCauseText: string
  actionPlanSummary: string
  evidenceRef?: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    await publishOnePageDiffusion({ ...args, access: access(guard.session) })
    refresh(args.incidentId)
    return { ok: true, message: "ONE PAGE RE-20-06 publicado y acreditado en PDTP" }
  } catch (error) {
    return fail(error, "No se pudo publicar el ONE PAGE")
  }
}

export async function recordBiweeklyFollowupAction(args: {
  incidentId: string
  followupDate: string
  note: string
  evidenceRef?: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    await recordBiweeklyFollowup({ ...args, access: access(guard.session) })
    refresh(args.incidentId)
    return { ok: true, message: "Seguimiento quincenal registrado y acreditado en PDTP" }
  } catch (error) {
    return fail(error, "No se pudo registrar el seguimiento quincenal")
  }
}

export async function markIncidentDiffusionAction(args: {
  incidentId: string
  kind: "shift" | "corrective_measures"
  summary: string
  evidenceRef?: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    await markIncidentDiffusion({ ...args, access: access(guard.session) })
    refresh(args.incidentId)
    return { ok: true, message: "Difusión marcada; queda pendiente de confirmación del supervisor" }
  } catch (error) {
    return fail(error, "No se pudo marcar la difusión")
  }
}

export async function confirmIncidentDiffusionAction(args: { incidentId: string; diffusionId: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:close")
  if (guard.error) return guard.error
  try {
    await confirmIncidentDiffusion({ diffusionId: args.diffusionId, access: access(guard.session) })
    refresh(args.incidentId)
    return { ok: true, message: "Difusión confirmada y acreditada en PDTP" }
  } catch (error) {
    return fail(error, "No se pudo confirmar la difusión")
  }
}




