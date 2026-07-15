"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardAuth } from "@/lib/auth/can"
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

function fail(e: unknown): ActionState {
  if (e instanceof ZodError) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: e.flatten().fieldErrors as Record<string, string[]> }
  }
  return { ok: false, message: (e as Error).message }
}

// ── Plantillas de checklist (por actividad) ─────────────────────────────────

export async function savePdtpChecklistTemplateAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:checklist:manage")) {
    return { ok: false, message: "No tienes permisos para editar plantillas de checklist." }
  }
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
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:checklist:manage")) {
    return { ok: false, message: "No tienes permisos para crear plantillas de checklist." }
  }
  try {
    await ensureDefaultChecklist(activityId, label)
    revalidatePath(`${REVALIDATE}/${programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpChecklistTemplateAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:checklist:manage")) {
    return { ok: false, message: "No tienes permisos para eliminar plantillas de checklist." }
  }
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
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:checklist:fill")) {
    return { ok: false, message: "No tienes permisos para llenar el checklist de verificación." }
  }
  try {
    const parsed = pdtpChecklistStartSchema.parse(input)
    const instance = await getOrCreateExecutionChecklist(parsed.executionId, session.user.id, {
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      subjectLabel: parsed.subjectLabel,
    })
    return { ok: true, instanceId: instance.id }
  } catch (e) {
    return fail(e)
  }
}

export async function upsertPdtpChecklistResponsesAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:checklist:fill")) {
    return { ok: false, message: "No tienes permisos para llenar el checklist de verificación." }
  }
  try {
    const parsed = pdtpChecklistResponsesUpsertSchema.parse(input)
    await upsertChecklistResponses(parsed.instanceId, parsed.responses, session.user.id)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`, "layout")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function submitPdtpExecutionChecklistAction(input: unknown): Promise<ActionState & { generadas?: number }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:checklist:fill")) {
    return { ok: false, message: "No tienes permisos para enviar la revisión del checklist." }
  }
  try {
    const parsed = pdtpChecklistSubmitSchema.parse(input)
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
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:action:manage")) {
    return { ok: false, message: "No tienes permisos para crear acciones correctivas." }
  }
  try {
    const parsed = pdtpActionPlanCreateSchema.parse(input)
    await createActionPlanItem(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function updatePdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:action:manage")) {
    return { ok: false, message: "No tienes permisos para editar acciones correctivas." }
  }
  try {
    const { itemId, ...update } = pdtpActionPlanUpdateSchema.parse(input)
    await updateActionPlanItem(itemId, update, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:action:manage")) {
    return { ok: false, message: "No tienes permisos para eliminar acciones correctivas." }
  }
  try {
    const parsed = pdtpActionPlanDeleteSchema.parse(input)
    await deleteActionPlanItem(parsed.itemId)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function verifyPdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:action:verify")) {
    return { ok: false, message: "No tienes permisos para verificar el cierre de acciones." }
  }
  try {
    const parsed = pdtpActionPlanVerifySchema.parse(input)
    await verifyActionPlanItem(parsed.itemId, session.user.id, parsed.observacion)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function reopenPdtpActionPlanItemAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:action:verify")) {
    return { ok: false, message: "No tienes permisos para reabrir acciones verificadas." }
  }
  try {
    const parsed = pdtpActionPlanReopenSchema.parse(input)
    await reopenActionPlanItem(parsed.itemId, session.user.id, parsed.motivo)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── Seguimiento (bitácora) ───────────────────────────────────────────────────

export async function addPdtpFollowupAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:action:manage")) {
    return { ok: false, message: "No tienes permisos para registrar seguimiento." }
  }
  try {
    const parsed = pdtpFollowupAddSchema.parse(input)
    await addFollowup(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
