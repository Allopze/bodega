import { inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelEquipmentLoads } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { ReviewStatus } from "./contracts"
import { SOURCE_FLAGS, orderFlags, parseInstantMs } from "./calc/performance-series"
import type { ProjectedFacts, SkippedRecord } from "./projection-sources"

/**
 * Upsert idempotente de `fuel_equipment_loads` desde sus orígenes. No recalcula
 * la serie: devuelve los equipos afectados para que el llamador lo haga una
 * sola vez por equipo.
 */

const INSERT_CHUNK = 500

type LoadRow = typeof fuelEquipmentLoads.$inferSelect
type LoadInsert = typeof fuelEquipmentLoads.$inferInsert

export interface UpsertOutcome {
  projected: number
  vehicleIds: string[]
  /** Cargas cuya decisión humana (aprobada/rechazada) se descartó porque cambió el origen. Auditar. */
  resetLoadIds: string[]
}

const numEq = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == b : Math.abs(Number(a) - Number(b)) < 1e-6

const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
  a == null || b == null ? a == b : parseInstantMs(a) === parseInstantMs(b)

function sourceFactsChanged(row: LoadRow, facts: ProjectedFacts): boolean {
  return !numEq(row.liters, facts.liters)
    || !numEq(row.meterReading, facts.meterReading)
    || !sameInstant(row.occurredAt, facts.occurredAt)
    || row.vehicleId !== facts.vehicleId
    || (facts.meterReset !== undefined && row.meterReset !== facts.meterReset)
}

const isSticky = (status: string) => status === "approved" || status === "rejected"

/** Campos que salen del origen, más lo calculado para una carga sin equipo (no entra a ninguna serie). */
function buildValues(facts: ProjectedFacts, previous: LoadRow | null, resetDecision: boolean): Partial<LoadInsert> {
  const voided = facts.voided === undefined
    ? { voidedAt: previous?.voidedAt ?? null, voidReason: previous?.voidReason ?? null }
    : facts.voided === null
      ? { voidedAt: null, voidReason: null }
      : { voidedAt: previous?.voidedAt ?? facts.voided.at, voidReason: facts.voided.reason }

  const currentStatus = (resetDecision ? "ok" : previous?.reviewStatus ?? "ok") as ReviewStatus
  const keptSeriesFlags = (previous?.flagReasons ?? []).filter((flag) => !SOURCE_FLAGS.includes(flag as never))
  const values: Partial<LoadInsert> = {
    source: facts.source,
    taeSubmissionId: facts.taeSubmissionId,
    operationRecordId: facts.operationRecordId,
    vehicleId: facts.vehicleId,
    worksiteId: facts.worksiteId,
    supplyMediumId: facts.supplyMediumId,
    loadingPointType: facts.loadingPointType,
    occurredAt: facts.occurredAt,
    month: facts.month,
    liters: facts.liters,
    meterType: facts.meterType,
    meterReading: facts.meterReading,
    driverWorkerId: facts.driverWorkerId,
    driverName: facts.driverName,
    supervisorWorkerId: facts.supervisorWorkerId,
    supervisorName: facts.supervisorName,
    declaredPerformance: facts.declaredPerformance,
    ...(facts.meterReset === undefined ? {} : { meterReset: facts.meterReset }),
    ...voided,
    reviewStatus: currentStatus,
    flagReasons: orderFlags([...keptSeriesFlags, ...facts.sourceFlags]),
  }
  if (resetDecision) Object.assign(values, { reviewedBy: null, reviewedAt: null, reviewNote: null })

  if (facts.vehicleId === null) {
    // Sin equipo no hay serie: ningún rendimiento, y espera revisión salvo decisión o anulación.
    const sticky = isSticky(currentStatus) ? currentStatus : null
    Object.assign(values, {
      anchorLoadId: null, meterDelta: null, accumulatedLiters: null, performanceUnit: null,
      performanceValue: null, performanceStatus: "not_applicable", duplicateOfId: null,
      flagReasons: orderFlags(facts.sourceFlags),
      reviewStatus: sticky ?? (voided.voidedAt ? "ok" : "flagged"),
    })
  }
  return values
}

function differs(row: LoadRow, values: Partial<LoadInsert>): boolean {
  for (const [key, value] of Object.entries(values)) {
    const current = row[key as keyof LoadRow]
    if (key === "occurredAt" || key === "voidedAt" || key === "reviewedAt") {
      if (!sameInstant(current as string | null, value as string | null)) return true
    } else if (typeof value === "number" || typeof current === "number") {
      if (!numEq(current as number | null, value as number | null)) return true
    } else if (Array.isArray(value)) {
      if (JSON.stringify(current ?? []) !== JSON.stringify(value)) return true
    } else if ((current ?? null) !== (value ?? null)) {
      return true
    }
  }
  return false
}

export async function upsertProjectedLoads(
  tx: Tx,
  facts: ProjectedFacts[],
  key: "taeSubmissionId" | "operationRecordId",
): Promise<UpsertOutcome> {
  const outcome: UpsertOutcome = { projected: 0, vehicleIds: [], resetLoadIds: [] }
  if (facts.length === 0) return outcome
  const vehicles = new Set<string>()
  const sourceIds = facts.map((fact) => fact[key]!)
  const existing = await tx.select().from(fuelEquipmentLoads).where(inArray(fuelEquipmentLoads[key], sourceIds))
  const bySource = new Map(existing.map((row) => [row[key]!, row]))

  const inserts: LoadInsert[] = []
  for (const fact of facts) {
    const previous = bySource.get(fact[key]!) ?? null
    if (fact.vehicleId) vehicles.add(fact.vehicleId)
    if (!previous) {
      inserts.push({ id: nanoid(), ...buildValues(fact, null, false) } as LoadInsert)
      continue
    }
    if (previous.vehicleId && previous.vehicleId !== fact.vehicleId) vehicles.add(previous.vehicleId)
    const resetDecision = isSticky(previous.reviewStatus) && sourceFactsChanged(previous, fact)
    const values = buildValues(fact, previous, resetDecision)
    if (resetDecision) outcome.resetLoadIds.push(previous.id)
    if (differs(previous, values)) {
      await tx.update(fuelEquipmentLoads)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(inArray(fuelEquipmentLoads.id, [previous.id]))
    }
  }
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    await tx.insert(fuelEquipmentLoads).values(inserts.slice(i, i + INSERT_CHUNK))
  }
  outcome.projected = facts.length
  outcome.vehicleIds = [...vehicles]
  return outcome
}

/**
 * Registros del log operacional que ya no se pueden proyectar (perdieron faena
 * o litros) pero tenían carga: la carga se ANULA con el motivo, no se borra.
 */
export async function voidSkippedProjections(tx: Tx, skipped: SkippedRecord[]): Promise<string[]> {
  if (skipped.length === 0) return []
  const rows = await tx.select({ id: fuelEquipmentLoads.id, recordId: fuelEquipmentLoads.operationRecordId, vehicleId: fuelEquipmentLoads.vehicleId, voidedAt: fuelEquipmentLoads.voidedAt })
    .from(fuelEquipmentLoads)
    .where(inArray(fuelEquipmentLoads.operationRecordId, skipped.map((s) => s.recordId)))
  const reasonByRecord = new Map(skipped.map((s) => [s.recordId, s.reason]))
  const vehicles: string[] = []
  const now = new Date().toISOString()
  for (const row of rows) {
    if (row.voidedAt) continue
    await tx.update(fuelEquipmentLoads)
      .set({ voidedAt: now, voidReason: reasonByRecord.get(row.recordId!) ?? "El registro de origen ya no es una carga válida", updatedAt: now })
      .where(inArray(fuelEquipmentLoads.id, [row.id]))
    if (row.vehicleId) vehicles.push(row.vehicleId)
  }
  return vehicles
}
