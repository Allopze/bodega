import { and, eq, inArray, ne, or, sql, type AnyColumn } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelVehicles,
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionRuns,
  preventionInspectionTemplates,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import type { IndicatorGranularity } from "@/lib/indicators/period"
import { todayInChile } from "@/lib/utils"
import type { MantViewer } from "./access"
import { fleetScopeFor } from "./panel"
import {
  buildOpenFailures,
  countFailuresBySystem,
  hasAllSignatures,
  isReceivedStatus,
  normalizeSignatureRoles,
  operatedHours,
  readingKey,
  REPORTE_EQUIPOS_CODE,
  summarizeCoverage,
  type ItemReading,
  type ReportCoverage,
  type SystemFailureCount,
} from "./reporte-equipos-metrics"

/**
 * Datos de la sección «Reportes de equipos» del Panel de mantención: ¿llegan los reportes de turno
 * y qué fallas dejan abiertas? Las definiciones y los cálculos están en `reporte-equipos-metrics.ts`;
 * acá sólo se consulta.
 *
 * Alcance: el mismo del resto del Panel (`fleetScopeFor`: la faena elegida sólo achica el alcance del
 * visor, nunca lo agranda), aplicado a la faena del reporte. Los reportes cancelados no se esperaban y
 * quedan fuera de todo.
 */

export interface ReporteEquiposQuery {
  /** El período medido (cortado en hoy). */
  from: string
  to: string
  granularity: IndicatorGranularity
  /** Faena elegida; `undefined` = todas las visibles. */
  worksiteId?: string
  today?: string
}

export interface EquipmentHours {
  vehicleId: string
  code: string
  plate: string
  hours: number
}

export interface EquipmentFailures {
  key: string
  vehicleId: string | null
  code: string
  plate: string
  fresh: number
  week: number
  old: number
  total: number
  /** Cuántas de sus fallas impactan la seguridad. */
  safety: number
}

export interface ReporteEquiposIndicators {
  /** Hay al menos un reporte (no cancelado) en el alcance. Sin ninguno, la sección no se pinta. */
  hasRuns: boolean
  coverage: ReportCoverage
  signatures: {
    /** Recibidos con todos los roles firmados. */
    complete: number
    received: number
    percent: number | null
  }
  hours: {
    total: number
    /** Reportes recibidos con ambas lecturas válidas: la base de la suma. */
    measuredReports: number
    byEquipment: EquipmentHours[]
  }
  /** Estado de hoy, no limitado al período: una falla abierta lo sigue estando fuera de él. */
  failures: {
    total: number
    safety: number
    byEquipment: EquipmentFailures[]
  }
  bySystem: SystemFailureCount[]
}

const EMPTY: ReporteEquiposIndicators = {
  hasRuns: false,
  coverage: { expected: 0, received: 0, percent: null, points: [] },
  signatures: { complete: 0, received: 0, percent: null },
  hours: { total: 0, measuredReports: 0, byEquipment: [] },
  failures: { total: 0, safety: 0, byEquipment: [] },
  bySystem: [],
}

const SANTIAGO_DAY = (column: AnyColumn) =>
  sql<string | null>`to_char(${column} AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')`

const runs = preventionInspectionRuns
const templates = preventionInspectionTemplates
const answers = preventionInspectionAnswers
const findings = preventionInspectionFindings

/** Fecha del reporte: la del turno; si falta, la de Chile de cuando se transcribió. */
const REPORT_DATE = sql<string | null>`COALESCE(${runs.scheduledFor}, ${SANTIAGO_DAY(runs.executedAt)})`
/** Roles que firman según la plantilla con la que se hizo el reporte. */
const SIGNATURE_ROLES = sql<unknown>`${templates.definitionSnapshot} -> 'closingAct' -> 'signatureRoles'`

const HOUR_METER_ITEMS = ["horometro_inicio", "horometro_termino"]

function baseScope(viewer: MantViewer, worksiteId: string | undefined) {
  return and(
    eq(templates.sourceDefinitionCode, REPORTE_EQUIPOS_CODE),
    ne(runs.status, "cancelled"),
    worksiteScopeSqlFor(fleetScopeFor(viewer, worksiteId), runs.worksiteId),
  )!
}

function periodScope(viewer: MantViewer, query: ReporteEquiposQuery, today: string) {
  const to = query.to < today ? query.to : today
  return and(baseScope(viewer, query.worksiteId), sql`${REPORT_DATE} >= ${query.from}`, sql`${REPORT_DATE} <= ${to}`)!
}

export async function loadReporteEquipos(viewer: MantViewer, query: ReporteEquiposQuery): Promise<ReporteEquiposIndicators> {
  const today = query.today ?? todayInChile()
  const scope = baseScope(viewer, query.worksiteId)

  const [anyRun] = await db.select({ id: runs.id })
    .from(runs)
    .innerJoin(templates, eq(templates.id, runs.templateId))
    .where(scope)
    .limit(1)
  if (!anyRun) return EMPTY

  const inPeriod = periodScope(viewer, query, today)
  const [periodRuns, periodAnswers, openFindings] = await Promise.all([
    db.select({
      id: runs.id,
      date: REPORT_DATE,
      status: runs.status,
      signatures: runs.closingSignatures,
      roles: SIGNATURE_ROLES,
    })
      .from(runs)
      .innerJoin(templates, eq(templates.id, runs.templateId))
      .where(inPeriod),
    // Sólo lo que se necesita de las respuestas de los reportes recibidos: las dos lecturas del
    // horómetro y las fallas (traer las 25 filas de cada reporte multiplicaría el volumen por 25).
    db.select({
      runId: answers.runId,
      vehicleId: runs.subjectVehicleId,
      itemId: answers.itemId,
      result: answers.result,
      value: answers.value,
    })
      .from(answers)
      .innerJoin(runs, eq(runs.id, answers.runId))
      .innerJoin(templates, eq(templates.id, runs.templateId))
      .where(and(
        inPeriod,
        inArray(runs.status, ["completed", "reviewed"]),
        or(inArray(answers.itemId, HOUR_METER_ITEMS), eq(answers.result, "non_conforming")),
      )),
    db.select({
      id: findings.id,
      vehicleId: runs.subjectVehicleId,
      itemId: answers.itemId,
      criticality: findings.criticality,
      /* La fecha del reporte que levantó el hallazgo, no la de su fila: el jefe transcribe el papel
       * días después (y la carga histórica de noviembre, semanas), y una desviación sin ítem —que no
       * tiene racha de lecturas con qué fecharse— salía «0 a 3 días» aunque el turno fuera de hace dos
       * semanas. Sin fecha de reporte, cae a la del hallazgo. */
      createdDate: sql<string>`COALESCE(${REPORT_DATE}, ${SANTIAGO_DAY(findings.createdAt)})`,
    })
      .from(findings)
      .innerJoin(runs, eq(runs.id, findings.runId))
      .innerJoin(templates, eq(templates.id, runs.templateId))
      .leftJoin(answers, eq(answers.id, findings.answerId))
      .where(and(scope, ne(findings.status, "closed"))),
  ])

  const coverage = summarizeCoverage(periodRuns, { from: query.from, to: query.to, granularity: query.granularity, today })

  // Firmas: de los recibidos, los que traen cada rol que la plantilla de ese reporte exige.
  const received = periodRuns.filter((run) => isReceivedStatus(run.status))
  const complete = received.filter((run) => hasAllSignatures(run.signatures, normalizeSignatureRoles(run.roles))).length

  // Horas y fallas por sistema, desde las respuestas de los recibidos.
  const meters = new Map<string, { vehicleId: string | null; start?: string | null; end?: string | null }>()
  const failedItems: string[] = []
  for (const answer of periodAnswers) {
    if (answer.itemId === "horometro_inicio" || answer.itemId === "horometro_termino") {
      const entry = meters.get(answer.runId) ?? { vehicleId: answer.vehicleId }
      if (answer.itemId === "horometro_inicio") entry.start = answer.value
      else entry.end = answer.value
      meters.set(answer.runId, entry)
    }
    if (answer.result === "non_conforming") failedItems.push(answer.itemId)
  }
  const hoursByVehicle = new Map<string, number>()
  let totalHours = 0
  let measuredReports = 0
  for (const entry of meters.values()) {
    const hours = operatedHours(entry.start, entry.end)
    if (hours === null || !entry.vehicleId) continue
    measuredReports += 1
    totalHours += hours
    hoursByVehicle.set(entry.vehicleId, (hoursByVehicle.get(entry.vehicleId) ?? 0) + hours)
  }

  // Fallas abiertas: la antigüedad pide el historial de ese equipo e ítem, no sólo el del período.
  const vehicleIds = [...new Set(openFindings.flatMap((row) => (row.vehicleId ? [row.vehicleId] : [])))]
  const itemIds = [...new Set(openFindings.flatMap((row) => (row.itemId ? [row.itemId] : [])))]
  const readings = await loadReadings(vehicleIds, itemIds, new Set(openFindings.flatMap((row) => (row.vehicleId && row.itemId ? [readingKey(row.vehicleId, row.itemId)] : []))))
  const openFailures = buildOpenFailures(
    openFindings.map((row) => ({ id: row.id, vehicleId: row.vehicleId, itemId: row.itemId, criticality: row.criticality, createdDate: row.createdDate ?? today })),
    readings,
    today,
  )

  const names = await vehicleNames([...hoursByVehicle.keys(), ...vehicleIds])
  const nameOf = (vehicleId: string | null) => {
    const vehicle = vehicleId ? names.get(vehicleId) : undefined
    return { code: vehicle?.code ?? vehicle?.plate ?? "Equipo sin registro", plate: vehicle?.plate ?? "" }
  }

  const failuresByEquipment = new Map<string, EquipmentFailures>()
  for (const failure of openFailures) {
    const key = failure.vehicleId ?? "sin-equipo"
    const row = failuresByEquipment.get(key) ?? { key, vehicleId: failure.vehicleId, ...nameOf(failure.vehicleId), fresh: 0, week: 0, old: 0, total: 0, safety: 0 }
    row[failure.bucket] += 1
    row.total += 1
    if (failure.safety) row.safety += 1
    failuresByEquipment.set(key, row)
  }

  return {
    hasRuns: true,
    coverage,
    signatures: { complete, received: received.length, percent: received.length > 0 ? (complete / received.length) * 100 : null },
    hours: {
      total: Math.round(totalHours * 10) / 10,
      measuredReports,
      byEquipment: [...hoursByVehicle.entries()]
        .map(([vehicleId, hours]) => ({ vehicleId, ...nameOf(vehicleId), hours: Math.round(hours * 10) / 10 }))
        .filter((row) => row.hours > 0)
        .sort((a, b) => b.hours - a.hours || a.code.localeCompare(b.code, "es")),
    },
    failures: {
      total: openFailures.length,
      safety: openFailures.filter((failure) => failure.safety).length,
      byEquipment: [...failuresByEquipment.values()].sort((a, b) => b.old - a.old || b.total - a.total || a.code.localeCompare(b.code, "es")),
    },
    bySystem: countFailuresBySystem(failedItems),
  }
}

async function vehicleNames(vehicleIds: string[]): Promise<Map<string, { code: string | null; plate: string }>> {
  const ids = [...new Set(vehicleIds)]
  if (ids.length === 0) return new Map()
  const rows = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate })
    .from(fuelVehicles)
    .where(inArray(fuelVehicles.id, ids))
  return new Map(rows.map((row) => [row.id, { code: row.code, plate: row.plate }]))
}

/**
 * Lo que dijo cada reporte recibido sobre un ítem de un equipo, para los pares con una falla abierta.
 * Sólo «conforme» y «no cumple»: un «no aplica» no dice nada sobre si la falla sigue.
 */
async function loadReadings(vehicleIds: string[], itemIds: string[], wanted: ReadonlySet<string>): Promise<Map<string, ItemReading[]>> {
  const map = new Map<string, ItemReading[]>()
  if (vehicleIds.length === 0 || itemIds.length === 0) return map
  const rows = await db.select({
    vehicleId: runs.subjectVehicleId,
    itemId: answers.itemId,
    result: answers.result,
    date: REPORT_DATE,
  })
    .from(answers)
    .innerJoin(runs, eq(runs.id, answers.runId))
    .innerJoin(templates, eq(templates.id, runs.templateId))
    .where(and(
      eq(templates.sourceDefinitionCode, REPORTE_EQUIPOS_CODE),
      inArray(runs.status, ["completed", "reviewed"]),
      inArray(runs.subjectVehicleId, vehicleIds),
      inArray(answers.itemId, itemIds),
      inArray(answers.result, ["conforming", "non_conforming"]),
    ))
  for (const row of rows) {
    if (!row.vehicleId || !row.date) continue
    const key = readingKey(row.vehicleId, row.itemId)
    if (!wanted.has(key)) continue
    const list = map.get(key)
    if (list) list.push({ date: row.date, result: row.result })
    else map.set(key, [{ date: row.date, result: row.result }])
  }
  return map
}
