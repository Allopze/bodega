"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
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

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): RiskLegalAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

/**
 * El error de dominio viaja con su mensaje: le dice a la persona qué hacer
 * (recargar, pedir otra firma, completar la evidencia). El resto pasa por
 * `unexpectedActionError`, que lo loguea y responde genérico para no filtrar
 * detalles de driver o SQL. Antes todo caía en el genérico.
 */
function fail(error: unknown): ActionState {
  if (error instanceof RiskLegalDomainError) return { ok: false, message: error.message }
  return unexpectedActionError(error, "prevencion/requisitos-legales/actions")
}

async function run(access: RiskLegalAccess, operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return fail(error)
  }
}

export async function createLegalRequirementDraftAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:legal:assess")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createLegalRequirementDraft(input, access))
}

export async function transitionLegalRequirementAction(input: unknown): Promise<ActionState> {
  const toStatus = typeof input === "object" && input && "toStatus" in input ? String(input.toStatus) : ""
  const permission: Permission = ["approved", "published"].includes(toStatus) ? "prevention:legal:approve_applicability" : "prevention:legal:assess"
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => transitionLegalRequirement(input, access))
}

export async function proposeLegalApplicabilityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:legal:assess")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => proposeLegalApplicability(input, access))
}

export async function approveLegalApplicabilityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:legal:approve_applicability")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => approveLegalApplicability(input, access))
}

export async function assessLegalComplianceAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:legal:assess")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => assessLegalCompliance(input, access))
}
