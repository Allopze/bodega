import Link from "next/link"
import { ChartSection } from "@/components/charts/chart-section"
import { ShareBar, type ShareSegment } from "@/components/charts/share-bar"
import {
  COVERAGE_BANDS,
  COVERAGE_BAND_ORDER,
  coverageSummary,
  type CoverageBand,
  type CoverageNoun,
  type CoverageSummary,
} from "@/lib/bodega/stock-coverage"

/**
 * CHART-035a · tira de cobertura del stock.
 *
 * Con los mínimos manuales retirados, nada decía qué reponer. La tira reparte las
 * líneas de stock (un producto en una faena) en cuatro respuestas —menos de 7
 * días, 7 a 30, más de 30, y las dos que no dan cifra: sin consumo y datos
 * insuficientes— y **es** el selector del filtro `?cobertura=` de la tabla (A5:
 * no hay además un Select de cobertura). Elegir la banda vigente otra vez lo quita.
 *
 * Cuenta lo mismo que lista la tabla de abajo: las líneas visibles con registro
 * de stock, antes de aplicar su propio filtro, para que la tira siga mostrando el
 * reparto completo mientras una banda está elegida. El gráfico acompaña a la
 * tabla y no la reemplaza: la decisión de reponer sigue siendo sobre una fila.
 */
export function StockCoverageStrip({
  summary,
  noun,
  active,
  hrefFor,
}: {
  summary: CoverageSummary
  noun: CoverageNoun
  /** Banda vigente en la URL; `""` si la tabla no está filtrada por cobertura. */
  active: CoverageBand | ""
  /** Destino de cada banda; `""` quita el filtro. Conserva el resto de los filtros de la URL. */
  hrefFor: (band: CoverageBand | "") => string
}) {
  const text = coverageSummary(summary, noun)
  if (!text) return null

  const segments: ShareSegment[] = COVERAGE_BAND_ORDER.map((band) => ({
    key: band,
    label: COVERAGE_BANDS[band].label,
    count: summary.byBand[band],
    color: COVERAGE_BANDS[band].color,
    active: active === band,
    // Elegir la banda vigente otra vez es la salida: quita el filtro.
    href: hrefFor(active === band ? "" : band),
  }))

  return (
    <ChartSection
      title="Cobertura del stock"
      summary={text}
      aside={
        active ? (
          <Link
            href={hrefFor("")}
            replace
            scroll={false}
            className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8"
          >
            Quitar filtro
          </Link>
        ) : undefined
      }
      data={{
        caption: "Cobertura del stock por banda",
        headers: ["Cobertura", "Qué significa", "Cantidad"],
        rows: COVERAGE_BAND_ORDER.map((band) => [COVERAGE_BANDS[band].label, COVERAGE_BANDS[band].definition, summary.byBand[band]]),
      }}
    >
      <ShareBar label="Cobertura del stock" segments={segments} noun={typeof noun === "string" ? noun : ""} inPlace />
    </ChartSection>
  )
}
