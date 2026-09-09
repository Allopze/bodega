import type { InvoiceLineAllocationErrorCode } from "./invoice-line-allocation-validation"

/** Shared recovery copy for the browser preview and typed server failures. */
export const INVOICE_ALLOCATION_ERRORS: Record<InvoiceLineAllocationErrorCode, string> = {
  DUPLICATE_TARGET: "Cada línea de OC puede aparecer una sola vez en este reparto. Une las filas repetidas.",
  CROSS_ORDER_TARGET: "Una línea seleccionada pertenece a otra OC. Recarga y elige una línea de esta orden.",
  TARGET_NOT_FOUND: "Selecciona una línea de OC disponible en cada fila.",
  QUANTITY_OVERFLOW: "La cantidad asignada supera la cantidad de la factura. Reduce el reparto.",
  SUBTOTAL_OVERFLOW: "El subtotal asignado supera el subtotal documental. Revisa los montos.",
  SIGN_MISMATCH: "Conserva el signo del documento: las notas de crédito llevan cantidades y subtotales negativos.",
  MISSING_UNIT: "Falta la unidad documental o la de la OC. Completa esa evidencia antes de repartir.",
  UNIT_MISMATCH: "Las unidades no son equivalentes. Selecciona una línea de OC con la misma unidad.",
  INCOMPLETE_COVERAGE: "Queda cantidad o subtotal sin asignar. Completa el reparto o guárdalo como parcial.",
  INVALID_NUMBER: "Ingresa cantidades distintas de cero y subtotales numéricos válidos.",
  INVOICE_ITEM_NOT_FOUND: "La línea de factura ya no está disponible. Recarga la página.",
  OUT_OF_SCOPE: "No tienes acceso a la faena de esta factura.",
  STALE_EVIDENCE: "La línea o su reparto cambió mientras editabas. Recarga la página y revisa la evidencia actual.",
}
