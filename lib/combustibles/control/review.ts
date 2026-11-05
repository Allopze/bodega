import { and, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelReviewMarks } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { can } from "@/lib/auth/can"
import { canAccessWorksite, isGlobalRole } from "@/lib/auth/scope"
import { lockVehicleSeries, lockVehiclesSeries, recomputeVehicleSeries } from "./projection-series"
import { projectWithStaleDecisions } from "./stale-decisions"
import { loadPerformanceControlContext } from "./settings"

/**
 * Decisión humana sobre una carga marcada (atípica, retroceso de medidor,
 * duplicada, valor de relleno…). La decisión es persistente: el recálculo de la
 * serie no la pisa. Aprobar una duplicada significa «no es duplicada» y la
 * devuelve a los cálculos; rechazar la saca de ellos.
 */

export const REVIEW_NOTE_MIN_LENGTH = 10
export const REVIEW_NOTE_MAX_LENGTH = 500

export async function decideFlaggedLoad(
  session: Session,
  input: { loadId: string; decision: "approve" | "reject"; note: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!can(session, "combustibles:approve_flagged")) {
    return { ok: false, message: "No tienes permisos para revisar cargas marcadas" }
  }
  const note = (input.note ?? "").trim()
  if (note.length < REVIEW_NOTE_MIN_LENGTH) {
    return { ok: false, message: `Escribe el motivo de la decisión (al menos ${REVIEW_NOTE_MIN_LENGTH} caracteres)` }
  }
  if (note.length > REVIEW_NOTE_MAX_LENGTH) {
    return { ok: false, message: `El motivo no puede superar ${REVIEW_NOTE_MAX_LENGTH} caracteres` }
  }
  if (input.decision !== "approve" && input.decision !== "reject") {
    return { ok: false, message: "Decisión no reconocida" }
  }

  return db.transaction(async (tx) => {
    // El candado del equipo se toma ANTES de bloquear la fila: el orden del
    // módulo es equipo → carga → serie, y una revisión que bloqueara la carga
    // esperando el equipo se cruzaría con un alta que tiene el equipo y espera
    // esa carga. La lectura previa no bloquea: sólo sirve para saber el equipo.
    const [head] = await tx.select({ vehicleId: fuelEquipmentLoads.vehicleId })
      .from(fuelEquipmentLoads)
      .where(eq(fuelEquipmentLoads.id, input.loadId))
    if (head?.vehicleId) await lockVehicleSeries(tx, head.vehicleId)

    const [load] = await tx.select({
      id: fuelEquipmentLoads.id,
      worksiteId: fuelEquipmentLoads.worksiteId,
      vehicleId: fuelEquipmentLoads.vehicleId,
      occurredAt: fuelEquipmentLoads.occurredAt,
      reviewStatus: fuelEquipmentLoads.reviewStatus,
      flagReasons: fuelEquipmentLoads.flagReasons,
      duplicateOfId: fuelEquipmentLoads.duplicateOfId,
      voidedAt: fuelEquipmentLoads.voidedAt,
    })
      .from(fuelEquipmentLoads)
      .where(eq(fuelEquipmentLoads.id, input.loadId))
      .for("update")
      .limit(1)

    // Misma respuesta para «no existe» y «fuera de tu alcance»: no se revela qué ids existen en otras faenas.
    if (!load || !canAccessWorksite(session, load.worksiteId)) {
      return { ok: false as const, message: "La carga no existe o no está en tus faenas" }
    }
    if (load.voidedAt) return { ok: false as const, message: "La carga está anulada; no requiere revisión" }
    if (load.reviewStatus !== "flagged") {
      return { ok: false as const, message: "La carga ya no está en revisión (otra persona pudo decidirla)" }
    }
    // La proyección pudo mover la carga de equipo entre la lectura previa y el bloqueo.
    if (load.vehicleId && load.vehicleId !== head?.vehicleId) await lockVehicleSeries(tx, load.vehicleId)

    const reviewStatus = input.decision === "approve" ? "approved" : "rejected"
    const now = new Date().toISOString()
    const next = {
      reviewStatus,
      reviewNote: note,
      reviewedBy: session.user.id,
      reviewedAt: now,
      // Aprobar una duplicada = «no es duplicada»: vuelve a la serie.
      duplicateOfId: input.decision === "approve" ? null : load.duplicateOfId,
    }
    // La decisión va dentro del trabajo: la foto de las decisiones siguientes se
    // toma ANTES de escribir, o la propia carga recién decidida entraría en ella.
    const vehicleId = load.vehicleId
    await projectWithStaleDecisions(
      tx,
      vehicleId,
      load.occurredAt,
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      async () => {
        await tx.update(fuelEquipmentLoads).set({ ...next, updatedAt: now }).where(eq(fuelEquipmentLoads.id, load.id))
        await recordAudit({
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          action: "status_change",
          entityType: "fuel_equipment_load",
          entityId: load.id,
          oldState: { reviewStatus: load.reviewStatus, flagReasons: load.flagReasons, duplicateOfId: load.duplicateOfId },
          newState: { reviewStatus, flagReasons: load.flagReasons, duplicateOfId: next.duplicateOfId, reviewedBy: session.user.id, reviewedAt: now },
          reason: note,
          worksiteId: load.worksiteId,
        }, tx)
        // La decisión saca o mete la carga en la serie: las cargas siguientes del
        // equipo cambiaron de base, así que sus decisiones se reabren si corresponde.
        if (vehicleId) await recomputeVehicleSeries(tx, vehicleId)
      },
    )
    return { ok: true as const }
  })
}

/** Tope de cargas por decisión en lote: una selección más grande es casi seguro un error de clic. */
export const MAX_BATCH_DECISION = 100

export type BatchDecisionResult =
  | { ok: true; decided: number; skipped: number; worksiteIds: string[] }
  | { ok: false; message: string }

function checkNote(raw: string | undefined | null): { ok: true; note: string } | { ok: false; message: string } {
  const note = (raw ?? "").trim()
  if (note.length < REVIEW_NOTE_MIN_LENGTH) {
    return { ok: false, message: `Escribe el motivo de la decisión (al menos ${REVIEW_NOTE_MIN_LENGTH} caracteres)` }
  }
  if (note.length > REVIEW_NOTE_MAX_LENGTH) {
    return { ok: false, message: `El motivo no puede superar ${REVIEW_NOTE_MAX_LENGTH} caracteres` }
  }
  return { ok: true, note }
}

/**
 * Decide varias cargas marcadas con una nota común, en UNA transacción y con una
 * auditoría por carga (cada una queda con su estado anterior y la misma nota).
 *
 * Una carga que alguien más ya decidió, o que se anuló, se omite y se cuenta en
 * `skipped`: la selección se armó con la pantalla de hace unos minutos y no hay
 * por qué perder las demás. En cambio un id que no existe o que está fuera de
 * las faenas de quien decide aborta TODO (misma respuesta para los dos casos),
 * porque eso no sale de un clic normal. El recálculo de la serie corre una vez
 * por equipo, al final, con todas las decisiones ya escritas.
 */
export async function decideFlaggedLoads(
  session: Session,
  input: { loadIds: string[]; decision: "approve" | "reject"; note: string },
): Promise<BatchDecisionResult> {
  if (!can(session, "combustibles:approve_flagged")) {
    return { ok: false, message: "No tienes permisos para revisar cargas marcadas" }
  }
  if (input.decision !== "approve" && input.decision !== "reject") return { ok: false, message: "Decisión no reconocida" }
  const note = checkNote(input.note)
  if (!note.ok) return note
  const noteText = note.note
  const loadIds = [...new Set((input.loadIds ?? []).filter((id): id is string => typeof id === "string" && id.trim() !== ""))]
  if (loadIds.length === 0) return { ok: false, message: "Elige al menos una carga" }
  if (loadIds.length > MAX_BATCH_DECISION) return { ok: false, message: `Decide hasta ${MAX_BATCH_DECISION} cargas por vez` }

  return db.transaction(async (tx) => {
    // Candado por equipo antes de bloquear las filas (equipo → carga → serie),
    // en orden estable: dos decisiones en lote que se cruzan no se bloquean en cruz.
    const heads = await tx.select({ vehicleId: fuelEquipmentLoads.vehicleId })
      .from(fuelEquipmentLoads)
      .where(inArray(fuelEquipmentLoads.id, loadIds))
    await lockVehiclesSeries(tx, heads.flatMap((row) => (row.vehicleId ? [row.vehicleId] : [])))

    const loads = await tx.select({
      id: fuelEquipmentLoads.id,
      worksiteId: fuelEquipmentLoads.worksiteId,
      vehicleId: fuelEquipmentLoads.vehicleId,
      occurredAt: fuelEquipmentLoads.occurredAt,
      reviewStatus: fuelEquipmentLoads.reviewStatus,
      flagReasons: fuelEquipmentLoads.flagReasons,
      duplicateOfId: fuelEquipmentLoads.duplicateOfId,
      voidedAt: fuelEquipmentLoads.voidedAt,
    })
      .from(fuelEquipmentLoads)
      .where(inArray(fuelEquipmentLoads.id, loadIds))
      // Orden estable: dos decisiones en lote que se cruzan toman los bloqueos en el mismo orden.
      .orderBy(fuelEquipmentLoads.id)
      .for("update")

    if (loads.length !== loadIds.length || loads.some((load) => !canAccessWorksite(session, load.worksiteId))) {
      return { ok: false as const, message: "Alguna carga no existe o no está en tus faenas" }
    }

    const reviewStatus = input.decision === "approve" ? "approved" : "rejected"
    const now = new Date().toISOString()
    // Una carga que alguien más ya decidió, o que se anuló, se omite; el resto
    // se decide aunque la selección venga con alguna vencida.
    const decidable = loads.filter((load) => !load.voidedAt && load.reviewStatus === "flagged")
    const skipped = loads.length - decidable.length
    if (decidable.length === 0) {
      return { ok: false as const, message: loads.length === 1 ? "La carga ya no está por decidir (otra persona pudo decidirla)" : "Ninguna de las cargas seguía por decidir (otra persona pudo decidirlas)" }
    }

    const decide = async (load: (typeof decidable)[number]) => {
      const duplicateOfId = input.decision === "approve" ? null : load.duplicateOfId
      await tx.update(fuelEquipmentLoads)
        .set({ reviewStatus, reviewNote: noteText, reviewedBy: session.user.id, reviewedAt: now, duplicateOfId, updatedAt: now })
        .where(and(eq(fuelEquipmentLoads.id, load.id), eq(fuelEquipmentLoads.reviewStatus, "flagged")))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "status_change",
        entityType: "fuel_equipment_load",
        entityId: load.id,
        oldState: { reviewStatus: load.reviewStatus, flagReasons: load.flagReasons, duplicateOfId: load.duplicateOfId },
        newState: { reviewStatus, flagReasons: load.flagReasons, duplicateOfId, reviewedBy: session.user.id, reviewedAt: now, batch: loadIds.length > 1 },
        reason: noteText,
        worksiteId: load.worksiteId,
      }, tx)
    }

    // Una vuelta por equipo: decidir cambia la serie de las cargas posteriores
    // del mismo equipo, y esas decisiones también se reabren si cambiaron de base.
    const byVehicle = new Map<string | null, typeof decidable>()
    for (const load of decidable) {
      const key = load.vehicleId
      byVehicle.set(key, [...(byVehicle.get(key) ?? []), load])
    }
    const context = await loadPerformanceControlContext(tx)
    const worksiteIds = new Set<string>()
    for (const [vehicleId, vehicleLoads] of byVehicle) {
      // Desde la más antigua del lote: lo anterior a ella no cambia.
      const after = vehicleLoads.reduce((min, load) => (load.occurredAt < min ? load.occurredAt : min), vehicleLoads[0]!.occurredAt)
      for (const load of vehicleLoads) worksiteIds.add(load.worksiteId)
      await projectWithStaleDecisions(
        tx,
        vehicleId,
        after,
        { userId: session.user.id, userEmail: session.user.email ?? undefined },
        async () => {
          for (const load of vehicleLoads) await decide(load)
          if (vehicleId) await recomputeVehicleSeries(tx, vehicleId, context)
        },
      )
    }
    return { ok: true as const, decided: decidable.length, skipped, worksiteIds: [...worksiteIds] }
  })
}

export type ReopenDecisionResult =
  | { ok: true; reviewStatus: "ok" | "flagged"; worksiteId: string }
  | { ok: false; message: string }

/**
 * Deshace la decisión de una carga («Cuenta» o «No cuenta»): vuelve a `ok` y la
 * serie del equipo se recalcula, sin restaurar nada a mano. El recálculo vuelve
 * a marcar lo que corresponda —una lectura que retrocede, litros sobre la
 * capacidad— y una duplicada se detecta sola otra vez, así que «deshacer» no
 * promete que la carga quede limpia: promete que ya nadie la decidió.
 *
 * Es la contracara de `decideFlaggedLoad`: mismo permiso, mismo alcance, misma
 * nota de 10 a 500 caracteres, y la auditoría deja el estado anterior (con la
 * nota y quién la decidió) para que la decisión deshecha no se pierda.
 */
export async function reopenFlaggedDecision(
  session: Session,
  input: { loadId: string; note: string },
): Promise<ReopenDecisionResult> {
  if (!can(session, "combustibles:approve_flagged")) {
    return { ok: false, message: "No tienes permisos para revisar cargas marcadas" }
  }
  const note = checkNote(input.note)
  if (!note.ok) return note
  if (typeof input.loadId !== "string" || input.loadId.trim() === "") return { ok: false, message: "Falta la carga" }

  return db.transaction(async (tx) => {
    // Equipo primero (ver `lockVehicleSeries`): deshacer una decisión también
    // mueve la serie de las cargas siguientes.
    const [head] = await tx.select({ vehicleId: fuelEquipmentLoads.vehicleId })
      .from(fuelEquipmentLoads)
      .where(eq(fuelEquipmentLoads.id, input.loadId))
    if (head?.vehicleId) await lockVehicleSeries(tx, head.vehicleId)

    const [load] = await tx.select({
      id: fuelEquipmentLoads.id,
      worksiteId: fuelEquipmentLoads.worksiteId,
      vehicleId: fuelEquipmentLoads.vehicleId,
      occurredAt: fuelEquipmentLoads.occurredAt,
      reviewStatus: fuelEquipmentLoads.reviewStatus,
      reviewNote: fuelEquipmentLoads.reviewNote,
      reviewedBy: fuelEquipmentLoads.reviewedBy,
      reviewedAt: fuelEquipmentLoads.reviewedAt,
      flagReasons: fuelEquipmentLoads.flagReasons,
      duplicateOfId: fuelEquipmentLoads.duplicateOfId,
      voidedAt: fuelEquipmentLoads.voidedAt,
    })
      .from(fuelEquipmentLoads)
      .where(eq(fuelEquipmentLoads.id, input.loadId))
      .for("update")
      .limit(1)

    if (!load || !canAccessWorksite(session, load.worksiteId)) {
      return { ok: false as const, message: "La carga no existe o no está en tus faenas" }
    }
    if (load.voidedAt) return { ok: false as const, message: "La carga está anulada; no hay decisión que deshacer" }
    if (load.reviewStatus !== "approved" && load.reviewStatus !== "rejected") {
      return { ok: false as const, message: "La carga no tiene una decisión que deshacer (otra persona pudo deshacerla)" }
    }
    // La proyección pudo mover la carga de equipo entre la lectura previa y el bloqueo.
    if (load.vehicleId && load.vehicleId !== head?.vehicleId) await lockVehicleSeries(tx, load.vehicleId)

    const now = new Date().toISOString()
    // Con equipo, la serie decide si la carga vuelve a marcarse. Sin equipo no hay serie
    // y las marcas guardadas (equipo sin ficha, fecha pasada) siguen mandando.
    let finalStatus: "ok" | "flagged" = load.flagReasons.length > 0 ? "flagged" : "ok"
    let finalFlags: string[] = load.flagReasons
    let finalDuplicateOfId: string | null = load.duplicateOfId
    const vehicleId = load.vehicleId
    await projectWithStaleDecisions(
      tx,
      vehicleId,
      load.occurredAt,
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      async () => {
        await tx.update(fuelEquipmentLoads)
          .set({ reviewStatus: "ok", reviewNote: null, reviewedBy: null, reviewedAt: null, updatedAt: now })
          .where(eq(fuelEquipmentLoads.id, load.id))
        if (!vehicleId) return
        await recomputeVehicleSeries(tx, vehicleId)
        const [after] = await tx.select({
          reviewStatus: fuelEquipmentLoads.reviewStatus,
          flagReasons: fuelEquipmentLoads.flagReasons,
          duplicateOfId: fuelEquipmentLoads.duplicateOfId,
        }).from(fuelEquipmentLoads).where(eq(fuelEquipmentLoads.id, load.id)).limit(1)
        finalStatus = after?.reviewStatus === "flagged" ? "flagged" : "ok"
        finalFlags = after?.flagReasons ?? []
        finalDuplicateOfId = after?.duplicateOfId ?? null
      },
    )
    if (!vehicleId && finalStatus === "flagged") {
      await tx.update(fuelEquipmentLoads).set({ reviewStatus: "flagged" }).where(eq(fuelEquipmentLoads.id, load.id))
    }

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "status_change",
      entityType: "fuel_equipment_load",
      entityId: load.id,
      oldState: {
        reviewStatus: load.reviewStatus,
        reviewNote: load.reviewNote,
        reviewedBy: load.reviewedBy,
        reviewedAt: load.reviewedAt,
        flagReasons: load.flagReasons,
        duplicateOfId: load.duplicateOfId,
      },
      newState: { reviewStatus: finalStatus, flagReasons: finalFlags, duplicateOfId: finalDuplicateOfId, reopened: true },
      reason: note.note,
      worksiteId: load.worksiteId,
    }, tx)

    return { ok: true as const, reviewStatus: finalStatus, worksiteId: load.worksiteId }
  })
}

export type ResolveRequestResult =
  | { ok: true; markId: string; entityType: string; entityId: string; markedBy: string; worksiteId: string | null }
  | { ok: false; message: string }

/**
 * Cierra un pedido de revisión («Pedir que la revisen», desde Cargas): pasa a
 * `resolved` con la nota de quien lo revisó, su nombre y la hora. El pedido no se
 * borra, así que queda en «Decididas» y en la auditoría. Sólo se puede cerrar un
 * pedido abierto; el índice único parcial de la tabla garantiza que hay uno solo
 * por carga.
 */
export async function resolveReviewRequest(
  session: Session,
  input: { markId: string; note: string },
): Promise<ResolveRequestResult> {
  if (!can(session, "combustibles:tae_review") && !can(session, "combustibles:approve_flagged")) {
    return { ok: false, message: "No tienes permisos para resolver pedidos de revisión" }
  }
  const note = checkNote(input.note)
  if (!note.ok) return note
  if (typeof input.markId !== "string" || input.markId.trim() === "") return { ok: false, message: "Falta el pedido" }

  return db.transaction(async (tx) => {
    const [mark] = await tx.select().from(fuelReviewMarks).where(eq(fuelReviewMarks.id, input.markId)).for("update").limit(1)
    // Un pedido sin faena (marca anterior al rediseño que no se pudo completar) sólo lo ven los roles globales.
    const inScope = mark ? (mark.worksiteId ? canAccessWorksite(session, mark.worksiteId) : isGlobalRole(session)) : false
    if (!mark || !inScope) return { ok: false as const, message: "El pedido no existe o no está en tus faenas" }
    if (mark.status !== "open") return { ok: false as const, message: "El pedido ya no está abierto (otra persona pudo resolverlo)" }

    const now = new Date().toISOString()
    await tx.update(fuelReviewMarks)
      .set({ status: "resolved", resolvedBy: session.user.id, resolvedAt: now, resolutionNote: note.note })
      .where(and(eq(fuelReviewMarks.id, mark.id), eq(fuelReviewMarks.status, "open")))
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "status_change",
      entityType: mark.entityType,
      entityId: mark.entityId,
      oldState: { reviewRequest: "open", note: mark.notes },
      newState: { reviewRequest: "resolved", resolvedBy: session.user.id, resolvedAt: now },
      reason: note.note,
      worksiteId: mark.worksiteId,
    }, tx)
    return { ok: true as const, markId: mark.id, entityType: mark.entityType, entityId: mark.entityId, markedBy: mark.markedBy, worksiteId: mark.worksiteId }
  })
}
