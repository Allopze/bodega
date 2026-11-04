"use client"

import { useMemo } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { ChartSection } from "@/components/charts/chart-section"
import { ResidualBands, RiskMatrix, type RiskMatrixLinkProps } from "@/components/charts/risk-matrix"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { parseMatrixFilters } from "@/lib/prevention/miper/matrix-filters"
import { buildRiskMatrix, cellParam, riskMatrixSummary, summarizeResidual, type RiskMatrixCell } from "@/lib/prevention/miper/risk-matrix"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { hrefToMatrixOnly, hrefWithoutMatrixFilter } from "@/lib/prevention/miper/workspace-url"
import { WorkspaceLink } from "./workspace-nav"

/** Identidad estable para «sin residual»: un `{}` nuevo en cada render invalidaría el `useMemo`. */
const NO_RESIDUAL: Readonly<Record<string, string>> = {}

/** Una celda filtra la matriz con `replaceState`, como las cifras de Inicio: sin ida al servidor y sin entrada nueva en el historial. */
function CellLink(props: RiskMatrixLinkProps) {
  // Esparce todo (ref, `aria-describedby`, manejadores): el tooltip de la celda cuelga de este enlace.
  return <WorkspaceLink replace {...props} />
}

/**
 * «¿Dónde se concentra el riesgo?» (CHART-007): el mapa de calor
 * probabilidad × consecuencia del riesgo inherente, y a su lado el residual.
 *
 * - **Inherente.** `rows` ya trae `probability` y `consequence` en la foto
 *   (`MiperEntrySnapshot`): viajan al cliente y siguen vivos mientras se edita.
 * - **Residual.** `residual_level` no es P × C sino un nivel de 4 escalones, y
 *   en producción está vacío en todas las filas (2026-11-03). Sin datos no hay
 *   grilla en cero: se explica que el efecto de las medidas aún no se registra
 *   (A4). Con datos, se compara banda por banda con el inherente.
 * - **Clic.** Filtra la matriz por la celda exacta (`?celda=P4xC2`, ver
 *   `matrix-filters.ts`): P4 × C2 y P2 × C4 comparten clasificación (8) pero no
 *   son la misma celda. Elegir otra vez la celda vigente quita el filtro. El
 *   resto de los filtros de la matriz se descarta, como en las cifras de Inicio,
 *   para que lo que se ve al llegar coincida con la cifra de la celda.
 * - **Hover y foco.** Cada celda con riesgos dice sus 3 peligros más frecuentes
 *   (`RiskMatrix`, P-3).
 */
export function RiskConcentration({ rows, residualLevels = NO_RESIDUAL, uncontrolled }: {
  rows: readonly MiperEntrySnapshot[]
  /** `residual_level` por id de fila; vacío si ninguna fila lo tiene. */
  residualLevels?: Readonly<Record<string, string>>
  /** Riesgos marcados «No controlado»: el destino del vacío residual, si hay alguno. */
  uncontrolled: number
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const matrix = useMemo(() => buildRiskMatrix(rows), [rows])
  const residual = useMemo(() => summarizeResidual(rows.map((row) => row.id), residualLevels), [rows, residualLevels])
  const selected = useMemo(() => parseMatrixFilters(params).cell, [params])
  const hrefFor = (cell: RiskMatrixCell) =>
    selected?.probability === cell.probability && selected.consequence === cell.consequence
      ? hrefWithoutMatrixFilter(pathname, params, "celda")
      : hrefToMatrixOnly(pathname, params, { celda: cellParam(cell) })
  return (
    <ChartSection
      title="Dónde se concentra el riesgo"
      summary={riskMatrixSummary(matrix)}
      empty={matrix.evaluated === 0 ? {
        label: "Ningún riesgo está evaluado todavía",
        hint: "Cuando los riesgos tengan probabilidad y consecuencia, aquí verás cuántos hay en cada celda y cuáles son graves.",
        ctaLabel: "Ver riesgos",
        ctaHref: hrefToMatrixOnly(pathname, params),
      } : null}
    >
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Riesgo inherente</h3>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">Antes de las medidas: probabilidad × consecuencia</p>
          <RiskMatrix matrix={matrix} caption="Riesgo inherente: cantidad de riesgos por probabilidad y consecuencia" hrefFor={hrefFor} selected={selected} renderLink={CellLink} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Riesgo residual</h3>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">Con las medidas aplicadas</p>
          {residual.recorded === 0 ? (
            <ChartEmpty
              className="h-auto min-h-48 py-6"
              label="Aún no se registra el efecto de las medidas"
              hint="Ningún riesgo de esta MIPER tiene nivel residual. Cuando lo tenga, aquí verás cuánto baja el riesgo gracias a las medidas."
              ctaLabel={uncontrolled > 0 ? "Ver riesgos no controlados" : undefined}
              ctaHref={uncontrolled > 0 ? hrefToMatrixOnly(pathname, params, { controlado: "no" }) : undefined}
            />
          ) : (
            <ResidualBands caption="Riesgo residual por clasificación, junto al inherente" inherent={matrix.byClassification} residual={residual} />
          )}
        </div>
      </div>
    </ChartSection>
  )
}
