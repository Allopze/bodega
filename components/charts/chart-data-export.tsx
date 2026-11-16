"use client"

import * as React from "react"
import { exportChartDataAction } from "@/app/(app)/chart-data-export-action"
import { registerBoardTable } from "@/components/charts/board-tables"
import { ExportButton } from "@/components/ui/export-button"
import type { ChartCellValue } from "@/components/charts/chart-cell-text"
import type { ChartExportPermission } from "@/lib/reports/chart-data-export"

/**
 * «Exportar Excel» de la tabla «Ver datos» de un gráfico. Es `ExportButton` —la misma descarga, el
 * mismo aviso y el mismo estado de carga que el resto de la plataforma— con una acción que recibe la
 * tabla que la pantalla ya muestra (`exportChartDataAction`) en vez de recalcular una consulta.
 *
 * Lo dibuja `ChartDataTable` sólo cuando el gráfico declara el permiso de exportar de su módulo
 * (`excel.permission`): quien ve una cifra no recibe por eso la descarga. Mientras está montado, la
 * tabla también queda anotada para el «Exportar Excel» de la cabecera de un tablero
 * (`BoardExportButton`), que la junta con las demás en un solo libro.
 */
export function ChartDataExport({
  title,
  headers,
  rows,
  permission,
  notes,
}: {
  title: string
  headers: string[]
  rows: ChartCellValue[][]
  permission: ChartExportPermission
  notes?: readonly string[]
}) {
  const id = React.useId()
  const anchor = React.useRef<HTMLSpanElement>(null)
  React.useEffect(
    () => registerBoardTable(id, { title, headers, rows, permission, notes, anchor: () => anchor.current }),
    [id, title, headers, rows, permission, notes],
  )

  return (
    <span ref={anchor} className="contents">
      <ExportButton
        action={exportChartDataAction}
        filters={{ permission, title, headers, rows, ...(notes && notes.length > 0 ? { notes: [...notes] } : {}) }}
        label="Exportar Excel"
        ariaLabel={`Exportar Excel: ${title}`}
        variant="ghost"
        size="sm"
      />
    </span>
  )
}
