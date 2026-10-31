import { and, eq, gt, inArray, isNull } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelEquipmentLoads } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { recomputeVehicleSeries } from "./projection-series"

/**
 * Decisiones que dejan de valer cuando se intercala una carga.
 *
 * Una decisión humana (cuenta / no cuenta) se tomó mirando una serie concreta:
 * la lectura contra la que se comparó, los litros acumulados, las cargas que
 * formaban el promedio. Cuando se registra una carga de otro día entre medio, la
 * serie de las cargas posteriores del mismo equipo cambia, y la decisión ya no
 * describe lo que ve la plataforma. Esas cargas vuelven a evaluarse (si siguen
 * marcadas, quedan «por decidir»; si la marca desapareció, ya no necesitan que
 * alguien decida) y cada una deja una auditoría con el estado anterior.
 *
 * Uso: tomar la foto ANTES de proyectar la carga nueva y reiniciar DESPUÉS, en
 * la misma transacción:
 *
 *   const before = await snapshotDecidedLoadsAfter(tx, vehicleId, loadedAt)
 *   await projectTaeSubmissions(tx, [id])
 *   await resetStaleDecisionsAfter(tx, before, { userId })
 */

export const STALE_DECISION_REASON = "Se registró una carga anterior del equipo: la decisión tomada ya no se ajusta a la serie y vuelve a revisarse"

/** Lo que define «la serie» de una carga: si cambia algo de esto, la decisión se tomó sobre otro dato. */
interface SeriesFingerprint {
  anchorLoadId: string | null
  meterDelta: number | null
  accumulatedLiters: number | null
  performanceValue: number | null
  performanceStatus: string
  duplicateOfId: string | null
  flagReasons: string[]
}

interface DecidedLoad {
  id: string
  worksiteId: string
  reviewStatus: string
  reviewNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  fingerprint: SeriesFingerprint
}

export interface DecidedLoadsSnapshot {
  vehicleId: string
  loads: Map<string, DecidedLoad>
}

const SERIES_COLUMNS = {
  id: fuelEquipmentLoads.id,
  worksiteId: fuelEquipmentLoads.worksiteId,
  reviewStatus: fuelEquipmentLoads.reviewStatus,
  reviewNote: fuelEquipmentLoads.reviewNote,
  reviewedBy: fuelEquipmentLoads.reviewedBy,
  reviewedAt: fuelEquipmentLoads.reviewedAt,
  anchorLoadId: fuelEquipmentLoads.anchorLoadId,
  meterDelta: fuelEquipmentLoads.meterDelta,
  accumulatedLiters: fuelEquipmentLoads.accumulatedLiters,
  performanceValue: fuelEquipmentLoads.performanceValue,
  performanceStatus: fuelEquipmentLoads.performanceStatus,
  duplicateOfId: fuelEquipmentLoads.duplicateOfId,
  flagReasons: fuelEquipmentLoads.flagReasons,
}

type SeriesRow = {
  id: string
  worksiteId: string
  reviewStatus: string
  reviewNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  anchorLoadId: string | null
  meterDelta: number | null
  accumulatedLiters: number | null
  performanceValue: number | null
  performanceStatus: string
  duplicateOfId: string | null
  flagReasons: string[] | null
}

const toDecided = (row: SeriesRow): DecidedLoad => ({
  id: row.id,
  worksiteId: row.worksiteId,
  reviewStatus: row.reviewStatus,
  reviewNote: row.reviewNote,
  reviewedBy: row.reviewedBy,
  reviewedAt: row.reviewedAt,
  fingerprint: {
    anchorLoadId: row.anchorLoadId,
    meterDelta: row.meterDelta,
    accumulatedLiters: row.accumulatedLiters,
    performanceValue: row.performanceValue,
    performanceStatus: row.performanceStatus,
    duplicateOfId: row.duplicateOfId,
    flagReasons: row.flagReasons ?? [],
  },
})

const numEq = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(Number(a) - Number(b)) < 1e-6

export function seriesFingerprintChanged(before: SeriesFingerprint, after: SeriesFingerprint): boolean {
  return before.anchorLoadId !== after.anchorLoadId
    || !numEq(before.meterDelta, after.meterDelta)
    || !numEq(before.accumulatedLiters, after.accumulatedLiters)
    || !numEq(before.performanceValue, after.performanceValue)
    || before.performanceStatus !== after.performanceStatus
    || before.duplicateOfId !== after.duplicateOfId
    || JSON.stringify(before.flagReasons) !== JSON.stringify(after.flagReasons)
}

/** Las cargas del equipo posteriores a `after` que ya tienen una decisión (cuenta / no cuenta) y no están anuladas. */
export async function snapshotDecidedLoadsAfter(tx: Tx, vehicleId: string, after: string): Promise<DecidedLoadsSnapshot> {
  const rows: SeriesRow[] = await tx.select(SERIES_COLUMNS).from(fuelEquipmentLoads)
    .where(and(
      eq(fuelEquipmentLoads.vehicleId, vehicleId),
      gt(fuelEquipmentLoads.occurredAt, after),
      inArray(fuelEquipmentLoads.reviewStatus, ["approved", "rejected"]),
      isNull(fuelEquipmentLoads.voidedAt),
    ))
  return { vehicleId, loads: new Map(rows.map((row) => [row.id, toDecided(row)])) }
}

/**
 * Compara la serie de esas cargas con la de antes y reabre las que cambiaron:
 * la decisión se descarta (estado «sin observaciones» y vuelve a calcularse su
 * marca) y queda una auditoría por carga con el estado anterior. Devuelve los
 * ids reabiertos. Sin cambios en la serie, no toca nada.
 */
export async function resetStaleDecisionsAfter(
  tx: Tx,
  snapshot: DecidedLoadsSnapshot,
  actor: { userId: string | null; userEmail?: string },
): Promise<string[]> {
  if (snapshot.loads.size === 0) return []
  const ids = [...snapshot.loads.keys()]
  const currentRows: SeriesRow[] = await tx.select(SERIES_COLUMNS).from(fuelEquipmentLoads).where(inArray(fuelEquipmentLoads.id, ids))
  const stale = currentRows.filter((row) => {
    const before = snapshot.loads.get(row.id)
    // Si la decisión ya no está (alguien la cambió en la misma transacción), no se pisa.
    return before !== undefined && (row.reviewStatus === "approved" || row.reviewStatus === "rejected")
      && seriesFingerprintChanged(before.fingerprint, toDecided(row).fingerprint)
  })
  if (stale.length === 0) return []

  const now = new Date().toISOString()
  await tx.update(fuelEquipmentLoads)
    .set({ reviewStatus: "ok", reviewNote: null, reviewedBy: null, reviewedAt: null, updatedAt: now })
    .where(inArray(fuelEquipmentLoads.id, stale.map((row) => row.id)))
  // La serie decide de nuevo qué marcas le corresponden a cada una.
  await recomputeVehicleSeries(tx, snapshot.vehicleId)

  const after: Array<{ id: string; reviewStatus: string; flagReasons: string[] | null }> = await tx.select({
    id: fuelEquipmentLoads.id,
    reviewStatus: fuelEquipmentLoads.reviewStatus,
    flagReasons: fuelEquipmentLoads.flagReasons,
  }).from(fuelEquipmentLoads).where(inArray(fuelEquipmentLoads.id, stale.map((row) => row.id)))
  const afterById = new Map(after.map((row) => [row.id, row]))

  for (const row of stale) {
    const previous = snapshot.loads.get(row.id)!
    const next = afterById.get(row.id)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "status_change",
      entityType: "fuel_equipment_load",
      entityId: row.id,
      oldState: {
        reviewStatus: previous.reviewStatus,
        flagReasons: previous.fingerprint.flagReasons,
        reviewNote: previous.reviewNote,
        reviewedBy: previous.reviewedBy,
        reviewedAt: previous.reviewedAt,
      },
      newState: { reviewStatus: next?.reviewStatus ?? "ok", flagReasons: next?.flagReasons ?? [] },
      reason: STALE_DECISION_REASON,
      worksiteId: previous.worksiteId,
    }, tx)
  }
  return stale.map((row) => row.id)
}
