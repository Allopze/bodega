"use client"

import { ExportDialog } from "@/components/export-dialog"

/**
 * «Exportar Excel» de la bandeja con los MISMOS filtros de la URL (`params`: pestaña y filtros ya validados). El descarga es un
 * GET a `/api/mantencion/notas-pedido/export`, que exige `mant:np:export` y vuelve a aplicar el alcance de faena en el
 * servidor: este botón sólo se dibuja para quien tiene el permiso, pero no es lo que lo autoriza.
 */
export function PartsNotesExportButton({ params, tabLabel }: { params: Record<string, string | undefined>; tabLabel: string }) {
  return (
    <ExportDialog
      endpoint="/api/mantencion/notas-pedido/export"
      title="Exportar notas de pedido"
      description={`Descarga las notas de «${tabLabel}» con los filtros que tienes aplicados: una fila por línea, con su compra y la fecha de cada cambio de estado. El historial completo va en otra hoja.`}
      label="Excel"
      showDateRange={false}
      baseParams={params}
    />
  )
}
