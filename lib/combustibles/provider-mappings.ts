import { and, eq, ne } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelProviderMappings } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"

/** El día anterior a una fecha civil `YYYY-MM-DD`. */
function previousDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! - 1)).toISOString().slice(0, 10)
}

/**
 * Lleva a la faena nueva las asignaciones de proveedor (Copec, Aramco) de un
 * vehículo que acaba de cambiar de faena.
 *
 * La sincronización atribuye el consumo a la faena GUARDADA en la asignación,
 * no a la del vehículo (`createVehicleResolver`). Antes, trasladar un vehículo
 * desde la flota o la mantención no tocaba sus asignaciones, y su consumo
 * seguía cayendo en la faena vieja sin que nada lo avisara.
 *
 * Cada asignación activa del vehículo en otra faena se versiona: la vigente se
 * cierra el día anterior a `effectiveFrom` y nace una versión nueva desde esa
 * fecha, con la misma regla que «vincular patente». Un mes que cruza el
 * traslado queda sin una sola faena para su agregado mensual y el resolvedor
 * lo deja pendiente a propósito: ese reparto lo decide una persona. Si la
 * asignación todavía no había entrado en vigor, se corrige en el lugar.
 *
 * Corre dentro de la transacción de quien traslada el vehículo; devuelve
 * cuántas asignaciones movió.
 */
export async function moveProviderMappingsWithVehicleTx(
  tx: Tx,
  input: { vehicleId: string; worksiteId: string; actorUserId: string; actorEmail?: string | null; effectiveFrom?: string },
): Promise<number> {
  const effectiveFrom = input.effectiveFrom ?? todayInChile()
  const stale = await tx.select().from(fuelProviderMappings).where(and(
    eq(fuelProviderMappings.vehicleId, input.vehicleId),
    eq(fuelProviderMappings.isActive, true),
    ne(fuelProviderMappings.worksiteId, input.worksiteId),
  ))
  const reason = "Traslado del vehículo a otra faena: la asignación sigue al vehículo"
  for (const mapping of stale) {
    if (mapping.effectiveFrom >= effectiveFrom) {
      await tx.update(fuelProviderMappings).set({ worksiteId: input.worksiteId }).where(eq(fuelProviderMappings.id, mapping.id))
      await recordAudit({
        userId: input.actorUserId,
        userEmail: input.actorEmail ?? undefined,
        action: "update",
        entityType: "fuel_provider_mapping",
        entityId: mapping.id,
        entityCode: mapping.externalKey,
        oldState: { worksiteId: mapping.worksiteId },
        newState: { worksiteId: input.worksiteId },
        reason,
        worksiteId: input.worksiteId,
      }, tx)
      continue
    }
    const effectiveTo = previousDay(effectiveFrom)
    // Primero se cierra la vigente: el índice único admite una sola activa por patente y cuenta.
    await tx.update(fuelProviderMappings).set({ isActive: false, effectiveTo }).where(eq(fuelProviderMappings.id, mapping.id))
    const next = {
      id: nanoid(),
      provider: mapping.provider,
      sourceAccount: mapping.sourceAccount,
      externalKey: mapping.externalKey,
      normalizedValue: mapping.normalizedValue,
      worksiteId: input.worksiteId,
      vehicleId: mapping.vehicleId,
      version: mapping.version + 1,
      isActive: true,
      decidedBy: input.actorUserId,
      reason,
      effectiveFrom,
      supersedesId: mapping.id,
    }
    await tx.insert(fuelProviderMappings).values(next)
    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.actorEmail ?? undefined,
      action: "update",
      entityType: "fuel_provider_mapping",
      entityId: next.id,
      entityCode: mapping.externalKey,
      oldState: { id: mapping.id, worksiteId: mapping.worksiteId, effectiveFrom: mapping.effectiveFrom, effectiveTo: mapping.effectiveTo },
      newState: { worksiteId: input.worksiteId, effectiveFrom, version: next.version, supersededEffectiveTo: effectiveTo },
      reason,
      worksiteId: input.worksiteId,
    }, tx)
  }
  return stale.length
}
