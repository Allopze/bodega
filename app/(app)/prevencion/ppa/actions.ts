"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  listPpa,
  getPpa,
  reviewPpa,
  getPpaStats,
  type PpaRow,
  type PpaStats,
} from "@/lib/services/ppa"
import { ppaReviewSchema, type ActionState, type PpaReviewInput } from "@/lib/validation/ppa"
import { notifyAfterCommit, notifySafe } from "@/lib/services/notifications"
import type { WorksiteScope } from "@/lib/auth/scope"

const REVALIDATE = "/prevencion/ppa"

function scopeToIds(scope: WorksiteScope): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listPpaAction(
  filters?: { estado?: string; tipoTrabajo?: string; workerId?: string },
  limit = 50,
  offset = 0,
): Promise<ActionState & { data?: { rows: PpaRow[] } }> {
  const { session, error } = await guardPermission("ppa:view")
  if (error) return error
  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  try {
    const rows = await listPpa({ worksiteIds, ...filters }, limit, offset)
    return { ok: true, data: { rows } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al listar PPA" }
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
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener el PPA" }
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
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${updated.id}`)

    // Trazabilidad: notificación interna de la decisión (vista del responsable).
    notifyAfterCommit(async () => {
      const isAuth = updated.decision === "autorizado"
      await notifySafe({
        userId:     session.user.id,
        type:       isAuth ? "ppa_authorized" : "ppa_rejected",
        title:      isAuth ? "PPA autorizado" : "PPA resuelto",
        body:       `${updated.workerName} — ${updated.estado}.`,
        entityType: "ppa",
        entityId:   updated.id,
        entityHref: `${REVALIDATE}/${updated.id}`,
      })
    })

    return { ok: true, message: "Revisión registrada" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar la revisión" }
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
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener indicadores" }
  }
}
