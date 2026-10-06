/**
 * Resuelve el documento de origen de un movimiento de inventario a un enlace.
 *
 * Vive aparte de `lib/services/document-chain.ts` a propósito: ese módulo abre
 * consultas, recibe `Session` e importa ocho tablas y el motor de permisos.
 * Arrastrar todo eso al render de cada fila del kardex por un mapa de strings
 * no se paga, y sus `DOCUMENT_KINDS` ni siquiera admiten estos tipos.
 */
const HREF_BY_REFERENCE: Record<string, (id: string) => string> = {
  receipt:                  (id) => `/recepcion/${id}`,
  delivery:                 (id) => `/entregas/${id}/print`,
  dispatch_guide:           (id) => `/bodega/guias/${id}`,
  stock_adjustment:         (id) => `/bodega/documentos?doc=${id}`,
  delivery_return:          (id) => `/bodega/documentos?doc=${id}`,
  physical_inventory_count: (id) => `/bodega/documentos?doc=${id}`,
  // `worksite_closure` no tiene pantalla: es un evento administrativo que ya
  // queda en `audit_log`. Devuelve null y la celda se pinta sin enlace, en vez
  // de inventarle un destino.
}

export const REFERENCE_TYPE_LABELS: Record<string, string> = {
  receipt:                  "Recepción",
  delivery:                 "Entrega",
  dispatch_guide:           "Guía de despacho",
  stock_adjustment:         "Documento de bodega",
  delivery_return:          "Devolución",
  physical_inventory_count: "Conteo físico",
  worksite_closure:         "Cierre de faena",
}

export function movementDocumentHref(
  referenceType: string | null | undefined,
  referenceId: string | null | undefined,
): string | null {
  if (!referenceType || !referenceId) return null
  return HREF_BY_REFERENCE[referenceType]?.(referenceId) ?? null
}

export function referenceTypeLabel(referenceType: string | null | undefined): string | null {
  if (!referenceType) return null
  return REFERENCE_TYPE_LABELS[referenceType] ?? referenceType.replace(/_/g, " ")
}

/** Folios que el sistema escribe en el motivo o la nota de un movimiento. */
const FOLIO_PATTERN = /\b(?:GDI|REC|ENT|OC|AJU|DES|DEV|CON)-[0-9]{4,}(?:-[0-9]+)?\b/

/**
 * Folio del documento de origen de un movimiento, para mostrarlo en la columna
 * "Documento". Antes sólo estaba enterrado en "Observación", que se truncaba, y
 * "Documento" decía el tipo ("Entrega") sin decir cuál.
 */
export function movementFolio(movement: {
  documentFolio?: string | null
  reason?: string | null
  notes?: string | null
}): string | null {
  if (movement.documentFolio) return movement.documentFolio
  for (const text of [movement.reason, movement.notes]) {
    const match = text ? FOLIO_PATTERN.exec(text) : null
    if (match) return match[0]
  }
  return null
}
