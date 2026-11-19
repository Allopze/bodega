import { asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetTransfers,
  fuelVehicleWorksiteIntervals as stays,
  users,
  worksites,
  type FleetStaySource,
} from "@/db/schema"

/** Una estadía del equipo en una faena, con el traslado que la abrió (si fue uno). */
export interface VehicleStay {
  id: string
  worksiteId: string
  worksiteName: string
  /** Fecha civil `YYYY-MM-DD`; nulo = «desde siempre» (la primera estadía). */
  startedOn: string | null
  /** Fecha civil `YYYY-MM-DD`, inclusiva; nulo = estadía actual. */
  endedOn: string | null
  source: FleetStaySource
  /** Para `reconstruccion`: qué registros sostienen la estadía. */
  evidence: string | null
  transfer: {
    id: string
    folio: string
    reason: string
    authorizedBy: string
    createdByName: string | null
    voided: boolean
  } | null
}

/**
 * Recorrido de un equipo por las faenas, de la más antigua a la actual. La
 * primera estadía no tiene inicio, por eso `NULLS FIRST`.
 */
export async function listVehicleStays(vehicleId: string): Promise<VehicleStay[]> {
  const rows = await db.select({
    id: stays.id,
    worksiteId: stays.worksiteId,
    worksiteName: worksites.name,
    startedOn: stays.startedOn,
    endedOn: stays.endedOn,
    source: stays.source,
    evidence: stays.evidence,
    transferId: fleetTransfers.id,
    folio: fleetTransfers.folio,
    reason: fleetTransfers.reason,
    authorizedBy: fleetTransfers.authorizedBy,
    createdByName: users.name,
    voidedAt: fleetTransfers.voidedAt,
  })
    .from(stays)
    .innerJoin(worksites, eq(worksites.id, stays.worksiteId))
    .leftJoin(fleetTransfers, eq(fleetTransfers.id, stays.transferId))
    .leftJoin(users, eq(users.id, fleetTransfers.createdBy))
    .where(eq(stays.vehicleId, vehicleId))
    .orderBy(sql`${stays.startedOn} ASC NULLS FIRST`, asc(stays.createdAt))

  return rows.map((row) => ({
    id: row.id,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    startedOn: row.startedOn,
    endedOn: row.endedOn,
    source: row.source,
    evidence: row.evidence,
    transfer: row.transferId
      ? {
          id: row.transferId,
          folio: row.folio ?? "",
          reason: row.reason ?? "",
          authorizedBy: row.authorizedBy ?? "",
          createdByName: row.createdByName,
          voided: row.voidedAt !== null,
        }
      : null,
  }))
}
