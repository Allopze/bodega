import { and, desc, eq, isNotNull, lt, ne } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { fuelTaeSubmissions } from "@/db/schema"
import { meterRegressionMessage } from "@/lib/combustibles/field-load-rules"
import { TaeSubmissionRejected } from "./errors"

type Client = DB | Tx

export type PreviousSubmission = Pick<typeof fuelTaeSubmissions.$inferSelect, "id" | "loadedAt" | "meterReading" | "meterType" | "removedSealNumber" | "installedSealNumber">

const PREVIOUS_COLUMNS = {
  id: fuelTaeSubmissions.id,
  loadedAt: fuelTaeSubmissions.loadedAt,
  meterReading: fuelTaeSubmissions.meterReading,
  meterType: fuelTaeSubmissions.meterType,
  removedSealNumber: fuelTaeSubmissions.removedSealNumber,
  installedSealNumber: fuelTaeSubmissions.installedSealNumber,
}

/** Carga vigente (no anulada) inmediatamente anterior del equipo: la que fija la cadena de sellos. */
export async function findPreviousSubmission(client: Client, vehicleId: string, loadedAt: string): Promise<PreviousSubmission | null> {
  const [row] = await client.select(PREVIOUS_COLUMNS).from(fuelTaeSubmissions)
    .where(and(
      eq(fuelTaeSubmissions.vehicleId, vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      lt(fuelTaeSubmissions.loadedAt, loadedAt),
    ))
    .orderBy(desc(fuelTaeSubmissions.loadedAt))
    .limit(1)
  return row ?? null
}

/** Última lectura de medidor vigente del equipo, en la misma unidad (odómetro u horómetro). */
async function findPreviousReading(client: Client, vehicleId: string, meterType: string, loadedAt: string): Promise<number | null> {
  const [row] = await client.select({ meterReading: fuelTaeSubmissions.meterReading }).from(fuelTaeSubmissions)
    .where(and(
      eq(fuelTaeSubmissions.vehicleId, vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      eq(fuelTaeSubmissions.meterType, meterType),
      isNotNull(fuelTaeSubmissions.meterReading),
      lt(fuelTaeSubmissions.loadedAt, loadedAt),
    ))
    .orderBy(desc(fuelTaeSubmissions.loadedAt))
    .limit(1)
  return row?.meterReading ?? null
}

/**
 * D-6: el retroceso del medidor se rechaza al registrar. Un cambio real de
 * tablero o de equipo lo corrige un revisor con el diálogo auditado, que parte
 * la serie; el operador no puede declararlo.
 */
export async function assertMeterNotRegressing(
  client: Client,
  vehicleId: string,
  meterType: string,
  reading: number | null,
  loadedAt: string,
): Promise<void> {
  if (reading == null) return
  const previous = await findPreviousReading(client, vehicleId, meterType, loadedAt)
  if (previous != null && reading < previous) {
    throw new TaeSubmissionRejected(meterRegressionMessage(reading, previous), "meter_regression", "meterReading")
  }
}
