"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { alcoholTestSchema, type ActionState } from "@/lib/validation/prevention"
import {
  registerAlcoholTest,
  markAlcoholTestSent,
  suggestRandomWorkersForTest,
} from "@/lib/services/prevention-alcohol-tests"

const REVALIDATE = "/prevencion/alcotest"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function registerAlcoholTestAction(
  input: Parameters<typeof alcoholTestSchema.parse>[0],
): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:alcohol_tests:manage")
  if (error) return error
  const scope = scopeToIds(resolveWorksiteScope(session))
  try {
    const result = await registerAlcoholTest(input, session.user.id, scope)
    revalidatePath(REVALIDATE)
    if (result && typeof result === "object" && "result" in result && (result as { result: string }).result === "positivo") {
      return { ok: true, message: "Test positivo registrado. Escalar al prevencionista para suspender el turno." }
    }
    return { ok: true, message: "Test registrado." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function markAlcoholTestSentAction(testId: string): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:alcohol_tests:manage")
  if (error) return error
  const scope = scopeToIds(resolveWorksiteScope(session))
  try {
    await markAlcoholTestSent(testId, scope)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function suggestRandomWorkersAction(
  worksiteId: string,
  n: number,
): Promise<ActionState & { data?: { workers: { id: string; firstName: string; lastName: string; rut: string | null }[] } }> {
  const { session, error } = await guardPermission("prevention:alcohol_tests:manage")
  if (error) return error
  try {
    const workers = await suggestRandomWorkersForTest(worksiteId, scopeToIds(resolveWorksiteScope(session)), n)
    return { ok: true, data: { workers } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al sugerir trabajadores." }
  }
}
