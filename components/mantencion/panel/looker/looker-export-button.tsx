"use client"

import { exportLookerPanelAction, type LookerExportActionInput } from "@/app/(app)/mantencion/panel/looker-export-action"
import { ExportButton } from "@/components/ui/export-button"
import { EXPORT_TAB_SHORT, type ExportTab } from "@/lib/services/mantencion/looker/export-filters"

/**
 * «Exportar Excel» de Planificación, «Por kilómetros» y «Por horas». Lleva a la acción de servidor la pestaña y los parámetros
 * de la URL (período, filtros manuales y cruzados): el servidor vuelve a consultar con el alcance de quien exporta y
 * arma el libro; del navegador no viaja ninguna fila. Es una acción de página: va en `PageHeader.actions`, y sólo se
 * ofrece a quien tiene `mant:export` (la acción lo vuelve a exigir).
 */
export function LookerExcelButton({ tab, params }: { tab: ExportTab; params: LookerExportActionInput["params"] }) {
  return (
    <ExportButton
      action={exportLookerPanelAction}
      filters={{ tab, params }}
      ariaLabel={`Exportar Excel: Panel de mantención, pestaña ${EXPORT_TAB_SHORT[tab]}, con los filtros elegidos`}
    />
  )
}
