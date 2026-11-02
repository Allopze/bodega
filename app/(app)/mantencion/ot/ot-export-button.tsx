"use client"

import { ExportButton } from "@/components/ui/export-button"
import type { WorkOrderListFilters } from "@/lib/services/mantencion/work-orders/query"
import { exportWorkOrdersAction } from "./actions"

type ExportFilters = Omit<WorkOrderListFilters, "page" | "pageSize">

/** «Exportar Excel» de la lista: manda los mismos filtros (y pestaña) de la URL; el servidor vuelve a validar el alcance. */
export function OtExportButton({ filters }: { filters: ExportFilters }) {
  return <ExportButton action={exportWorkOrdersAction} filters={filters} label="Exportar Excel" />
}
