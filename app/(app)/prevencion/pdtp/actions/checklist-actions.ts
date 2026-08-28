"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import {
  savePdtpActivityChecklist,
  deletePdtpActivityChecklist,
  ensureDefaultChecklist,
  getOrCreateExecutionChecklist,
  upsertChecklistResponses,
  submitExecutionChecklist,
  createActionPlanItem,
  updateActionPlanItem,
  deleteActionPlanItem,
  verifyActionPlanItem,
  reopenActionPlanItem,
  addFollowup,
  assertPdtpActionPlanItemAccess,
  assertPdtpChecklistInstanceAccess,
  assertPdtpExecutionAccess,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpChecklistDefinitionSchema,
  pdtpChecklistTemplateSaveSchema,
  pdtpChecklistTemplateDeleteSchema,
  pdtpChecklistStartSchema,
  pdtpChecklistResponsesUpsertSchema,
  pdtpChecklistSubmitSchema,
  pdtpActionPlanCreateSchema,
  pdtpActionPlanUpdateSchema,
  pdtpActionPlanDeleteSchema,
  pdtpActionPlanVerifySchema,
  pdtpActionPlanReopenSchema,
  pdtpFollowupAddSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function pdtpScopeForSession(session: Parameters<typeof resolveWorksiteScope>[0]) {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.ids
}

function fail(e: unknown): ActionState {
  if (e instanceof ZodError) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: e.flatten().fieldErrors as Record<string, string[]> }
  }
  return unexpectedActionError(e, "prevencion/pdtp/checklist-actions")
}

// ── Plantillas de checklist (por actividad) ─────────────────────────────────

export async function savePdtpChecklistTemplateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:checklist:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpChecklistTemplateSaveSchema.parse(input)
    let definitionJson: unknown
    try {
      definitionJson = JSON.parse(parsed.definitionRaw)
    } catch {
      return { ok: false, message: "El JSON de la definición no es válido.", fieldErrors: { definitionRaw: ["JSON inválido"] } }
    }
    const definition = pdtpChecklistDefinitionSchema.parse(definitionJson)
    await savePdtpActivityChecklist({
      activityId: parsed.activityId,
      label: parsed.label,
      definition,
    })
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function ensureDefaultPdtpChecklistAction(
  activityId: string,
  programId: string,
  label: string,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:checklist:manage")
  if (guard.error) return guard.error
  try {
    await ensureDefaultChecklist(activityId, label)
    revalidatePath(`${REVALIDATE}/${programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpChecklistTemplateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:checklist:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpChecklistTemplateDeleteSchema.parse(input)
    await deletePdtpActivityChecklist(parsed.checklistId)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── Llenado de checklist en ejecución ───────────────────────────────────────

export async function startPdtpExecutionChecklistAction(input: unknown): Promise<ActionState & { instanceId?: string }> {
  const guard = await guardPermission("prevention:pdtp:checklist:fill")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpChecklistStartSchema.parse(input)
    await assertPdtpExecutionAccess(parsed.executionId, pdtpScopeForSession(session))
    const instance = await getOrCreateExecutionChecklist(parsed.executionId, session.user.id, {
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      subjectResourceId: parsed.subjectResourceId,
      subjectLabel: parsed.subjectLabel,
    })
    return { ok: true, instanceId: instance.id }
  } catch (e) {
    return fail(e)
  }
}

export async function upsertPdtpChecklistResponsesAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:checklist:fill")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpChecklistResponsesUpsertSchema.parse(input)
    await assertPdtpChecklistInstanceAccess(parsed.instanceId, pdtpScopeForSession(session))
    await upsertChecklistResponses(parsed.instanceId, parsed.responses, session.user.id)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`, "layout")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function submitPdtpExecutionChecklistAction(input: unknown): Promise<ActionState & { generadas?: number }> {
  const guard = await guardPermission("prevention:pdtp:checklist:fill")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpChecklistSubmitSchema.parse(input)
    await assertPdtpChecklistInstanceAccess(parsed.instanceId, pdtpScopeForSession(session))
    const result = await submitExecutionChecklist(parsed.instanceId, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`, "layout")
    return { ok: true, generadas: result.generadas }
  } catch (e) {
    return fail(e)
  }
}

// ── Plan de acción ──────────────────────────────────────────────────────────

export async function createPdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:action:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActionPlanCreateSchema.parse(input)
    await assertPdtpExecutionAccess(parsed.executionId, pdtpScopeForSession(session))
    await createActionPlanItem(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function updatePdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:action:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const { itemId, ...update } = pdtpActionPlanUpdateSchema.parse(input)
    await assertPdtpActionPlanItemAccess(itemId, pdtpScopeForSession(session))
    await updateActionPlanItem(itemId, update, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:action:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpActionPlanDeleteSchema.parse(input)
    await assertPdtpActionPlanItemAccess(parsed.itemId, pdtpScopeForSession(guard.session))
    await deleteActionPlanItem(parsed.itemId, guard.session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function verifyPdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:action:verify")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActionPlanVerifySchema.parse(input)
    await assertPdtpActionPlanItemAccess(parsed.itemId, pdtpScopeForSession(session))
    await verifyActionPlanItem(parsed.itemId, session.user.id, parsed.observacion, parsed.effectivenessAssessment)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function reopenPdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:action:verify")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActionPlanReopenSchema.parse(input)
    await assertPdtpActionPlanItemAccess(parsed.itemId, pdtpScopeForSession(session))
    await reopenActionPlanItem(parsed.itemId, session.user.id, parsed.motivo)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── Seguimiento (bitácora) ───────────────────────────────────────────────────

export async function addPdtpFollowupAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:action:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpFollowupAddSchema.parse(input)
    await assertPdtpActionPlanItemAccess(parsed.actionPlanItemId, pdtpScopeForSession(session))
    await addFollowup(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
