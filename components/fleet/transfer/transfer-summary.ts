import { plural } from "@/lib/mantencion/format"
import type { TransferCandidate } from "@/lib/services/fleet-transfers"
import { formatDate } from "@/lib/utils"

/**
 * Lo que le pasaría a un equipo si se traslada. Se muestra bajo la fila marcada:
 * quien traslada ve las consecuencias antes de confirmar (la OT abierta sigue con
 * el equipo, pero sus horas quedan imputadas al origen; la asignación Copec se mueve
 * desde el día del traslado).
 */
export function transferRowNotes(candidate: TransferCandidate, toWorksiteName: string, effectiveDate: string): string[] {
  const notes = [`Sale de ${candidate.worksiteName}`]
  if (candidate.openWorkOrderFolio) {
    notes.push(`Tiene la ${candidate.openWorkOrderFolio} abierta: sigue con el equipo; la recepción y la conformidad las da ${toWorksiteName || "la faena de destino"}, y las horas quedan imputadas a ${candidate.worksiteName}`)
  }
  if (candidate.providerMappingCount > 0) {
    notes.push(`Tiene asignación Copec: pasa a ${toWorksiteName || "la faena de destino"} desde el ${formatDate(effectiveDate)}`)
  }
  return notes
}

/** Pie del modal: «3 equipos pasan a Mininco desde el 15-11-2026». */
export function transferSummaryText(count: number, toWorksiteName: string | null, effectiveDate: string): string {
  if (count === 0) return "Marca los equipos que se trasladan."
  if (!toWorksiteName) return `${plural(count, "equipo", "equipos")} por trasladar · elige la faena de destino`
  const since = effectiveDate ? ` desde el ${formatDate(effectiveDate)}` : ""
  return `${plural(count, "equipo pasa", "equipos pasan")} a ${toWorksiteName}${since}`
}
