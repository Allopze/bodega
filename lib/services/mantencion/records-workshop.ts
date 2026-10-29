import { and, eq, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordCorrectives, mantRecords, mantWorkshopUpdates } from "@/db/schema"
import { workshopState, type WorkshopState } from "@/lib/mantencion/status"
import { todayInChile } from "@/lib/utils"

/**
 * Correctivas que pasaron por taller, con su estado (regla 11) calculado con la
 * función pura `workshopState`. Lo usan los indicadores de «Registros», el
 * panel (días fuera de servicio) y el detalle, para que «sin actualizar» y
 * «días detenido» salgan siempre de la misma cuenta.
 *
 * Sólo mira el vigente: quien llama pasa en `where` el alcance, los filtros y
 * `status = 'vigente'`; un registro anulado no deja un equipo «en taller».
 */
export interface WorkshopCase {
  recordId: string
  vehicleId: string
  worksiteId: string
  workDate: string
  entryDate: string | null
  hours: number
  state: WorkshopState
}

export async function loadWorkshopCases(where: SQL | undefined, today: string = todayInChile()): Promise<WorkshopCase[]> {
  const rows = await db
    .select({
      recordId: mantRecords.id,
      vehicleId: mantRecords.vehicleId,
      worksiteId: mantRecords.worksiteId,
      workDate: mantRecords.workDate,
      entryDate: mantRecordCorrectives.workshopEntryDate,
      hours: mantRecordCorrectives.hours,
    })
    .from(mantRecords)
    .innerJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .where(and(eq(mantRecordCorrectives.inWorkshop, true), where))
  if (rows.length === 0) return []

  const updates = await db
    .select({
      recordId: mantWorkshopUpdates.recordId,
      kind: mantWorkshopUpdates.kind,
      createdAt: mantWorkshopUpdates.createdAt,
      exitDate: mantWorkshopUpdates.exitDate,
    })
    .from(mantWorkshopUpdates)
    .innerJoin(mantRecords, eq(mantRecords.id, mantWorkshopUpdates.recordId))
    .innerJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .where(and(eq(mantRecordCorrectives.inWorkshop, true), where))

  const byRecord = new Map<string, Array<{ kind: "sigue" | "salio"; createdDate: string; exitDate: string | null }>>()
  for (const update of updates) {
    const list = byRecord.get(update.recordId) ?? []
    list.push({ kind: update.kind as "sigue" | "salio", createdDate: todayInChile(update.createdAt), exitDate: update.exitDate })
    byRecord.set(update.recordId, list)
  }

  return rows.map((row) => ({
    ...row,
    state: workshopState({
      inWorkshop: true,
      entryDate: row.entryDate,
      workDate: row.workDate,
      updates: byRecord.get(row.recordId) ?? [],
    }, today),
  }))
}
