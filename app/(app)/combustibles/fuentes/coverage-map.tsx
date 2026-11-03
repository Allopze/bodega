import { ChartSection } from "@/components/charts/chart-section"
import { ComplianceCalendar, type ComplianceRow } from "@/components/charts/compliance-calendar"
import { coverageColumns, summarizeCoverage } from "@/lib/combustibles/coverage-matrix"
import type { FuelCoverageMatrix } from "@/lib/combustibles/coverage-matrix-data"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/**
 * CHART-022: de un vistazo, qué meses de qué fuente están completos. Antes de
 * creer cualquier gráfico de combustible hay que saber si el mes lo está, y la
 * cobertura sólo se decía en frases dentro de cada fuente.
 *
 * Es el `ComplianceCalendar` de la plataforma con el vocabulario de datos
 * («Completo», «Sin datos», «En curso») en vez del de cumplimiento. El detalle
 * de cada celda (filas y litros, días con datos) va en su texto accesible y en
 * el tooltip; el estado nunca es sólo color.
 *
 * Las celdas no enlazan: la lista de «Archivos importados» filtra por tipo y
 * estado, no por mes, así que no hay un destino por celda que prometer.
 */
const COVERAGE_LABELS = {
  ok: "Completo",
  partial: "Parcial",
  missing: "Sin datos",
  upcoming: "En curso",
  na: "No aplica",
} as const

export function CoverageMap({ matrix }: { matrix: FuelCoverageMatrix }) {
  if (matrix.rows.length === 0) return null
  const rows: ComplianceRow[] = matrix.rows.map((row) => ({
    id: row.id,
    label: <span title={row.label}>{row.label}</span>,
    labelText: row.label,
    cells: row.cells,
  }))
  return (
    <ChartSection
      title="Cobertura de datos por mes"
      headingLevel={2}
      summary={summarizeCoverage(matrix.months, matrix.rows)}
      drillHref={FUEL_PATHS.fuentesArchivos}
      drillLabel="Ver archivos importados"
      className="mb-4"
    >
      <ComplianceCalendar
        caption="Cobertura de datos por fuente en los últimos 12 meses"
        rowHeader="Fuente"
        columns={coverageColumns(matrix.months)}
        rows={rows}
        statusLabels={COVERAGE_LABELS}
      />
    </ChartSection>
  )
}
