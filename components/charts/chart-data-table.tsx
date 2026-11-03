/**
 * Alternativa textual de un gráfico: los mismos datos en una tabla que se abre
 * a demanda («Ver datos»). Es la salida para quien no ve el gráfico y para quien
 * quiere el número exacto. Server-safe: un `<details>` nativo, sin JS.
 */
export function ChartDataTable({
  caption,
  headers,
  rows,
}: {
  caption: string
  headers: string[]
  rows: Array<Array<string | number>>
}) {
  return (
    <details className="mt-3 text-xs">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8">
        Ver datos
      </summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-left text-[var(--color-text-muted)]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col" className="py-1 pr-3 font-semibold text-[var(--color-text)]">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-[var(--color-border)]">
                {row.map((cell, cellIndex) => (cellIndex === 0
                  ? <th key={cellIndex} scope="row" className="py-1 pr-3 font-normal">{cell}</th>
                  : <td key={cellIndex} className="py-1 pr-3 tabular-nums">{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
