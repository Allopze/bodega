/**
 * Plazos del ciclo de abastecimiento (CHART-029), sin acceso a datos.
 *
 * Esta parte es **pura**: recibe, por cada ítem de solicitud ya cerrado, el día en que ocurrió cada
 * hito, y devuelve medianas, P90 y el tamaño de muestra (`n`) por tramo y por faena. La consulta que
 * saca los hitos de la base vive en `lead-time.ts`; el gráfico (`components/charts/stage-duration-bar`)
 * sólo dibuja lo que sale de acá.
 *
 * Tres decisiones que importan para no mentir con un número:
 *
 * 1. **Sólo cuentan los ítems cerrados** (llegaron completos a faena o se entregaron). Un ítem que
 *    sigue esperando no tiene plazo todavía: promediar sólo a los que terminaron subestima la espera
 *    real (sesgo de supervivencia). El gráfico lo declara y remite a la antigüedad de los abiertos.
 * 2. **Nunca un número pelado.** Cada cifra lleva su `n`. Con menos de `LEAD_TIME_MIN_SAMPLE`
 *    observaciones no se publica mediana (`insufficient`), y el P90 exige `LEAD_TIME_P90_MIN_SAMPLE`:
 *    con 5 datos el P90 es el máximo, no un percentil.
 * 3. **Fechas fuera de orden no se corrigen**: una OC emitida antes de aprobar el ítem daría un tramo
 *    negativo. Esa observación se excluye de ese tramo y se cuenta aparte (`outOfOrder`).
 */

/** Observaciones mínimas para publicar una mediana. */
export const LEAD_TIME_MIN_SAMPLE = 5
/** Observaciones mínimas para publicar un P90. */
export const LEAD_TIME_P90_MIN_SAMPLE = 10

export type LeadTimeMilestone = "submittedDay" | "approvedDay" | "issuedDay" | "arrivedDay" | "deliveredDay"

export const LEAD_TIME_STAGES = [
  { key: "approval", label: "Aprobación", from: "submittedDay", to: "approvedDay" },
  { key: "purchase", label: "Emisión de OC", from: "approvedDay", to: "issuedDay" },
  { key: "arrival", label: "Llegada", from: "issuedDay", to: "arrivedDay" },
  { key: "delivery", label: "Entrega", from: "arrivedDay", to: "deliveredDay" },
] as const satisfies ReadonlyArray<{ key: string; label: string; from: LeadTimeMilestone; to: LeadTimeMilestone }>

export type LeadTimeStageKey = (typeof LEAD_TIME_STAGES)[number]["key"]

/**
 * Un ítem cerrado con sus hitos. Los días son **días civiles de Chile** contados desde 1970-01-01
 * (la diferencia entre dos es exactamente "días corridos"), o `null` si el hito no ocurrió.
 */
export interface LeadTimeItem {
  worksiteId: string
  worksiteName: string
  requestType: string
  submittedDay: number | null
  approvedDay: number | null
  issuedDay: number | null
  arrivedDay: number | null
  deliveredDay: number | null
  /** Último movimiento del ítem (última recepción o entrega): ubica el cierre en el tiempo. */
  closedDay: number | null
}

export interface DurationStat {
  /** Observaciones que entraron al cálculo. Se muestra siempre junto a la cifra. */
  n: number
  /** Mediana en días corridos; `null` si `insufficient`. */
  median: number | null
  /** Percentil 90; `null` con menos de `LEAD_TIME_P90_MIN_SAMPLE` observaciones. */
  p90: number | null
  /** Menos de `LEAD_TIME_MIN_SAMPLE` observaciones: no hay cifra que mostrar. */
  insufficient: boolean
}

export interface LeadTimeStageStat extends DurationStat {
  key: LeadTimeStageKey
  label: string
}

export interface LeadTimeGroup {
  key: string
  label: string
  /** Ítems cerrados en el período que entraron a este grupo. */
  closedItems: number
  stages: LeadTimeStageStat[]
  /** Solicitud → cierre. No es la suma de las medianas de los tramos. */
  total: DurationStat
}

export interface SupplyLeadTime {
  overall: LeadTimeGroup
  byWorksite: LeadTimeGroup[]
  /** Total del período de comparación (mismo largo, inmediatamente anterior). */
  previousTotal: DurationStat
  /** Observaciones con fechas fuera de orden, excluidas. */
  outOfOrder: number
}

/** Percentil con interpolación lineal (el `percentile_cont` de Postgres). `sorted` ya viene ordenado. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!
  const rank = p * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  const fraction = rank - lower
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction
}

/** Redondeo a 2 decimales, sin el ruido de coma flotante (9.100000000000001). */
const round2 = (value: number) => Math.round(value * 100) / 100

export function summarizeDurations(values: readonly number[]): DurationStat {
  const n = values.length
  if (n < LEAD_TIME_MIN_SAMPLE) return { n, median: null, p90: null, insufficient: true }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n,
    median: round2(percentile(sorted, 0.5)),
    p90: n >= LEAD_TIME_P90_MIN_SAMPLE ? round2(percentile(sorted, 0.9)) : null,
    insufficient: false,
  }
}

export interface LeadTimeWindows {
  /** `[desde, hasta]` en días desde 1970, inclusivo. */
  current: readonly [number, number]
  previous: readonly [number, number]
}

const inWindow = (day: number | null, [from, to]: readonly [number, number]) => day !== null && day >= from && day <= to

interface Samples {
  stages: Record<LeadTimeStageKey, number[]>
  total: number[]
  items: number
}

const emptySamples = (): Samples => ({
  stages: { approval: [], purchase: [], arrival: [], delivery: [] },
  total: [],
  items: 0,
})

function toGroup(key: string, label: string, samples: Samples): LeadTimeGroup {
  return {
    key,
    label,
    closedItems: samples.items,
    stages: LEAD_TIME_STAGES.map((stage) => ({ key: stage.key, label: stage.label, ...summarizeDurations(samples.stages[stage.key]) })),
    total: summarizeDurations(samples.total),
  }
}

export function buildSupplyLeadTime(items: readonly LeadTimeItem[], windows: LeadTimeWindows): SupplyLeadTime {
  const overall = emptySamples()
  const byWorksite = new Map<string, { label: string; samples: Samples }>()
  const previousTotal: number[] = []
  let outOfOrder = 0

  /** Acumula la duración `to − from`; si el orden es imposible, la cuenta aparte en vez de corregirla. */
  const duration = (from: number | null, to: number | null): number | null => {
    if (from === null || to === null) return null
    if (to < from) {
      outOfOrder += 1
      return null
    }
    return to - from
  }

  for (const item of items) {
    if (inWindow(item.closedDay, windows.previous)) {
      const total = duration(item.submittedDay, item.closedDay)
      if (total !== null) previousTotal.push(total)
      continue
    }
    if (!inWindow(item.closedDay, windows.current)) continue

    const group = byWorksite.get(item.worksiteId) ?? { label: item.worksiteName, samples: emptySamples() }
    byWorksite.set(item.worksiteId, group)
    for (const samples of [overall, group.samples]) samples.items += 1

    // Una sola evaluación por tramo y por ítem: si no, una fecha desordenada se contaría dos veces.
    const stageDurations = LEAD_TIME_STAGES.map((stage) => [stage.key, duration(item[stage.from], item[stage.to])] as const)
    const total = duration(item.submittedDay, item.closedDay)
    for (const samples of [overall, group.samples]) {
      for (const [key, days] of stageDurations) if (days !== null) samples.stages[key].push(days)
      if (total !== null) samples.total.push(total)
    }
  }

  return {
    // «Total» y no «Todas las faenas»: un usuario con faenas acotadas ve el total de las suyas.
    overall: toGroup("all", "Total", overall),
    byWorksite: [...byWorksite.entries()]
      .map(([id, group]) => toGroup(id, group.label, group.samples))
      .sort((a, b) => b.closedItems - a.closedItems || a.label.localeCompare(b.label, "es")),
    previousTotal: summarizeDurations(previousTotal),
    outOfOrder,
  }
}

/**
 * La frase que responde el gráfico, armada de los mismos números que se dibujan.
 *
 * Con muestra insuficiente no hay cifra: dice cuántos ítems hay y cuántos hacen falta. El «tramo más
 * lento» sólo compite entre tramos con muestra suficiente.
 */
export function leadTimeStageHeadline(report: SupplyLeadTime, formatDays: (value: number) => string): string {
  const { overall } = report
  if (overall.closedItems === 0) return "Ningún ítem se cerró en el período."
  const { total } = overall
  const noun = total.n === 1 ? "ítem cerrado" : "ítems cerrados"
  if (total.median === null) {
    // Un ítem sin fecha de envío no tiene plazo total: si hay diferencia, se nombra.
    const scope = total.n === overall.closedItems ? "en el período" : "con todas sus fechas en el período"
    return `Datos insuficientes: hay ${total.n} ${noun} ${scope} y se necesitan al menos ${LEAD_TIME_MIN_SAMPLE} para publicar una mediana.`
  }
  const slowest = overall.stages
    .filter((stage) => stage.median !== null)
    .reduce<LeadTimeStageStat | null>((top, stage) => (top === null || (stage.median ?? 0) > (top.median ?? 0) ? stage : top), null)
  const head = `La mitad de los ${total.n} ${noun} tardó ${formatDays(total.median)} o menos de la solicitud al cierre`
  return slowest?.median != null ? `${head}; el tramo más lento fue ${slowest.label} (${formatDays(slowest.median)}).` : `${head}.`
}
