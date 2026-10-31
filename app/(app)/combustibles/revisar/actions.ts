"use server"

import { guardAnyPermission, guardPermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { isNetworkError } from "@/lib/network-error"
import { logger } from "@/lib/logger"
import { takeAnomalyCase, type AnomalyCaseStatus } from "@/lib/combustibles/anomaly-cases"
import { decideFlaggedLoads, MAX_BATCH_DECISION, reopenFlaggedDecision, resolveReviewRequest } from "@/lib/combustibles/control/review"
import { FUEL_PATHS, fuelLoadHref, type FuelLoadOrigin } from "@/lib/combustibles/routes"
import { notifyAfterCommit, notifySafe } from "@/lib/services/notifications"
import { linkConsumptionPlateAction } from "../actions-consumos"
import { revalidateInbox } from "./revalidate-inbox"

/**
 * Acciones de la bandeja «Por revisar». La autorización (permiso + alcance de
 * faena) se verifica aquí y otra vez en el servicio; ninguna de estas acciones
 * pide confirmación: decidir, decidir en lote, deshacer y marcar un pedido como
 * revisado son rutina. Lo irreversible —descartar un caso— vive en
 * `anomalias/actions.ts` y la hoja de decisión lo confirma antes de llamarlo.
 *
 * Los casos (resolver, descartar, reabrir, comentar, asignar) siguen en
 * `anomalias/actions.ts`; las decisiones de una sola carga viejas, en
 * `control/revision/actions.ts`.
 */

type Result = { ok: boolean; message?: string }

const CASE_STATUSES = new Set<string>(["open", "in_review", "resolved", "dismissed", "reopened"])

function failure(error: unknown, fallback: string): Result {
  logger.error(`[revisar] ${fallback}`, error)
  const message = error instanceof Error && isNetworkError(error)
    ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente."
    : safeActionMessage(error, fallback)
  return { ok: false, message }
}

/** «Cuenta» o «No cuenta» sobre una o varias cargas, con una nota común. */
export async function decideFlaggedLoadsAction(
  input: { loadIds: string[]; decision: "approve" | "reject"; note: string },
): Promise<Result & { decided?: number; skipped?: number }> {
  const guard = await guardPermission("combustibles:approve_flagged", FUEL_PATHS.revisar)
  if (guard.error) return guard.error
  if (!input || !Array.isArray(input.loadIds) || typeof input.note !== "string" || (input.decision !== "approve" && input.decision !== "reject")) {
    return { ok: false, message: "Solicitud incompleta: faltan las cargas, la decisión o el motivo" }
  }
  if (input.loadIds.length > MAX_BATCH_DECISION) return { ok: false, message: `Decide hasta ${MAX_BATCH_DECISION} cargas por vez` }
  try {
    const result = await decideFlaggedLoads(guard.session, { loadIds: input.loadIds.map(String), decision: input.decision, note: input.note })
    if (!result.ok) return result
    revalidateInbox()
    const verdict = input.decision === "approve" ? "cuenta" : "no cuenta"
    const base = result.decided === 1 ? `Carga decidida: ${verdict}` : `${result.decided} cargas decididas: ${input.decision === "approve" ? "cuentan" : "no cuentan"}`
    return {
      ok: true,
      decided: result.decided,
      skipped: result.skipped,
      message: result.skipped > 0 ? `${base}. ${result.skipped === 1 ? "Otra carga ya estaba decidida y se dejó como estaba" : `${result.skipped} cargas ya estaban decididas y se dejaron como estaban`}` : base,
    }
  } catch (error) {
    return failure(error, "No se pudo registrar la decisión. Reintenta.")
  }
}

/** Deshace la decisión de una carga: vuelve a «Pendientes» o queda sin observaciones, según lo que diga el recálculo. */
export async function reopenFlaggedDecisionAction(input: { loadId: string; note: string }): Promise<Result> {
  const guard = await guardPermission("combustibles:approve_flagged", FUEL_PATHS.revisar)
  if (guard.error) return guard.error
  if (!input || typeof input.loadId !== "string" || input.loadId.trim() === "" || typeof input.note !== "string") {
    return { ok: false, message: "Solicitud incompleta: falta la carga o el motivo" }
  }
  try {
    const result = await reopenFlaggedDecision(guard.session, { loadId: input.loadId, note: input.note })
    if (!result.ok) return result
    revalidateInbox()
    return {
      ok: true,
      message: result.reviewStatus === "flagged"
        ? "Decisión deshecha: la carga volvió a «Pendientes»"
        : "Decisión deshecha: la carga ya no tiene nada por decidir",
    }
  } catch (error) {
    return failure(error, "No se pudo deshacer la decisión. Reintenta.")
  }
}

/** «Tomar el caso»: quedas como responsable y el caso pasa a «Tomada», en un solo paso. */
export async function takeAnomalyCaseAction(
  input: { caseId: string; expectedStatus: AnomalyCaseStatus; expectedAssigneeId: string | null },
): Promise<Result> {
  const guard = await guardPermission("combustibles:review_anomalies", FUEL_PATHS.revisar)
  if (guard.error) return guard.error
  if (!input || typeof input.caseId !== "string" || !CASE_STATUSES.has(input.expectedStatus)) {
    return { ok: false, message: "Solicitud incompleta" }
  }
  try {
    await takeAnomalyCase(guard.session, input.caseId, { status: input.expectedStatus, assigneeId: input.expectedAssigneeId ?? null })
    revalidateInbox()
    return { ok: true, message: "Caso tomado: eres su responsable" }
  } catch (error) {
    return failure(error, "No se pudo tomar el caso")
  }
}

const ORIGIN_BY_ENTITY: Record<string, FuelLoadOrigin> = {
  fuel_tae_submission: "terreno",
  fuel_operation_record: "planilla",
  fuel_load: "factura",
}

/** Marca un pedido de revisión como revisado, con la nota de quien lo revisó; quien lo pidió recibe el aviso. */
export async function resolveReviewRequestAction(input: { markId: string; note: string }): Promise<Result> {
  const guard = await guardAnyPermission(["combustibles:tae_review", "combustibles:approve_flagged"], FUEL_PATHS.revisar)
  if (guard.error) return guard.error
  if (!input || typeof input.markId !== "string" || input.markId.trim() === "" || typeof input.note !== "string") {
    return { ok: false, message: "Solicitud incompleta: falta el pedido o la nota" }
  }
  try {
    const result = await resolveReviewRequest(guard.session, { markId: input.markId, note: input.note })
    if (!result.ok) return result
    revalidateInbox()
    if (result.markedBy !== guard.session.user.id) {
      const origen = ORIGIN_BY_ENTITY[result.entityType]
      notifyAfterCommit(() => notifySafe({
        userId: result.markedBy,
        type: "system_alert",
        title: "Tu pedido de revisión ya se revisó",
        body: input.note.trim(),
        entityType: result.entityType,
        entityId: result.entityId,
        entityHref: origen ? fuelLoadHref({ origen, id: result.entityId }) : FUEL_PATHS.revisar,
        dedupeKey: `review-resolved:${result.markId}`,
      }))
    }
    return { ok: true, message: "Pedido revisado" }
  } catch (error) {
    return failure(error, "No se pudo registrar la revisión. Reintenta.")
  }
}

/**
 * Vincula una patente de un reporte de tarjeta a un equipo. Delega en la acción
 * que ya existía (`linkConsumptionPlateAction`, con su permiso, su alcance y el
 * mapeo permanente) y sólo agrega el refresco de «Por revisar».
 */
export async function linkInboxPlateAction(input: { batchId: string; plate: string; vehicleId: string }): Promise<Result> {
  if (!input || typeof input.batchId !== "string" || typeof input.plate !== "string" || typeof input.vehicleId !== "string") {
    return { ok: false, message: "Solicitud incompleta: falta la patente o el equipo" }
  }
  try {
    const form = new FormData()
    form.set("batchId", input.batchId)
    form.set("patente", input.plate)
    form.set("vehicleId", input.vehicleId)
    const result = await linkConsumptionPlateAction({ ok: true }, form)
    if (result.ok) revalidateInbox()
    return { ok: result.ok, message: result.message }
  } catch (error) {
    return failure(error, "No se pudo vincular la patente. Reintenta.")
  }
}
