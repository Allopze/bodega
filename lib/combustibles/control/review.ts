import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelEquipmentLoads } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { recomputeVehicleSeries } from "./projection-series"

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
    const [load] = await tx.select({
      id: fuelEquipmentLoads.id,
      worksiteId: fuelEquipmentLoads.worksiteId,
      vehicleId: fuelEquipmentLoads.vehicleId,
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

    if (load.vehicleId) await recomputeVehicleSeries(tx, load.vehicleId)
    return { ok: true as const }
  })
}
