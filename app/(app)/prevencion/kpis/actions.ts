"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { setLaborHours } from "@/lib/services/prevention-kpis"
import { laborHoursSetSchema, type ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/kpis"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function setLaborHoursAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:kpis:manage")
  if (error) return error
  const parsed = laborHoursSetSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await setLaborHours(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Horas hombre registradas." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar las horas hombre." }
  }
}
