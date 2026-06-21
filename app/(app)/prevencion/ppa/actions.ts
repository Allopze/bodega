"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  listPpa,
  countPpa,
  getPpa,
  reviewPpa,
  closePpa,
  getPpaStats,
  type PpaRow,
  type PpaStats,
} from "@/lib/services/ppa"
import { ppaReviewSchema, type ActionState, type PpaReviewInput } from "@/lib/validation/ppa"
import { scopeToIds } from "@/lib/ppa/utils"

const REVALIDATE = "/prevencion/ppa"

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

    // El trabajador ve la decisión en su página pública de resultado
    // (`/ppa/result/[token]`), que refleja el estado actual del caso. No se
    // emite notificación interna aquí: el trabajador no es usuario del sistema.

    return { ok: true, message: "Revisión registrada" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar la revisión" }
  }
}

export async function closePpaAction(id: string): Promise<ActionState> {
  const { session, error } = await guardPermission("ppa:review")
  if (error) return error
  if (!id) return { ok: false, message: "Falta el identificador del PPA." }

  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  try {
    await closePpa(id, worksiteIds)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${id}`)
    return { ok: true, message: "Caso cerrado" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al cerrar el caso" }
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
