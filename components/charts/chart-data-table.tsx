import type { ReactNode } from "react"
import { chartRowsValues } from "@/components/charts/chart-cell-text"
import { ChartDataExport } from "@/components/charts/chart-data-export"
import type { ChartExportPermission } from "@/lib/reports/chart-data-export"

/**
 * Descarga de la tabla en Excel. Es **opt-in** y se declara con el permiso de exportar del módulo
 * (`combustibles:export`, `analytics:export`…): quien ve una cifra no recibe por eso la descarga, y
 * la acción lo vuelve a exigir en el servidor. Quien dibuja el gráfico decide con `can(session, …)`
 * si pasar `excel` o no; sin él no hay botón.
 */
export interface ChartDataExcel {
  permission: ChartExportPermission
  /** Salvedades que viajan en la hoja «Metadatos» (p. ej. el aviso de cobertura del gráfico). */
  notes?: readonly string[]
}

/**
 * Alternativa textual de un gráfico: los mismos datos en una tabla que se abre
 * a demanda («Ver datos»). Es la salida para quien no ve el gráfico y para quien
 * quiere el número exacto. Server-safe: un `<details>` nativo, sin JS (el botón
 * de Excel, si lo hay, es el único hijo cliente).
 */
export function ChartDataTable({
  caption,
  headers,
  rows,
  excel,
}: {
  caption: string
  headers: string[]
  /** Cada celda es texto o, cuando la fila lleva a una lista (un proveedor), un enlace. */
  rows: Array<Array<ReactNode>>
  excel?: ChartDataExcel
}) {
  return (
    <details className="mt-3 text-xs">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8">
        Ver datos
      </summary>
      {excel && rows.length > 0 && (
        <div className="mt-1 flex justify-end">
          {/* A Excel va el texto de cada celda (un enlace exporta su texto), las mismas filas que la tabla. */}
          <ChartDataExport title={caption} headers={headers} rows={chartRowsValues(rows)} permission={excel.permission} notes={excel.notes} />
        </div>
      )}
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
