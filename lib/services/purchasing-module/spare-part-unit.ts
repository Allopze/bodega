/**
 * Catálogo de repuestos: un repuesto se compra en una sola unidad de medida.
 *
 * Vincular una línea pedida en «juego» a un repuesto que se compra por «unidad»
 * mezcla magnitudes: el precio de la OC (por juego) quedaría en el catálogo como
 * precio por unidad. Por eso el vínculo exige la misma unidad, y emitir la OC no
 * escribe el precio de una línea cuya unidad no es la del repuesto.
 *
 * Sin dependencias de base de datos: lo usan el servicio de la OC y la acción de
 * la hoja «Catalogar», que avisa antes de enviar.
 */

/** La unidad tal como se compara: sin espacios en los bordes y en minúsculas. */
export function normalizeUnitOfMeasure(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLocaleLowerCase("es-CL")
}

/**
 * El mensaje que explica por qué el repuesto no se puede vincular a la línea, o
 * `null` cuando las unidades coinciden.
 */
export function sparePartUnitMismatchMessage(
  part: { sku: string; unitOfMeasure: string },
  lineUnitOfMeasure: string,
): string | null {
  if (normalizeUnitOfMeasure(part.unitOfMeasure) === normalizeUnitOfMeasure(lineUnitOfMeasure)) return null
  return `El repuesto ${part.sku} se compra por «${part.unitOfMeasure.trim()}» y la línea pide «${lineUnitOfMeasure.trim()}»; elige otro o crea uno nuevo`
}
