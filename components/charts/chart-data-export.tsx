"use client"

import { exportChartDataAction } from "@/app/(app)/chart-data-export-action"
import { ExportButton } from "@/components/ui/export-button"
import type { ChartCellValue } from "@/components/charts/chart-cell-text"
import type { ChartExportPermission } from "@/lib/reports/chart-data-export"

/**
 * «Exportar Excel» de la tabla «Ver datos» de un gráfico. Es `ExportButton` —la misma descarga, el
 * mismo aviso y el mismo estado de carga que el resto de la plataforma— con una acción que recibe la
 * tabla que la pantalla ya muestra (`exportChartDataAction`) en vez de recalcular una consulta.
 *
 * Lo dibuja `ChartDataTable` sólo cuando el gráfico declara el permiso de exportar de su módulo
 * (`excel.permission`): quien ve una cifra no recibe por eso la descarga.
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
  return (
    <ExportButton
      action={exportChartDataAction}
      filters={{ permission, title, headers, rows, ...(notes && notes.length > 0 ? { notes: [...notes] } : {}) }}
      label="Exportar Excel"
      ariaLabel={`Exportar Excel: ${title}`}
      variant="ghost"
      size="sm"
    />
  )
}
