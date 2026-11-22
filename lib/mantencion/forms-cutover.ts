import { addDaysToPlainDate } from "@/lib/utils"

/**
 * Corte de los formularios de Google (decisión del usuario, 2026-11-22): la plataforma reemplaza a los
 * Forms desde el **01-12-2026**, el día de la auditoría Trinorma.
 *
 * - Antes del corte, los trabajos que no pasaron por una OT se cuentan desde el historial de formularios
 *   (`mant_historical_records`).
 * - Desde el corte, se cuentan desde los registros firmados en la plataforma (`mant_records` sin OT).
 * - Las OT de la plataforma cuentan siempre: nunca estuvieron en los Forms.
 *
 * Así el Panel no cuenta dos veces un trabajo que se cargó en el formulario y en la app durante la
 * transición, sin tener que cruzar fila por fila. Una respuesta de Forms posterior al corte se guarda en el
 * historial (es evidencia), pero no entra en las cifras.
 *
 * Es una constante a propósito: moverla cambia cifras ya informadas, así que pasa por un commit y no por
 * un parámetro editable.
 */
export const FORMS_CUTOVER_DATE = "2026-12-01"

/** Último día en que el historial de formularios cuenta en las cifras (`YYYY-MM-DD`). */
export const FORMS_LAST_COUNTED_DATE = addDaysToPlainDate(FORMS_CUTOVER_DATE, -1)

/** El trabajo de esa fecha (`YYYY-MM-DD`) se cuenta desde el historial de formularios. */
export function countsFromForms(date: string): boolean {
  return date < FORMS_CUTOVER_DATE
}

/** El trabajo de esa fecha (`YYYY-MM-DD`) se cuenta desde los registros de la plataforma. */
export function countsFromPlatform(date: string): boolean {
  return date >= FORMS_CUTOVER_DATE
}
