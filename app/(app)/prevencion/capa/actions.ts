"use server"

import { safeActionMessage } from "@/lib/action-error"

import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { parseZ } from "@/lib/actions/parse-z"
import type { ActionState } from "@/lib/validation/masters"
import {
  addCapaEvidence,
  capaManualCreateSchema,
  createManualCapaAction,
  addCapaFollowup,
  capaEvidenceSchema,
  capaTransitionSchema,
  reconcileCapaAction,
  transitionCapaAction,
  updateCapaAction,
  type CapaStatus,
} from "@/lib/services/prevention-capa"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

const REVALIDATE = "/prevencion/capa"

function refresh(actionId: string) {
  revalidateOperationalViews([REVALIDATE, `${REVALIDATE}/${actionId}`])
}

function fail(error: unknown, fallback: string): ActionState {
  return { ok: false, message: safeActionMessage(error, fallback) }
}

function permissionForTransition(target: CapaStatus) {
  if (target === "verified" || target === "reopened") return "prevention:capa:verify" as const
  if (target === "closed") return "prevention:capa:close" as const
  if (target === "in_progress" || target === "pending_verification") return "prevention:capa:complete" as const
  return "prevention:capa:manage" as const
}

export async function transitionCapaActionAction(input: {
  actionId: string
  expectedVersion: number
  toStatus: CapaStatus
  reason?: string
  effectivenessStatus?: "effective" | "ineffective" | "not_required"
  effectivenessAssessment?: string
  segregationExceptionReason?: string
}): Promise<ActionState> {
  const guard = await guardPermission(permissionForTransition(input.toStatus))
  if (guard.error) return guard.error
  // Validado DESPUÉS del guard de permiso (no antes) para no exponer
  // detalles de validación a quien no tiene permiso sobre esta transición.
  const parsed = parseZ(capaTransitionSchema, input)
  if (!parsed.ok) return parsed
  try {
    await transitionCapaAction({
      input: parsed.data,
      ctx: { userId: guard.session.user.id },
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    refresh(input.actionId)
    return { ok: true, message: "Estado CAPA actualizado" }
  } catch (error) {
    return fail(error, "No se pudo actualizar el estado CAPA")
  }
}

/**
 * E2E-006 (auditoría 2026-09-14) — La pantalla de CAPA no tenía creación.
 *
 * Sus cinco acciones eran transitar, agregar evidencia, agregar seguimiento,
 * actualizar y conciliar: toda acción correctiva nacía en otro módulo. Una
 * observación de un recorrido o un compromiso de una reunión obligaban a
 * inventar antes un registro de origen. El enum de la base ya tenía `manual` y
 * nadie lo escribía; ésta es la puerta que faltaba.
 */
export async function createManualCapaActionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:capa:manage")
  if (guard.error) return guard.error
  const parsed = parseZ(capaManualCreateSchema, input)
  if (!parsed.ok) return parsed
  try {
    const created = await createManualCapaAction({
      input: parsed.data,
      ctx: { userId: guard.session.user.id },
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidateOperationalViews([REVALIDATE])
    return { ok: true, message: `Acción ${created.code} creada`, data: { id: created.id, code: created.code } }
  } catch (error) {
    return fail(error, "No se pudo crear la acción correctiva")
  }
}

export async function addCapaEvidenceAction(input: {
  actionId: string
  expectedVersion: number
  kind: "document" | "photo" | "url" | "note"
  reference: string
  description?: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:capa:complete")
  if (guard.error) return guard.error
  const parsed = parseZ(capaEvidenceSchema, input)
  if (!parsed.ok) return parsed
  try {
    await addCapaEvidence({
      input: parsed.data,
      ctx: { userId: guard.session.user.id },
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    refresh(input.actionId)
    return { ok: true, message: "Evidencia CAPA registrada" }
  } catch (error) {
    return fail(error, "No se pudo registrar la evidencia")
  }
}

export async function addCapaFollowupAction(input: {
  actionId: string
  expectedVersion: number
  note: string
  progress?: number
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:capa:manage")
  if (guard.error) return guard.error
  try {
    await addCapaFollowup({
      input,
      ctx: { userId: guard.session.user.id },
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    refresh(input.actionId)
    return { ok: true, message: "Seguimiento CAPA registrado" }
  } catch (error) {
    return fail(error, "No se pudo registrar el seguimiento")
  }
}

export async function updateCapaActionAction(input: {
  actionId: string
  expectedVersion: number
  finding?: string
  immediateMeasure?: string | null
  rootCause?: string | null
  actionDescription?: string
  responsibleUserId?: string | null
  responsibleSnapshot?: string | null
  responsibleRole?: string | null
  priority?: "low" | "medium" | "high" | "critical"
  targetDate?: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:capa:manage")
  if (guard.error) return guard.error
  try {
    await updateCapaAction({
      input,
      ctx: { userId: guard.session.user.id },
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    refresh(input.actionId)
    return { ok: true, message: "CAPA actualizada" }
  } catch (error) {
    return fail(error, "No se pudo actualizar la CAPA")
  }
}

export async function reconcileCapaActionAction(input: {
  actionId: string
  expectedVersion: number
  responsibleUserId: string | null
  status: "reconciled" | "needs_assignment" | "needs_evidence" | "needs_review"
  reason: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:capa:reconcile")
  if (guard.error) return guard.error
  try {
    await reconcileCapaAction({
      input,
      ctx: { userId: guard.session.user.id },
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    refresh(input.actionId)
    return { ok: true, message: "Conciliación CAPA registrada" }
  } catch (error) {
    return fail(error, "No se pudo conciliar la CAPA")
  }
}
