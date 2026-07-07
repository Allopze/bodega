"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ZodError } from "zod"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  markPdtpExecution,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
  approvePdtpExecution,
  rejectPdtpExecution,
  updatePdtpActivity,
  addPdtpActivity,
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
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpExecutionApprovalSchema,
  pdtpExecutionRejectionSchema,
  pdtpActivityUpdateSchema,
  pdtpActivityAddSchema,
  pdtpActivityOverrideSchema,
  pdtpProgramCreateSchema,
  pdtpProgramUpdateSchema,
  pdtpProgramDeleteSchema,
  pdtpSheetCreateSchema,
  pdtpSheetDeleteSchema,
  pdtpActivityDeleteSchema,
  pdtpActivityReorderSchema,
  pdtpObjectiveRenameSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

// ── Existing actions (keep unchanged) ──────────────────────────────────────

export async function markPdtpExecutionAction(formData: FormData): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para registrar ejecución PDTP." }
  }

  try {
    const evidenceUrl = formData.get("evidenceUrl")
    await markPdtpExecution({
      activityId: formData.get("activityId"),
      worksiteId: formData.get("worksiteId"),
      year: formData.get("year"),
      month: formData.get("month"),
      week: formData.get("week"),
      executedQuantity: formData.get("executedQuantity"),
      evidenceText: formData.get("evidenceText") ?? "",
      evidenceUrl: evidenceUrl ?? "",
      evidencePhotos: evidenceUrl ? [String(evidenceUrl)] : [],
    }, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    // pdtp-execution-form.tsx lee state.fieldErrors.month/week/executedQuantity
    // para marcar los Select/input inválidos — antes nunca se poblaba porque
    // acá solo se devolvía el mensaje crudo del ZodError, nunca los campos.
    if (e instanceof ZodError) {
      return {
        ok: false,
        message: "Revisa los campos marcados.",
        fieldErrors: e.flatten().fieldErrors as Record<string, string[]>,
      }
    }
    return { ok: false, message: (e as Error).message }
  }
}

export async function markPdtpExecutionFormAction(formData: FormData): Promise<ActionState> {
  return markPdtpExecutionAction(formData)
}

// ── WS2: Program lifecycle ──────────────────────────────────────────────────

export async function approvePdtpProgramJdprAction(programId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:approve")) {
    return { ok: false, message: "No tienes permisos para aprobar el programa PDTP." }
  }
  try {
    await approvePdtpProgramJdpr(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function signPdtpProgramLegalAction(programId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:sign_legal")) {
    return { ok: false, message: "No tienes permisos para firmar el programa PDTP." }
  }
  try {
    await signPdtpProgramLegal(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function activatePdtpProgramAction(programId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:approve")) {
    return { ok: false, message: "No tienes permisos para activar el programa PDTP." }
  }
  try {
    await activatePdtpProgram(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ── WS3: Execution approval ─────────────────────────────────────────────────

export async function approvePdtpExecutionAction(executionId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:approve")) {
    return { ok: false, message: "No tienes permisos para aprobar ejecuciones PDTP." }
  }
  try {
    const parsed = pdtpExecutionApprovalSchema.parse({ executionId })
    await approvePdtpExecution(parsed.executionId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/aprobaciones")
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function rejectPdtpExecutionAction(
  executionId: string,
  reason: string,
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:approve")) {
    return { ok: false, message: "No tienes permisos para rechazar ejecuciones PDTP." }
  }
  try {
    const parsed = pdtpExecutionRejectionSchema.parse({ executionId, reason })
    await rejectPdtpExecution(parsed.executionId, session.user.id, parsed.reason, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/aprobaciones")
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ── WS4: Activity edit + add ────────────────────────────────────────────────

export async function updatePdtpActivityAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para editar actividades PDTP." }
  }
  try {
    const parsed = pdtpActivityUpdateSchema.parse(input)
    await updatePdtpActivity(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function addPdtpActivityAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para agregar actividades PDTP." }
  }
  try {
    const parsed = pdtpActivityAddSchema.parse(input)
    await addPdtpActivity(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
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

  const { session, error } = await guardAuth()
  if (error) return backTo(error.message)
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return backTo("No tienes permisos para fijar metas PDTP por faena.")
  }

  const mode = String(fd.get("mode") ?? "set")
  try {
    const parsed = pdtpActivityOverrideSchema.parse({
      activityId: fd.get("activityId"),
      worksiteId: fd.get("worksiteId"),
      year: fd.get("year"),
      month: fd.get("month"),
      week: fd.get("week"),
      plannedQuantity: fd.get("plannedQuantity"),
    })
    if (mode === "delete" || parsed.plannedQuantity === 0) {
      await deletePdtpActivityOverride(parsed, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    } else {
      await setPdtpActivityOverride(parsed, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    }
  } catch (e) {
    return backTo((e as Error).message)
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
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para crear programas PDTP." }
  }

  try {
    const parsed = pdtpProgramCreateSchema.parse({
      year: formData.get("year"),
      title: formData.get("title"),
      copySheetsFromProgramId: formData.get("copySheetsFromProgramId") || undefined,
    })
    const program = await createPdtpProgram({
      year: parsed.year,
      title: parsed.title,
      userId: session.user.id,
      copySheetsFromProgramId: parsed.copySheetsFromProgramId,
    })
    revalidatePath(REVALIDATE)
    return { ok: true, programId: program.id }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function updatePdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para editar programas PDTP." }
  }

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
    return { ok: false, message: (e as Error).message }
  }
}

export async function deletePdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para eliminar programas PDTP." }
  }

  try {
    const parsed = pdtpProgramDeleteSchema.parse({ programId: formData.get("programId") })
    await deletePdtpProgramService(parsed.programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ── WS6: Sheet management ────────────────────────────────────────────────────

export async function createPdtpSheetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para crear hojas PDTP." }
  }

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
    return { ok: false, message: (e as Error).message }
  }
}

export async function deletePdtpSheetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para eliminar hojas PDTP." }
  }

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
    return { ok: false, message: (e as Error).message }
  }
}

// ── WS7: Activity delete + reorder ───────────────────────────────────────────

export async function deletePdtpActivityAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para eliminar actividades PDTP." }
  }

  try {
    const parsed = pdtpActivityDeleteSchema.parse(input)
    await deletePdtpActivity(parsed.activityId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function reorderPdtpActivitiesAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para reordenar actividades PDTP." }
  }

  try {
    const parsed = pdtpActivityReorderSchema.parse(input)
    await reorderPdtpActivities(parsed.programId, parsed.orderedIds, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
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

  const { session, error } = await guardAuth()
  if (error) return backTo(error.message)
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return backTo("No tienes permisos para agregar actividades PDTP.")
  }

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
      notes: fd.get("notes") ?? undefined,
    })
    await addPdtpActivity(parsed, session.user.id)
  } catch (e) {
    return backTo((e as Error).message)
  }
  revalidatePath(REVALIDATE)
  if (programId) revalidatePath(detailPath)
  return backTo()
}

// ── Tab Objetivos: renombrar el objetivo de un grupo (objectiveOrder) ───────

export async function renamePdtpObjectiveAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para editar objetivos PDTP." }
  }
  try {
    const parsed = pdtpObjectiveRenameSchema.parse(input)
    await renamePdtpObjective(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
