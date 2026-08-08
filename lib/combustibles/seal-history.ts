/**
 * Historial de movimientos de sellos (sección 9) derivado de fuel_tae_submissions.
 * Cada carga TAE que registra sello retirado o instalado produce una entrada
 * en este read model. Los sellos repetidos y la continuidad inconsistente se
 * calculan aquí como base para las reglas de anomalía (sección 11).
 */

import type { Session } from "next-auth"
import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm"
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

/**
 * Tope de filas del historial. Los avisos de sello repetido y continuidad rota
 * se derivan de las filas traídas, así que al alcanzarlo pueden ser incompletos
 * — la página lo advierte.
 */
export const SEAL_HISTORY_MAX_ROWS = 2000

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
    .limit(SEAL_HISTORY_MAX_ROWS)

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

  // Enlazar el siguiente retiro y derivar la continuidad del MISMO cálculo.
  //
  // Antes eran dos criterios distintos y se contradecían: la continuidad usaba
  // un Set de sellos retirados sin mirar la fecha, así que un sello retirado
  // ANTES de instalarse (sello reutilizado) contaba como continuo mientras la
  // columna "Siguiente" —que sí exige posterioridad— quedaba vacía. Y el enlace
  // tomaba el primer match de un array ordenado DESC, es decir el retiro MÁS
  // TARDÍO en vez del inmediato.
  const removalsBySeal = new Map<string, SealMovement[]>()
  for (const m of movements) {
    if (!m.removedSeal) continue
    const list = removalsBySeal.get(m.removedSeal)
    if (list) list.push(m)
    else removalsBySeal.set(m.removedSeal, [m])
  }

  for (const m of movements) {
    if (!m.installedSeal) continue
    let next: SealMovement | null = null
    for (const candidate of removalsBySeal.get(m.installedSeal) ?? []) {
      if (candidate.loadedAt <= m.loadedAt) continue
      if (!next || candidate.loadedAt < next.loadedAt) next = candidate
    }
    if (next) {
      m.nextRemovedBy = next.equipmentCode ? `${next.equipmentCode} (${next.plate})` : next.plate
      m.nextRemovedAt = next.loadedAt
    } else {
      m.continuityBroken = true
    }
  }

  // Segunda pasada, SIN filtro de fecha/faena de página, sólo para los sellos
  // que quedaron "sin siguiente" dentro de la ventana filtrada: filtrar agosto
  // podía marcar como roto un sello que se retiró en septiembre, simplemente
  // porque esa carga cayó fuera del recorte. Acotada a `inArray` sobre los
  // sellos realmente rotos de esta página (no un table scan completo) — el
  // costo es proporcional a las anomalías encontradas, no al volumen total.
  const brokenSeals = [...new Set(movements.filter((m) => m.continuityBroken && m.installedSeal).map((m) => m.installedSeal!))]
  if (brokenSeals.length > 0) {
    const laterRemovals = await db.select({
      loadedAt: sql<string>`to_char(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago', 'YYYY-MM-DD HH24:MI')`,
      equipmentCode: fuelTaeSubmissions.equipmentCodeSnapshot,
      plate: fuelTaeSubmissions.plateSnapshot,
      removedSeal: fuelTaeSubmissions.removedSealNumber,
    })
      .from(fuelTaeSubmissions)
      .where(and(
        worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
        eq(fuelTaeSubmissions.status, "validated"),
        inArray(fuelTaeSubmissions.removedSealNumber, brokenSeals),
      ))

    const candidatesBySeal = new Map<string, typeof laterRemovals>()
    for (const row of laterRemovals) {
      if (!row.removedSeal) continue
      const list = candidatesBySeal.get(row.removedSeal)
      if (list) list.push(row)
      else candidatesBySeal.set(row.removedSeal, [row])
    }

    for (const m of movements) {
      if (!m.continuityBroken || !m.installedSeal) continue
      let found: (typeof laterRemovals)[number] | null = null
      for (const candidate of candidatesBySeal.get(m.installedSeal) ?? []) {
        if (candidate.loadedAt <= m.loadedAt) continue
        if (!found || candidate.loadedAt < found.loadedAt) found = candidate
      }
      if (found) {
        m.nextRemovedBy = found.equipmentCode ? `${found.equipmentCode} (${found.plate})` : found.plate
        m.nextRemovedAt = found.loadedAt
        m.continuityBroken = false
      }
    }
  }

  return movements
}
