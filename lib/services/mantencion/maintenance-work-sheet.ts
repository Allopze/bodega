import { ACTION_TYPE_LABELS } from "@/lib/mantencion/action-type"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import type { MaintenanceWorkRow } from "./maintenance-work"

/** Hoja «Trabajos» del Excel del Panel. Aparte de la acción: un archivo `"use server"` sólo exporta funciones async. */

/** Cómo se rotula en un libro la fuente de un trabajo (el Panel `Hoy` y las pestañas Looker usan el mismo texto). */
export const WORK_SOURCE_LABEL: Record<MaintenanceWorkRow["source"], string> = {
  historial: "Historial de formularios",
  ot: "Orden de trabajo",
  registro: "Registro de la plataforma",
}

export const WORK_SHEET_HEADERS = [
  "Fecha", "Equipo", "Faena", "Tipo", "Horas hombre", "Días en taller", "En taller", "Taller externo", "Fuente", "Referencia",
] as const

/** Formato de Excel por columna (índice desde 0): la fecha es una celda de fecha real, ordenable y filtrable. */
export const WORK_SHEET_COLUMN_FORMATS: Record<number, string> = { 0: EXCEL_DATE_FORMAT }

/**
 * Una fila de la hoja «Trabajos». Los vacíos van vacíos, nunca en cero: «sin dato» no es 0 horas. La fecha es un
 * `Date` de Excel, y las horas y los días, números; «En taller» (Sí/No) va en su propia columna.
 */
export function workSheetRow(row: MaintenanceWorkRow): Array<string | number | Date | null> {
  return [
    excelPlainDate(row.date),
    row.equipmentLabel,
    row.worksiteName ?? "Sin faena",
    ACTION_TYPE_LABELS[row.actionType],
    row.laborHours,
    row.workshopDays,
    row.inWorkshop ? "Sí" : "No",
    row.external === null ? "No informado" : row.external ? "Sí" : "No",
    WORK_SOURCE_LABEL[row.source],
    row.reference || null,
  ]
}
