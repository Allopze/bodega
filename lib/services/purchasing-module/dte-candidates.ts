/**
 * Selección de los DTE que se le pueden ofrecer a una orden de compra para
 * registrar su factura sin volver a subir el archivo.
 *
 * ## Por qué es una función aparte y probada
 *
 * La primera versión filtraba sólo por RUT del proveedor. En una OC de APRO
 * creada el 2026-08-07 eso ofrecía sus 10 facturas de julio: ninguna podía ser
 * suya —todas emitidas antes de que la orden existiera— y cada una quedaba a un
 * clic de precargar folio, montos y líneas ajenas. El costo de equivocarse pasó
 * de "bajar el archivo equivocado del portal" a "aceptar lo que propone la
 * pantalla", que es mucho más fácil de hacer sin mirar.
 *
 * La regla que evita eso vive acá y no en un comentario junto a la consulta.
 */

import { cleanRut } from "@/lib/rut"

export interface DteCandidateInput {
  id: string
  rutEmisor: string
  /** 'YYYY-MM-DD' — el portal la entrega así y la columna es texto. */
  fechaEmision: string
}

export interface DteCandidateFilter {
  /** RUT del proveedor de la OC, sin normalizar: se normaliza acá. */
  supplierRut: string | null
  /**
   * Fecha de creación de la OC, 'YYYY-MM-DD'. Es el piso: un proveedor no puede
   * facturar una orden que todavía no existe.
   *
   * Se usa la creación y no la emisión porque sí puede facturar entre que la
   * orden se crea y se emite formalmente.
   */
  createdOn: string
  /** Tope de la lista, para que un proveedor muy activo no la vuelva un muro. */
  limit?: number
}

const DEFAULT_LIMIT = 20

/**
 * Devuelve, del conjunto ya acotado a documentos sin vincular, los que pueden
 * corresponder a esta orden: mismo proveedor y emitidos desde que la orden
 * existe. Preserva el orden recibido (la consulta los trae por fecha desc).
 *
 * Una OC cargada de forma retroactiva sobre una compra ya facturada no verá
 * candidatos. Es deliberado: para ese caso queda la subida manual, que es
 * exactamente como se trabajaba antes de que esto existiera.
 */
export function selectDteCandidates<T extends DteCandidateInput>(
  unlinkedDocs: T[],
  { supplierRut, createdOn, limit = DEFAULT_LIMIT }: DteCandidateFilter,
): T[] {
  if (!supplierRut) return []
  const normalized = cleanRut(supplierRut)
  if (!normalized) return []

  return unlinkedDocs
    .filter((doc) => cleanRut(doc.rutEmisor) === normalized && doc.fechaEmision >= createdOn)
    .slice(0, limit)
}
