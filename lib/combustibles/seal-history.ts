/**
 * Historial de movimientos de sellos (sección 9) derivado de fuel_tae_submissions.
 * Cada carga TAE que registra sello retirado o instalado produce una entrada
 * en este read model. Los sellos repetidos y la continuidad inconsistente se
 * calculan aquí como base para las reglas de anomalía (sección 11).
 */

import type { Session } from "next-auth"
import { and, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeSubmissions, fuelTaeLoadingPoints, worksites, fuelVehicles, fuelProducts } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"

export interface SealMovement {
  submissionId: string
  loadedAt: string
  worksiteName: string | null
  loadingPointName: string | null
  equipmentCode: string
  plate: string | null
  productName: string | null
  liters: number
  /** Sello que se retiró en esta carga. */
  removedSeal: string | null
  /** Sello que se instaló en esta carga. */
  installedSeal: string | null
  /** La siguiente carga (por fecha) para este mismo número de sello instalado. */
  nextRemovedBy: string | null
  /** La siguiente carga (por fecha) para este mismo número de sello instalado — fecha. */
  nextRemovedAt: string | null
  /** `true` si este número de sello instalado aparece como instalado más de una vez. */
  installedRepeated: boolean
  /** `true` si este número de sello instalado ya aparecía como instalado en otra carga
   *  sin aparecer como retirado en las del medio (falta de continuidad). */
  continuityBroken: boolean
}

export interface SealHistoryFilters {
  worksiteId?: string
  from?: string
  to?: string
  sealNumber?: string
  plate?: string
}

export async function getSealHistory(session: Session, filters: SealHistoryFilters = {}): Promise<SealMovement[]> {
  const rows = await db.select({
    submissionId: fuelTaeSubmissions.id,
    loadedAt: sql<string>`to_char(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago', 'YYYY-MM-DD HH24:MI')`,
    worksiteName: worksites.name,
    loadingPointName: fuelTaeLoadingPoints.name,
    equipmentCode: fuelTaeSubmissions.equipmentCodeSnapshot,
    plate: fuelTaeSubmissions.plateSnapshot,
    productName: fuelProducts.name,
    liters: sql<number>`${fuelTaeSubmissions.liters}`,
    removedSeal: fuelTaeSubmissions.removedSealNumber,
    installedSeal: fuelTaeSubmissions.installedSealNumber,
  })
    .from(fuelTaeSubmissions)
    .leftJoin(worksites, eq(fuelTaeSubmissions.worksiteId, worksites.id))
    .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeSubmissions.loadingPointId, fuelTaeLoadingPoints.id))
    .leftJoin(fuelVehicles, eq(fuelTaeSubmissions.vehicleId, fuelVehicles.id))
    .leftJoin(fuelProducts, eq(fuelTaeSubmissions.productId, fuelProducts.id))
    .where(and(
      worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
      eq(fuelTaeSubmissions.status, "validated"),
      or(isNotNull(fuelTaeSubmissions.removedSealNumber), isNotNull(fuelTaeSubmissions.installedSealNumber)),
      filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
      filters.from ? gte(sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date`, sql`${filters.from}::date`) : undefined,
      filters.to ? lte(sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date`, sql`${filters.to}::date`) : undefined,
      filters.sealNumber ? or(
        eq(fuelTaeSubmissions.removedSealNumber, filters.sealNumber),
        eq(fuelTaeSubmissions.installedSealNumber, filters.sealNumber),
      ) : undefined,
      filters.plate ? eq(fuelTaeSubmissions.plateSnapshot, filters.plate.trim().toUpperCase()) : undefined,
    ))
    .orderBy(sql`${fuelTaeSubmissions.loadedAt} desc`)
    .limit(2000)

  const movements: SealMovement[] = rows.map((r) => ({
    submissionId: r.submissionId,
    loadedAt: r.loadedAt,
    worksiteName: r.worksiteName,
    loadingPointName: r.loadingPointName,
    equipmentCode: r.equipmentCode,
    plate: r.plate,
    productName: r.productName,
    liters: Number(r.liters),
    removedSeal: r.removedSeal,
    installedSeal: r.installedSeal,
    nextRemovedBy: null,
    nextRemovedAt: null,
    installedRepeated: false,
    continuityBroken: false,
  }))

  // Detectar sellos repetidos: mismo installedSealNumber aparece 2+ veces.
  const installedCounts = new Map<string, number>()
  for (const m of movements) {
    if (m.installedSeal) installedCounts.set(m.installedSeal, (installedCounts.get(m.installedSeal) ?? 0) + 1)
  }
  for (const m of movements) {
    if (m.installedSeal && (installedCounts.get(m.installedSeal) ?? 0) > 1) m.installedRepeated = true
  }

  // Detectar continuidad: por cada sello instalado, buscar si aparece como
  // retirado en alguna carga posterior. Si no, está roto.
  const removedSet = new Set(movements.filter((m) => m.removedSeal).map((m) => m.removedSeal))
  for (const m of movements) {
    if (m.installedSeal && !removedSet.has(m.installedSeal)) m.continuityBroken = true
  }

  // Enlazar siguiente: para cada sello instalado, buscar la carga donde se retira.
  for (const m of movements) {
    if (!m.installedSeal) continue
    const next = movements.find((other) => other.removedSeal === m.installedSeal && other.loadedAt > m.loadedAt)
    if (next) {
      m.nextRemovedBy = next.equipmentCode ? `${next.equipmentCode} (${next.plate})` : next.plate
      m.nextRemovedAt = next.loadedAt
    }
  }

  return movements
}
