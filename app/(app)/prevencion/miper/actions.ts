"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import {
  addRiskEntry,
  createRiskMatrixDraft,
  createRiskMethodology,
  createRiskReviewTrigger,
  ensureIspRiskMethodology,
  resolveRiskReviewTrigger,
  transitionRiskMatrix,
  type RiskLegalAccess,
} from "@/lib/services/prevention-risk-legal"
import {
  activateRiskImportBatch,
  approveRiskImportBatch,
  resolveRiskImportRow,
  stageRiskImport,
} from "@/lib/services/prevention-risk-import"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/miper"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): RiskLegalAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

async function run(access: RiskLegalAccess, operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return unexpectedActionError(error, "prevencion/miper/actions")
  }
}

export async function ensureIspRiskMethodologyAction(): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), ensureIspRiskMethodology)
}

export async function createRiskMethodologyAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createRiskMethodology(input, access))
}

export async function createRiskMatrixDraftAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createRiskMatrixDraft(input, access))
}

export async function addRiskEntryAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addRiskEntry(input, access))
}

export async function transitionRiskMatrixAction(input: unknown): Promise<ActionState> {
  const toStatus = typeof input === "object" && input && "toStatus" in input ? String(input.toStatus) : ""
  const permission: Permission = toStatus === "reviewed" ? "prevention:risk:review" : toStatus === "approved" ? "prevention:risk:approve" : toStatus === "published" ? "prevention:risk:publish" : "prevention:risk:edit"
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => transitionRiskMatrix(input, access))
}

export async function createRiskReviewTriggerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createRiskReviewTrigger(input, access))
}

export async function resolveRiskReviewTriggerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:review")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => resolveRiskReviewTrigger(input, access))
}

export async function stageRiskImportAction(formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  try {
    const file = formData.get("file")
    const worksiteId = String(formData.get("worksiteId") ?? "")
    if (!(file instanceof File)) return { ok: false, message: "Selecciona un archivo Excel." }
    await stageRiskImport({ worksiteId, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()), access: accessFromSession(guard.session) })
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (error) {
    return unexpectedActionError(error, "prevencion/miper/actions")
  }
}

export async function resolveRiskImportRowAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => resolveRiskImportRow(input, access))
}

export async function approveRiskImportBatchAction(batchId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => approveRiskImportBatch(batchId, access))
}

export async function activateRiskImportBatchAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => activateRiskImportBatch(input, access))
}
