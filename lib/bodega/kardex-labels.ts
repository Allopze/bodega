import { movementLabel } from "@/lib/movement-labels"

/**
 * Rótulo del tipo de movimiento en el kárdex (pantalla y Excel).
 *
 * `ingreso_anulacion` es el tipo con que se repone lo que salió mal registrado: una entrega
 * anulada, pero también el uso de un repuesto cuyo registro de mantención se anuló. Dicho como
 * «Reverso por anulación» a secas, el segundo caso no se distingue del primero; el origen
 * (`mant_record_void`, que escribe `reverseRecordPartsTx`) lo desambigua sin tocar el mapa
 * canónico de `lib/movement-labels.ts`.
 */
export const MANT_RECORD_VOID_REFERENCE = "mant_record_void"

export function kardexTypeLabel(type: string, referenceType?: string | null): string {
  if (type === "ingreso_anulacion" && referenceType === MANT_RECORD_VOID_REFERENCE) {
    return "Reverso de uso en mantención"
  }
  return movementLabel(type)
}
