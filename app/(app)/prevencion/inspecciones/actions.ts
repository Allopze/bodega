"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  approveInspectionTemplate,
  completeInspectionRun,
  createFindingCapa,
  createInspectionProgram,
  createInspectionRun,
  importInspectionTemplate,
  reviewInspectionRun,
  saveInspectionAnswers,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/inspecciones"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): InspectionAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: InspectionAccess, operation: (access: InspectionAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function importInspectionTemplateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => importInspectionTemplate(input, access))
}

export async function approveInspectionTemplateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => approveInspectionTemplate(input, access))
}

export async function createInspectionProgramAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createInspectionProgram(input, access))
}

export async function createInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createInspectionRun(input, access))
}

export async function saveInspectionAnswersAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => saveInspectionAnswers(input, access))
}

export async function completeInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => completeInspectionRun(input, access))
}

export async function createFindingCapaAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createFindingCapa(input, access))
}

export async function reviewInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:review")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => reviewInspectionRun(input, access))
}
