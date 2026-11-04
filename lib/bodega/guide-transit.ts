/**
 * Tiempo en tránsito de las guías de despacho (CHART-037 de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`): qué destino tarda en confirmar la
 * recepción y cuánto llevan esperando las guías despachadas sin confirmar.
 *
 * Módulo **puro**: lo leen la consulta (`lib/services/dispatch-guide-transit.ts`),
 * la página, el gráfico (cliente) y las pruebas.
 *
 * Reglas que no son obvias:
 *
 * - **Qué se mide.** Días entre `dispatched_at` y `received_at` de las guías
 *   `received` (confirmadas por completo). Una guía `partially_received` fija
 *   `received_at` en el instante de cada cotejo con diferencias, no cuando llegó
 *   todo, así que su fecha no mide lo mismo: se cuenta aparte («con
 *   diferencias») y se dice que no entra, en vez de mezclarla en silencio.
 * - **Una cifra lleva su n y con pocas guías no hay cifra.** Con menos de
 *   `GUIDE_MIN_N` guías confirmadas en un destino no se publica ni mediana ni P90;
 *   el P90 pide `GUIDE_MIN_N_P90`: con menos guías es, en la práctica, el máximo.
 * - **La antigüedad de lo pendiente** usa la misma escala que la cola de
 *   aprobaciones (0–1, 2–3, 4–7, más de 7 días) a propósito: «más de 7 días»
 *   significa lo mismo en toda la plataforma.
 */
import {
  APPROVAL_AGE_BUCKETS,
  approvalAgeBucketLabel,
  bucketApprovalAges,
  parseApprovalAgeParam,
  type ApprovalAgeCounts,
  type ApprovalAgeFilter,
  type ApprovalAgeKey,
} from "@/lib/approvals-age"
import { formatDate } from "@/lib/utils"

/** Guías confirmadas mínimas por destino para publicar una mediana. */
export const GUIDE_MIN_N = 5
/** Guías confirmadas mínimas por destino para publicar un P90. */
export const GUIDE_MIN_N_P90 = 10

/** Una fila del agregado: las guías de un destino. Las medianas vienen de la base, sobre guías `received`. */
export interface GuideTransitRow {
  worksiteId: string
  worksiteName: string
  /** Guías confirmadas por completo (`received`): las medidas. */
  confirmed: number
  /** Mediana de días entre despacho y confirmación; `null` sin guías medidas. */
  median: number | null
  p90: number | null
  /** Guías confirmadas con diferencias (`partially_received`): no entran a la medición. */
  withDifferences: number
}

/**
 * `measured` mediana y P90 · `median_only` sólo la mediana (n entre 5 y 9) ·
 * `insufficient` ninguna de las dos.
 */
export type GuideTransitState = "measured" | "median_only" | "insufficient"

export interface GuideTransitDestination {
  worksiteId: string
  worksiteName: string
  confirmed: number
  withDifferences: number
  state: GuideTransitState
  median: number | null
  p90: number | null
}

export interface GuideTransitShape {
  /** Primero lo medible, de más lento a más rápido; al final lo que no tiene cifra. */
  destinations: GuideTransitDestination[]
  /** Los que tienen mediana (`measured` y `median_only`), de más lento a más rápido. */
  measured: GuideTransitDestination[]
  insufficient: GuideTransitDestination[]
  confirmed: number
  withDifferences: number
}

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0

export function shapeGuideTransit(rows: readonly GuideTransitRow[]): GuideTransitShape {
  const destinations = rows.map<GuideTransitDestination>((row) => {
    const confirmed = Math.max(0, Math.floor(Number.isFinite(row.confirmed) ? row.confirmed : 0))
    const hasMedian = confirmed >= GUIDE_MIN_N && finite(row.median)
    const hasP90 = confirmed >= GUIDE_MIN_N_P90 && finite(row.p90)
    return {
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      confirmed,
      withDifferences: Math.max(0, Math.floor(row.withDifferences)),
      state: hasMedian ? (hasP90 ? "measured" : "median_only") : "insufficient",
      median: hasMedian ? row.median : null,
      p90: hasMedian && hasP90 ? row.p90 : null,
    }
  })
  const slowestFirst = (a: GuideTransitDestination, b: GuideTransitDestination) =>
    (b.median ?? 0) - (a.median ?? 0) || a.worksiteName.localeCompare(b.worksiteName, "es")
  const measured = destinations.filter((destination) => destination.median !== null).sort(slowestFirst)
  const insufficient = destinations
    .filter((destination) => destination.median === null)
    .sort((a, b) => b.confirmed - a.confirmed || a.worksiteName.localeCompare(b.worksiteName, "es"))
  return {
    destinations: [...measured, ...insufficient],
    measured,
    insufficient,
    confirmed: destinations.reduce((sum, destination) => sum + destination.confirmed, 0),
    withDifferences: destinations.reduce((sum, destination) => sum + destination.withDifferences, 0),
  }
}

const DAYS_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 })

/** «1 día», «1,5 días», «12 días» o, bajo un día, «menos de 1 día»: nunca «0 d». */
export function formatTransitDays(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "—"
  if (days < 1) return "menos de 1 día"
  const rounded = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10
  return `${DAYS_FORMAT.format(rounded)} ${rounded === 1 ? "día" : "días"}`
}

const guidesOf = (count: number): string => `${count.toLocaleString("es-CL")} ${count === 1 ? "guía" : "guías"}`

/**
 * La respuesta del gráfico: qué destino tarda más, con su n. Verdadera también en
 * los estados parciales: sólo compara destinos que se pueden medir, y los que no
 * se pueden medir se cuentan aparte en vez de esconderse dentro de «los otros».
 * `window` es el período en palabras y encabeza la frase («En los últimos 6 meses»).
 */
export function transitSummary(shape: GuideTransitShape, window: string): string | null {
  if (shape.destinations.length === 0) return null
  const { measured, insufficient } = shape
  const notes = [
    insufficient.length > 0 && measured.length > 0
      ? `${insufficient.length} ${insufficient.length === 1 ? "destino sin guías suficientes para medirlo" : "destinos sin guías suficientes para medirlos"}.`
      : null,
    shape.withDifferences > 0
      ? shape.withDifferences === 1
        ? "1 guía confirmada con diferencias no entra a la medición."
        : `${shape.withDifferences.toLocaleString("es-CL")} guías confirmadas con diferencias no entran a la medición.`
      : null,
  ].filter((note): note is string => note !== null)
  const tail = notes.length > 0 ? ` ${notes.join(" ")}` : ""

  if (measured.length === 0) {
    return `Todavía no hay guías confirmadas suficientes para comparar destinos (${guidesOf(shape.confirmed)} en ${shape.destinations.length} ${shape.destinations.length === 1 ? "destino" : "destinos"}, se necesitan ${GUIDE_MIN_N} por destino).${tail}`
  }
  const [first, second] = measured as [GuideTransitDestination, ...GuideTransitDestination[]]
  if (!second) {
    return `${window}, ${first.worksiteName} confirma en una mediana de ${formatTransitDays(first.median!)} (${guidesOf(first.confirmed)}).${tail}`
  }
  const tied = measured.filter((destination) => formatTransitDays(destination.median!) === formatTransitDays(first.median!))
  if (tied.length > 1) {
    const names = tied.length === 2 ? `${tied[0]!.worksiteName} y ${tied[1]!.worksiteName}` : `${tied.slice(0, -1).map((destination) => destination.worksiteName).join(", ")} y ${tied.at(-1)!.worksiteName}`
    return `${window}, ${names} son los destinos que más tardan en confirmar, con una mediana de ${formatTransitDays(first.median!)}.${tail}`
  }
  const others = measured.slice(1)
  const fastest = Math.max(...others.map((destination) => destination.median!))
  return `${window}, ${first.worksiteName} es el destino que más tarda en confirmar: mediana de ${formatTransitDays(first.median!)} entre ${guidesOf(first.confirmed)}. ${others.length === 1 ? "El otro destino confirma" : "Los otros destinos confirman"} en una mediana de ${formatTransitDays(fastest)} o menos.${tail}`
}

const INSUFFICIENT = "Datos insuficientes"

/** Alternativa en datos («Ver datos»): con n, y «datos insuficientes» donde la cifra no alcanza. */
export function transitTable(shape: GuideTransitShape): { headers: string[]; rows: Array<Array<string | number>> } {
  return {
    headers: ["Destino", "Guías medidas", "Mediana", "P90", "Con diferencias (no medidas)"],
    rows: shape.destinations.map((destination) => [
      destination.worksiteName,
      destination.confirmed,
      destination.median === null ? INSUFFICIENT : formatTransitDays(destination.median),
      destination.p90 !== null
        ? formatTransitDays(destination.p90)
        : destination.state === "median_only" ? `${INSUFFICIENT} (desde ${GUIDE_MIN_N_P90} guías)` : INSUFFICIENT,
      destination.withDifferences,
    ]),
  }
}

/**
 * Período de la medición en palabras, para encabezar la frase: «En los últimos 6
 * meses» cuando se usa la ventana por defecto y las fechas elegidas cuando las hay.
 */
export function transitWindowText({ from, to, chosen = false, months }: { from: string; to?: string; chosen?: boolean; months: number }): string {
  if (!chosen) return months === 1 ? "En el último mes" : `En los últimos ${months} meses`
  if (from && to) return `Entre el ${formatDate(from)} y el ${formatDate(to)}`
  if (from) return `Desde el ${formatDate(from)}`
  return `Hasta el ${formatDate(to ?? "")}`
}

/** Destino de un destino del ranking: las guías recibidas de esa faena en la misma ventana, que cuentan lo mismo que la fila. */
export function guideDestinationHref(worksiteId: string, from: string, to?: string): string {
  const params = new URLSearchParams({ estado: "received", faena: worksiteId, desde: from })
  if (to) params.set("hasta", to)
  return `/bodega/guias?${params.toString()}`
}

// ── Antigüedad de las guías por confirmar ────────────────────────────────────

export const GUIDE_AGE_BUCKETS = APPROVAL_AGE_BUCKETS
export const GUIDE_AGE_PARAM = "antiguedad"
export type GuideAgeKey = ApprovalAgeKey
export type GuideAgeCounts = ApprovalAgeCounts
export type GuideAgeFilter = ApprovalAgeFilter
export const parseGuideAgeParam = parseApprovalAgeParam
export const guideAgeBucketLabel = approvalAgeBucketLabel

/** Reparte las guías despachadas por días de espera; una sin fecha de salida no se cuenta. */
export function bucketGuideAges(rows: ReadonlyArray<{ ageDays: number | null; guides: number }>): GuideAgeCounts {
  return bucketApprovalAges(rows.map((row) => ({ ageDays: row.ageDays, items: row.guides })))
}

/** La respuesta de la barra: cuántas esperan y cuántas llevan más de una semana. */
export function guideAgeSummary(counts: GuideAgeCounts, active: GuideAgeFilter): string | null {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  if (total === 0) return null
  if (active) return `Filtrando por «${guideAgeBucketLabel(active)}»: ${counts[active].toLocaleString("es-CL")} de ${guidesOf(total)}.`
  const old = counts["mas-de-7"]
  const waiting = total === 1 ? "1 guía despachada espera confirmación" : `${total.toLocaleString("es-CL")} guías despachadas esperan confirmación`
  if (old === 0) return `${waiting}; ninguna lleva más de 7 días.`
  return `${waiting}; ${old.toLocaleString("es-CL")} ${old === 1 ? "lleva" : "llevan"} más de 7 días.`
}

/**
 * Destino de un tramo: las guías despachadas de esa faena en ese tramo. Descarta
 * fechas, búsqueda y página a propósito: la barra cuenta TODAS las despachadas del
 * alcance —la más vieja suele estar fuera de cualquier ventana— y la lista a la
 * que lleva debe contar lo mismo.
 */
export function guideAgeHref(key: GuideAgeFilter, faena: string): string {
  const params = new URLSearchParams({ estado: "dispatched", faena: faena || "todas" })
  if (key) params.set(GUIDE_AGE_PARAM, key)
  return `/bodega/guias?${params.toString()}`
}
