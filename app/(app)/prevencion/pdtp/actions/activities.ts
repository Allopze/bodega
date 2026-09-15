"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import {
  updatePdtpActivity,
  addPdtpActivity,
  duplicatePdtpActivity,
  batchUpdatePdtpActivities,
  retirePdtpActivity,
  reorderPdtpActivities,
  setPdtpActivityOverride,
  deletePdtpActivityOverride,
  reconcilePdtpDeclaredActor,
  setPdtpActivityWorksiteAdjustment,
  PdtpScheduleConflictError,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import { adoptLatestCatalogRevision } from "@/lib/services/pdtp/catalog-activities"
import {
  pdtpActivityUpdateSchema,
  pdtpActivityAddSchema,
  pdtpActivityOverrideSchema,
  pdtpActivityDeleteSchema,
  pdtpActivityDuplicateSchema,
  pdtpActivityBatchUpdateSchema,
  pdtpActivityReorderSchema,
  pdtpActivityWorksiteAdjustmentSchema,
  pdtpReconcileDeclaredActorSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

function fail(error: unknown): ActionState {
  // Un conflicto de planificación no es un fallo inesperado: es la respuesta a
  // una operación que habría borrado cantidad planificada. Se devuelve con su
  // detalle para que la UI pueda pedir confirmación, en vez de registrarse
  // como bug.
  if (error instanceof PdtpScheduleConflictError) {
    return { ok: false, message: error.message, data: { scheduleConflict: error.detail } }
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  // Los servicios PDTP lanzan sus reglas de negocio como `new Error("texto
  // para el operador")` y son la única pista de por qué la operación no
  // avanza. `safeActionMessage` las deja pasar y sigue ocultando los errores
  // de driver y de esquema.
  return { ok: false, message: safeActionMessage(error, "No se pudo completar la acción. Intenta nuevamente.") }
}

// ── Activity CRUD ────────────────────────────────────────────────────────────

export async function updatePdtpActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActivityUpdateSchema.parse(input)
    const updated = await updatePdtpActivity(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${updated.programId}`)
    revalidatePath(`${REVALIDATE}/${updated.programId}/editar`)
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

export async function adoptLatestCatalogRevisionAction(input: { activityId: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const updated = await adoptLatestCatalogRevision(input.activityId)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${updated.programId}/editar`)
    return { ok: true }
  } catch (error) {
    return fail(error)
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

export async function deletePdtpActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActivityDeleteSchema.parse(input)
    await retirePdtpActivity(parsed, session.user.id)
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

// ── Program ← add activity (server-only, no JS) ─────────────────────────────

export async function addPdtpActivityFormAction(fd: FormData): Promise<void> {
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

  const responsibleSlugs = fd.getAll("responsibleSlugs[]").map(String).filter(Boolean)
  const sheetCodes = fd.getAll("sheetCodes[]").map(String).filter(Boolean)
  if (responsibleSlugs.length === 0) return backTo("Debes indicar al menos un responsable.")
  if (sheetCodes.length === 0) return backTo("Debes indicar al menos una hoja.")

  try {
    const parsed = pdtpActivityAddSchema.parse({
      programId: fd.get("programId"),
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

// ── Activity overrides ───────────────────────────────────────────────────────

export async function setPdtpActivityOverrideFormAction(fd: FormData): Promise<void> {
  const hoja = String(fd.get("hoja") ?? "")
  const faena = String(fd.get("faena") ?? "")
  const programId = String(fd.get("programId") ?? "")
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

// ── Document reconciliation ──────────────────────────────────────────────────

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

// ── Worksite exclusions and params ───────────────────────────────────────────

export async function setPdtpActivityWorksiteAdjustmentAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpActivityWorksiteAdjustmentSchema.parse(input)
    await setPdtpActivityWorksiteAdjustment(
      parsed,
      guard.session.user.id,
      scopeToIds(resolveWorksiteScope(guard.session)),
    )
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
