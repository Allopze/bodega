import { cn, formatQty } from "@/lib/utils"

/**
 * Barras agrupadas por categoría, como lista: una fila por categoría (una faena) y, dentro de ella, una
 * barra por serie (ítems sin OC, OC por recibir) con su cifra al lado. Para comparar dos conteos **de la
 * misma unidad** en una escala común; si las series son magnitudes de escala distinta, no es este
 * componente (A5b: un eje, una unidad).
 *
 * Es la versión CSS de un gráfico de barras agrupadas: server-safe, sin recharts, y accesible porque cada
 * cifra está escrita en la fila (el color nunca carga solo el significado: la leyenda y la fila nombran la
 * serie). Todas las barras miden contra el mayor valor de todo el gráfico, así que se comparan entre filas.
 */
export interface GroupedBarSeries {
  key: string
  label: string
  /** Relleno de la barra y de su marca en la leyenda: un `var(--color-*)`, nunca un hex. */
  color: string
}

export interface GroupedBarRow {
  key: string
  label: string
  values: Record<string, number>
}

export function GroupedBarList({
  rows,
  series,
  ariaLabel,
  limit = 10,
  className,
}: {
  rows: GroupedBarRow[]
  series: GroupedBarSeries[]
  ariaLabel: string
  /** Filas visibles; el resto se resume en «y N más». */
  limit?: number
  className?: string
}) {
  if (rows.length === 0 || series.length === 0) return null
  const max = Math.max(1, ...rows.flatMap((row) => series.map((entry) => row.values[entry.key] ?? 0)))
  const visible = rows.slice(0, Math.max(1, Math.floor(limit)))
  const hidden = rows.length - visible.length

  return (
    <div className={cn("min-w-0", className)}>
      <ul aria-label="Series" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        {series.map((entry) => (
          <li key={entry.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: entry.color }} />
            {entry.label}
          </li>
        ))}
      </ul>
      <ul aria-label={ariaLabel} className="flex flex-col gap-4">
        {visible.map((row) => (
          <li key={row.key} className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--color-text)]" title={row.label}>{row.label}</p>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {series.map((entry) => {
                const value = row.values[entry.key] ?? 0
                return (
                  <div key={entry.key} data-series={entry.key} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_4rem]">
                    <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      {value > 0 && <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: entry.color }} />}
                    </div>
                    <span className="text-right text-sm tabular-nums text-[var(--color-text)]">
                      {formatQty(value)}
                      <span className="sr-only"> {entry.label}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="mt-3 text-xs text-[var(--color-text-muted)]">y {hidden} más</p>}
    </div>
  )
}
