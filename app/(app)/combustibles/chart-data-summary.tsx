import { cn, formatCLP, formatQty } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export interface FuelChartDataPoint {
  group: string | null
  totalLiters: number
  totalAmount: number
  count?: number
}

interface ChartDataSummaryProps {
  title: string
  data: FuelChartDataPoint[]
  periodLabel: string
  groupLabel: string
  visibleLimit?: number
  className?: string
}

const groupName = (group: string | null) => group ?? "Sin asignar"

/**
 * Alternative textual reading for a fuel chart. `visibleLimit` must match the
 * chart's own limit so the table describes exactly the bars being shown.
 */
export function ChartDataSummary({
  title,
  data,
  periodLabel,
  groupLabel,
  visibleLimit,
  className,
}: ChartDataSummaryProps) {
  const visibleData = visibleLimit == null ? data : data.slice(0, visibleLimit)
  const hasLoadCount = visibleData.some((point) => point.count != null)
  const totalAmount = visibleData.reduce((sum, point) => sum + point.totalAmount, 0)
  const totalLiters = visibleData.reduce((sum, point) => sum + point.totalLiters, 0)
  const leading = visibleData.reduce<FuelChartDataPoint | undefined>(
    (current, point) => !current || point.totalAmount > current.totalAmount ? point : current,
    undefined,
  )

  const conclusion = visibleData.length === 0
    ? `No hay datos de ${groupLabel.toLowerCase()} para los filtros aplicados.`
    : visibleData.length === 1
      ? `Hay un único dato: ${groupName(visibleData[0]?.group ?? null)} registra ${formatCLP(totalAmount)} y ${formatQty(totalLiters, "L")}.`
      : `${groupName(leading?.group ?? null)} concentra el mayor gasto: ${formatCLP(leading?.totalAmount ?? 0)} y ${formatQty(leading?.totalLiters ?? 0, "L")}.`

  const tableDescription = visibleLimit != null && data.length > visibleData.length
    ? `Tabla equivalente: ${visibleData.length} ${groupLabel.toLowerCase()} visibles de ${data.length}.`
    : `Tabla equivalente: ${visibleData.length} ${groupLabel.toLowerCase()}.`

  return (
    <section className={cn("mt-4 border-t border-[var(--color-border)] pt-3", className)} aria-label={`Resumen de ${title}`}>
      <p className="text-sm text-[var(--color-text)]">
        <span className="font-semibold">Lectura rápida. </span>
        {conclusion}
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Período: {periodLabel}. Valores en pesos chilenos y litros.
      </p>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-[var(--color-primary)] underline-offset-4 hover:underline">
          {tableDescription}
        </summary>
        <div className="mt-3 overflow-x-auto">
          <Table className="min-w-[420px]">
            <TableHeader>
              <TableRow>
                <TableHead>{groupLabel}</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Litros</TableHead>
                {hasLoadCount ? <TableHead className="text-right">Cargas</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={hasLoadCount ? 4 : 3} className="py-4 text-center text-sm text-[var(--color-text-muted)]">
                    Sin datos para los filtros aplicados.
                  </TableCell>
                </TableRow>
              ) : visibleData.map((point, index) => (
                <TableRow key={`${point.group ?? "sin-asignar"}-${index}`}>
                  <TableCell className="font-medium">{groupName(point.group)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCLP(point.totalAmount)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatQty(point.totalLiters, "L")}</TableCell>
                  {hasLoadCount ? <TableCell className="text-right">{point.count ?? "—"}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </section>
  )
}
