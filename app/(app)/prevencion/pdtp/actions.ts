"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ZodError } from "zod"
import { guardAuth, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { parseZ } from "@/lib/actions/parse-z"
import {
  markPdtpExecution,
  submitPdtpProgramForReview,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
  rejectPdtpApprovalStep,
  reopenRejectedPdtpProgram,
  archivePdtpProgram,
  decidePdtpApprovalStep,
  getPdtpApprovalStep,
  approvePdtpExecution,
  rejectPdtpExecution,
  updatePdtpActivity,
  addPdtpActivity,
  duplicatePdtpActivity,
  batchUpdatePdtpActivities,
  deletePdtpActivity,
  reorderPdtpActivities,
  setPdtpActivityOverride,
  deletePdtpActivityOverride,
  createPdtpProgram,
  updatePdtpProgram,
  deletePdtpProgram as deletePdtpProgramService,
  createPdtpSheet,
  deletePdtpSheet as deletePdtpSheetService,
  renamePdtpObjective,
  createPdtpTemplateVersion,
  reconcilePdtpDeclaredActor,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpExecutionSchema,
  pdtpExecutionApprovalSchema,
  pdtpExecutionRejectionSchema,
  pdtpActivityUpdateSchema,
  pdtpActivityAddSchema,
  pdtpActivityOverrideSchema,
  pdtpProgramCreateSchema,
  pdtpProgramUpdateSchema,
  pdtpProgramDeleteSchema,
  pdtpProgramLifecycleReasonSchema,
  pdtpApprovalDecisionSchema,
  pdtpSheetCreateSchema,
  pdtpSheetDeleteSchema,
  pdtpActivityDeleteSchema,
  pdtpActivityDuplicateSchema,
  pdtpActivityBatchUpdateSchema,
  pdtpActivityReorderSchema,
  pdtpObjectiveRenameSchema,
  pdtpTemplatePublishSchema,
  pdtpReconcileDeclaredActorSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  return unexpectedActionError(error, "prevencion/pdtp/actions")
}

// ── Existing actions (keep unchanged) ──────────────────────────────────────

export async function markPdtpExecutionAction(formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:execute")
  if (guard.error) return guard.error
  const session = guard.session

  const evidenceUrl = formData.get("evidenceUrl")
  // Boundary de validación con parseZ (Fase 1 H-27): mismo schema que ya
  // aplicaba markPdtpExecution internamente, movido al boundary de la
  // action. El servicio lo sigue re-validando (defensa en profundidad).
  const parsed = parseZ(pdtpExecutionSchema, {
    activityId: formData.get("activityId"),
    worksiteId: formData.get("worksiteId"),
    year: formData.get("year"),
    month: formData.get("month"),
    week: formData.get("week"),
    executedQuantity: formData.get("executedQuantity"),
    evidenceText: formData.get("evidenceText") ?? "",
    evidenceUrl: evidenceUrl ?? "",
    // evidenceUrl es la evidencia destacada; no se duplica en el arreglo
    // de adjuntos, que se reserva para evidencias adicionales.
    evidencePhotos: [],
  })
  if (!parsed.ok) return parsed

  try {
    await markPdtpExecution(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    // pdtp-execution-form.tsx usa fieldErrors para señalar cada control.
    return fail(e)
  }
}

export async function markPdtpExecutionFormAction(formData: FormData): Promise<ActionState> {
  return markPdtpExecutionAction(formData)
}

// ── WS2: Program lifecycle ──────────────────────────────────────────────────

export async function submitPdtpProgramForReviewAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:submit_review")
  if (guard.error) return guard.error
  try {
    await submitPdtpProgramForReview(programId, guard.session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function decidePdtpApprovalStepAction(input: unknown): Promise<ActionState> {
  const authGuard = await guardAuth()
  if (authGuard.error) return authGuard.error
  try {
    const parsed = pdtpApprovalDecisionSchema.parse(input)
    const step = await getPdtpApprovalStep(parsed.stepId)
    if (!step || step.programId !== parsed.programId) throw new Error("Paso de aprobación no encontrado.")
    if (!authGuard.session.user.permissions.includes(step.requiredPermission)) {
      return { ok: false, message: "No tienes permisos para realizar esta acción" }
    }
    await decidePdtpApprovalStep({
      programId: parsed.programId,
      stepId: parsed.stepId,
      actorUserId: authGuard.session.user.id,
      decision: parsed.decision,
      reason: parsed.reason,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function approvePdtpProgramJdprAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await approvePdtpProgramJdpr(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function signPdtpProgramLegalAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:sign_legal")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await signPdtpProgramLegal(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function activatePdtpProgramAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:activate")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await activatePdtpProgram(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── WS3: Execution approval ─────────────────────────────────────────────────

async function rejectPdtpProgramWithPermission(
  programId: string,
  stepCode: "jdpr" | "legal",
  reason: string,
  permission: "prevention:pdtp:approve" | "prevention:pdtp:sign_legal",
): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    const parsed = pdtpProgramLifecycleReasonSchema.parse({ programId, reason })
    await rejectPdtpApprovalStep(parsed.programId, stepCode, guard.session.user.id, parsed.reason)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function rejectPdtpProgramAsJdprAction(programId: string, reason: string): Promise<ActionState> {
  return rejectPdtpProgramWithPermission(programId, "jdpr", reason, "prevention:pdtp:approve")
}

export async function rejectPdtpProgramAsLegalAction(programId: string, reason: string): Promise<ActionState> {
  return rejectPdtpProgramWithPermission(programId, "legal", reason, "prevention:pdtp:sign_legal")
}

export async function reopenRejectedPdtpProgramAction(programId: string, reason: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:lifecycle:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpProgramLifecycleReasonSchema.parse({ programId, reason })
    await reopenRejectedPdtpProgram(parsed.programId, guard.session.user.id, parsed.reason)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function archivePdtpProgramAction(programId: string, reason: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:lifecycle:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpProgramLifecycleReasonSchema.parse({ programId, reason })
    await archivePdtpProgram(parsed.programId, guard.session.user.id, parsed.reason)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function approvePdtpExecutionAction(executionId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpExecutionApprovalSchema.parse({ executionId })
    await approvePdtpExecution(parsed.executionId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/aprobaciones")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function rejectPdtpExecutionAction(
  executionId: string,
  reason: string,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpExecutionRejectionSchema.parse({ executionId, reason })
    await rejectPdtpExecution(parsed.executionId, session.user.id, parsed.reason, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/aprobaciones")
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── WS4: Activity edit + add ────────────────────────────────────────────────

export async function updatePdtpActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActivityUpdateSchema.parse(input)
    await updatePdtpActivity(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function addPdtpActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActivityAddSchema.parse(input)
    await addPdtpActivity(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function duplicatePdtpActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpActivityDuplicateSchema.parse(input)
    const created = await duplicatePdtpActivity(parsed.activityId, guard.session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${created.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function batchUpdatePdtpActivitiesAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpActivityBatchUpdateSchema.parse(input)
    await batchUpdatePdtpActivities(parsed, guard.session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function setPdtpActivityOverrideFormAction(fd: FormData): Promise<void> {
  const hoja = String(fd.get("hoja") ?? "")
  const faena = String(fd.get("faena") ?? "")
  const programId = String(fd.get("programId") ?? "")
  // Bug C: antes esto siempre volvía a la lista (`/prevencion/pdtp`)
  // ignorando el programId oculto que el form ya envía, y con ≥2 programas
  // el usuario quedaba varado ahí sin ver el error. Vuelve al detalle del
  // programa correcto, preservando hoja/faena y el mensaje de error.
  const detailPath = programId ? `${REVALIDATE}/${programId}` : REVALIDATE
  const backTo = (errorMessage?: string): never => {
    const params = new URLSearchParams()
    if (hoja) params.set("hoja", hoja)
    if (faena) params.set("faena", faena)
    if (errorMessage) params.set("overrideError", errorMessage)
    const qs = params.toString()
    redirect(qs ? `${detailPath}?${qs}` : detailPath)
  }

  const guard = await guardPermission("prevention:pdtp:override:manage")
  if (guard.error) return backTo(guard.error.message)
  const session = guard.session

  const mode = String(fd.get("mode") ?? "set")
  try {
    const parsed = pdtpActivityOverrideSchema.parse({
      activityId: fd.get("activityId"),
      worksiteId: fd.get("worksiteId"),
      year: fd.get("year"),
      month: fd.get("month"),
      week: fd.get("week"),
      plannedQuantity: fd.get("plannedQuantity"),
      reason: fd.get("reason"),
    })
    if (mode === "delete" || parsed.plannedQuantity === 0) {
      await deletePdtpActivityOverride(parsed, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    } else {
      await setPdtpActivityOverride(parsed, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    }
  } catch (e) {
    return backTo(fail(e).message)
  }
  revalidatePath(REVALIDATE)
  if (programId) revalidatePath(detailPath)
  return backTo()
}

// ── WS5: Program CRUD ───────────────────────────────────────────────────────

export async function createPdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState & { programId?: string }> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session

  let programId: string
  try {
    const parsed = pdtpProgramCreateSchema.parse({
      year: formData.get("year"),
      title: formData.get("title"),
      copySheetsFromProgramId: formData.get("copySheetsFromProgramId") || undefined,
      templateVersionId: formData.get("templateVersionId") || undefined,
    })
    const program = await createPdtpProgram({
      year: parsed.year,
      title: parsed.title,
      userId: session.user.id,
      copySheetsFromProgramId: parsed.copySheetsFromProgramId,
      templateVersionId: parsed.templateVersionId,
    })
    programId = program.id
  } catch (e) {
    return fail(e)
  }
  revalidatePath(REVALIDATE)
  redirect(`${REVALIDATE}/${programId}/editar`)
}

export async function updatePdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session

  try {
    const parsed = pdtpProgramUpdateSchema.parse({
      programId: formData.get("programId"),
      title: formData.get("title") || undefined,
      complianceTarget: formData.get("complianceTarget") || undefined,
    })
    await updatePdtpProgram(parsed.programId!, parsed, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function publishPdtpTemplateAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session

  try {
    const parsed = pdtpTemplatePublishSchema.parse({
      sourceProgramId: formData.get("sourceProgramId"),
      name: formData.get("name"),
      description: formData.get("description") ?? "",
    })
    const published = await createPdtpTemplateVersion({
      sourceProgramId: parsed.sourceProgramId,
      name: parsed.name,
      description: parsed.description || undefined,
      userId: session.user.id,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/nuevo`)
    revalidatePath(`${REVALIDATE}/${parsed.sourceProgramId}/editar`)
    return { ok: true, message: `Plantilla ${published.template.name} v${published.version.version} publicada.` }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error

  try {
    const parsed = pdtpProgramDeleteSchema.parse({ programId: formData.get("programId") })
    await deletePdtpProgramService(parsed.programId)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── WS6: Sheet management ────────────────────────────────────────────────────

export async function createPdtpSheetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error

  try {
    const parsed = pdtpSheetCreateSchema.parse({
      programId: formData.get("programId"),
      code: formData.get("code"),
      label: formData.get("label"),
      area: formData.get("area"),
    })
    await createPdtpSheet(parsed)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpSheetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error

  try {
    const parsed = pdtpSheetDeleteSchema.parse({
      sheetId: formData.get("sheetId"),
      programId: formData.get("programId"),
    })
    await deletePdtpSheetService(parsed.sheetId, parsed.programId)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── WS7: Activity delete + reorder ───────────────────────────────────────────

export async function deletePdtpActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session

  try {
    const parsed = pdtpActivityDeleteSchema.parse(input)
    await deletePdtpActivity(parsed.activityId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function reorderPdtpActivitiesAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session

  try {
    const parsed = pdtpActivityReorderSchema.parse(input)
    await reorderPdtpActivities(parsed.programId, parsed.orderedIds, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function addPdtpActivityFormAction(fd: FormData): Promise<void> {
  // Página 100% servidor (sin componentes cliente): el feedback de error se
  // propaga por query param en vez de toast, preservando hoja/faena actuales.
  // Bug C: antes volvía siempre a la lista (`/prevencion/pdtp`), no al
  // detalle del programa — con ≥2 programas el usuario quedaba varado.
  const hoja = String(fd.get("hoja") ?? "")
  const faena = String(fd.get("faena") ?? "")
  const programId = String(fd.get("programId") ?? "")
  const detailPath = programId ? `${REVALIDATE}/${programId}` : REVALIDATE
  const backTo = (errorMessage?: string): never => {
    const params = new URLSearchParams()
    if (hoja) params.set("hoja", hoja)
    if (faena) params.set("faena", faena)
    if (errorMessage) params.set("actividadError", errorMessage)
    const qs = params.toString()
    redirect(qs ? `${detailPath}?${qs}` : detailPath)
  }

  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return backTo(guard.error.message)
  const session = guard.session

  // H-M2: aceptar múltiples responsables y hojas. Iteramos sobre todos los
  // entries del FormData con keys `responsibleSlugs[*]` y `sheetCodes[*]`.
  // `getAll()` devuelve los valores en orden de aparición; filtramos vacíos.
  // Estos checks van FUERA del try: `redirect()` lanza internamente para
  // interrumpir el render, y si backTo() se llama dentro del try, el catch
  // de abajo la reatrapa y produce un segundo redirect con el mensaje de
  // error doblemente codificado.
  const responsibleSlugs = fd.getAll("responsibleSlugs[]").map(String).filter(Boolean)
  const sheetCodes = fd.getAll("sheetCodes[]").map(String).filter(Boolean)
  if (responsibleSlugs.length === 0) {
    return backTo("Debes indicar al menos un responsable.")
  }
  if (sheetCodes.length === 0) {
    return backTo("Debes indicar al menos una hoja.")
  }

  try {
    const parsed = pdtpActivityAddSchema.parse({
      programId: fd.get("programId"),
      objectiveOrder: fd.get("objectiveOrder"),
      objective: fd.get("objective"),
      activity: fd.get("activity"),
      program: fd.get("program"),
      responsibleDisplay: fd.get("responsibleDisplay"),
      responsibleSlugs,
      sheetCodes,
      scheduleMode: "on_demand",
      indicatorMode: "completed_count",
      notes: fd.get("notes") ?? undefined,
    })
    await addPdtpActivity(parsed, session.user.id)
  } catch (e) {
    return backTo(fail(e).message)
  }
  revalidatePath(REVALIDATE)
  if (programId) revalidatePath(detailPath)
  return backTo()
}

// ── Tab Objetivos: renombrar el objetivo de un grupo (objectiveOrder) ───────

export async function renamePdtpObjectiveAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpObjectiveRenameSchema.parse(input)
    await renamePdtpObjective(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── Historia del documento importado: vincular/desvincular una identidad declarada ──

export async function reconcilePdtpDeclaredActorAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpReconcileDeclaredActorSchema.parse(input)
    await reconcilePdtpDeclaredActor({
      historyEntryId: parsed.historyEntryId,
      linkedUserId: parsed.linkedUserId,
      actorUserId: session.user.id,
      reason: parsed.reason,
    })
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
