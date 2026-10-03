/**
 * Portada de la MIPER por faena (spec §7, Fase B): las reglas que no tocan la
 * base. Qué MIPER representa a cada faena, en qué estado está, cómo se lee la
 * URL de la portada (enlaces viejos incluidos) y qué cuenta cada cifra de la
 * franja. El servicio (`lib/services/miper/portfolio.ts`) arma las filas y la
 * portada (`app/(app)/prevencion/miper/miper-home.tsx`) las filtra con esto.
 */
import type { ProgramProgress } from "./progress"

export const PORTFOLIO_PATH = "/prevencion/miper"

export const PORTFOLIO_STATUSES = ["sin_miper", "borrador", "en_revision", "observada", "vigente"] as const
export type MiperPortfolioStatus = typeof PORTFOLIO_STATUSES[number]

export const PORTFOLIO_STATUS_LABEL: Record<MiperPortfolioStatus, string> = {
  sin_miper: "Sin MIPER",
  borrador: "Borrador",
  en_revision: "En revisión",
  observada: "Con observaciones",
  vigente: "Vigente",
}

/** El filtro de estado suma «Con MIPER» (todas menos «Sin MIPER»): es el destino de la cifra «Faenas con MIPER». */
export type PortfolioStatusFilter = MiperPortfolioStatus | "con_miper"
export const PORTFOLIO_STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: PortfolioStatusFilter; label: string }> = [
  { value: "con_miper", label: "Con MIPER" },
  ...PORTFOLIO_STATUSES.map((value) => ({ value, label: PORTFOLIO_STATUS_LABEL[value] })),
]

export type MiperPortfolioMatrix = { id: string; period: number | null; versionNumber: number | null; label: string; isLegacy: boolean }
export type MiperPortfolioAction = { matrixId: string; period: number | null; reason: string }

export type MiperPortfolioRow = {
  /** = `worksiteId`: `DataTable` usa `row.id` como clave de fila. */
  id: string
  worksiteId: string
  worksiteName: string
  worksiteActive: boolean
  /** La MIPER no reemplazada de mayor período; `null` = la faena no tiene MIPER. */
  matrix: MiperPortfolioMatrix | null
  /** La vigente, sólo cuando NO es `matrix` («Vigente vN (AAAA)»). */
  vigente: MiperPortfolioMatrix | null
  status: MiperPortfolioStatus
  /** `miperStatusLabel` de `matrix`, o «Sin MIPER». */
  stateLabel: string
  /** La dotación de la ficha de `matrix` o, sin ella, los trabajadores activos de la faena. */
  headcount: number
  headcountSource: "ficha" | "trabajadores"
  updatedAt: string | null
  /** Riesgos sin errores ÷ riesgos (la regla de «Completos x de y»). `null`: sin MIPER o metodología anterior. */
  completeness: { complete: number; total: number } | null
  importantCount: number
  intolerableCount: number
  /** De la vigente: Intolerables (o críticos legacy) sin control (`critical-control.ts`). */
  criticalWithoutControl: number
  requiresMyAction: boolean
  /** Lo que espera de ti CADA MIPER no reemplazada de la faena, no sólo la de la fila. */
  myActions: MiperPortfolioAction[]
  /** Quién envió la ronda abierta de `matrix`. */
  submittedByName: string | null
  /** Del programa de la vigente (o de `matrix` si no hay vigente). `null`: sin MIPER. */
  programProgress: ProgramProgress | null
}

/** Una opción del selector «Cambiar de faena» del espacio de trabajo. */
export type MiperWorksiteTarget = { worksiteId: string; worksiteName: string; matrixId: string | null; period: number | null }

export type PortfolioCandidate = { id: string; worksiteId: string; period: number | null; status: string; updatedAt: string }
export type PortfolioPick<T extends PortfolioCandidate> = { primary: T; published: T | null; all: T[] }

/**
 * Por faena: la MIPER no reemplazada de mayor período (sin período al final;
 * con empate, la modificada más reciente) y, aparte, la vigente (`published`;
 * el índice único de la base admite una por faena). Las reemplazadas no
 * cuentan: una faena que sólo tiene reemplazadas no tiene MIPER.
 */
export function pickCurrentMatrices<T extends PortfolioCandidate>(rows: readonly T[]): Map<string, PortfolioPick<T>> {
  const byWorksite = new Map<string, T[]>()
  for (const row of rows) {
    if (row.status === "superseded") continue
    const list = byWorksite.get(row.worksiteId)
    if (list) list.push(row)
    else byWorksite.set(row.worksiteId, [row])
  }
  const picks = new Map<string, PortfolioPick<T>>()
  for (const [worksiteId, list] of byWorksite) {
    const all = [...list].sort((a, b) =>
      (b.period ?? Number.NEGATIVE_INFINITY) - (a.period ?? Number.NEGATIVE_INFINITY)
      || b.updatedAt.localeCompare(a.updatedAt)
      || a.id.localeCompare(b.id))
    picks.set(worksiteId, { primary: all[0]!, published: list.find((row) => row.status === "published") ?? null, all })
  }
  return picks
}

/** En qué orden se ofrecen las acciones de una faena: la MIPER de la fila, la vigente y el resto, sin repetir. */
export function portfolioActionOrder<T extends PortfolioCandidate>(pick: PortfolioPick<T>): T[] {
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const row of [pick.primary, pick.published, ...pick.all]) {
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)
    ordered.push(row)
  }
  return ordered
}

export function portfolioStatusOf(matrix: { status: string; reviewState: string } | null): MiperPortfolioStatus {
  if (!matrix) return "sin_miper"
  if (matrix.reviewState === "in_review" || matrix.reviewState === "pending_approval") return "en_revision"
  if (matrix.reviewState === "observed") return "observada"
  return matrix.status === "published" ? "vigente" : "borrador"
}

export type PortfolioView = "todas" | "mias"
export type PortfolioParams = { vista: PortfolioView; estado: PortfolioStatusFilter | null; sinControl: boolean; faena: string | null }

const STATUS_FILTERS: ReadonlySet<string> = new Set(PORTFOLIO_STATUS_FILTER_OPTIONS.map((option) => option.value))

/**
 * Lee la URL de la portada. Enlaces viejos: `?tab=porhacer` (la bandeja de
 * antes) es `vista=mias`; `?tab=todas` y `?tab=resumen` caen en la vista por
 * defecto. `?faena=` (enlace del PDTP) sigue acotando a una faena.
 */
export function parsePortfolioParams(params: { get(key: string): string | null }): PortfolioParams {
  const vista = params.get("vista")
  const estado = params.get("estado")
  return {
    vista: vista === "mias" || (vista === null && params.get("tab") === "porhacer") ? "mias" : "todas",
    estado: estado && STATUS_FILTERS.has(estado) ? (estado as PortfolioStatusFilter) : null,
    sinControl: params.get("sincontrol") === "1",
    faena: params.get("faena") || null,
  }
}

export function hasPortfolioFilters(params: PortfolioParams): boolean {
  return params.vista === "mias" || params.estado !== null || params.sinControl || params.faena !== null
}

/**
 * La URL de la portada con `patch` aplicado (`null` o `""` quitan la clave).
 * Borra SIEMPRE el `tab` heredado: si no, un `?tab=porhacer` viejo volvería a
 * forzar «mías» después de elegir «Todas las faenas».
 */
export function portfolioHref(current: { toString(): string }, patch: Record<string, string | null>, pathname: string = PORTFOLIO_PATH): string {
  const next = new URLSearchParams(current.toString())
  next.delete("tab")
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") next.delete(key)
    else next.set(key, value)
  }
  const query = next.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function filterPortfolioRows(rows: readonly MiperPortfolioRow[], params: PortfolioParams): MiperPortfolioRow[] {
  return rows.filter((row) => {
    if (params.vista === "mias" && !row.requiresMyAction) return false
    if (params.estado === "con_miper" && row.matrix === null) return false
    if (params.estado !== null && params.estado !== "con_miper" && row.status !== params.estado) return false
    if (params.sinControl && row.criticalWithoutControl === 0) return false
    if (params.faena !== null && row.worksiteId !== params.faena) return false
    return true
  })
}

export type PortfolioSummary = { total: number; withMiper: number; inReview: number; mine: number; critical: number }

/** Las cuatro cifras de la franja, sobre TODAS las faenas del alcance (los filtros no las cambian). */
export function portfolioSummary(rows: readonly MiperPortfolioRow[]): PortfolioSummary {
  return {
    total: rows.length,
    withMiper: rows.filter((row) => row.matrix !== null).length,
    inReview: rows.filter((row) => row.status === "en_revision").length,
    mine: rows.filter((row) => row.requiresMyAction).length,
    critical: rows.reduce((total, row) => total + row.criticalWithoutControl, 0),
  }
}

/**
 * Destino de cada cifra (A1): su subconjunto y SÓLO él. Las URLs no arrastran
 * otros filtros. `critical` es también el destino del KPI del tablero
 * (`prevention-section.tsx`).
 */
export const PORTFOLIO_SUMMARY_HREF = {
  withMiper: `${PORTFOLIO_PATH}?estado=con_miper`,
  inReview: `${PORTFOLIO_PATH}?estado=en_revision`,
  mine: `${PORTFOLIO_PATH}?vista=mias`,
  critical: `${PORTFOLIO_PATH}?sincontrol=1`,
} as const
