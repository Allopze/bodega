"use server"

import { revalidatePath } from "next/cache"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createIperMatrix,
  addIperRiskItem,
  listIperMatrices,
  listIperRiskItems,
  closeIperMatrix,
} from "@/lib/services/prevention-iper"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/iper"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listIperMatricesAction(): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  try {
    const items = await listIperMatrices(scopeToIds(resolveWorksiteScope(session)))
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function listIperRiskItemsAction(
  matrixId: string,
): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  try {
    const items = await listIperRiskItems(matrixId, scopeToIds(resolveWorksiteScope(session)))
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function createIperMatrixAction(
  input: Parameters<typeof createIperMatrix>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:iper:manage")) {
    return { ok: false, message: "No tienes permisos para crear matrices IPER." }
  }
  try {
    const row = await createIperMatrix(input, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function addIperRiskItemAction(
  input: Parameters<typeof addIperRiskItem>[0],
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:iper:manage")) {
    return { ok: false, message: "No tienes permisos para registrar riesgos IPER." }
  }
  try {
    await addIperRiskItem(input, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function closeIperMatrixAction(matrixId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:iper:manage")) {
    return { ok: false, message: "No tienes permisos para cerrar matrices IPER." }
  }
  try {
    await closeIperMatrix(matrixId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}