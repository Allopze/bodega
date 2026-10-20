"use server"

import { actionErrorResult } from "@/lib/actions/action-error-result"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { ActionState } from "@/lib/validation/masters"
import {
  addPreventionIncidentEvidence,
  authorizePreventionIncidentRestart,
  classifyIncidentPersonForIndicators,
  confirmIncidentDiffusion,
  createCapaFromRe20Measure,
  createPreliminaryReport,
  createPreventionIncidentCapa,
  markIncidentDiffusion,
  publishOnePageDiffusion,
  recordBiweeklyFollowup,
  recordIncidentStatement,
  recordPreventionIncidentNotification,
  reviewPreventionIncidentRe20Quality,
  reportPreventionIncident,
  savePreventionIncidentRe20Policy,
  savePreventionIncidentRe20CatalogOption,
  savePreventionIncidentRe20Workspace,
  savePreventionIncidentPersonSensitive,
  transitionPreventionIncident,
  triagePreventionIncident,
  type IncidentStatus,
} from "@/lib/services/prevention-incidents"
import { scheduleGeneratedDocumentDrain } from "@/lib/services/generated-documents/schedule"
import { convertPublicIncidentReport, discardPublicIncidentReport } from "@/lib/services/prevention-incident-reports"

const ROOT = "/prevencion/incidentes"

function access(session: NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>) {
  return {
    ctx: { userId: session.user.id },
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
    roles: session.user.roles ?? [],
  }
}

function fail(error: unknown, fallback: string): ActionState {
  return actionErrorResult(error, fallback)
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
    // El expediente cerrado se arma y se sube a Cloudreve después de responder.
    if (incident.status === "closed") await scheduleGeneratedDocumentDrain(guard.session.user.id)
    return { ok: true, message: "Estado del incidente actualizado" }
  } catch (error) {
    return fail(error, "No se pudo actualizar el incidente")
  }
}

export async function savePreventionIncidentRe20WorkspaceAction(input: unknown): Promise<ActionState & { version?: number; idempotentReplay?: boolean }> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await savePreventionIncidentRe20Workspace({ input, access: access(guard.session) })
    refresh(result.incidentId)
    return { ok: true, message: result.idempotentReplay ? "El guardado RE-20 ya estaba sincronizado" : "Expediente RE-20 guardado", version: result.workspace.version, idempotentReplay: result.idempotentReplay }
  } catch (error) {
    return fail(error, "No se pudo guardar el expediente RE-20")
  }
}

export async function reviewPreventionIncidentRe20QualityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:review_quality")
  if (guard.error) return guard.error
  try {
    await reviewPreventionIncidentRe20Quality({ input, access: access(guard.session) })
    const incidentId = typeof input === "object" && input !== null && "incidentId" in input ? String(input.incidentId) : undefined
    refresh(incidentId)
    return { ok: true, message: "Revisión de calidad RE-20 registrada" }
  } catch (error) {
    return fail(error, "No se pudo registrar la revisión de calidad")
  }
}

export async function savePreventionIncidentRe20PolicyAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:configure_re20")
  if (guard.error) return guard.error
  try {
    await savePreventionIncidentRe20Policy({ input, access: access(guard.session) })
    revalidatePath(ROOT)
    return { ok: true, message: "Plazos internos RE-20 actualizados para nuevos expedientes" }
  } catch (error) {
    return fail(error, "No se pudo guardar la política RE-20")
  }
}

export async function savePreventionIncidentRe20CatalogOptionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:configure_re20")
  if (guard.error) return guard.error
  try {
    await savePreventionIncidentRe20CatalogOption({ input, access: access(guard.session) })
    revalidatePath(ROOT)
    return { ok: true, message: "Catálogo RE-20 actualizado" }
  } catch (error) {
    return fail(error, "No se pudo actualizar el catálogo RE-20")
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

/** Medida RE-20 → CAPA: crea la acción y deja su vínculo (`capaId`) en el expediente con la misma versión optimista. */
export async function createCapaFromRe20MeasureAction(input: {
  incidentId: string
  measureId: string
  expectedWorkspaceVersion: number
}): Promise<ActionState & { version?: number; capaId?: string }> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await createCapaFromRe20Measure({ input, access: access(guard.session) })
    refresh(input.incidentId)
    revalidatePath("/prevencion/capa")
    return { ok: true, message: `CAPA ${result.capa.code} creada y vinculada a la medida`, version: result.workspaceVersion, capaId: result.capa.id }
  } catch (error) {
    return fail(error, "No se pudo crear la CAPA desde la medida")
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
  purpose: string
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

/** ONE PAGE RE-20-06. Sin textos explícitos se genera desde el expediente (medidas, causas raíz); exige revisión aprobada. */
export async function publishOnePageDiffusionAction(args: {
  incidentId: string
  onePageSummary?: string
  rootCauseText?: string
  actionPlanSummary?: string
  learning?: string
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

/** Seguimiento de medidas (RE-20-08 accidente / RE-20-09 daño) con estado triple implementada / verificada / eficaz. */
export async function recordBiweeklyFollowupAction(args: {
  incidentId: string
  followupDate: string
  note: string
  evidenceRef?: string
  kind?: "accident" | "damage"
  measureId?: string
  rootCauseId?: string
  controlType?: string
  verifierUserId?: string
  verifiedAt?: string
  residualRisk?: string
  implementedAt?: string
  verified?: boolean
  effective?: boolean
  lostDays?: number
  lossDescription?: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:investigate")
  if (guard.error) return guard.error
  try {
    const result = await recordBiweeklyFollowup({ ...args, access: access(guard.session) })
    refresh(args.incidentId)
    return {
      ok: true,
      message: result.idempotentReplay ? "El seguimiento ya estaba registrado" : "Seguimiento registrado y acreditado en PDTP",
    }
  } catch (error) {
    return fail(error, "No se pudo registrar el seguimiento")
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
  // `diffuse`, no `close`: confirmar que la difusión ocurrió es el acto que
  // acredita la n=71 y la n=75, y su responsable declarado es el jefe de
  // terreno. Cerrar el incidente es otra cosa, con otras compuertas.
  const guard = await guardPermission("prevention:incidents:diffuse")
  if (guard.error) return guard.error
  try {
    await confirmIncidentDiffusion({ diffusionId: args.diffusionId, access: access(guard.session) })
    refresh(args.incidentId)
    return { ok: true, message: "Difusión confirmada y acreditada en PDTP" }
  } catch (error) {
    return fail(error, "No se pudo confirmar la difusión")
  }
}

/**
 * Ficha reservada de una persona del incidente. Mismo permiso que abrir la
 * vista reservada: quien no puede leer esos datos tampoco los escribe.
 */
export async function savePreventionIncidentPersonSensitiveAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:view_sensitive")
  if (guard.error) return guard.error
  try {
    const result = await savePreventionIncidentPersonSensitive({ input, access: access(guard.session) })
    refresh(result.incidentId)
    return { ok: true, message: result.action === "create" ? "Ficha reservada registrada" : "Ficha reservada actualizada" }
  } catch (error) {
    return fail(error, "No se pudo guardar la ficha reservada")
  }
}

/*
 * Buzón del canal del trabajador. Decidir si un reporte es un incidente es el
 * mismo acto que clasificar uno: `prevention:incidents:triage`. El servicio
 * vuelve a comprobar el permiso y la faena del reporte.
 */
export async function convertPublicIncidentReportAction(input: unknown): Promise<ActionState & { incidentId?: string }> {
  const guard = await guardPermission("prevention:incidents:triage")
  if (guard.error) return guard.error
  try {
    const result = await convertPublicIncidentReport({ input, access: access(guard.session) })
    refresh(result.incident.id)
    return { ok: true, message: `Incidente ${result.incident.code} abierto desde el reporte`, incidentId: result.incident.id }
  } catch (error) {
    return fail(error, "No se pudo abrir el incidente desde el reporte")
  }
}

export async function discardPublicIncidentReportAction(args: { reportId: string; reason: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:incidents:triage")
  if (guard.error) return guard.error
  try {
    await discardPublicIncidentReport({ reportId: args.reportId, reason: args.reason, access: access(guard.session) })
    refresh()
    return { ok: true, message: "Reporte descartado" }
  } catch (error) {
    return fail(error, "No se pudo descartar el reporte")
  }
}
