import { and, asc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelVehicles,
  mantHistoricalFindings,
  mantHistoricalInspections,
  mantHistoricalRecords,
  mantHistoricalScheduleChecks,
  mantRecordCorrectives,
  mantRecords,
  mantWorkOrders,
  mantWorkshopUpdates,
  worksites,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { bucketKey, isPartialBucket, listBuckets, type ChartWindow } from "@/lib/indicators/period"
import { actionTypeFromText, isActionType, workOrderActionType, type ActionTypeOrUnknown } from "@/lib/mantencion/action-type"
import { FORMS_CUTOVER_DATE } from "@/lib/mantencion/forms-cutover"
import { workshopState } from "@/lib/mantencion/status"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { getOperationalSettings } from "@/lib/services/system-settings"
import { equipmentScope, recordVisibility, recordVisibilitySql, type MantViewer } from "./access"
import type { MantWorksiteScope } from "./fleet"
import { workOrderVisibility, workOrderVisibilitySql } from "./work-orders/access"

/**
 * «Trabajos de mantención» del Panel (Trinorma, R5): lo que se hizo sobre cada equipo en un período,
 * venga de donde venga. Es la unión de tres fuentes que NO se solapan (corte de los formularios de Google,
 * `lib/mantencion/forms-cutover.ts`, 2026-12-01):
 *
 * - `historial`: `mant_historical_records` sin `is_test`, **sólo antes del corte** (fecha del trabajo < 01-12-2026).
 *   Una respuesta de Forms posterior al corte queda guardada como evidencia, pero no entra en las cifras;
 * - `ot`: `mant_work_orders` no anuladas **que ya entraron a taller** (`workshop_entry_at` no nulo): una OT
 *   «Por asignar» o «Asignada» todavía no es un trabajo hecho. Su fecha es el día de ingreso (hora de Chile);
 * - `registro`: `mant_records` vigentes, **sin OT** (`work_order_id` nulo) y **desde el corte** (`work_date` >=
 *   01-12-2026). Lo que tiene OT ya se cuenta por la OT; antes del corte lo cuenta el historial.
 *
 * Reglas:
 * - Fecha del trabajo: historial → ingreso a taller (`entry_date`) o, si falta, el día de envío del formulario;
 *   OT → día de ingreso a taller; registro → `work_date`.
 * - Tipo: OT → `workOrderActionType`; historial → su `action_type` y, si es null, `actionTypeFromText(kind_text)`;
 *   registro → `P` preventiva, `C` correctiva. Lo que no dice uno de los tres tipos es `sin_clasificar` y se
 *   cuenta aparte, nunca como correctiva.
 * - Días en taller: salida − ingreso (fechas civiles). Sin una de las dos fechas, o con la salida antes del
 *   ingreso (dato malo), no hay cifra: queda `null` y se informa cuántas filas no la traen. Una OT o una
 *   correctiva con ingreso y sin salida cuenta hasta hoy y va marcada «en taller». Una correctiva de registro
 *   se deriva con `workshopState` (la misma regla 11 de la ficha); sin taller, `null`.
 * - Horas: historial y OT traen las suyas; una correctiva de registro, `mant_record_correctives.hours`; una
 *   preventiva de registro no las informa (`null`).
 * - Alcance: `equipmentScope` (faena de imputación de la fila); las OT además respetan su propia visibilidad
 *   (`workOrderVisibility`) y los registros la de la lista de Registros (`recordVisibility`): quien no ve OT no
 *   recibe sus filas y el Panel lo dice.
 * - `loadWorkOfVehicles` (¿hubo trabajo después del hallazgo?) es un hecho del equipo: suma historial, OT y
 *   todos los registros vigentes, **sin** el corte y sin la restricción de «sin OT».
 */

export type WorkSource = "historial" | "ot" | "registro"

export interface MaintenanceWorkRow {
  /** `h:<source_key>`, `ot:<id>` o `r:<id>`: único entre las tres fuentes. */
  id: string
  source: WorkSource
  /** Folio de la OT o del registro, o ID del consolidado (`MT-00001`); vacío si no lo trae. */
  reference: string
  /** `YYYY-MM-DD`. */
  date: string
  vehicleId: string | null
  /** «KA-1 · BCDF12», o el texto original cuando el equipo no está vinculado. */
  equipmentLabel: string
  worksiteId: string | null
  worksiteName: string | null
  actionType: ActionTypeOrUnknown
  /** Horas hombre; `null` = no informadas. */
  laborHours: number | null
  /** Días en taller; `null` = no calculables. */
  workshopDays: number | null
  /** OT con ingreso a taller y sin salida: el equipo sigue ahí. */
  inWorkshop: boolean
  /** `true` taller externo; `null` = el trabajo no lo informa. */
  external: boolean | null
}

export interface MaintenanceWorkQuery {
  from: string
  to: string
  /** Faena elegida; `undefined` = todas las visibles. */
  worksiteId?: string
  /** Equipo elegido (ya validado contra el alcance). */
  vehicleId?: string
  today?: string
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/
const plainDay = (value: string | null | undefined): string | null => (value && DATE_PATTERN.test(value) ? value.slice(0, 10) : null)

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Días entre ingreso y salida; `null` si falta una o la salida es anterior. */
export function workshopDaysBetween(entry: string | null, exit: string | null): number | null {
  if (!entry || !exit) return null
  const days = dayDiff(entry, exit)
  return days >= 0 ? days : null
}

const SANTIAGO_DAY = (column: unknown) => sql<string | null>`to_char(${column} AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')`

function equipmentText(code: string | null, plate: string | null, fallback: string): string {
  if (code && plate) return code === plate ? code : `${code} · ${plate}`
  return code ?? plate ?? (fallback.trim() || "Equipo sin identificar")
}

/** Fecha del trabajo de una fila del historial: ingreso a taller o, si falta, el día del envío. */
const HISTORICAL_DATE = sql<string>`CASE WHEN ${mantHistoricalRecords.entryDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${mantHistoricalRecords.entryDate}, 10) ELSE left(${mantHistoricalRecords.submittedAt}, 10) END`
/** Valor del campo «externo» del formulario (la columna no es estable entre formularios: se lee de la fila original). */
const HISTORICAL_EXTERNAL = sql<string | null>`(SELECT f->>'value' FROM jsonb_array_elements(${mantHistoricalRecords.fields}) AS f WHERE upper(f->>'header') LIKE '%EXTERNO%' LIMIT 1)`

interface RowFilter {
  from: string
  to: string
  scope: MantWorksiteScope
  worksiteId?: string
  vehicleIds?: readonly string[]
  /** Predicado de visibilidad de las OT; `null` = no se leen OT. */
  orderVisibility: SQL | null
  /** Predicado de visibilidad de los registros firmados; `null` = no se leen. */
  recordVisibility: SQL | null
  /**
   * `panel` aplica el corte de los formularios (historial < corte, registros >= corte y sin OT);
   * `fact` es «¿hubo trabajo en el equipo?»: sin corte y con todos los registros vigentes.
   */
  mode: "panel" | "fact"
  today: string
}

const EXTERNAL_NEGATIVE = new Set(["NO", "N", "0", "FALSO", "INTERNO"])
const EXTERNAL_UNKNOWN = new Set(["", "N/A", "NA", "NO APLICA", "NINGUNO", "-"])

/**
 * Lo que dice el campo «taller externo» de un formulario. En el consolidado trae el NOMBRE del taller
 * («MAESTRANZA MELO»), así que cualquier texto que no sea un negativo explícito ni un «no aplica» es externo.
 */
export function externalFromHistorical(value: string | null): boolean | null {
  const text = (value ?? "").trim().toUpperCase()
  if (EXTERNAL_UNKNOWN.has(text)) return null
  return !EXTERNAL_NEGATIVE.has(text)
}

async function loadHistorialRows(filter: RowFilter): Promise<MaintenanceWorkRow[]> {
  const rows = await db.select({
    key: mantHistoricalRecords.sourceKey,
    recordId: mantHistoricalRecords.sourceRecordId,
    date: HISTORICAL_DATE,
    entryDate: mantHistoricalRecords.entryDate,
    exitDate: mantHistoricalRecords.exitDate,
    vehicleId: mantHistoricalRecords.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    equipmentText: mantHistoricalRecords.equipmentText,
    worksiteId: mantHistoricalRecords.worksiteId,
    worksiteName: worksites.name,
    actionType: mantHistoricalRecords.actionType,
    kindText: mantHistoricalRecords.kindText,
    laborHours: mantHistoricalRecords.laborHours,
    external: HISTORICAL_EXTERNAL,
  })
    .from(mantHistoricalRecords)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantHistoricalRecords.vehicleId))
    .leftJoin(worksites, eq(worksites.id, mantHistoricalRecords.worksiteId))
    .where(and(
      eq(mantHistoricalRecords.isTest, false),
      sql`${HISTORICAL_DATE} >= ${filter.from} AND ${HISTORICAL_DATE} <= ${filter.to}`,
      // Desde el corte, el trabajo lo cuentan los registros de la plataforma: el historial no suma dos veces.
      filter.mode === "panel" ? sql`${HISTORICAL_DATE} < ${FORMS_CUTOVER_DATE}` : undefined,
      worksiteScopeSqlFor(filter.scope, mantHistoricalRecords.worksiteId, filter.worksiteId),
      filter.vehicleIds ? inArray(mantHistoricalRecords.vehicleId, filter.vehicleIds.length ? [...filter.vehicleIds] : ["__none__"]) : undefined,
    ))
  return rows.map((row) => ({
    id: `h:${row.key}`,
    source: "historial" as const,
    reference: row.recordId ?? "",
    date: row.date,
    vehicleId: row.vehicleId,
    equipmentLabel: equipmentText(row.code, row.plate, row.equipmentText),
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    actionType: isActionType(row.actionType) || row.actionType === "sin_clasificar" ? (row.actionType as ActionTypeOrUnknown) : actionTypeFromText(row.kindText),
    laborHours: row.laborHours,
    workshopDays: workshopDaysBetween(plainDay(row.entryDate), plainDay(row.exitDate)),
    inWorkshop: false,
    external: externalFromHistorical(row.external),
  }))
}

async function loadOrderRows(filter: RowFilter): Promise<MaintenanceWorkRow[]> {
  if (!filter.orderVisibility) return []
  const entryDay = SANTIAGO_DAY(mantWorkOrders.workshopEntryAt)
  const exitDay = SANTIAGO_DAY(mantWorkOrders.workshopExitAt)
  const rows = await db.select({
    id: mantWorkOrders.id,
    folio: mantWorkOrders.folio,
    entryDay,
    exitDay,
    vehicleId: mantWorkOrders.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    worksiteId: mantWorkOrders.worksiteId,
    worksiteName: worksites.name,
    actionType: mantWorkOrders.actionType,
    repair: mantWorkOrders.repair,
    maintenance: mantWorkOrders.maintenance,
    laborHours: mantWorkOrders.laborHours,
    workshopKind: mantWorkOrders.workshopKind,
  })
    .from(mantWorkOrders)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .where(and(
      ne(mantWorkOrders.status, "anulada"),
      // Sólo las OT que ya entraron a taller son trabajo hecho; la fecha es el día de ingreso.
      isNotNull(mantWorkOrders.workshopEntryAt),
      filter.orderVisibility,
      sql`${entryDay} >= ${filter.from} AND ${entryDay} <= ${filter.to}`,
      worksiteScopeSqlFor(filter.scope, mantWorkOrders.worksiteId, filter.worksiteId),
      filter.vehicleIds ? inArray(mantWorkOrders.vehicleId, filter.vehicleIds.length ? [...filter.vehicleIds] : ["__none__"]) : undefined,
    ))
  return rows.map((row) => {
    const open = !!row.entryDay && !row.exitDay
    return {
      id: `ot:${row.id}`,
      source: "ot" as const,
      reference: row.folio,
      date: row.entryDay!,
      vehicleId: row.vehicleId,
      equipmentLabel: equipmentText(row.code, row.plate, ""),
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      actionType: workOrderActionType({ actionType: row.actionType, repair: row.repair, maintenance: row.maintenance }),
      laborHours: row.laborHours,
      workshopDays: open ? workshopDaysBetween(row.entryDay, filter.today) : workshopDaysBetween(row.entryDay, row.exitDay),
      inWorkshop: open,
      external: row.workshopKind ? row.workshopKind === "externo" : null,
    }
  })
}

/** Los registros firmados de la plataforma como trabajos (ver la cabecera del archivo para el corte y el «sin OT»). */
async function loadRecordRows(filter: RowFilter): Promise<MaintenanceWorkRow[]> {
  if (!filter.recordVisibility) return []
  const rows = await db.select({
    id: mantRecords.id,
    folio: mantRecords.folio,
    kind: mantRecords.kind,
    workDate: mantRecords.workDate,
    vehicleId: mantRecords.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    worksiteId: mantRecords.worksiteId,
    worksiteName: worksites.name,
    executorKind: mantRecords.executorKind,
    hours: mantRecordCorrectives.hours,
    inWorkshop: mantRecordCorrectives.inWorkshop,
    workshopEntryDate: mantRecordCorrectives.workshopEntryDate,
  })
    .from(mantRecords)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantRecords.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .leftJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .where(and(
      eq(mantRecords.status, "vigente"),
      filter.recordVisibility,
      sql`${mantRecords.workDate} >= ${filter.from} AND ${mantRecords.workDate} <= ${filter.to}`,
      // Lo que tiene OT ya se cuenta por la OT; antes del corte, por el historial.
      filter.mode === "panel" ? sql`${mantRecords.workOrderId} IS NULL AND ${mantRecords.workDate} >= ${FORMS_CUTOVER_DATE}` : undefined,
      worksiteScopeSqlFor(filter.scope, mantRecords.worksiteId, filter.worksiteId),
      filter.vehicleIds ? inArray(mantRecords.vehicleId, filter.vehicleIds.length ? [...filter.vehicleIds] : ["__none__"]) : undefined,
    ))

  // Novedades de taller sólo de las correctivas que pasaron por taller: de ahí salen la salida y los días.
  const inShopIds = rows.filter((row) => row.inWorkshop).map((row) => row.id)
  const updates = inShopIds.length
    ? await db.select({
      recordId: mantWorkshopUpdates.recordId, kind: mantWorkshopUpdates.kind, exitDate: mantWorkshopUpdates.exitDate, createdAt: mantWorkshopUpdates.createdAt,
    })
      .from(mantWorkshopUpdates)
      .where(inArray(mantWorkshopUpdates.recordId, inShopIds))
      .orderBy(asc(mantWorkshopUpdates.createdAt))
    : []
  const updatesByRecord = new Map<string, Array<{ kind: "sigue" | "salio"; createdDate: string; exitDate: string | null }>>()
  for (const update of updates) {
    const list = updatesByRecord.get(update.recordId) ?? []
    list.push({ kind: update.kind as "sigue" | "salio", createdDate: todayInChile(update.createdAt), exitDate: update.exitDate })
    updatesByRecord.set(update.recordId, list)
  }

  return rows.map((row) => {
    const corrective = row.kind === "C"
    // Mismo cálculo que la ficha del registro (regla 11); sin paso por taller no hay días que inventar.
    const state = corrective && row.inWorkshop
      ? workshopState({ inWorkshop: true, entryDate: row.workshopEntryDate, workDate: row.workDate, updates: updatesByRecord.get(row.id) ?? [] }, filter.today)
      : null
    return {
      id: `r:${row.id}`,
      source: "registro" as const,
      reference: row.folio ?? "",
      date: row.workDate,
      vehicleId: row.vehicleId,
      equipmentLabel: equipmentText(row.code, row.plate, ""),
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      actionType: corrective ? "correctiva" as const : "preventiva" as const,
      laborHours: corrective ? row.hours : null,
      workshopDays: state?.daysStopped ?? null,
      inWorkshop: !!state?.inWorkshop,
      external: row.executorKind === "externo",
    }
  })
}

function sortRows(rows: MaintenanceWorkRow[]): MaintenanceWorkRow[] {
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.equipmentLabel.localeCompare(b.equipmentLabel, "es") || a.id.localeCompare(b.id))
}

export interface MaintenanceWorkResult {
  rows: MaintenanceWorkRow[]
  /** `false` = quien mira no ve órdenes de trabajo: el resultado no trae OT y el Panel lo dice. */
  includesOrders: boolean
}

/** Los trabajos del rango dentro del alcance de quien mira, del más reciente al más antiguo. */
export async function loadMaintenanceWork(viewer: MantViewer, query: MaintenanceWorkQuery): Promise<MaintenanceWorkResult> {
  const scope = equipmentScope(viewer)
  const visibility = workOrderVisibility(viewer)
  // Las OT entran sólo con visibilidad completa para el alcance (todas, o las de sus faenas). Quien ve únicamente
  // las propias no recibe un conteo parcial que parezca el de la faena: se trata como «no ve OT» y el Panel lo dice.
  const fullOrderView = visibility.kind === "all" || visibility.worksiteIds.length > 0
  const orderVisibility = fullOrderView ? workOrderVisibilitySql(visibility) : null
  const filter: RowFilter = {
    from: query.from,
    to: query.to,
    scope,
    ...(query.worksiteId ? { worksiteId: query.worksiteId } : {}),
    ...(query.vehicleId ? { vehicleIds: [query.vehicleId] } : {}),
    orderVisibility,
    recordVisibility: recordVisibilitySql(recordVisibility(viewer)),
    mode: "panel",
    today: query.today ?? todayInChile(),
  }
  const [historial, orders, records] = await Promise.all([loadHistorialRows(filter), loadOrderRows(filter), loadRecordRows(filter)])
  return { rows: sortRows([...historial, ...orders, ...records]), includesOrders: orderVisibility !== null }
}

/**
 * Trabajos de unos equipos sin filtrar por quién pregunta: sólo lo usa la comprobación «¿hubo trabajo después
 * del hallazgo?», que responde un hecho del equipo y devuelve conteos de hallazgos que ya pasaron por el
 * alcance. Con el alcance de lectura, quien no ve OT daría por «sin trabajo» un hallazgo que sí tiene una OT.
 * Es un hecho, no una cifra del Panel: no aplica el corte de los formularios y suma todos los registros vigentes.
 */
async function loadWorkOfVehicles(vehicleIds: readonly string[], from: string, to: string, today: string): Promise<MaintenanceWorkRow[]> {
  if (vehicleIds.length === 0) return []
  const filter: RowFilter = { from, to, scope: "all", vehicleIds, orderVisibility: sql`true`, recordVisibility: sql`true`, mode: "fact", today }
  const [historial, orders, records] = await Promise.all([loadHistorialRows(filter), loadOrderRows(filter), loadRecordRows(filter)])
  return [...historial, ...orders, ...records]
}

// ── Agregados del Panel (puros) ────────────────────────────────────────────

export interface WorkTypeSeriesPoint {
  key: string
  partial: boolean
  preventiva: number
  correctiva: number
  predictiva: number
  sin_clasificar: number
}

export interface WorksiteWorkRow {
  /** Id de la faena o `__sin_faena__`. */
  key: string
  name: string
  worksiteId: string | null
  count: number
  correctives: number
  /** Suma de días en taller de los trabajos que los traen. */
  workshopDays: number
  laborHours: number
}

export interface CorrectiveEquipmentRow {
  vehicleId: string
  label: string
  count: number
}

export interface MaintenanceWorkSummary {
  total: number
  byType: Record<ActionTypeOrUnknown, number>
  /** Trabajos con tipo definido: la base del % de correctivas (los «sin clasificar» van aparte). */
  classified: number
  /** `null` sin trabajos clasificados: no hay porcentaje que inventar. */
  correctivePercent: number | null
  bySource: Record<WorkSource, number>
  workshopDays: { total: number; withData: number; withoutData: number; inWorkshop: number }
  laborHours: { total: number; withData: number; withoutData: number }
  external: number
  series: WorkTypeSeriesPoint[]
  byWorksite: WorksiteWorkRow[]
  topCorrective: CorrectiveEquipmentRow[]
}

export const SIN_FAENA_KEY = "__sin_faena__"
export const SIN_FAENA_LABEL = "Sin faena"

const round1 = (value: number) => Math.round(value * 10) / 10
const emptyByType = (): Record<ActionTypeOrUnknown, number> => ({ preventiva: 0, correctiva: 0, predictiva: 0, sin_clasificar: 0 })

/**
 * Agrega los trabajos. Las cifras (totales, por faena, equipos) miden el período `[from, to]`; la serie por
 * tipo mide la ventana del gráfico (`chart`, que contiene al período), igual que el resto del Panel.
 */
export function summarizeMaintenanceWork(
  rows: readonly MaintenanceWorkRow[],
  query: { from: string; to: string; chart: ChartWindow | { from: string; to: string; granularity: "day" | "month" }; today: string },
  topLimit = 50,
  topMin = 2,
): MaintenanceWorkSummary {
  const { chart, today } = query
  const inPeriod = rows.filter((row) => row.date >= query.from && row.date <= query.to)
  const byType = emptyByType()
  const bySource: Record<WorkSource, number> = { historial: 0, ot: 0, registro: 0 }
  const days = { total: 0, withData: 0, withoutData: 0, inWorkshop: 0 }
  const hours = { total: 0, withData: 0, withoutData: 0 }
  let external = 0
  const sites = new Map<string, WorksiteWorkRow>()
  const equipment = new Map<string, CorrectiveEquipmentRow>()

  for (const row of inPeriod) {
    byType[row.actionType] += 1
    bySource[row.source] += 1
    if (row.workshopDays === null) days.withoutData += 1
    else { days.withData += 1; days.total += row.workshopDays }
    if (row.inWorkshop) days.inWorkshop += 1
    if (row.laborHours === null) hours.withoutData += 1
    else { hours.withData += 1; hours.total += row.laborHours }
    if (row.external) external += 1

    const key = row.worksiteId ?? SIN_FAENA_KEY
    const site = sites.get(key) ?? { key, name: row.worksiteName ?? SIN_FAENA_LABEL, worksiteId: row.worksiteId, count: 0, correctives: 0, workshopDays: 0, laborHours: 0 }
    site.count += 1
    if (row.actionType === "correctiva") site.correctives += 1
    site.workshopDays += row.workshopDays ?? 0
    site.laborHours += row.laborHours ?? 0
    sites.set(key, site)

    if (row.actionType === "correctiva" && row.vehicleId) {
      const item = equipment.get(row.vehicleId) ?? { vehicleId: row.vehicleId, label: row.equipmentLabel, count: 0 }
      item.count += 1
      equipment.set(row.vehicleId, item)
    }
  }

  const classified = byType.preventiva + byType.correctiva + byType.predictiva

  const keys = listBuckets(chart.from, chart.to, chart.granularity)
  const points = new Map<string, WorkTypeSeriesPoint>(keys.map((key) => [key, {
    key, preventiva: 0, correctiva: 0, predictiva: 0, sin_clasificar: 0,
    partial: isPartialBucket(key, chart.granularity, today) && chart.to >= today,
  }]))
  for (const row of rows) {
    if (row.date < chart.from || row.date > chart.to) continue
    const point = points.get(bucketKey(row.date, chart.granularity))
    if (point) point[row.actionType] += 1
  }

  return {
    total: inPeriod.length,
    byType,
    classified,
    correctivePercent: classified > 0 ? (byType.correctiva / classified) * 100 : null,
    bySource,
    workshopDays: { ...days, total: round1(days.total) },
    laborHours: { ...hours, total: round1(hours.total) },
    external,
    series: keys.map((key) => points.get(key)!),
    byWorksite: [...sites.values()]
      .map((site) => ({ ...site, workshopDays: round1(site.workshopDays), laborHours: round1(site.laborHours) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es")),
    topCorrective: [...equipment.values()]
      .filter((item) => item.count >= topMin)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))
      .slice(0, topLimit),
  }
}

// ── Equipo elegido (filtro `?equipo=`) ─────────────────────────────────────

export interface PanelEquipment {
  id: string
  code: string | null
  plate: string
  worksiteId: string
  label: string
}

function toPanelEquipment(row: { id: string; code: string | null; plate: string; worksiteId: string }): PanelEquipment {
  return { ...row, label: equipmentText(row.code, row.plate, "") }
}

/** Equipos activos dentro del alcance (y de la faena elegida): las opciones del filtro «Equipo». */
export async function loadPanelEquipment(viewer: MantViewer, worksiteId: string | undefined): Promise<PanelEquipment[]> {
  const rows = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId })
    .from(fuelVehicles)
    .where(and(eq(fuelVehicles.isActive, true), worksiteScopeSqlFor(equipmentScope(viewer), fuelVehicles.worksiteId, worksiteId)))
    .orderBy(asc(fuelVehicles.code), asc(fuelVehicles.plate))
  return rows.map(toPanelEquipment)
}

/**
 * El equipo pedido en la URL, sólo si cae dentro del alcance (y de la faena elegida). Uno inventado o de una
 * faena que no se ve devuelve `null` y el Panel lo ignora, igual que con `?faena=`.
 */
export async function resolvePanelEquipment(viewer: MantViewer, worksiteId: string | undefined, vehicleId: string | undefined): Promise<PanelEquipment | null> {
  if (!vehicleId) return null
  const [row] = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId })
    .from(fuelVehicles)
    .where(and(eq(fuelVehicles.id, vehicleId), worksiteScopeSqlFor(equipmentScope(viewer), fuelVehicles.worksiteId, worksiteId)))
    .limit(1)
  return row ? toPanelEquipment(row) : null
}

// ── R5: cumplimiento de pautas (formularios) ───────────────────────────────

export interface ScheduleComplianceStats {
  /** Pautas importadas del período (sin las de prueba). */
  checks: number
  /** De ellas, las que traen % de cumplimiento. */
  withCompliance: number
  /** Promedio de `compliance`, 0–100; `null` sin pautas con cumplimiento. */
  averagePercent: number | null
}

const SCHEDULE_DATE = sql<string>`coalesce(${mantHistoricalScheduleChecks.performedOn}, left(${mantHistoricalScheduleChecks.submittedAt}, 10))`

/**
 * Promedio de `compliance` de las pautas preventivas importadas (checklist de los formularios), sin las filas
 * de prueba. NO es el semáforo nativo del equipo (ese sale de lecturas y pautas de la plataforma): el Panel
 * rotula cada uno con su origen.
 */
export async function loadScheduleCompliance(viewer: MantViewer, query: MaintenanceWorkQuery): Promise<ScheduleComplianceStats> {
  const [row] = await db.select({
    checks: sql<number>`count(*)::int`,
    withCompliance: sql<number>`(count(${mantHistoricalScheduleChecks.compliance}))::int`,
    average: sql<number | null>`avg(${mantHistoricalScheduleChecks.compliance})::float8`,
  })
    .from(mantHistoricalScheduleChecks)
    .where(and(
      eq(mantHistoricalScheduleChecks.isTest, false),
      sql`${SCHEDULE_DATE} >= ${query.from} AND ${SCHEDULE_DATE} <= ${query.to}`,
      worksiteScopeSqlFor(equipmentScope(viewer), mantHistoricalScheduleChecks.worksiteId, query.worksiteId),
      query.vehicleId ? eq(mantHistoricalScheduleChecks.vehicleId, query.vehicleId) : undefined,
    ))
  const average = row?.average
  return {
    checks: Number(row?.checks ?? 0),
    withCompliance: Number(row?.withCompliance ?? 0),
    averagePercent: average === null || average === undefined ? null : Math.round(Number(average) * 1000) / 10,
  }
}

// ── R5: hallazgos «mal estado» sin trabajo ─────────────────────────────────

export interface FindingWithoutWork {
  vehicleId: string
  label: string
  worksiteName: string | null
  /** Hallazgos «mal estado» de este equipo sin trabajo dentro del plazo. */
  count: number
  /** Primer día en que se encontró alguno. */
  firstFoundOn: string
  /** «Sección: ítem», sin repetir. */
  items: string[]
}

export interface FindingsWithoutWork {
  /** Plazo vigente (`mantencionFindingWithoutOtDays`). */
  days: number
  /** Hallazgos «mal estado» del período con equipo vinculado: la base. */
  total: number
  /** Con un trabajo del mismo equipo entre el día del hallazgo y `days` días después. */
  withWork: number
  /** Sin trabajo y con el plazo ya cumplido: lo que el Panel cuenta como «sin trabajo». */
  withoutWork: number
  /** Sin trabajo todavía, pero el plazo sigue corriendo: no se acusa. */
  inWindow: number
  /** Hallazgos «mal estado» cuyo equipo no está vinculado: no se puede saber si hubo trabajo. */
  unlinked: number
  /** Los que no tienen trabajo (plazo cumplido), agrupados por equipo, el que más tiene primero. */
  byEquipment: FindingWithoutWork[]
}

export interface FindingRow {
  vehicleId: string | null
  label: string
  worksiteName: string | null
  foundOn: string
  section: string
  item: string
}

/** Clasifica los hallazgos contra los trabajos del mismo equipo. Pura: la usan el servicio y las pruebas. */
export function classifyFindings(
  findings: readonly FindingRow[],
  work: ReadonlyArray<Pick<MaintenanceWorkRow, "vehicleId" | "date">>,
  days: number,
  today: string,
): FindingsWithoutWork {
  const workDates = new Map<string, string[]>()
  for (const row of work) {
    if (!row.vehicleId) continue
    const list = workDates.get(row.vehicleId) ?? []
    list.push(row.date)
    workDates.set(row.vehicleId, list)
  }
  let total = 0
  let withWork = 0
  let withoutWork = 0
  let inWindow = 0
  let unlinked = 0
  const grouped = new Map<string, FindingWithoutWork>()
  for (const finding of findings) {
    if (!finding.vehicleId) { unlinked += 1; continue }
    total += 1
    const deadline = addDaysToPlainDate(finding.foundOn, days)
    const covered = (workDates.get(finding.vehicleId) ?? []).some((date) => date >= finding.foundOn && date <= deadline)
    if (covered) { withWork += 1; continue }
    if (deadline >= today) { inWindow += 1; continue }
    withoutWork += 1
    const group = grouped.get(finding.vehicleId) ?? { vehicleId: finding.vehicleId, label: finding.label, worksiteName: finding.worksiteName, count: 0, firstFoundOn: finding.foundOn, items: [] }
    group.count += 1
    if (finding.foundOn < group.firstFoundOn) group.firstFoundOn = finding.foundOn
    const text = `${finding.section}: ${finding.item}`
    if (!group.items.includes(text)) group.items.push(text)
    grouped.set(finding.vehicleId, group)
  }
  return {
    days, total, withWork, withoutWork, inWindow, unlinked,
    byEquipment: [...grouped.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es")),
  }
}

/**
 * Hallazgos «mal estado» de las inspecciones importadas, en el período y el alcance de quien mira, que no
 * tienen un trabajo (historial u OT, no anulada ni de prueba) del mismo equipo con ingreso entre el día del
 * hallazgo y `mantencionFindingWithoutOtDays` días después. El plazo es un parámetro operativo.
 */
export async function loadFindingsWithoutWork(viewer: MantViewer, query: MaintenanceWorkQuery): Promise<FindingsWithoutWork> {
  const today = query.today ?? todayInChile()
  const { mantencionFindingWithoutOtDays: days } = await getOperationalSettings()
  const rows = await db.select({
    vehicleId: mantHistoricalInspections.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    equipmentText: mantHistoricalInspections.equipmentText,
    worksiteName: worksites.name,
    foundOn: mantHistoricalFindings.foundOn,
    section: mantHistoricalFindings.section,
    item: mantHistoricalFindings.item,
  })
    .from(mantHistoricalFindings)
    .innerJoin(mantHistoricalInspections, eq(mantHistoricalInspections.sourceKey, mantHistoricalFindings.inspectionSourceKey))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantHistoricalInspections.vehicleId))
    .leftJoin(worksites, eq(worksites.id, mantHistoricalInspections.worksiteId))
    .where(and(
      eq(mantHistoricalFindings.condition, "mal"),
      sql`${mantHistoricalFindings.foundOn} >= ${query.from} AND ${mantHistoricalFindings.foundOn} <= ${query.to}`,
      worksiteScopeSqlFor(equipmentScope(viewer), mantHistoricalInspections.worksiteId, query.worksiteId),
      query.vehicleId ? eq(mantHistoricalInspections.vehicleId, query.vehicleId) : undefined,
    ))
    .orderBy(asc(mantHistoricalFindings.foundOn), asc(mantHistoricalFindings.sourceKey))
  const findings: FindingRow[] = rows.map((row) => ({
    vehicleId: row.vehicleId,
    label: equipmentText(row.code, row.plate, row.equipmentText),
    worksiteName: row.worksiteName,
    foundOn: row.foundOn,
    section: row.section,
    item: row.item,
  }))
  const vehicleIds = [...new Set(findings.map((finding) => finding.vehicleId).filter((id): id is string => !!id))]
  const work = vehicleIds.length > 0
    ? await loadWorkOfVehicles(vehicleIds, findings.reduce((min, f) => (f.foundOn < min ? f.foundOn : min), findings[0]!.foundOn), addDaysToPlainDate(query.to, days), today)
    : []
  return classifyFindings(findings, work, days, today)
}
