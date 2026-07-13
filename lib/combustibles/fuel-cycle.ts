import type { Session } from "next-auth"
import { and, eq, gte, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { fuelCycleMovements, fuelLoads, fuelStorageLocations } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { worksiteScopeSql } from "@/lib/auth/scope"

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

export async function getFuelCycleComparison(session: Session, filters: { worksiteId?: string; productId?: string; from: string; to: string }) {
  const movementWhere = and(gte(fuelCycleMovements.occurredAt, filters.from), lte(fuelCycleMovements.occurredAt, filters.to), filters.worksiteId ? eq(fuelCycleMovements.worksiteId, filters.worksiteId) : undefined, filters.productId ? eq(fuelCycleMovements.productId, filters.productId) : undefined, worksiteScopeSql(session, fuelCycleMovements.worksiteId))
  const registeredWhere = and(gte(fuelLoads.loadDate, filters.from.slice(0, 10)), lte(fuelLoads.loadDate, filters.to.slice(0, 10)), filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined, filters.productId ? eq(fuelLoads.productId, filters.productId) : undefined, worksiteScopeSql(session, fuelLoads.worksiteId))
  const [movementRows, registeredRows] = await Promise.all([
    db.select({ eventType: fuelCycleMovements.eventType, liters: sql<number>`coalesce(sum(${fuelCycleMovements.quantity}), 0)`, records: sql<number>`count(*)` }).from(fuelCycleMovements).where(movementWhere).groupBy(fuelCycleMovements.eventType),
    db.select({ liters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`, records: sql<number>`count(*)` }).from(fuelLoads).where(registeredWhere),
  ])
  const sum = new Map(movementRows.map((row) => [row.eventType, { liters: Number(row.liters), records: Number(row.records) }]))
  const received = sum.get("received") ?? null
  const tankDelivery = sum.get("tank_delivery")
  const directDelivery = sum.get("direct_delivery")
  const delivered = tankDelivery || directDelivery ? { liters: (tankDelivery?.liters ?? 0) + (directDelivery?.liters ?? 0), records: (tankDelivery?.records ?? 0) + (directDelivery?.records ?? 0) } : null
  const registered = registeredRows[0] ? { liters: Number(registeredRows[0].liters), records: Number(registeredRows[0].records) } : null
  return { received, registered, delivered, consumed: null, differences: { receivedVsRegistered: compareCycleAmounts(received, registered), receivedVsDelivered: compareCycleAmounts(received, delivered) } }
}
