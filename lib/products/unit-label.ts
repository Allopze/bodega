/**
 * El nombre con que se muestra una unidad de medida del catálogo de unidades
 * (`product_units.label`: «Bidón», «Juego») en vez de su código («bidon»,
 * «juego»). Quien llama carga el mapa código → rótulo; sin él, o con un código
 * que el catálogo no tiene, se muestra el código tal cual.
 *
 * Sin dependencias de base de datos: lo usan páginas de servidor y formularios
 * de cliente.
 */

export type UnitLabels = Readonly<Record<string, string>>

function unitKey(code: string): string {
  return code.trim().toLocaleLowerCase("es-CL").replace(/\s+/g, " ")
}

/** «Bidón»: para una celda o un dato rotulado («Unidad de medida: Bidón»). */
export function unitLabel(code: string, labels?: UnitLabels): string {
  return labels?.[unitKey(code)] ?? code.trim()
}

/** «bidón»: para una frase («se compra por bidón»). */
export function unitWord(code: string, labels?: UnitLabels): string {
  return unitLabel(code, labels).toLocaleLowerCase("es-CL")
}
