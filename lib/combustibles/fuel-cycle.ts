import type { Session } from "next-auth"
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { z } from "zod"
import { db } from "@/db"
import { fuelCycleMovements, fuelLoads, fuelStorageLocations, fuelTaeLoadingPoints, fuelTaeSubmissions } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { worksiteScopeSql } from "@/lib/auth/scope"

/** ponytail: Umbral máximo de diferencia porcentual considerado "normal" en el
 *  semáforo del ciclo. Pendiente de hacer configurable por faena (sección 12). */
export const CYCLE_DIFF_NORMAL_PCT = 2

/** ponytail: Umbral máximo de diferencia porcentual considerado "advertencia"
 *  (por encima = crítico). Pendiente de hacer configurable por faena (sección 12). */
export const CYCLE_DIFF_WARNING_PCT = 5

export const fuelCycleMovementSchema = z.object({
  eventType: z.enum(["received", "transfer", "tank_delivery", "direct_delivery"]),
  worksiteId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  supplierId: z.string().optional(),
  sourceLocationId: z.string().optional(),
  targetLocationId: z.string().optional(),
  vehicleId: z.string().optional(),
  documentNumber: z.string().max(120).optional(),
  sourceType: z.string().max(80).optional(),
  sourceId: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
}).superRefine((value, ctx) => {
  const issue = (path: "supplierId" | "sourceLocationId" | "targetLocationId" | "vehicleId", message: string) => ctx.addIssue({ code: "custom", path: [path], message })
  if (value.eventType === "received" && (!value.supplierId || !value.targetLocationId)) issue(!value.supplierId ? "supplierId" : "targetLocationId", "La recepción requiere proveedor y estanque destino")
  if (value.eventType === "transfer" && (!value.sourceLocationId || !value.targetLocationId || value.sourceLocationId === value.targetLocationId)) issue("targetLocationId", "La transferencia requiere dos estanques distintos")
  if (value.eventType === "tank_delivery" && (!value.sourceLocationId || !value.vehicleId)) issue(!value.sourceLocationId ? "sourceLocationId" : "vehicleId", "La entrega desde estanque requiere origen y equipo")
  if (value.eventType === "direct_delivery" && (!value.supplierId || !value.vehicleId)) issue(!value.supplierId ? "supplierId" : "vehicleId", "La entrega directa requiere proveedor y equipo")
})

export async function createFuelCycleMovement(input: unknown, actor: { userId: string; userEmail?: string }) {
  const parsed = fuelCycleMovementSchema.parse(input)
  const id = nanoid()
  await db.transaction(async (tx) => {
    for (const locationId of [parsed.sourceLocationId, parsed.targetLocationId].filter(Boolean) as string[]) {
      const location = await tx.query.fuelStorageLocations.findFirst({ where: eq(fuelStorageLocations.id, locationId) })
      if (!location || location.worksiteId !== parsed.worksiteId || location.productId !== parsed.productId || !location.isActive) throw new Error("El estanque no corresponde a la faena, producto o estado seleccionado")
    }
    await tx.insert(fuelCycleMovements).values({ id, ...parsed, createdBy: actor.userId })
    await recordAudit({ userId: actor.userId, userEmail: actor.userEmail, action: "create", entityType: "fuel_cycle_movement", entityId: id, newState: parsed }, tx)
  })
  return { id }
}

export type CycleAmount = { liters: number; records: number }
export type CycleDifference = { status: "available"; absolute: number; percent: number | null } | { status: "unavailable"; absolute: null; percent: null }

export function compareCycleAmounts(left: CycleAmount | null, right: CycleAmount | null): CycleDifference {
  if (!left || !right) return { status: "unavailable", absolute: null, percent: null }
  return { status: "available", absolute: left.liters - right.liters, percent: right.liters === 0 ? null : ((left.liters - right.liters) / right.liters) * 100 }
}

export type DifferenceSeverity = "normal" | "warning" | "critical" | "unavailable"

export function differenceSeverity(difference: CycleDifference): DifferenceSeverity {
  if (difference.status === "unavailable" || difference.percent === null) return "unavailable"
  const magnitude = Math.abs(difference.percent)
  if (magnitude <= CYCLE_DIFF_NORMAL_PCT) return "normal"
  if (magnitude <= CYCLE_DIFF_WARNING_PCT) return "warning"
  return "critical"
}

/** Ventana en día calendario chileno sobre una columna timestamptz, igual que
 *  el resto del módulo (fuel-log, tae-dashboard, seal-history, …). Comparar el
 *  instante crudo contra un límite en UTC dejaría fuera las recepciones
 *  nocturnas del último día del rango y colaría las de la víspera.
 *  El `.slice(0, 10)` tolera "YYYY-MM-DD" o un ISO completo. */
const chileDayRange = (column: AnyPgColumn, from: string, to: string) => and(
  sql`(${column} at time zone 'America/Santiago')::date >= ${from.slice(0, 10)}::date`,
  sql`(${column} at time zone 'America/Santiago')::date <= ${to.slice(0, 10)}::date`,
)

export async function getFuelCycleComparison(session: Session, filters: { worksiteId?: string; productId?: string; from: string; to: string }) {
  const movementWhere = and(chileDayRange(fuelCycleMovements.occurredAt, filters.from, filters.to), filters.worksiteId ? eq(fuelCycleMovements.worksiteId, filters.worksiteId) : undefined, filters.productId ? eq(fuelCycleMovements.productId, filters.productId) : undefined, worksiteScopeSql(session, fuelCycleMovements.worksiteId))
  const registeredWhere = and(gte(fuelLoads.loadDate, filters.from.slice(0, 10)), lte(fuelLoads.loadDate, filters.to.slice(0, 10)), filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined, filters.productId ? eq(fuelLoads.productId, filters.productId) : undefined, worksiteScopeSql(session, fuelLoads.worksiteId))
  // La PWA es la fuente real de lo entregado desde la vasija: registra litros,
  // medidor, sellos y evidencia por equipo. No se duplica como movimiento del
  // ledger — se lee de origen, y así una carga anulada deja de contar sola.
  const taeWhere = and(chileDayRange(fuelTaeSubmissions.loadedAt, filters.from, filters.to), filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined, filters.productId ? eq(fuelTaeSubmissions.productId, filters.productId) : undefined, ne(fuelTaeSubmissions.status, "voided"), worksiteScopeSql(session, fuelTaeSubmissions.worksiteId))
  const [movementRows, registeredRows, taeRows] = await Promise.all([
    db.select({ eventType: fuelCycleMovements.eventType, liters: sql<number>`coalesce(sum(${fuelCycleMovements.quantity}), 0)`, records: sql<number>`count(*)` }).from(fuelCycleMovements).where(movementWhere).groupBy(fuelCycleMovements.eventType),
    db.select({ liters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`, records: sql<number>`count(*)` }).from(fuelLoads).where(registeredWhere),
    db.select({ liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)`, records: sql<number>`count(*)` }).from(fuelTaeSubmissions).where(taeWhere),
  ])
  const sum = new Map(movementRows.map((row) => [row.eventType, { liters: Number(row.liters), records: Number(row.records) }]))
  const received = sum.get("received") ?? null
  const sources = [sum.get("tank_delivery"), sum.get("direct_delivery"), taeRows[0] && Number(taeRows[0].records) > 0 ? { liters: Number(taeRows[0].liters), records: Number(taeRows[0].records) } : undefined].filter(Boolean) as CycleAmount[]
  const delivered = sources.length ? { liters: sources.reduce((total, source) => total + source.liters, 0), records: sources.reduce((total, source) => total + source.records, 0) } : null
  const registered = registeredRows[0] ? { liters: Number(registeredRows[0].liters), records: Number(registeredRows[0].records) } : null
  return { received, registered, delivered, consumed: null, differences: { receivedVsRegistered: compareCycleAmounts(received, registered), receivedVsDelivered: compareCycleAmounts(received, delivered) } }
}

export interface FuelStorageBalance {
  storageLocationId: string
  worksiteId: string
  name: string
  productId: string
  capacityLiters: number | null
  receivedLiters: number
  transferInLiters: number
  transferOutLiters: number
  deliveredLiters: number
  balanceLiters: number
}

/**
 * Saldo por vasija: recibido + transferido-hacia − transferido-desde − entregado,
 * en el período dado. "Entregado" combina las salidas manuales `tank_delivery`
 * del ledger con lo que la PWA repartió desde el punto de carga enlazado a esta
 * vasija (`fuel_tae_loading_points.storage_location_id`) — sin ese enlace, una
 * vasija que sólo reparte por PWA muestra saldo igual a lo recibido, porque no
 * hay nada que restarle.
 */
export async function getFuelStorageBalances(session: Session, filters: { worksiteId?: string; productId?: string; from: string; to: string }): Promise<FuelStorageBalance[]> {
  const locations = await db.query.fuelStorageLocations.findMany({
    where: and(
      eq(fuelStorageLocations.isActive, true),
      filters.worksiteId ? eq(fuelStorageLocations.worksiteId, filters.worksiteId) : undefined,
      filters.productId ? eq(fuelStorageLocations.productId, filters.productId) : undefined,
      worksiteScopeSql(session, fuelStorageLocations.worksiteId),
    ),
    columns: { id: true, worksiteId: true, name: true, productId: true, capacityLiters: true },
  })
  if (!locations.length) return []
  const ids = locations.map((location) => location.id)
  const dateWhere = chileDayRange(fuelCycleMovements.occurredAt, filters.from, filters.to)

  const [inbound, outboundMovements, outboundSubmissions] = await Promise.all([
    db.select({ locationId: fuelCycleMovements.targetLocationId, eventType: fuelCycleMovements.eventType, liters: sql<number>`coalesce(sum(${fuelCycleMovements.quantity}), 0)` })
      .from(fuelCycleMovements)
      .where(and(dateWhere, inArray(fuelCycleMovements.targetLocationId, ids), inArray(fuelCycleMovements.eventType, ["received", "transfer"])))
      .groupBy(fuelCycleMovements.targetLocationId, fuelCycleMovements.eventType),
    db.select({ locationId: fuelCycleMovements.sourceLocationId, eventType: fuelCycleMovements.eventType, liters: sql<number>`coalesce(sum(${fuelCycleMovements.quantity}), 0)` })
      .from(fuelCycleMovements)
      .where(and(dateWhere, inArray(fuelCycleMovements.sourceLocationId, ids), inArray(fuelCycleMovements.eventType, ["transfer", "tank_delivery"])))
      .groupBy(fuelCycleMovements.sourceLocationId, fuelCycleMovements.eventType),
    db.select({ locationId: fuelTaeLoadingPoints.storageLocationId, liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)` })
      .from(fuelTaeSubmissions)
      .innerJoin(fuelTaeLoadingPoints, eq(fuelTaeSubmissions.loadingPointId, fuelTaeLoadingPoints.id))
      .where(and(chileDayRange(fuelTaeSubmissions.loadedAt, filters.from, filters.to), ne(fuelTaeSubmissions.status, "voided"), inArray(fuelTaeLoadingPoints.storageLocationId, ids)))
      .groupBy(fuelTaeLoadingPoints.storageLocationId),
  ])

  const received = new Map<string, number>()
  const transferIn = new Map<string, number>()
  for (const row of inbound) {
    if (!row.locationId) continue
    const target = row.eventType === "received" ? received : transferIn
    target.set(row.locationId, Number(row.liters))
  }
  const transferOut = new Map<string, number>()
  const tankDelivery = new Map<string, number>()
  for (const row of outboundMovements) {
    if (!row.locationId) continue
    const target = row.eventType === "transfer" ? transferOut : tankDelivery
    target.set(row.locationId, Number(row.liters))
  }
  const pwaDelivery = new Map(outboundSubmissions.filter((row) => row.locationId).map((row) => [row.locationId as string, Number(row.liters)]))

  return locations.map((location) => {
    const receivedLiters = received.get(location.id) ?? 0
    const transferInLiters = transferIn.get(location.id) ?? 0
    const transferOutLiters = transferOut.get(location.id) ?? 0
    const deliveredLiters = (tankDelivery.get(location.id) ?? 0) + (pwaDelivery.get(location.id) ?? 0)
    return {
      storageLocationId: location.id,
      worksiteId: location.worksiteId,
      name: location.name,
      productId: location.productId,
      capacityLiters: location.capacityLiters,
      receivedLiters,
      transferInLiters,
      transferOutLiters,
      deliveredLiters,
      balanceLiters: receivedLiters + transferInLiters - transferOutLiters - deliveredLiters,
    }
  })
}
