"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  blockContractAccess,
  closeCoordinationMeeting,
  createAccreditationRequirement,
  createContractorCompany,
  createContractorContract,
  createCoordinationMeeting,
  registerContractorWorker,
  releaseContractAccess,
  reviewAccreditationItem,
  submitAccreditationItem,
  transitionContractStatus,
  type ContractorAccess,
} from "@/lib/services/prevention-contractors"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/contratistas"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): ContractorAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción y no dentro de este helper, para
// que cada entrada sea verificable sin seguir una indirección.
async function run(access: ContractorAccess, operation: (access: ContractorAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    revalidatePath(`${BASE}/brechas`)
    revalidatePath(`${BASE}/coordinacion`)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createContractorCompanyAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createContractorCompany(input, access))
}

export async function createContractorContractAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createContractorContract(input, access))
}

export async function registerContractorWorkerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => registerContractorWorker(input, access))
}

export async function createAccreditationRequirementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createAccreditationRequirement(input, access))
}

export async function submitAccreditationItemAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:submit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => submitAccreditationItem(input, access))
}

export async function reviewAccreditationItemAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:accredit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => reviewAccreditationItem(input, access))
}

export async function releaseContractAccessAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:authorize_access")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => releaseContractAccess(input, access))
}

export async function blockContractAccessAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:authorize_access")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => blockContractAccess(input, access))
}

export async function transitionContractStatusAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => transitionContractStatus(input, access))
}

export async function createCoordinationMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:coordinate")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createCoordinationMeeting(input, access))
}

export async function closeCoordinationMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:contractors:coordinate")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => closeCoordinationMeeting(input, access))
}
