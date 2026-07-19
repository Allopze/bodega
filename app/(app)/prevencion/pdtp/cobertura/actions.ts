"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  linkPdtpActivitySource,
  resolvePdtpUpdateObligation,
  type RiskLegalAccess,
} from "@/lib/services/prevention-risk-legal"
import type { ActionState } from "@/lib/validation/prevention"

async function run(operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    await operation({ userId: guard.session.user.id, scope: resolveWorksiteScope(guard.session), permissions: guard.session.user.permissions })
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return unexpectedActionError(error, "prevencion/pdtp/cobertura/actions")
  }
}

export async function linkPdtpActivitySourceAction(input: unknown): Promise<ActionState> {
  return run((access) => linkPdtpActivitySource(input, access))
}

export async function resolvePdtpUpdateObligationAction(input: unknown): Promise<ActionState> {
  return run((access) => resolvePdtpUpdateObligation(input, access))
}

