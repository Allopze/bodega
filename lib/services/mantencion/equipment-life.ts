import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fleetVehicleDocuments, fuelVehicles, mantRecordCorrectives, mantRecordVoids, mantRecords, mantWorkOrders, mantWorkshopUpdates, users, worksites,
} from "@/db/schema"
import { expiryState, type ExpiryState } from "@/lib/expiry"
import { daysBetween } from "@/lib/mantencion/readings"
import { workshopState } from "@/lib/mantencion/status"
import type { MantExecutorKind, MantRecordKind, MantRecordStatus, MantReview, MantUnit } from "@/lib/mantencion/types"
import type { OtStatus } from "@/lib/mantencion/work-order-states"
import { todayInChile } from "@/lib/utils"
import type { MantViewer } from "./access"

/**
 * Hoja de vida del equipo: el historial COMPLETO de mantenciones (preventivas y
 * correctivas, vigentes y anuladas) más los antecedentes de seguro que la flota
 * ya guarda. Es lo único que lee; no escribe nada.
 *
 * Quien llama pasa `visibility` (`recordVisibilitySql` de `access.ts`): un
 * supervisor ve los registros de su faena y los propios, no los de otra faena
 * del mismo equipo. Las anuladas NO se excluyen —se ven marcadas (regla 13)—
 * pero los totales sólo cuentan las vigentes.
 */

export interface LifeRow {
  id: string
  folio: string | null
  kind: MantRecordKind
  status: MantRecordStatus
  review: MantReview
  workDate: string
  signedAt: string
  receivedAt: string
  reading: number
  unit: MantUnit
  intervalValue: number | null
  suggestedIntervalValue: number | null
  scheduleName: string | null
  worksiteName: string
  executorKind: MantExecutorKind
  executorName: string
  registeredByName: string
  notes: string | null
  /** Sólo correctivas. */
  hours: number | null
  inWorkshop: boolean
  workshopEntryDate: string | null
  workshopExitDate: string | null
  /** Días detenido (ingreso → salida, o hasta hoy si sigue en taller); `null` si no pasó por taller. */
  daysInWorkshop: number | null
  voidReason: string | null
  voidedAt: string | null
  voidedByName: string | null
}

export interface LifeTotals {
  /** Vigentes. */
  active: number
  activeCorrective: number
  activePreventive: number
  /** Horas de taller (suma de las horas de las correctivas vigentes). */
  activeHours: number
  /** Anuladas: se cuentan aparte para que no se confundan con el total. */
  voided: number
}

export async function loadLifeTotals(vehicleId: string, visibility: SQL): Promise<LifeTotals> {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${mantRecords.status} = 'vigente')::int`,
      activeCorrective: sql<number>`count(*) filter (where ${mantRecords.status} = 'vigente' and ${mantRecords.kind} = 'C')::int`,
      activePreventive: sql<number>`count(*) filter (where ${mantRecords.status} = 'vigente' and ${mantRecords.kind} = 'P')::int`,
      activeHours: sql<number>`coalesce(sum(${mantRecordCorrectives.hours}) filter (where ${mantRecords.status} = 'vigente'), 0)::float8`,
      voided: sql<number>`count(*) filter (where ${mantRecords.status} = 'anulado')::int`,
    })
    .from(mantRecords)
    .leftJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .where(and(eq(mantRecords.vehicleId, vehicleId), visibility))
  return row ?? { active: 0, activeCorrective: 0, activePreventive: 0, activeHours: 0, voided: 0 }
}

/**
 * Filas de la hoja de vida, de la más reciente a la más antigua. `limit` trae
 * una fila de más para saber si hay otra página sin un segundo conteo.
 */
export async function loadLifeRows(
  vehicleId: string,
  visibility: SQL,
  opts: { limit?: number } = {},
): Promise<{ rows: LifeRow[]; hasMore: boolean }> {
  const registrar = alias(users, "registrar")
  const voider = alias(users, "voider")
  const query = db
    .select({
      record: mantRecords,
      worksiteName: worksites.name,
      registeredByName: registrar.name,
      corrective: mantRecordCorrectives,
      voidReason: mantRecordVoids.reason,
      voidedAt: mantRecordVoids.createdAt,
      voidedByName: voider.name,
    })
    .from(mantRecords)
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .innerJoin(registrar, eq(registrar.id, mantRecords.registeredBy))
    .leftJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .leftJoin(mantRecordVoids, eq(mantRecordVoids.recordId, mantRecords.id))
    .leftJoin(voider, eq(voider.id, mantRecordVoids.userId))
    .where(and(eq(mantRecords.vehicleId, vehicleId), visibility))
    .orderBy(desc(mantRecords.workDate), desc(mantRecords.receivedAt), asc(mantRecords.id))
  const fetched = opts.limit ? await query.limit(opts.limit + 1) : await query
  const hasMore = opts.limit != null && fetched.length > opts.limit
  const kept = hasMore ? fetched.slice(0, opts.limit) : fetched

  // Las novedades de taller sólo importan a las correctivas que pasaron por taller.
  const inWorkshopIds = kept.filter((row) => row.corrective?.inWorkshop).map((row) => row.record.id)
  const updates = inWorkshopIds.length
    ? await db.select().from(mantWorkshopUpdates).where(inArray(mantWorkshopUpdates.recordId, inWorkshopIds)).orderBy(asc(mantWorkshopUpdates.createdAt))
    : []
  const updatesByRecord = new Map<string, Array<{ kind: "sigue" | "salio"; createdDate: string; exitDate: string | null }>>()
  for (const update of updates) {
    const list = updatesByRecord.get(update.recordId) ?? []
    list.push({ kind: update.kind as "sigue" | "salio", createdDate: todayInChile(update.createdAt), exitDate: update.exitDate })
    updatesByRecord.set(update.recordId, list)
  }
  const today = todayInChile()

  const rows = kept.map<LifeRow>(({ record: r, corrective: c, worksiteName, registeredByName, voidReason, voidedAt, voidedByName }) => {
    // Un anulado no deja el equipo en taller ni acumula «días detenido»: sólo el vigente tiene estado.
    const inWorkshopNow = !!c?.inWorkshop && r.status === "vigente"
    const workshop = inWorkshopNow
      ? workshopState({ inWorkshop: true, entryDate: c.workshopEntryDate, workDate: r.workDate, updates: updatesByRecord.get(r.id) ?? [] }, today)
      : null
    return {
      id: r.id, folio: r.folio, kind: r.kind as MantRecordKind, status: r.status as MantRecordStatus, review: r.review as MantReview,
      workDate: r.workDate, signedAt: r.signedAt, receivedAt: r.receivedAt, reading: r.reading, unit: r.unit as MantUnit,
      intervalValue: r.intervalValue, suggestedIntervalValue: r.suggestedIntervalValue, scheduleName: r.scheduleNameSnapshot,
      worksiteName, executorKind: r.executorKind as MantExecutorKind, executorName: r.executorName, registeredByName, notes: r.notes,
      hours: c?.hours ?? null,
      inWorkshop: inWorkshopNow,
      workshopEntryDate: c?.workshopEntryDate ?? null,
      workshopExitDate: workshop?.exitDate ?? null,
      daysInWorkshop: workshop?.daysStopped ?? null,
      voidReason, voidedAt, voidedByName,
    }
  })
  return { rows, hasMore }
}

// ── Seguro ───────────────────────────────────────────────────────────────────

/** Días antes del vencimiento desde los que se avisa «por vencer». */
export const INSURANCE_WARNING_DAYS = 30

/** Los cuatro estados son los de `lib/expiry.ts`: un vencimiento se lee igual en flota, licencias y mantención. */
export type InsuranceState = ExpiryState

/** `today` es `todayInChile()` del llamador: la función queda pura. Delega en `expiryState` (`lib/expiry.ts`). */
export function insuranceState(expiresAt: string | null, today: string): { state: InsuranceState; days: number | null } {
  const { state, days } = expiryState(expiresAt, today, INSURANCE_WARNING_DAYS)
  return { state, days }
}

export interface InsuranceDocument {
  id: string
  fileName: string
  expiresAt: string | null
  /** `current` rige hoy; `replaced` es una versión anterior que se conserva. */
  current: boolean
}

export interface EquipmentInsurance {
  policyNumber: string | null
  expiresAt: string | null
  state: InsuranceState
  days: number | null
  documents: InsuranceDocument[]
  /** Hay algo que mostrar: póliza, vencimiento o documentos. */
  hasData: boolean
}

/**
 * Antecedentes de seguro de la flota: póliza y vencimiento de `fuel_vehicles` y
 * los documentos de tipo «Seguro» (vigentes y reemplazados; los anulados no son
 * versiones, son errores corregidos y no se listan).
 *
 * PENDIENTE DE DEFINICIÓN (no hay tablas nuevas): qué más registrar de los
 * seguros —siniestros, deducibles, aseguradora, cobertura— lo decide el negocio;
 * hoy sólo se muestra lo que la flota ya guarda.
 */
export async function loadEquipmentInsurance(vehicleId: string): Promise<EquipmentInsurance> {
  const [[vehicle], docs] = await Promise.all([
    db.select({ policy: fuelVehicles.insurancePolicyNumber, expiresAt: fuelVehicles.insuranceExpiresAt })
      .from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).limit(1),
    db.select({ id: fleetVehicleDocuments.id, fileName: fleetVehicleDocuments.fileName, expiresAt: fleetVehicleDocuments.expiresAt, status: fleetVehicleDocuments.status })
      .from(fleetVehicleDocuments)
      .where(and(eq(fleetVehicleDocuments.vehicleId, vehicleId), eq(fleetVehicleDocuments.documentType, "Seguro"), ne(fleetVehicleDocuments.status, "voided")))
      // `current` antes que `replaced` (orden alfabético) y, dentro de cada grupo, el vencimiento más lejano primero.
      .orderBy(asc(fleetVehicleDocuments.status), desc(fleetVehicleDocuments.expiresAt)),
  ])
  const policyNumber = vehicle?.policy?.trim() || null
  const expiresAt = vehicle?.expiresAt || null
  // El vencimiento canónico es la columna de la ficha de flota; el del documento vigente sólo la suple si está vacía.
  const fromDocument = docs.find((doc) => doc.status === "current" && doc.expiresAt)?.expiresAt ?? null
  const effective = expiresAt ?? fromDocument
  const { state, days } = insuranceState(effective, todayInChile())
  return {
    policyNumber,
    expiresAt: effective,
    state,
    days,
    documents: docs.map((doc) => ({ id: doc.id, fileName: doc.fileName, expiresAt: doc.expiresAt, current: doc.status === "current" })),
    hasData: !!(policyNumber || effective || docs.length),
  }
}

// ── Órdenes de trabajo ───────────────────────────────────────────────────────

export interface LifeWorkOrderRow {
  id: string
  folio: string
  status: OtStatus
  repair: boolean
  maintenance: boolean
  requestDate: string
  workshopEntryAt: string | null
  workshopExitAt: string | null
  /** Días en taller (ingreso → salida, o hasta hoy si sigue allí); `null` si aún no ingresa. */
  daysInWorkshop: number | null
}

export interface LifeWorkOrders {
  rows: LifeWorkOrderRow[]
  /** Cuántas OT (no anuladas) tiene el equipo dentro del alcance de quien mira. */
  total: number
}

/**
 * Faenas de OT que el usuario puede ver: `view_all` ve todas; `view_worksite` las
 * suyas (un rol global, todas). Sin ninguno de los dos permisos devuelve `null` y
 * la hoja de vida no muestra la sección. Es el mismo criterio de `otVisibility`
 * del servicio de OT, repetido aquí a propósito: este archivo sólo lee la tabla.
 */
function workOrderWorksiteScope(viewer: MantViewer): "all" | string[] | null {
  if (viewer.permissions.includes("mant:ot:view_all")) return "all"
  if (viewer.permissions.includes("mant:ot:view_worksite")) return viewer.isGlobal ? "all" : [...viewer.worksiteIds]
  return null
}

/**
 * Las OT del equipo para su hoja de vida, de la más reciente a la más antigua.
 * Las anuladas no se listan (no ocurrieron) y no cuentan en el total. `null` =
 * el usuario no tiene permiso de OT: la sección no se dibuja.
 */
export async function loadEquipmentWorkOrders(vehicleId: string, viewer: MantViewer, opts: { limit?: number } = {}): Promise<LifeWorkOrders | null> {
  const scope = workOrderWorksiteScope(viewer)
  if (scope === null) return null
  const where = and(
    eq(mantWorkOrders.vehicleId, vehicleId),
    ne(mantWorkOrders.status, "anulada"),
    scope === "all" ? undefined : scope.length ? inArray(mantWorkOrders.worksiteId, scope) : sql`false`,
  )
  const limit = opts.limit ?? 10
  const [rows, [count]] = await Promise.all([
    db.select({
      id: mantWorkOrders.id, folio: mantWorkOrders.folio, status: mantWorkOrders.status, repair: mantWorkOrders.repair,
      maintenance: mantWorkOrders.maintenance, requestDate: mantWorkOrders.requestDate,
      workshopEntryAt: mantWorkOrders.workshopEntryAt, workshopExitAt: mantWorkOrders.workshopExitAt,
    })
      .from(mantWorkOrders)
      .where(where)
      .orderBy(desc(mantWorkOrders.createdAt), asc(mantWorkOrders.id))
      .limit(limit),
    db.select({ total: sql<number>`count(*)::int` }).from(mantWorkOrders).where(where),
  ])
  const today = todayInChile()
  return {
    total: count?.total ?? rows.length,
    rows: rows.map((row) => ({
      ...row,
      status: row.status as OtStatus,
      daysInWorkshop: row.workshopEntryAt
        ? Math.max(0, daysBetween(todayInChile(row.workshopEntryAt), row.workshopExitAt ? todayInChile(row.workshopExitAt) : today))
        : null,
    })),
  }
}
