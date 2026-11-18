import { and, asc, eq, inArray } from "drizzle-orm"
import type { DB } from "@/db"
import { fuelVehicles, fuelVehicleWorksiteIntervals as stayTable, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import { nanoid } from "@/lib/id"
import { loadStayEvidence } from "./stay-evidence"
import {
  reconstructStays, type PendingReason, type ReconstructedStay, type StayEvidence,
} from "./stay-reconstruction"

/**
 * Orquestación de la reconstrucción del pasado (script de una vez): carga la
 * evidencia, la pasa por `reconstructStays`, clasifica a cada equipo en una hoja
 * del informe y, con `apply`, escribe el recorrido. Sin `apply` no escribe nada.
 *
 * Principio vinculante (spec «Reconstrucción del pasado»): nunca se inventa una
 * fecha. Un equipo con algo por confirmar (`confident: false`) NO se escribe; va a
 * «Por confirmar» para que lo fije una persona. Un equipo con estadías de traslado
 * tampoco se toca: su recorrido ya es dato firme.
 *
 * La base garantiza la cadena (triggers diferidos): por equipo y en una sola
 * transacción se borran sus estadías `alta`/`reconstruccion` y se inserta la
 * cadena completa, con la abierta en la faena actual.
 */

export const STAY_AUDIT_REASON = "Reconstrucción del recorrido por faena"
export const DEFAULT_MAX_GAP_DAYS = 7

/** Una fila de planilla ya reducida a lo que el script necesita (la arma una persona). */
export interface StaySnapshotInput {
  date: string
  code?: string | null
  plate?: string | null
  worksiteName: string
}

export interface StayRunOptions {
  apply?: boolean
  maxGapDays?: number
  snapshots?: StaySnapshotInput[]
  /** Acota la corrida a estos equipos (pruebas, reintentos). */
  vehicleIds?: string[]
  actor?: { userId: string | null; email?: string }
}

export interface ReportStay {
  worksite: string
  startedOn: string | null
  endedOn: string | null
  evidence: string
}

export interface ReportPending {
  reason: PendingReason
  fromWorksite: string | null
  toWorksite: string
  lastDayInFrom: string | null
  firstDayInTo: string
  gapDays: number | null
  detail: string
}

export interface VehicleOutcome {
  vehicleId: string
  code: string | null
  plate: string
  currentWorksite: string
  stays: ReportStay[]
  pending: ReportPending[]
  /** Por qué está en esta hoja (texto para el informe). */
  note: string
}

export interface UnmatchedSnapshot extends StaySnapshotInput {
  why: string
}

export interface FailedVehicle {
  vehicleId: string
  code: string | null
  plate: string
  message: string
}

export interface StayRunResult {
  dryRun: boolean
  maxGapDays: number
  vehicles: number
  /** Confiables y distintos de lo que ya hay: lo que se escribe con `apply`. */
  applied: VehicleOutcome[]
  /** Con algo por confirmar: no se escriben. */
  toConfirm: VehicleOutcome[]
  /** Sin evidencia física: una sola estadía en la faena actual. */
  noEvidence: VehicleOutcome[]
  /** Con estadías de traslado: se saltan. */
  skippedTransfers: VehicleOutcome[]
  unmatched: UnmatchedSnapshot[]
  failed: FailedVehicle[]
  /** Confiables cuyo recorrido ya está tal cual en la base. */
  unchanged: number
  /** Equipos efectivamente escritos (0 en seco). */
  written: number
}

type StayRow = typeof stayTable.$inferSelect

const REASON_LABEL: Record<PendingReason, string> = {
  ventana_amplia: "Cambio de faena sin evidencia por más días que el tope",
  contradiccion: "Evidencia en más de una faena el mismo día",
  planilla: "La planilla contradice la evidencia",
  faena_actual_distinta: "La última evidencia no está en la faena actual",
}
export const pendingReasonLabel = (reason: PendingReason): string => REASON_LABEL[reason]

/** Nombre de faena o código sin tildes ni mayúsculas ni espacios de más, para comparar. */
function normalizeKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

function compareStays(a: { startedOn: string | null }, b: { startedOn: string | null }): number {
  if (a.startedOn === b.startedOn) return 0
  if (a.startedOn === null) return -1
  if (b.startedOn === null) return 1
  return a.startedOn < b.startedOn ? -1 : 1
}

function sameChain(existing: StayRow[], proposed: ReconstructedStay[]): boolean {
  if (existing.length !== proposed.length) return false
  const sorted = [...existing].sort(compareStays)
  return sorted.every((row, index) => {
    const next = proposed[index]!
    return row.worksiteId === next.worksiteId && row.startedOn === next.startedOn && row.endedOn === next.endedOn
  })
}

interface VehicleRef {
  id: string
  code: string | null
  plate: string
  worksiteId: string
}

/** Calza una fila de planilla con un equipo (patente primero, luego código) y una faena. */
function resolveSnapshots(
  snapshots: StaySnapshotInput[],
  vehicles: VehicleRef[],
  worksiteByName: Map<string, string>,
): { evidence: Map<string, StayEvidence[]>; unmatched: UnmatchedSnapshot[] } {
  const byPlate = new Map<string, VehicleRef[]>()
  const byCode = new Map<string, VehicleRef[]>()
  for (const vehicle of vehicles) {
    const plateKey = plateMatchKey(vehicle.plate)
    if (plateKey) byPlate.set(plateKey, [...(byPlate.get(plateKey) ?? []), vehicle])
    if (vehicle.code) {
      const codeKey = plateMatchKey(vehicle.code)
      byCode.set(codeKey, [...(byCode.get(codeKey) ?? []), vehicle])
    }
  }
  const evidence = new Map<string, StayEvidence[]>()
  const unmatched: UnmatchedSnapshot[] = []
  snapshots.forEach((snapshot, index) => {
    const fail = (why: string) => unmatched.push({ ...snapshot, why })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)) return fail("Fecha inválida (se espera AAAA-MM-DD)")
    const worksiteId = worksiteByName.get(normalizeKey(snapshot.worksiteName))
    if (!worksiteId) return fail("La faena no existe")
    let candidates: VehicleRef[] = []
    if (snapshot.plate && plateMatchKey(snapshot.plate)) candidates = byPlate.get(plateMatchKey(snapshot.plate)) ?? []
    if (candidates.length === 0 && snapshot.code && plateMatchKey(snapshot.code)) candidates = byCode.get(plateMatchKey(snapshot.code)) ?? []
    if (candidates.length === 0) return fail("No hay equipo con esa patente ni ese código")
    if (candidates.length > 1) return fail("La patente o el código calzan con más de un equipo")
    const vehicle = candidates[0]!
    const item: StayEvidence = { day: snapshot.date, worksiteId, kind: "planilla", ref: `planilla fila ${index + 1}` }
    evidence.set(vehicle.id, [...(evidence.get(vehicle.id) ?? []), item])
  })
  return { evidence, unmatched }
}

export async function runStayReconstruction(db: DB, options: StayRunOptions = {}): Promise<StayRunResult> {
  const apply = options.apply === true
  const maxGapDays = options.maxGapDays ?? DEFAULT_MAX_GAP_DAYS
  const filter = options.vehicleIds

  const worksiteRows = await db.select({ id: worksites.id, name: worksites.name }).from(worksites)
  const worksiteName = new Map(worksiteRows.map((row) => [row.id, row.name]))
  const worksiteByName = new Map(worksiteRows.map((row) => [normalizeKey(row.name), row.id]))
  const nameOf = (id: string | null): string | null => (id === null ? null : worksiteName.get(id) ?? id)
  // Los ids de faena van en el texto de `PendingChange.detail`: se cambian por su nombre
  // (los más largos primero, para que un id no pise a otro que lo contiene).
  const idsByLength = [...worksiteName.keys()].sort((a, b) => b.length - a.length)
  const humanize = (text: string): string => idsByLength.reduce((acc, id) => acc.split(id).join(worksiteName.get(id)!), text)

  const vehicles: VehicleRef[] = await db
    .select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId })
    .from(fuelVehicles)
    .where(filter ? inArray(fuelVehicles.id, filter) : undefined)
    .orderBy(asc(fuelVehicles.code), asc(fuelVehicles.plate))

  const ids = vehicles.map((vehicle) => vehicle.id)
  const stayRows = ids.length
    ? await db.select().from(stayTable).where(inArray(stayTable.vehicleId, ids))
    : []
  const staysByVehicle = new Map<string, StayRow[]>()
  for (const row of stayRows) staysByVehicle.set(row.vehicleId, [...(staysByVehicle.get(row.vehicleId) ?? []), row])

  const physical = ids.length ? await loadStayEvidence(db, ids) : new Map<string, StayEvidence[]>()
  const { evidence: planilla, unmatched } = resolveSnapshots(options.snapshots ?? [], vehicles, worksiteByName)

  const result: StayRunResult = {
    dryRun: !apply, maxGapDays, vehicles: vehicles.length,
    applied: [], toConfirm: [], noEvidence: [], skippedTransfers: [], unmatched, failed: [], unchanged: 0, written: 0,
  }

  const toProposal = (stays: ReconstructedStay[]): ReportStay[] =>
    stays.map((stay) => ({ worksite: nameOf(stay.worksiteId)!, startedOn: stay.startedOn, endedOn: stay.endedOn, evidence: stay.evidence }))

  for (const vehicle of vehicles) {
    const base = { vehicleId: vehicle.id, code: vehicle.code, plate: vehicle.plate, currentWorksite: nameOf(vehicle.worksiteId)! }
    const existing = staysByVehicle.get(vehicle.id) ?? []

    const transferStays = existing.filter((row) => row.source === "traslado")
    if (transferStays.length > 0) {
      result.skippedTransfers.push({
        ...base, stays: [], pending: [],
        note: `Tiene ${transferStays.length} ${transferStays.length === 1 ? "estadía" : "estadías"} de traslado: su recorrido ya es firme`,
      })
      continue
    }

    const own = physical.get(vehicle.id) ?? []
    const reconstruction = reconstructStays({
      evidence: [...own, ...(planilla.get(vehicle.id) ?? [])],
      currentWorksiteId: vehicle.worksiteId,
      maxGapDays,
    })
    const stays = toProposal(reconstruction.stays)

    if (!reconstruction.confident) {
      result.toConfirm.push({
        ...base, stays,
        pending: reconstruction.toConfirm.map((change) => ({
          reason: change.reason,
          fromWorksite: nameOf(change.fromWorksiteId),
          toWorksite: nameOf(change.toWorksiteId)!,
          lastDayInFrom: change.lastDayInFrom,
          firstDayInTo: change.firstDayInTo,
          gapDays: change.gapDays,
          detail: humanize(change.detail),
        })),
        note: "No se escribe: hay que fijar las fechas a mano",
      })
      continue
    }

    if (own.length === 0) {
      result.noEvidence.push({ ...base, stays, pending: [], note: "Sin evidencia de otra faena: se queda en la actual" })
    }
    if (sameChain(existing, reconstruction.stays)) {
      result.unchanged += 1
      continue
    }

    const outcome: VehicleOutcome = {
      ...base, stays, pending: [],
      note: stays.length === 1 ? "Una sola faena" : `${stays.length} estadías reconstruidas`,
    }
    result.applied.push(outcome)
    if (!apply) continue

    try {
      await writeChain(db, vehicle, existing, reconstruction.stays, options.actor)
      result.written += 1
    } catch (error) {
      result.applied.pop()
      result.failed.push({ vehicleId: vehicle.id, code: vehicle.code, plate: vehicle.plate, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

/** Reemplaza las estadías `alta`/`reconstruccion` del equipo por la cadena reconstruida, con su auditoría. */
async function writeChain(
  db: DB,
  vehicle: VehicleRef,
  existing: StayRow[],
  proposed: ReconstructedStay[],
  actor: StayRunOptions["actor"],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Entre la lectura y la escritura el equipo pudo cambiar de faena o ser trasladado: no se pisa.
    const [current] = await tx.select({ worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles)
      .where(eq(fuelVehicles.id, vehicle.id)).for("update")
    if (!current || current.worksiteId !== vehicle.worksiteId) throw new Error("El equipo cambió de faena durante la corrida")
    const transfers = await tx.select({ id: stayTable.id }).from(stayTable)
      .where(and(eq(stayTable.vehicleId, vehicle.id), eq(stayTable.source, "traslado")))
    if (transfers.length > 0) throw new Error("El equipo recibió un traslado durante la corrida")

    await tx.delete(stayTable).where(and(eq(stayTable.vehicleId, vehicle.id), inArray(stayTable.source, ["alta", "reconstruccion"])))
    await tx.insert(stayTable).values(proposed.map((stay) => ({
      id: nanoid(),
      vehicleId: vehicle.id,
      worksiteId: stay.worksiteId,
      startedOn: stay.startedOn,
      endedOn: stay.endedOn,
      // Una sola estadía sin inicio es el alta del equipo; con más de una, es reconstrucción.
      source: proposed.length === 1 ? ("alta" as const) : ("reconstruccion" as const),
      evidence: stay.evidence,
    })))

    const view = (rows: Array<{ worksiteId: string; startedOn: string | null; endedOn: string | null }>) =>
      rows.map((row) => ({ worksiteId: row.worksiteId, startedOn: row.startedOn, endedOn: row.endedOn }))
    await recordAudit({
      userId: actor?.userId ?? null,
      userEmail: actor?.email,
      action: "update",
      entityType: "fuel_vehicle_worksite_intervals",
      entityId: vehicle.id,
      entityCode: vehicle.code ?? vehicle.plate,
      oldState: { stays: view([...existing].sort(compareStays)) },
      newState: { stays: view(proposed) },
      reason: STAY_AUDIT_REASON,
      worksiteId: vehicle.worksiteId,
    }, tx)
  })
}
