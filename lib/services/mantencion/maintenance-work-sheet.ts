import { ACTION_TYPE_LABELS } from "@/lib/mantencion/action-type"
import { formatDate } from "@/lib/utils"
import type { MaintenanceWorkRow } from "./maintenance-work"

/** Hoja «Trabajos» del Excel del Panel. Aparte de la acción: un archivo `"use server"` sólo exporta funciones async. */

const SOURCE_LABEL: Record<MaintenanceWorkRow["source"], string> = { historial: "Historial de formularios", ot: "Orden de trabajo" }

export const WORK_SHEET_HEADERS = [
  "Fecha", "Equipo", "Faena", "Tipo", "Horas hombre", "Días en taller", "Taller externo", "Fuente", "Referencia",
] as const

/** Una fila de la hoja «Trabajos». Los vacíos van vacíos, nunca en cero: «sin dato» no es 0 horas. */
export function workSheetRow(row: MaintenanceWorkRow): Array<string | number | null> {
  return [
    formatDate(row.date),
    row.equipmentLabel,
    row.worksiteName ?? "Sin faena",
    ACTION_TYPE_LABELS[row.actionType],
    row.laborHours,
    row.workshopDays === null ? null : row.inWorkshop ? `${row.workshopDays} (en taller)` : row.workshopDays,
    row.external === null ? "No informado" : row.external ? "Sí" : "No",
    SOURCE_LABEL[row.source],
    row.reference || null,
  ]
}

