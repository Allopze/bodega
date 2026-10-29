import { and, isNull, lt } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsAlerts, fleetGpsPositionHistory, fleetGpsTrips } from "@/db/schema"

export interface OnwayRetentionResult {
  deletedPoints: number
  purgedAlertCoordinates: number
  deletedAlerts: number
  deletedTrips: number
}

function cutoffMonths(now: Date, months: number) {
  const value = new Date(now)
  value.setUTCMonth(value.getUTCMonth() - months)
  return value.toISOString()
}

/**
 * Retención explícita: puntos y coordenadas detalladas no permanecen más de
 * 30 días; los resúmenes y alertas existen a lo sumo 24 meses.
 */
export async function purgeOnwayRetention(now = new Date()): Promise<OnwayRetentionResult> {
  const pointCutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const summaryCutoff = cutoffMonths(now, 24)
  const purgedAt = now.toISOString()
  return await db.transaction(async (tx) => {
    const deletedPoints = await tx.delete(fleetGpsPositionHistory)
      .where(lt(fleetGpsPositionHistory.occurredAt, pointCutoff)).returning({ id: fleetGpsPositionHistory.id })
    const purgedCoordinates = await tx.update(fleetGpsAlerts).set({
      latitude: null,
      longitude: null,
      coordinatesPurgedAt: purgedAt,
      updatedAt: purgedAt,
    }).where(and(
      lt(fleetGpsAlerts.occurredAt, pointCutoff),
      isNull(fleetGpsAlerts.coordinatesPurgedAt),
    )).returning({ id: fleetGpsAlerts.id })
    const deletedAlerts = await tx.delete(fleetGpsAlerts)
      .where(lt(fleetGpsAlerts.occurredAt, summaryCutoff)).returning({ id: fleetGpsAlerts.id })
    const deletedTrips = await tx.delete(fleetGpsTrips)
      .where(lt(fleetGpsTrips.endedAt, summaryCutoff)).returning({ id: fleetGpsTrips.id })
    return {
      deletedPoints: deletedPoints.length,
      purgedAlertCoordinates: purgedCoordinates.length,
      deletedAlerts: deletedAlerts.length,
      deletedTrips: deletedTrips.length,
    }
  })
}
