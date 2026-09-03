"use server"

import { ZodError } from "zod"
import { safeActionMessage } from "@/lib/action-error"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  recordAlcoholTest,
  recordAlcoholTestDispatch,
} from "@/lib/services/prevention-alcotest"
import type { WorksiteScope } from "@/lib/services/pdtp/helpers"
import {
  alcoholTestDispatchSchema,
  alcoholTestRegisterSchema,
  type ActionState,
} from "@/lib/validation/prevention"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

function scopeFromSession(session: NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>): WorksiteScope {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
}

async function run(
  permission: "prevention:alcotest:register" | "prevention:alcotest:dispatch",
  operation: (context: { userId: string; roles: string[]; scope: WorksiteScope }) => Promise<unknown>,
): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    await operation({
      userId: guard.session!.user.id,
      roles: guard.session!.user.roles,
      scope: scopeFromSession(guard.session!),
    })
    revalidateOperationalViews(["/prevencion/alcotest"])
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    }
    return { ok: false, message: safeActionMessage(error, "No se pudo completar la acción. Intenta nuevamente.") }
  }
}

export async function recordAlcoholTestAction(input: unknown): Promise<ActionState> {
  return run("prevention:alcotest:register", ({ userId, roles, scope }) => {
    const parsed = alcoholTestRegisterSchema.parse(input)
    return recordAlcoholTest(parsed, userId, roles, scope)
  })
}

export async function recordAlcoholTestDispatchAction(input: unknown): Promise<ActionState> {
  return run("prevention:alcotest:dispatch", ({ userId, scope }) => {
    const parsed = alcoholTestDispatchSchema.parse(input)
    return recordAlcoholTestDispatch(parsed, userId, scope)
  })
}
