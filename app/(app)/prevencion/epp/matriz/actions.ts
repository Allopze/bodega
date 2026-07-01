"use server"

import { revalidatePath } from "next/cache"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { setEppPositionEntry, logEppDelivery, acknowledgeEppDelivery } from "@/lib/services/prevention-epp-matrix"
import { eppPositionEntrySchema, eppDeliveryLogSchema, type ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/epp/matriz"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function setEppPositionEntryAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:epp_matrix:manage")) {
    return { ok: false, message: "No tienes permisos para gestionar la matriz EPP." }
  }
  const parsed = eppPositionEntrySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await setEppPositionEntry(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Entrada de matriz guardada." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar la entrada." }
  }
}

export async function logEppDeliveryAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:epp_matrix:manage")) {
    return { ok: false, message: "No tienes permisos para registrar entregas de EPP." }
  }
  const parsed = eppDeliveryLogSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await logEppDelivery(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Entrega de EPP registrada." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar la entrega." }
  }
}

export async function acknowledgeEppDeliveryAction(recambioLogId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:epp_matrix:manage")) {
    return { ok: false, message: "No tienes permisos para gestionar entregas de EPP." }
  }
  try {
    await acknowledgeEppDelivery(recambioLogId, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Acuse de recibo registrado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar el acuse de recibo." }
  }
}
