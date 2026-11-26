import type { MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"

/**
 * Textos de la lista y de la vista previa del Historial de mantenciones. Un módulo sin `"use client"`: la tabla (servidor)
 * y la vista previa (cliente) los usan por igual, y una función exportada desde un módulo de cliente no se puede llamar
 * desde el servidor.
 */

const DASH = "—"

/** «3 días en taller», «3 días · sigue en taller» o «—» cuando el trabajo no lo informa. */
export function workshopText(row: Pick<MaintenanceHistoryRow, "workshopDays" | "inWorkshop">): string {
  if (row.workshopDays === null) return row.inWorkshop ? "En taller" : DASH
  const days = `${row.workshopDays} ${row.workshopDays === 1 ? "día" : "días"}`
  return row.inWorkshop ? `${days} · sigue en taller` : days
}

/** «Interno», «Externo» o «Externo · MAESTRANZA MELO»; «—» cuando el trabajo no lo informa. */
export function responsibleText(row: Pick<MaintenanceHistoryRow, "external"> & { detail: Pick<MaintenanceHistoryRow["detail"], "responsible"> }): string {
  if (row.external === null) return DASH
  if (!row.external) return "Interno"
  return row.detail.responsible ? `Externo · ${row.detail.responsible}` : "Externo"
}
