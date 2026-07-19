/**
 * Cálculos puros de indicadores de accidentabilidad — sin dependencias de
 * DB, importable tanto desde el servicio (server) como desde componentes
 * cliente (modal de edición, gráficos) para el cálculo en vivo.
 */

export type IndicatorCounters = {
  trabajadores: number
  horasHombre: number
  accConTiempoPerdido: number
  accSinTiempoPerdido: number
  diasPerdidos: number
  incidentes: number
  danoMaterial: number
  danoAmbiental: number
}

export const EMPTY_COUNTERS: IndicatorCounters = {
  trabajadores: 0, horasHombre: 0, accConTiempoPerdido: 0, accSinTiempoPerdido: 0,
  diasPerdidos: 0, incidentes: 0, danoMaterial: 0, danoAmbiental: 0,
}

/**
 * Proxy legado mientras no exista el registro canónico de lesionados/días de
 * cargo. No debe mostrarse como indicador oficial. DS 44 usa factor 1.000.000
 * para frecuencia y gravedad; sin HH el resultado no es calculable.
 */
export function calcRates(d: Pick<IndicatorCounters, "horasHombre" | "accConTiempoPerdido" | "accSinTiempoPerdido" | "diasPerdidos">) {
  const hh = d.horasHombre || 0
  const tasaFrecuencia = hh > 0 ? (d.accConTiempoPerdido / hh) * 1_000_000 : null
  const tasaGravedad = hh > 0 ? (d.diasPerdidos / hh) * 1_000_000 : null
  const totalAccidentes = (d.accConTiempoPerdido || 0) + (d.accSinTiempoPerdido || 0)
  return { tasaFrecuencia, tasaGravedad, totalAccidentes }
}

export function sumCounters(rows: IndicatorCounters[]): IndicatorCounters {
  return rows.reduce((acc, r) => ({
    trabajadores: acc.trabajadores + r.trabajadores,
    horasHombre: acc.horasHombre + r.horasHombre,
    accConTiempoPerdido: acc.accConTiempoPerdido + r.accConTiempoPerdido,
    accSinTiempoPerdido: acc.accSinTiempoPerdido + r.accSinTiempoPerdido,
    diasPerdidos: acc.diasPerdidos + r.diasPerdidos,
    incidentes: acc.incidentes + r.incidentes,
    danoMaterial: acc.danoMaterial + r.danoMaterial,
    danoAmbiental: acc.danoAmbiental + r.danoAmbiental,
  }), { ...EMPTY_COUNTERS })
}

/**
 * Arma, para una faena dada (o "total" = suma de todas las filas), los 12
 * meses del año con sus contadores (0 si no hay fila para ese mes).
 */
export function buildMonthlyCounters(
  rows: Array<IndicatorCounters & { worksiteId: string; month: number }>,
  worksiteId: string | "total",
): IndicatorCounters[] {
  const relevant = worksiteId === "total" ? rows : rows.filter((r) => r.worksiteId === worksiteId)
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const monthRows = relevant.filter((r) => r.month === month)
    return monthRows.length > 0 ? sumCounters(monthRows) : { ...EMPTY_COUNTERS }
  })
}

export const SAFETY_INDICATOR_FORMULA_VERSION = "ds44-art73-2025-v1"

export type IndicatorInclusionStatus = "pending" | "included" | "excluded"
export type CanonicalIndicatorStatus = "reconciled" | "provisional" | "non_calculable" | "error"

export interface CanonicalIndicatorEvent {
  incidentId: string
  worksiteId: string
  year: number
  month: number
  eventType: string
}

export interface CanonicalIndicatorCase {
  incidentId: string
  personId: string
  workerId: string | null
  worksiteId: string
  year: number
  month: number
  eventType: string
  absenceAtLeastNormalShift: boolean
  absenceDays: number
  chargeDays: number
  inclusionStatus: IndicatorInclusionStatus
  sex: string | null
}

export interface ControlledIndicatorDenominator {
  id: string
  worksiteId: string
  year: number
  month: number
  workerCount: number
  workedHours: number
  status: "draft" | "pending_review" | "approved" | "rejected"
  reconciliationStatus: "pending" | "matched" | "difference" | "exception"
  version: number
}

export interface IndicatorMetricSet {
  accidents: number
  injuredPeople: number
  absenceDays: number
  chargeDays: number
  accidentabilityRate: number | null
  frequencyRate: number | null
  severityRate: number | null
}

export interface CanonicalIndicatorResult {
  formulaVersion: typeof SAFETY_INDICATOR_FORMULA_VERSION
  year: number
  startMonth: number
  endMonth: number
  status: CanonicalIndicatorStatus
  confirmed: IndicatorMetricSet
  provisional: IndicatorMetricSet
  workerAverage: number | null
  workedHours: number
  denominatorSlots: number
  expectedDenominatorSlots: number
  pendingCaseCount: number
  errors: string[]
  reconciliationIssues: string[]
  incidentIds: string[]
  personCaseKeys: string[]
  denominatorIds: string[]
  denominatorVersions: number[]
  eventCounts: {
    incidents: number
    materialDamage: number
    environmentalDamage: number
  }
  sexBreakdown: Array<{ sex: string; value: number | null; suppressed: boolean }>
}

function inPeriod(item: { year: number; month: number }, year: number, startMonth: number, endMonth: number) {
  return item.year === year && item.month >= startMonth && item.month <= endMonth
}

function caseKey(item: CanonicalIndicatorCase) {
  return `${item.incidentId}:${item.workerId ?? item.personId}`
}

function deduplicateCases(items: CanonicalIndicatorCase[]) {
  const grouped = new Map<string, CanonicalIndicatorCase>()
  for (const item of items) {
    const key = caseKey(item)
    const current = grouped.get(key)
    if (!current) {
      grouped.set(key, item)
      continue
    }
    const inclusionStatus: IndicatorInclusionStatus = current.inclusionStatus === "included" || item.inclusionStatus === "included"
      ? "included"
      : current.inclusionStatus === "pending" || item.inclusionStatus === "pending"
        ? "pending"
        : "excluded"
    grouped.set(key, {
      ...current,
      inclusionStatus,
      absenceAtLeastNormalShift: current.absenceAtLeastNormalShift || item.absenceAtLeastNormalShift,
      absenceDays: Math.max(current.absenceDays, item.absenceDays),
      chargeDays: Math.max(current.chargeDays, item.chargeDays),
      sex: current.sex ?? item.sex,
    })
  }
  return [...grouped.values()]
}

function metricSet(cases: CanonicalIndicatorCase[], workerAverage: number | null, workedHours: number): IndicatorMetricSet {
  const accidents = new Set(cases.map((item) => item.incidentId)).size
  const injuredPeople = cases.length
  const absenceDays = cases.reduce((total, item) => total + item.absenceDays, 0)
  const chargeDays = cases.reduce((total, item) => total + item.chargeDays, 0)
  return {
    accidents,
    injuredPeople,
    absenceDays,
    chargeDays,
    accidentabilityRate: workerAverage && workerAverage > 0 ? (accidents / workerAverage) * 100 : null,
    frequencyRate: workedHours > 0 ? (injuredPeople / workedHours) * 1_000_000 : null,
    severityRate: workedHours > 0 ? ((absenceDays + chargeDays) / workedHours) * 1_000_000 : null,
  }
}

/**
 * Motor único DS 44. Los casos pendientes participan sólo en el resultado
 * provisional; un snapshot aprobado exige que confirmed === provisional.
 */
export function calculateCanonicalIndicatorPeriod(args: {
  year: number
  startMonth: number
  endMonth: number
  events: CanonicalIndicatorEvent[]
  cases: CanonicalIndicatorCase[]
  denominators: ControlledIndicatorDenominator[]
  expectedDenominatorSlots?: number
  smallGroupThreshold?: number
}): CanonicalIndicatorResult {
  if (!Number.isInteger(args.year) || args.year < 2024 || args.year > 2100) throw new Error("Año de indicadores inválido.")
  if (!Number.isInteger(args.startMonth) || !Number.isInteger(args.endMonth) || args.startMonth < 1 || args.endMonth > 12 || args.startMonth > args.endMonth) {
    throw new Error("Rango mensual de indicadores inválido.")
  }

  const events = args.events.filter((item) => inPeriod(item, args.year, args.startMonth, args.endMonth))
  const periodCases = deduplicateCases(args.cases.filter((item) => (
    inPeriod(item, args.year, args.startMonth, args.endMonth)
    && item.eventType === "work_accident"
    && item.absenceAtLeastNormalShift
  )))
  const confirmedCases = periodCases.filter((item) => item.inclusionStatus === "included")
  const pendingCases = periodCases.filter((item) => item.inclusionStatus === "pending")
  const provisionalCases = [...confirmedCases, ...pendingCases]
  const denominators = args.denominators.filter((item) => inPeriod(item, args.year, args.startMonth, args.endMonth) && item.status !== "rejected")
  const monthGroups = new Map<number, { workers: number; hours: number }>()
  for (const denominator of denominators) {
    const current = monthGroups.get(denominator.month) ?? { workers: 0, hours: 0 }
    current.workers += denominator.workerCount
    current.hours += denominator.workedHours
    monthGroups.set(denominator.month, current)
  }
  const workedHours = [...monthGroups.values()].reduce((total, month) => total + month.hours, 0)
  const workerAverage = monthGroups.size > 0
    ? [...monthGroups.values()].reduce((total, month) => total + month.workers, 0) / monthGroups.size
    : null
  const expectedSlots = args.expectedDenominatorSlots ?? (args.endMonth - args.startMonth + 1)
  const reconciliationIssues: string[] = []
  if (denominators.length < expectedSlots) reconciliationIssues.push("Faltan denominadores mensuales para el período.")
  if (denominators.some((item) => item.status !== "approved")) reconciliationIssues.push("Existen denominadores sin aprobación.")
  if (denominators.some((item) => item.reconciliationStatus !== "matched")) reconciliationIssues.push("Existen denominadores no conciliados.")
  const errors: string[] = []
  if (workedHours === 0 && (provisionalCases.length > 0 || provisionalCases.some((item) => item.absenceDays + item.chargeDays > 0))) {
    errors.push("Hay numeradores de frecuencia/gravedad sin horas trabajadas.")
  }
  if ((!workerAverage || workerAverage === 0) && new Set(provisionalCases.map((item) => item.incidentId)).size > 0) {
    errors.push("Hay accidentes incluidos sin dotación del período.")
  }
  const confirmed = metricSet(confirmedCases, workerAverage, workedHours)
  const provisional = metricSet(provisionalCases, workerAverage, workedHours)
  const status: CanonicalIndicatorStatus = errors.length > 0
    ? "error"
    : workedHours === 0 || !workerAverage
      ? "non_calculable"
      : pendingCases.length > 0 || reconciliationIssues.length > 0
        ? "provisional"
        : "reconciled"
  const threshold = Math.max(1, args.smallGroupThreshold ?? 5)
  const sexCounts = new Map<string, number>()
  for (const item of provisionalCases) {
    const sex = item.sex ?? "unspecified"
    sexCounts.set(sex, (sexCounts.get(sex) ?? 0) + 1)
  }
  const incidentEventIds = new Set<string>()
  const materialDamageIds = new Set<string>()
  const environmentalDamageIds = new Set<string>()
  for (const event of events) {
    if (event.eventType === "dangerous_incident") incidentEventIds.add(event.incidentId)
    else if (event.eventType === "material_damage") materialDamageIds.add(event.incidentId)
    else if (event.eventType === "environmental_spill") environmentalDamageIds.add(event.incidentId)
  }
  const incidentIds = [...new Set(provisionalCases.map((item) => item.incidentId))].sort()
  return {
    formulaVersion: SAFETY_INDICATOR_FORMULA_VERSION,
    year: args.year,
    startMonth: args.startMonth,
    endMonth: args.endMonth,
    status,
    confirmed,
    provisional,
    workerAverage,
    workedHours,
    denominatorSlots: denominators.length,
    expectedDenominatorSlots: expectedSlots,
    pendingCaseCount: pendingCases.length,
    errors,
    reconciliationIssues,
    incidentIds,
    personCaseKeys: provisionalCases.map(caseKey).sort(),
    denominatorIds: denominators.map((item) => item.id).sort(),
    denominatorVersions: [...denominators].sort((a, b) => a.id.localeCompare(b.id)).map((item) => item.version),
    eventCounts: {
      incidents: incidentEventIds.size,
      materialDamage: materialDamageIds.size,
      environmentalDamage: environmentalDamageIds.size,
    },
    sexBreakdown: [...sexCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([sex, value]) => ({
      sex,
      value: value < threshold ? null : value,
      suppressed: value < threshold,
    })),
  }
}
