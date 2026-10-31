import { and, asc, desc, eq, gt, gte, isNotNull, lt, lte, ne, sql } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { fuelTaeSubmissions } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { meterAboveNextMessage, meterRegressionMessage, type DuplicateLoadSummary } from "@/lib/combustibles/field-load-rules"
import { reevaluateNextSealChain } from "@/lib/combustibles/control/seal-chain"
import { fuelLoadHref } from "@/lib/combustibles/routes"
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

/**
 * Lo mismo hacia adelante: una carga de otro día se intercala en la serie y su
 * lectura no puede superar la de la carga siguiente del equipo (misma unidad).
 * Una siguiente que inicia serie nueva por un cambio de tablero (`meterReset`)
 * no es un tope: su lectura vuelve a partir de cero a propósito.
 */
export async function assertMeterBelowNext(
  client: Client,
  vehicleId: string,
  meterType: string,
  reading: number | null,
  loadedAt: string,
): Promise<void> {
  if (reading == null) return
  const [next] = await client.select({
    meterReading: fuelTaeSubmissions.meterReading,
    loadedAt: fuelTaeSubmissions.loadedAt,
    rawRow: fuelTaeSubmissions.rawRow,
  }).from(fuelTaeSubmissions)
    .where(and(
      eq(fuelTaeSubmissions.vehicleId, vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      eq(fuelTaeSubmissions.meterType, meterType),
      isNotNull(fuelTaeSubmissions.meterReading),
      gt(fuelTaeSubmissions.loadedAt, loadedAt),
    ))
    .orderBy(asc(fuelTaeSubmissions.loadedAt))
    .limit(1)
  if (!next || next.meterReading == null) return
  const isReset = typeof next.rawRow === "object" && next.rawRow !== null && (next.rawRow as { meterReset?: unknown }).meterReset === true
  if (isReset) return
  if (reading > next.meterReading) {
    throw new TaeSubmissionRejected(meterAboveNextMessage(reading, next.meterReading, next.loadedAt), "meter_regression", "meterReading")
  }
}

/**
 * La carga del mismo equipo, del mismo origen (formulario o app), cercana en
 * tiempo y en litros: la ventana y la tolerancia son las del control de
 * rendimiento (las mismas con que se detectan duplicadas entre canales).
 */
export async function findPossibleDuplicate(
  client: Client,
  vehicleId: string,
  loadedAt: string,
  liters: number,
  settings: { duplicateWindowMinutes: number; duplicateLitersTolerance: number },
): Promise<DuplicateLoadSummary | null> {
  const windowMs = settings.duplicateWindowMinutes * 60_000
  const from = new Date(Date.parse(loadedAt) - windowMs).toISOString()
  const to = new Date(Date.parse(loadedAt) + windowMs).toISOString()
  const [row] = await client.select({
    id: fuelTaeSubmissions.id,
    loadedAt: fuelTaeSubmissions.loadedAt,
    liters: fuelTaeSubmissions.liters,
    equipment: fuelTaeSubmissions.equipmentCodeSnapshot,
  }).from(fuelTaeSubmissions)
    .where(and(
      eq(fuelTaeSubmissions.vehicleId, vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      gte(fuelTaeSubmissions.loadedAt, from),
      lte(fuelTaeSubmissions.loadedAt, to),
      // Pequeño margen para que 0,5 L de tolerancia no falle por decimales.
      sql`abs(${fuelTaeSubmissions.liters} - ${liters}) <= ${settings.duplicateLitersTolerance + 1e-9}`,
    ))
    .orderBy(sql`abs(extract(epoch from (${fuelTaeSubmissions.loadedAt} - ${loadedAt}::timestamptz)))`)
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    loadedAt: row.loadedAt,
    liters: Number(row.liters),
    equipment: row.equipment,
    href: fuelLoadHref({ origen: "terreno", id: row.id }),
  }
}

/** La carga vigente inmediatamente posterior del equipo (la que la nueva deja con otra «carga anterior»). */
async function findNextSubmission(client: Client, vehicleId: string, loadedAt: string) {
  const [row] = await client.select({
    id: fuelTaeSubmissions.id,
    worksiteId: fuelTaeSubmissions.worksiteId,
    removedSealNumber: fuelTaeSubmissions.removedSealNumber,
    installedSealNumber: fuelTaeSubmissions.installedSealNumber,
    noSealReason: fuelTaeSubmissions.noSealReason,
    sealChainStatus: fuelTaeSubmissions.sealChainStatus,
    sealChainExpected: fuelTaeSubmissions.sealChainExpected,
  }).from(fuelTaeSubmissions)
    .where(and(
      eq(fuelTaeSubmissions.vehicleId, vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      gt(fuelTaeSubmissions.loadedAt, loadedAt),
    ))
    .orderBy(asc(fuelTaeSubmissions.loadedAt), asc(fuelTaeSubmissions.id))
    .limit(1)
  return row ?? null
}

/**
 * Tras insertar una carga que quedó antes de otras: la siguiente cambia de
 * «carga anterior», así que su cadena de sellos se evalúa de nuevo. Si cambia,
 * se guarda y se audita en la misma transacción. Devuelve el id de la carga
 * afectada (o `null` si no había siguiente o su cadena quedó igual).
 */
export async function reevaluateNextSubmissionSealChain(
  tx: Tx,
  input: { vehicleId: string; loadedAt: string; installedSeal: string | null; actorId: string | null },
): Promise<string | null> {
  const next = await findNextSubmission(tx, input.vehicleId, input.loadedAt)
  if (!next) return null
  const outcome = reevaluateNextSealChain({
    removedSeal: next.removedSealNumber,
    installedSeal: next.installedSealNumber,
    noSealReason: next.noSealReason,
    sealChainStatus: next.sealChainStatus,
    sealChainExpected: next.sealChainExpected,
  }, input.installedSeal)
  if (!outcome.changed) return null
  await tx.update(fuelTaeSubmissions)
    .set({ sealChainStatus: outcome.status, sealChainExpected: outcome.expected, updatedAt: new Date().toISOString() })
    .where(eq(fuelTaeSubmissions.id, next.id))
  await recordAudit({
    userId: input.actorId,
    action: "update",
    entityType: "fuel_tae_submission",
    entityId: next.id,
    oldState: { sealChainStatus: next.sealChainStatus, sealChainExpected: next.sealChainExpected },
    newState: { sealChainStatus: outcome.status, sealChainExpected: outcome.expected },
    reason: "Se registró una carga anterior del equipo: la cadena de sellos se evaluó de nuevo",
    worksiteId: next.worksiteId,
  }, tx)
  return next.id
}
