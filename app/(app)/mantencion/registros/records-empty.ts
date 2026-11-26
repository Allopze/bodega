import type { MantReview } from "@/lib/mantencion/types"
import { hasRecordFilters, type RecordFilters } from "@/lib/services/mantencion/records-filters"

/**
 * Textos del estado vacío de «Registros firmados». Viven fuera de `page.tsx` porque una página de Next no puede exportar
 * nada más que su componente y su configuración.
 */

/** La pestaña de revisión dicha como complemento de «registros»: «por revisar», «observados», «revisados». */
function reviewWhere(review: MantReview | undefined): string | null {
  return review === "pendiente" ? "por revisar" : review === "observado" ? "observados" : review === "revisado" ? "revisados" : null
}

/**
 * Lo que dice una pestaña sin registros: qué significa y qué hacer, sin jerga (regla A4). Con sólo una búsqueda puesta
 * (`searchOnly`), el vacío habla de la búsqueda: «otro período» o «algún filtro» despistaban a quien tecleó un folio.
 */
export function emptyCopy(review: MantReview | undefined, filtered: boolean, searchOnly: boolean): { title: string; description?: string } {
  const where = reviewWhere(review)
  if (searchOnly) {
    return {
      title: "No hay un registro con ese folio, código o patente",
      description: where ? `Se buscó sólo entre los registros ${where}.` : undefined,
    }
  }
  if (filtered) {
    return {
      title: where ? `No hay registros ${where} con estos filtros` : "Ningún registro coincide con estos filtros",
      description: "Prueba con otro período o quita algún filtro.",
    }
  }
  if (review === "pendiente") {
    return { title: "No hay registros por revisar", description: "Llegan apenas un mecánico los firma y su teléfono los sincroniza." }
  }
  if (review === "observado") {
    return { title: "No hay registros observados", description: "Quedan los registros con corrección pedida, hasta que los marques como revisados." }
  }
  if (review === "revisado") {
    return { title: "Aún no hay registros revisados", description: "Aparece al marcar un registro como revisado." }
  }
  return { title: "Aún no hay registros firmados", description: "Llegan apenas un mecánico firma una mantención y su teléfono la sincroniza." }
}

/**
 * `true` cuando lo único puesto es la búsqueda por folio, código o patente (la pestaña de revisión no cuenta, es una
 * dimensión aparte): su vacío habla de la búsqueda y se sale de él quitándola, no «quitando los filtros».
 */
export function isSearchOnly(filters: RecordFilters): boolean {
  return Boolean(filters.equipment) && !hasRecordFilters({ ...filters, review: undefined, equipment: undefined })
}
