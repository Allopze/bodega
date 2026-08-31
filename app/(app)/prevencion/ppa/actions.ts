"use server"

import { safeActionMessage } from "@/lib/action-error"

import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import {
  listPpa,
  countPpa,
  getPpa,
  reviewPpa,
  declarePpaCorrection,
  verifyPpaCorrection,
  authorizePpaRestart,
  cancelPpa,
  closePpa,
  getPpaCorrectiveAction,
  revokePpaToken,
  getPpaStats,
  type PpaRow,
  type PpaStats,
} from "@/lib/services/ppa"
import {
  ppaReviewSchema,
  type ActionState,
  type PpaAuthorizeRestartInput,
  type PpaCancelInput,
  type PpaCloseInput,
  type PpaCorrectionDeclareInput,
  type PpaReviewInput,
  type PpaVerificationInput,
} from "@/lib/validation/ppa"
import { scopeToIds } from "@/lib/ppa/utils"
import { addCapaEvidence } from "@/lib/services/prevention-capa"

const REVALIDATE = "/prevencion/ppa"

function operationAccess(session: {
  user: { id: string; permissions: string[] }
}) {
  return {
    userId: session.user.id,
    worksiteIds: scopeToIds(resolveWorksiteScope(session as Parameters<typeof resolveWorksiteScope>[0])),
    permissions: session.user.permissions,
  }
}

function refreshPpa(id: string) {
  revalidateOperationalViews([REVALIDATE, `${REVALIDATE}/${id}`])
}

function failure(error: unknown, fallback: string): ActionState {
  return { ok: false, message: safeActionMessage(error, fallback) }
}

export interface PpaListClientFilters {
  estado?: string
  tipoTrabajo?: string
  worksiteId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}

export async function listPpaAction(
  filters: PpaListClientFilters = {},
  limit = 20,
  offset = 0,
): Promise<ActionState & { data?: { rows: PpaRow[]; total: number } }> {
  const { session, error } = await guardPermission("ppa:view")
  if (error) return error
  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  try {
    const f = { worksiteIds, ...filters }
    const [rows, total] = await Promise.all([listPpa(f, limit, offset), countPpa(f)])
    return { ok: true, data: { rows, total } }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al listar PPA") }
  }
}

export async function getPpaAction(
  id: string,
): Promise<ActionState & { data?: { ppa: PpaRow | null } }> {
  const { session, error } = await guardPermission("ppa:view")
  if (error) return error
  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  try {
    const ppa = await getPpa(id, worksiteIds)
    return { ok: true, data: { ppa } }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al obtener el PPA") }
  }
}

export async function reviewPpaAction(
  input: PpaReviewInput,
): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:review")
  if (error) return error

  const parsed = ppaReviewSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos del formulario.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  try {
    const updated = await reviewPpa(parsed.data, session.user.id, worksiteIds)
    refreshPpa(updated.id)

    // El trabajador ve la decisión en su página pública de resultado
    // (`/ppa/result/[token]`), que refleja el estado actual del caso. No se
    // emite notificación interna aquí: el trabajador no es usuario del sistema.

    return { ok: true, message: "Revisión registrada" }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al registrar la revisión") }
  }
}

export async function declarePpaCorrectionAction(input: PpaCorrectionDeclareInput): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:correct")
  if (error) return error
  try {
    const updated = await declarePpaCorrection(input, operationAccess(session))
    refreshPpa(updated.id)
    return { ok: true, message: "Controles enviados a verificación" }
  } catch (e) {
    return failure(e, "Error al declarar la implementación")
  }
}

export async function verifyPpaCorrectionAction(input: PpaVerificationInput): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:verify")
  if (error) return error
  try {
    const updated = await verifyPpaCorrection(input, operationAccess(session))
    refreshPpa(updated.id)
    return { ok: true, message: input.accepted ? "Corrección verificada" : "Corrección devuelta para ajuste" }
  } catch (e) {
    return failure(e, "Error al verificar la corrección")
  }
}

export async function authorizePpaRestartAction(input: PpaAuthorizeRestartInput): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:authorize_restart")
  if (error) return error
  try {
    const updated = await authorizePpaRestart(input, operationAccess(session))
    refreshPpa(updated.id)
    return { ok: true, message: "Reinicio de la tarea autorizado" }
  } catch (e) {
    return failure(e, "Error al autorizar el reinicio")
  }
}

export async function cancelPpaAction(input: PpaCancelInput): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:cancel")
  if (error) return error
  try {
    const updated = await cancelPpa(input, operationAccess(session))
    refreshPpa(updated.id)
    return { ok: true, message: "PPA cancelado con trazabilidad" }
  } catch (e) {
    return failure(e, "Error al cancelar el PPA")
  }
}

export async function addPpaEvidenceAction(input: {
  ppaId: string
  actionId: string
  expectedCapaVersion: number
  kind: "document" | "photo" | "url"
  reference: string
  description?: string
}): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:correct")
  if (error) return error
  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)
  try {
    const [ppa, linkedAction] = await Promise.all([
      getPpa(input.ppaId, worksiteIds),
      getPpaCorrectiveAction(input.ppaId, worksiteIds),
    ])
    if (!ppa || !linkedAction?.capaActionId || linkedAction.capaActionId !== input.actionId) {
      return { ok: false, message: "PPA no encontrado o fuera de tu alcance." }
    }
    await addCapaEvidence({
      input: {
        actionId: input.actionId,
        expectedVersion: input.expectedCapaVersion,
        kind: input.kind,
        reference: input.reference,
        description: input.description,
      },
      ctx: { userId: session.user.id },
      scope,
      permissions: session.user.permissions,
    })
    refreshPpa(input.ppaId)
    return { ok: true, message: "Evidencia vinculada a la acción correctiva" }
  } catch (e) {
    return failure(e, "Error al agregar la evidencia")
  }
}

export async function closePpaAction(input: PpaCloseInput): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:close")
  if (error) return error

  try {
    const updated = await closePpa(input, operationAccess(session))
    refreshPpa(updated.id)
    return { ok: true, message: "Caso cerrado" }
  } catch (e) {
    return failure(e, "Error al cerrar el caso")
  }
}

export async function getPpaStatsAction(): Promise<ActionState & { data?: { stats: PpaStats } }> {
  const { session, error } = await guardPermission("ppa:view")
  if (error) return error
  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  try {
    const stats = await getPpaStats(worksiteIds)
    return { ok: true, data: { stats } }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al obtener indicadores") }
  }
}

export async function revokePpaTokenAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:manage")
  if (error) return error
  const rawId = formData.get("id")
  const id = typeof rawId === "string" ? rawId : ""
  if (!id) return { ok: false, message: "Falta el identificador del PPA." }

  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  try {
    await revokePpaToken(id, session.user.id, worksiteIds)
    refreshPpa(id)
    return { ok: true, message: "Acceso público revocado. El enlace ya no muestra el resultado." }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al revocar el acceso público") }
  }
}
