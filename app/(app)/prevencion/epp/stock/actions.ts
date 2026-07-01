"use server"

import { revalidatePath } from "next/cache"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { setEppStockThreshold } from "@/lib/services/prevention-epp-matrix"
import { eppStockThresholdSchema, type ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/epp/stock"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function setEppStockThresholdAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:epp_stock:manage")) {
    return { ok: false, message: "No tienes permisos para configurar el stock EPP." }
  }
  const parsed = eppStockThresholdSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await setEppStockThreshold(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Umbral de stock guardado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar el umbral." }
  }
}
