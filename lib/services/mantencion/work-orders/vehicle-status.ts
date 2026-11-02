import { and, eq, isNull, ne } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelVehicleOperationalIntervals, fuelVehicles, mantWorkOrders } from "@/db/schema"
import { setVehicleOperationalStatus } from "@/lib/services/fleet-operational-status"

/**
 * Estado operacional del equipo según su OT (`fuel_vehicles.operational_status`
 * e intervalos). Dos reglas para no pisar a otros módulos:
 *
 * - Al entrar a taller (o volver a él por un rechazo o una reapertura) el equipo
 *   pasa a `mantencion` SÓLO si hoy está `operativo`: un `fuera_servicio`
 *   impuesto por una inspección, o un `mantencion` de otra OT, no se tocan.
 * - Al salir devuelve a `operativo` SÓLO si el intervalo abierto es de una OT
 *   (el motivo empieza con su folio) y ya no queda otra OT de ese equipo en
 *   taller. Un `mantencion` puesto a mano o por otro motivo se respeta.
 *
 * Corre dentro de la transacción de la OT, con el equipo ya bloqueado.
 */

/** `OT-BIO-0001: …` — el motivo con que esta plataforma marca los intervalos que abre una OT. */
const OT_REASON = /^OT-[A-Z0-9]+-\d+:/

interface Args {
  vehicleId: string
  folio: string
  actorUserId: string
}

async function currentStatus(tx: Tx, vehicleId: string): Promise<string | null> {
  const [row] = await tx.select({ status: fuelVehicles.operationalStatus }).from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).limit(1)
  return row?.status ?? null
}

/** Ingreso (o reingreso) a taller: `operativo` → `mantencion`. */
export async function markVehicleInWorkshop(tx: Tx, args: Args & { reason?: string }): Promise<boolean> {
  if ((await currentStatus(tx, args.vehicleId)) !== "operativo") return false
  await setVehicleOperationalStatus(tx, {
    vehicleId: args.vehicleId,
    status: "mantencion",
    reason: `${args.folio}: ${args.reason ?? "Ingreso a taller"}`,
    actorUserId: args.actorUserId,
  })
  return true
}

/** Salida de taller (o anulación en taller): vuelve a `operativo` si el intervalo es de una OT y ninguna otra sigue en taller. */
export async function markVehicleOutOfWorkshop(tx: Tx, args: Args & { workOrderId: string; reason?: string }): Promise<boolean> {
  if ((await currentStatus(tx, args.vehicleId)) !== "mantencion") return false
  const [open] = await tx
    .select({ reason: fuelVehicleOperationalIntervals.reason })
    .from(fuelVehicleOperationalIntervals)
    .where(and(eq(fuelVehicleOperationalIntervals.vehicleId, args.vehicleId), isNull(fuelVehicleOperationalIntervals.endedAt)))
    .limit(1)
  if (!open?.reason || !OT_REASON.test(open.reason)) return false
  const [other] = await tx
    .select({ id: mantWorkOrders.id })
    .from(mantWorkOrders)
    .where(and(
      eq(mantWorkOrders.vehicleId, args.vehicleId),
      eq(mantWorkOrders.status, "en_ejecucion"),
      ne(mantWorkOrders.id, args.workOrderId),
    ))
    .limit(1)
  if (other) return false
  await setVehicleOperationalStatus(tx, {
    vehicleId: args.vehicleId,
    status: "operativo",
    reason: `${args.folio}: ${args.reason ?? "Salida de taller"}`,
    actorUserId: args.actorUserId,
  })
  return true
}
