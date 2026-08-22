import { and, eq, isNull } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { fuelVehicleOperationalIntervals, fuelVehicles } from "@/db/schema"
import { nanoid } from "@/lib/id"

/**
 * Cambia el estado operativo de un activo y conserva el intervalo histórico.
 *
 * No valida permisos: cada caso de uso debe comprobarlos antes de entrar. Vive
 * fuera del agregado de Flota para que Inspecciones y Mantenciones reutilicen
 * esta operación transaccional sin formar ciclos de imports.
 */
export async function setVehicleOperationalStatus(
  client: DB | Tx,
  args: { vehicleId: string; status: string; reason: string; actorUserId: string },
) {
  const changedAt = new Date().toISOString()
  await client.update(fuelVehicles)
    .set({ operationalStatus: args.status, updatedAt: changedAt })
    .where(eq(fuelVehicles.id, args.vehicleId))
  await client.update(fuelVehicleOperationalIntervals)
    .set({ endedAt: changedAt })
    .where(and(
      eq(fuelVehicleOperationalIntervals.vehicleId, args.vehicleId),
      isNull(fuelVehicleOperationalIntervals.endedAt),
    ))
  await client.insert(fuelVehicleOperationalIntervals).values({
    id: nanoid(),
    vehicleId: args.vehicleId,
    status: args.status,
    startedAt: changedAt,
    reason: args.reason,
    changedBy: args.actorUserId,
  })
}
