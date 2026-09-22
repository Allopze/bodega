"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ZodError } from "zod"
import { can, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpExecutionConnector } from "@/lib/services/pdtp/connectors"
import type { Permission } from "@/modules/permissions"
import { safeActionMessage } from "@/lib/action-error"
import {
  updatePdtpActivity,
  addPdtpActivity,
  duplicatePdtpActivity,
  batchUpdatePdtpActivities,
  applyPdtpSchedulePresetToActivities,
  retirePdtpActivity,
  reorderPdtpActivities,
  setPdtpActivityOverride,
  deletePdtpActivityOverride,
  reconcilePdtpDeclaredActor,
  setPdtpActivityWorksiteAdjustment,
  syncPdtpCphsHeadcountExclusionsForProgram,
  PdtpScheduleConflictError,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import { adoptLatestCatalogRevision } from "@/lib/services/pdtp/catalog-activities"
import {
  addCatalogActivityToProgram,
  createPublishedCatalogActivityAndAddToProgram,
  PdtpCatalogCodeConflictError,
} from "@/lib/services/pdtp/activity-creation"
import {
  pdtpActivityUpdateSchema,
  pdtpActivityAddSchema,
  pdtpProgramActivityCreateSchema,
  pdtpActivityOverrideSchema,
  pdtpActivityDeleteSchema,
  pdtpActivityDuplicateSchema,
  pdtpActivityBatchUpdateSchema,
  pdtpSchedulePresetBatchSchema,
  pdtpActivityReorderSchema,
  pdtpActivityWorksiteAdjustmentSchema,
  pdtpCphsHeadcountSweepSchema,
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
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of error.issues) {
      const key = [...issue.path].reverse().find((part): part is string => typeof part === "string")
      if (!key) continue
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
    }
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors,
    }
  }
  if (error instanceof PdtpCatalogCodeConflictError) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: { code: ["Este código ya existe"] } }
  }
  // Los servicios PDTP lanzan sus reglas de negocio como `new Error("texto
  // para el operador")` y son la única pista de por qué la operación no
  // avanza. `safeActionMessage` las deja pasar y sigue ocultando los errores
  // de driver y de esquema.
  return { ok: false, message: safeActionMessage(error, "No se pudo completar la acción. Intenta nuevamente.") }
}

/**
 * La configuración anual no debe convertirse en una forma indirecta de
 * editar instrumentos de un submódulo que el actor no administra. Se valida
 * aquí, además de en la UI, porque las server actions pueden invocarse sin el
 * creador unificado.
 */
function assertExecutionConfigurationPermission(
  session: Parameters<typeof can>[0],
  executionConfig: { destinationConnectorKey: string } | undefined,
  scheduleDefinition: { kind: string; triggerConnectorKey?: string } | null | undefined,
) {
  if (!executionConfig) return
  const destination = getPdtpExecutionConnector(executionConfig.destinationConnectorKey)
  if (!destination) throw new Error("Selecciona un destino operativo soportado por Prevención.")
  if (!can(session, destination.configurePermission as Permission)) {
    throw new Error("No tienes permiso para configurar el submódulo seleccionado.")
  }
  if (scheduleDefinition?.kind === "event" && scheduleDefinition.triggerConnectorKey) {
    const trigger = getPdtpExecutionConnector(scheduleDefinition.triggerConnectorKey)
    if (!trigger) throw new Error("Selecciona un conector productor de eventos soportado por Prevención.")
    if (!can(session, trigger.configurePermission as Permission)) {
      throw new Error("No tienes permiso para configurar el evento disparador seleccionado.")
    }
  }
}

// ── Activity CRUD ────────────────────────────────────────────────────────────

export async function updatePdtpActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpActivityUpdateSchema.parse(input)
    assertExecutionConfigurationPermission(session, parsed.executionConfig, parsed.scheduleDefinition)
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

/** Crea una identidad publicada o reutiliza una existente y la incorpora al
 * programa en una sola transacción. La validación y los permisos viven aquí
 * porque una Server Action también puede invocarse fuera de la UI. */
export async function savePdtpProgramActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpProgramActivityCreateSchema.parse(input)
    if (parsed.source.kind === "new" && !can(session, "admin:pdtp_catalog")) {
      return { ok: false, message: "No tienes permisos para crear y publicar actividades de catálogo" }
    }
    assertExecutionConfigurationPermission(session, parsed.executionConfig, parsed.scheduleDefinition)

    const execution = {
      sheetCode: parsed.sheetCode,
      responsibleSlug: parsed.responsibleSlug,
      audienceRoles: parsed.audienceRoles,
      scheduleMode: parsed.scheduleMode,
      recurrenceRule: parsed.scheduleMode === "scheduled" ? parsed.recurrenceRule : null,
      scheduleDefinition: parsed.scheduleDefinition,
      executionConfig: parsed.executionConfig,
      reminderRules: parsed.reminderRules,
      triggerType: parsed.scheduleMode === "triggered" ? parsed.triggerType ?? "evento_operacional" : null,
      triggerDescription: parsed.scheduleMode === "triggered" ? parsed.triggerDescription : null,
      evidenceRequirement: parsed.evidenceRequirement,
      indicatorMode: parsed.scheduleMode === "scheduled" ? "planned_vs_completed" as const : "closed_on_time" as const,
      targetValue: 100,
      targetUnit: "%",
      notes: parsed.notes,
    }
    const actor = { userId: session.user.id, userEmail: session.user.email ?? undefined }
    const result = parsed.source.kind === "new"
      ? await createPublishedCatalogActivityAndAddToProgram({
        programId: parsed.programId,
        definition: parsed.source,
        execution,
      }, actor)
      : await addCatalogActivityToProgram({
        programId: parsed.programId,
        catalogActivityId: parsed.source.catalogActivityId,
        execution,
      }, actor)

    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    revalidatePath("/admin/pdtp-catalogos")
    return { ok: true, data: result }
  } catch (error) {
    return fail(error)
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

export async function applyPdtpSchedulePresetAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpSchedulePresetBatchSchema.parse(input)
    const result = await applyPdtpSchedulePresetToActivities(parsed, guard.session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true, data: { applied: result.applied, skippedConflicts: result.skippedConflicts } }
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

/**
 * Aplica la regla de dotación (R4 / DS 44) a todas las faenas del programa:
 * excluye las actividades del Comité Paritario donde la dotación no lo exige y
 * las vuelve a incluir donde sí. El servicio ya rechaza un programa fuera de
 * borrador, porque las exclusiones son parte del contenido firmado.
 */
export async function applyPdtpCphsHeadcountRuleAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpCphsHeadcountSweepSchema.parse(input)
    const result = await syncPdtpCphsHeadcountExclusionsForProgram(
      parsed.programId,
      guard.session.user.id,
      scopeToIds(resolveWorksiteScope(guard.session)),
    )
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    const message = result.evaluated === 0
      ? "El programa no declara faenas en tu alcance: no hay nada que evaluar."
      : result.changed === 0
        ? `Sin cambios: las ${result.evaluated} faenas ya reflejan la regla de dotación.`
        : `Regla aplicada en ${result.changed} de ${result.evaluated} faena(s).`
    return { ok: true, message }
  } catch (e) {
    return fail(e)
  }
}

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
