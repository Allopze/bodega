import { ChartSection } from "@/components/charts/chart-section"
import { balanceSummary, balanceTable, type BalanceSeries } from "@/lib/bodega/balance-series"
import { StockBalanceChart } from "./stock-balance-chart-lazy"

/**
 * CHART-035b · evolución del saldo sobre el kardex.
 *
 * Aparece sólo con un producto y una faena elegidos: el saldo de «todo» no es un
 * número con sentido. Va **encima** del kardex y no lo reemplaza (un kardex se
 * consulta para encontrar un registro; la curva responde por el patrón). Sin
 * movimientos en la ventana explica el vacío y ofrece ampliarla (A4).
 */
export function StockBalanceSection({
  series,
  productName,
  worksiteName,
  unit,
  truncated,
  empty,
}: {
  series: BalanceSeries | null
  productName: string
  worksiteName: string
  unit: string
  /** Había más movimientos que el tope: la serie conserva los más recientes. */
  truncated: boolean
  /** CTA del estado vacío: ampliar la ventana o quitar las fechas. */
  empty: { label: string; hint: string; ctaLabel: string; ctaHref: string }
}) {
  if (!series) {
    return <ChartSection title="Saldo en el tiempo" empty={empty} />
  }
  const base = balanceSummary(series, { productName, worksiteName, unit })
  const summary = truncated
    ? `${base} Hay más movimientos de los que caben: se muestran los ${series.movements.toLocaleString("es-CL")} más recientes.`
    : base
  const table = balanceTable(series)
  return (
    <ChartSection
      title="Saldo en el tiempo"
      summary={summary}
      data={{ caption: `Saldo de ${productName} en ${worksiteName}`, headers: table.headers, rows: table.rows }}
    >
      <StockBalanceChart series={series} />
    </ChartSection>
  )
}
