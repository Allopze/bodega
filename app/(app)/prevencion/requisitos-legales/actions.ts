"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import {
  approveLegalApplicability,
  assessLegalCompliance,
  createLegalRequirementDraft,
  proposeLegalApplicability,
  transitionLegalRequirement,
  type RiskLegalAccess,
} from "@/lib/services/prevention-risk-legal"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/requisitos-legales"

async function run(permission: Permission, operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    const access = { userId: guard.session.user.id, scope: resolveWorksiteScope(guard.session), permissions: guard.session.user.permissions }
    await operation(access)
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return unexpectedActionError(error, "prevencion/requisitos-legales/actions")
  }
}

export async function createLegalRequirementDraftAction(input: unknown): Promise<ActionState> {
  return run("prevention:legal:assess", (access) => createLegalRequirementDraft(input, access))
}

export async function transitionLegalRequirementAction(input: unknown): Promise<ActionState> {
  const toStatus = typeof input === "object" && input && "toStatus" in input ? String(input.toStatus) : ""
  const permission = ["approved", "published"].includes(toStatus) ? "prevention:legal:approve_applicability" : "prevention:legal:assess"
  return run(permission, (access) => transitionLegalRequirement(input, access))
}

export async function proposeLegalApplicabilityAction(input: unknown): Promise<ActionState> {
  return run("prevention:legal:assess", (access) => proposeLegalApplicability(input, access))
}

export async function approveLegalApplicabilityAction(input: unknown): Promise<ActionState> {
  return run("prevention:legal:approve_applicability", (access) => approveLegalApplicability(input, access))
}

export async function assessLegalComplianceAction(input: unknown): Promise<ActionState> {
  return run("prevention:legal:assess", (access) => assessLegalCompliance(input, access))
}
