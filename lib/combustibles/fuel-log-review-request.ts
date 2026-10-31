/**
 * «Pedir que la revisen»: un pedido de revisión con nota sobre una carga
 * (`fuel_review_marks`). Reemplaza al interruptor de la bitácora, que se borraba
 * al desmarcar y no dejaba quién lo resolvió ni por qué.
 *
 * El pedido tiene ciclo de vida: nace `open`, y lo cierra quien decide
 * (`resolved`, desde la bandeja «Por revisar») o lo retira quien lo pidió
 * (`withdrawn`, aquí). Sólo puede haber un pedido abierto por carga (índice único
 * parcial). Esta capa recibe la sesión ya autenticada: el permiso de entrada lo
 * exige la Server Action; aquí se aplica el alcance por faena, que ningún
 * permiso de módulo acota.
 */
import type { Session } from "next-auth"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelLoads, fuelOperationRecords, fuelReviewMarks, fuelTaeSubmissions, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { can } from "@/lib/auth/can"
import { canAccessWorksite, isGlobalRole } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { fuelInboxHref } from "@/lib/combustibles/routes"
import { fuelLogEntityType } from "@/lib/combustibles/fuel-log"
import type { FuelLogSource } from "@/lib/combustibles/fuel-log-shared"
import { getUserIdsWithPermissionForWorksite, notifyAfterCommit, notifyManyUser } from "@/lib/services/notifications"

export const REVIEW_REQUEST_NOTE_MIN = 10
export const REVIEW_REQUEST_NOTE_MAX = 500

export type ReviewRequestFailure = "invalid_note" | "not_found" | "forbidden" | "already_open" | "not_open"

export type ReviewRequestResult =
  | { ok: true; markId: string }
  | { ok: false; code: ReviewRequestFailure; message: string }

function fail(code: ReviewRequestFailure, message: string): ReviewRequestResult {
  return { ok: false, code, message }
}

export interface FuelLogEntityContext {
  /** `null` en una fila de planilla cuya faena no se pudo vincular. */
  worksiteId: string | null
  worksiteName: string | null
  label: string
}

/**
 * La faena y un rótulo legible de una carga, a partir de su tabla de origen.
 * Sirve para acotar por faena (una fila fuera del alcance no se puede marcar ni
 * ver su historial) y para el cuerpo de la notificación.
 */
export async function resolveFuelLogEntity(entityType: string, entityId: string): Promise<FuelLogEntityContext | null> {
  async function worksiteName(worksiteId: string | null) {
    if (!worksiteId) return null
    const row = await db.query.worksites.findFirst({ where: eq(worksites.id, worksiteId), columns: { name: true } })
    return row?.name ?? null
  }

  if (entityType === "fuel_tae_submission") {
    const row = await db.query.fuelTaeSubmissions.findFirst({
      where: eq(fuelTaeSubmissions.id, entityId),
      columns: { worksiteId: true, equipmentCodeSnapshot: true, plateSnapshot: true, liters: true },
    })
    if (!row) return null
    return {
      worksiteId: row.worksiteId,
      worksiteName: await worksiteName(row.worksiteId),
      label: `${row.equipmentCodeSnapshot ?? row.plateSnapshot} · ${Number(row.liters).toLocaleString("es-CL")} L`,
    }
  }
  if (entityType === "fuel_load") {
    const row = await db.query.fuelLoads.findFirst({
      where: eq(fuelLoads.id, entityId),
      columns: { worksiteId: true, liters: true },
      with: { vehicle: { columns: { code: true, plate: true } } },
    })
    if (!row) return null
    const vehicleLabel = row.vehicle ? (row.vehicle.code ?? row.vehicle.plate) : "—"
    return {
      worksiteId: row.worksiteId,
      worksiteName: await worksiteName(row.worksiteId),
      label: `${vehicleLabel} · ${Number(row.liters).toLocaleString("es-CL")} L`,
    }
  }
  if (entityType === "fuel_operation_record") {
    const row = await db.query.fuelOperationRecords.findFirst({
      where: eq(fuelOperationRecords.id, entityId),
      columns: { worksiteId: true, plate: true, code: true, liters: true },
    })
    if (!row) return null
    return {
      worksiteId: row.worksiteId,
      worksiteName: await worksiteName(row.worksiteId),
      label: `${row.code ?? row.plate} · ${Number(row.liters).toLocaleString("es-CL")} L`,
    }
  }
  return null
}

/** Una carga sin faena (patente de planilla sin vincular) sólo la ven los roles globales. */
function canAccessEntity(session: Session, ctx: FuelLogEntityContext): boolean {
  return ctx.worksiteId ? canAccessWorksite(session, ctx.worksiteId) : isGlobalRole(session)
}

/** ¿Puede la sesión retirar el pedido de otra persona? Quien decide sobre las cargas. */
export function canWithdrawOthersReviewRequest(session: Session): boolean {
  return can(session, "combustibles:approve_flagged") || can(session, "combustibles:tae_review")
}

/**
 * Abre un pedido de revisión sobre una carga. La nota es obligatoria (10 a 500
 * caracteres): sin ella quien revisa no sabe qué mirar, que era el defecto de la marca sin nota.
 */
export async function requestLoadReview(
  session: Session,
  input: { source: FuelLogSource; entityId: string; note: string },
): Promise<ReviewRequestResult> {
  const note = input.note.trim()
  if (note.length < REVIEW_REQUEST_NOTE_MIN || note.length > REVIEW_REQUEST_NOTE_MAX) {
    return fail("invalid_note", `Cuenta qué debe revisarse, en ${REVIEW_REQUEST_NOTE_MIN} a ${REVIEW_REQUEST_NOTE_MAX} caracteres.`)
  }

  const entityType = fuelLogEntityType(input.source)
  // `combustibles:view` no acota por faena: sin esto, quien tuviera el permiso
  // podía marcar (y disparar la notificación de) una carga de una faena fuera de
  // su alcance con sólo conocer su id.
  const ctx = await resolveFuelLogEntity(entityType, input.entityId)
  if (!ctx) return fail("not_found", "No se encontró la carga.")
  if (!canAccessEntity(session, ctx)) return fail("forbidden", "No tienes acceso a la faena de esta carga.")

  const markId = nanoid()
  const created = await db.transaction(async (tx) => {
    // `on conflict do nothing` sin objetivo: el índice único parcial sobre los
    // pedidos abiertos es el que impide duplicarlo, incluso entre dos clics casi simultáneos.
    const inserted = await tx.insert(fuelReviewMarks).values({
      id: markId,
      entityType,
      entityId: input.entityId,
      worksiteId: ctx.worksiteId,
      markedBy: session.user.id,
      notes: note,
      status: "open",
    }).onConflictDoNothing().returning({ id: fuelReviewMarks.id })
    if (inserted.length === 0) return false
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType,
      entityId: input.entityId,
      oldState: { reviewRequest: null },
      newState: { reviewRequest: "open", markId },
      reason: note,
      worksiteId: ctx.worksiteId,
    }, tx)
    return true
  })
  if (!created) return fail("already_open", "Esta carga ya tiene un pedido de revisión abierto.")

  // Avisar a quien decide en la faena, sin bloquear el pedido.
  notifyAfterCommit(async () => {
    try {
      if (!ctx.worksiteId) return
      const [deciders, validators] = await Promise.all([
        getUserIdsWithPermissionForWorksite("combustibles:approve_flagged", ctx.worksiteId),
        getUserIdsWithPermissionForWorksite("combustibles:tae_review", ctx.worksiteId),
      ])
      const targetIds = [...new Set([...deciders, ...validators])].filter((id) => id !== session.user.id)
      if (targetIds.length === 0) return
      await notifyManyUser(targetIds, {
        type: "system_alert",
        title: "Piden que revisen una carga",
        body: `${ctx.label} · ${ctx.worksiteName ?? "Faena sin nombre"}: ${note}`,
        entityType,
        entityId: input.entityId,
        entityHref: fuelInboxHref({ tipo: "pedido" }),
        dedupeKey: `review-mark:${markId}`,
      })
    } catch (err) {
      logger.error("[review-request] notification failed", err)
    }
  })

  return { ok: true, markId }
}

/**
 * Retira un pedido abierto. Lo puede hacer quien lo pidió o quien puede decidir
 * sobre las cargas; el pedido no se borra: pasa a `withdrawn` y queda en el
 * historial de la carga.
 */
export async function withdrawLoadReviewRequest(session: Session, markId: string): Promise<ReviewRequestResult> {
  const mark = await db.query.fuelReviewMarks.findFirst({ where: eq(fuelReviewMarks.id, markId) })
  if (!mark) return fail("not_found", "No se encontró el pedido de revisión.")
  if (mark.status !== "open") return fail("not_open", "Este pedido ya no está abierto.")

  const ctx = await resolveFuelLogEntity(mark.entityType, mark.entityId)
  // El alcance se evalúa sobre la carga de hoy: si la faena de la carga cambió, manda la actual.
  const worksiteId = ctx ? ctx.worksiteId : mark.worksiteId
  const inScope = worksiteId ? canAccessWorksite(session, worksiteId) : isGlobalRole(session)
  if (!inScope) return fail("forbidden", "No tienes acceso a la faena de esta carga.")
  if (mark.markedBy !== session.user.id && !canWithdrawOthersReviewRequest(session)) {
    return fail("forbidden", "Sólo quien lo pidió, o quien decide sobre las cargas, puede retirarlo.")
  }

  const now = new Date().toISOString()
  const withdrawn = await db.transaction(async (tx) => {
    const updated = await tx.update(fuelReviewMarks)
      .set({ status: "withdrawn", resolvedBy: session.user.id, resolvedAt: now })
      .where(and(eq(fuelReviewMarks.id, markId), eq(fuelReviewMarks.status, "open")))
      .returning({ id: fuelReviewMarks.id })
    if (updated.length === 0) return false
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: mark.entityType,
      entityId: mark.entityId,
      oldState: { reviewRequest: "open", markId },
      newState: { reviewRequest: "withdrawn", markId },
      worksiteId: worksiteId ?? null,
    }, tx)
    return true
  })
  if (!withdrawn) return fail("not_open", "Este pedido ya no está abierto.")
  return { ok: true, markId }
}
