/**
 * Historial de movimientos de sellos (sección 9) derivado de fuel_tae_submissions.
 * Cada carga TAE que registra sello retirado o instalado produce una entrada
 * en este read model. Los sellos repetidos y la continuidad inconsistente se
 * calculan aquí como base para las reglas de anomalía (sección 11).
 *
 * Población (auditoría 2026-11-05, 5.6): la misma que las otras dos pestañas de
 * la pantalla de sellos —`status <> 'voided'`, no sólo `validated`—. Antes este
 * historial omitía las cargas `submitted`/`observed` que «Por supervisor» y
 * «Detalle por equipo» sí contaban, y las tres pestañas no cuadraban entre sí.
 *
 * Este módulo también es el dueño de la retractación de `fuel_seal_movements`
 * (5.7): un movimiento deja de contar cuando la carga deja de estar validada,
 * pero la fila no se borra —se marca— para no perder el historial del sello.
 */

import type { Session } from "next-auth"
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelSealMovements, fuelTaeSubmissions, fuelTaeLoadingPoints, worksites, fuelVehicles, fuelProducts } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"

export interface SealMovement {
  submissionId: string
  /** Equipo de la ficha (`fuel_vehicles.id`); `null` si la carga no se asoció a uno. */
  vehicleId: string | null
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
  /** `true` si el equipo volvió a cargar después de instalar este sello y ninguna carga
   *  lo retiró (falta de continuidad). El último sello de un equipo NO es un problema:
   *  todavía no hay carga siguiente que lo retire, y ahí `continuityBroken` es `false`. */
  continuityBroken: boolean
  /** `true` si ésta es la última carga validada del equipo: su sello instalado es el vigente
   *  y no tiene por qué tener un retiro posterior todavía. */
  isLatestForEquipment: boolean
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
    vehicleId: fuelTaeSubmissions.vehicleId,
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
      ne(fuelTaeSubmissions.status, "voided"),
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
    vehicleId: r.vehicleId,
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
    isLatestForEquipment: false,
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
        ne(fuelTaeSubmissions.status, "voided"),
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

  await clearLatestSealOfEachEquipment(session, movements)

  return movements
}

/** Llave del equipo de un movimiento: su id, o la patente si la carga no se asoció a un equipo. */
const equipmentKey = (vehicleId: string | null, plate: string | null) => vehicleId ? `v:${vehicleId}` : plate ? `p:${plate}` : null

/**
 * El último sello de cada equipo no es un problema. Un sello instalado «sin
 * siguiente» sólo está roto si el equipo **volvió a cargar** después y esa carga
 * no lo retiró; si no hay carga posterior, el sello sigue puesto y todavía no
 * tiene quién lo retire (ése era el aviso falso que ensuciaba el historial: cada
 * equipo tiene, por definición, uno así).
 *
 * Se mira la última carga validada del equipo sobre toda la base y no sobre las
 * filas de la página: con el filtro de un mes, la «siguiente carga» puede caer
 * fuera del recorte y no por eso el sello deja de estar vigente.
 */
async function clearLatestSealOfEachEquipment(session: Session, movements: SealMovement[]) {
  const candidates = movements.filter((m) => m.installedSeal)
  if (candidates.length === 0) return
  const vehicleIds = [...new Set(candidates.flatMap((m) => m.vehicleId ? [m.vehicleId] : []))]
  const plates = [...new Set(candidates.flatMap((m) => !m.vehicleId && m.plate ? [m.plate] : []))]

  const latestRows = await db.select({
    vehicleId: fuelTaeSubmissions.vehicleId,
    plate: fuelTaeSubmissions.plateSnapshot,
    latest: sql<string>`to_char(max(${fuelTaeSubmissions.loadedAt}) at time zone 'America/Santiago', 'YYYY-MM-DD HH24:MI')`,
  })
    .from(fuelTaeSubmissions)
    .where(and(
      worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
      // El «sello vigente» sólo puede sostenerlo una carga validada: una
      // enviada/observada todavía no reemplaza el sello anterior. La población
      // del historial sí incluye las no anuladas (5.6), pero la marca de
      // vigencia no se adelanta a una revisión pendiente.
      eq(fuelTaeSubmissions.status, "validated"),
      or(
        vehicleIds.length > 0 ? inArray(fuelTaeSubmissions.vehicleId, vehicleIds) : undefined,
        plates.length > 0 ? and(isNull(fuelTaeSubmissions.vehicleId), inArray(fuelTaeSubmissions.plateSnapshot, plates)) : undefined,
      ),
    ))
    .groupBy(fuelTaeSubmissions.vehicleId, fuelTaeSubmissions.plateSnapshot)

  const latestByEquipment = new Map<string, string>()
  for (const row of latestRows) {
    const key = equipmentKey(row.vehicleId, row.plate)
    if (!key) continue
    const current = latestByEquipment.get(key)
    if (!current || row.latest > current) latestByEquipment.set(key, row.latest)
  }

  for (const m of candidates) {
    const key = equipmentKey(m.vehicleId, m.plate)
    const latest = key ? latestByEquipment.get(key) : undefined
    // Sin carga validada posterior del mismo equipo (o sin poder identificarlo),
    // es su sello vigente. La carga enviada/observada puede mostrarse en el
    // historial, pero no reemplaza la vigencia de la última validada.
    if (key && latest && latest === m.loadedAt) {
      m.continuityBroken = false
      m.isLatestForEquipment = true
    }
  }
}

/* ── Retractación de movimientos de sello (auditoría 2026-11-05, 2.7 / 5.4) ── */

const SEAL_MOVEMENT_RETRACTION_REASON_MAX = 500

/**
 * Retracta los movimientos de sello de las cargas indicadas: la carga dejó de
 * estar validada, así que su retiro/instalación no debe seguir contando ni
 * sostener la cadena de sellos del equipo. La fila **no se borra** — se marca
 * con quién, cuándo y por qué (columnas de la migración 0372), para que el
 * historial del sello sobreviva al borrado de la carga (`submission_id` queda
 * NULL por la FK `ON DELETE SET NULL` de la 0373).
 *
 * Idempotente: sólo toca los que todavía estaban vigentes (`reverted_at is null`).
 * Devuelve los ids efectivamente retractados (para auditarlos uno a uno).
 */
export async function retractSealMovements(
  tx: Tx,
  submissionIds: readonly string[],
  actor: { userId: string | null; reason: string; now?: string },
): Promise<string[]> {
  if (submissionIds.length === 0) return []
  const rows = await tx.update(fuelSealMovements)
    .set({
      revertedAt: actor.now ?? new Date().toISOString(),
      revertedBy: actor.userId,
      revertedReason: actor.reason.slice(0, SEAL_MOVEMENT_RETRACTION_REASON_MAX),
    })
    .where(and(
      inArray(fuelSealMovements.submissionId, [...submissionIds]),
      isNull(fuelSealMovements.revertedAt),
    ))
    .returning({ id: fuelSealMovements.id })
  return rows.map((row) => row.id)
}

/**
 * Reactiva los movimientos retractados de una carga que vuelve a estar
 * validada. Misma operación inversa, también idempotente.
 */
export async function restoreSealMovements(tx: Tx, submissionIds: readonly string[]): Promise<string[]> {
  if (submissionIds.length === 0) return []
  const result = await tx.update(fuelSealMovements)
    .set({ revertedAt: null, revertedBy: null, revertedReason: null })
    .where(and(
      inArray(fuelSealMovements.submissionId, [...submissionIds]),
      isNotNull(fuelSealMovements.revertedAt),
    ))
    .returning({ id: fuelSealMovements.id })
  const rows = Array.isArray(result) ? result : (result as { rows?: Array<{ id: string }> }).rows ?? []
  return rows.map((row) => row.id)
}
