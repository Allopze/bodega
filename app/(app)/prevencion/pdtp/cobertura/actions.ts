"use server"

import { revalidatePath } from "next/cache"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  linkPdtpActivitySource,
  resolvePdtpUpdateObligation,
  type RiskLegalAccess,
} from "@/lib/services/prevention-risk-legal"
import type { ActionState } from "@/lib/validation/prevention"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): RiskLegalAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

async function run(access: RiskLegalAccess, operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return actionErrorResult(error, "Revisa los campos marcados.")
    // Los servicios PDTP lanzan sus reglas de negocio como `new Error("texto
    // para el operador")` y son la única pista de por qué la operación no
    // avanza. `safeActionMessage` las deja pasar y sigue ocultando los errores
    // de driver y de esquema.
    return actionErrorResult(error, "No se pudo completar la acción. Intenta nuevamente.")
  }
}

export async function linkPdtpActivitySourceAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => linkPdtpActivitySource(input, access))
}

export async function resolvePdtpUpdateObligationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => resolvePdtpUpdateObligation(input, access))
}
