import { REPORTE_EQUIPOS_FILAS, REPORTE_EQUIPOS_SECTIONS } from "@/lib/sst/definitions/reporte-equipos-sections"

/**
 * Geometría del formulario "REPORTE DE EQUIPOS" para la detección de marcas.
 *
 * El talonario es de **layout fijo**, así que las 25 filas × 4 columnas
 * NORMAL/FALLA son un problema de posición, no de OCR. Este archivo es la
 * perilla de calibración: todo se expresa como **fracción del rectángulo
 * exterior del formulario ya rectificado**, nunca en píxeles, para que sirva
 * igual con una foto de 2 MP que con un escaneo de 300 dpi.
 *
 * ⚠️ **Los valores actuales son estimaciones tomadas del render de la plantilla
 * corregida 2026-08-19, NO medidas sobre el arte original.** Antes de confiar
 * en el detector hay que correr `scripts/overlay-form-grid.ts` sobre una foto
 * real y ajustar: la malla tiene que caer dentro de las casillas, no encima de
 * las líneas. Un desplazamiento sistemático de media celda produce lecturas
 * plausibles y equivocadas, que es el peor modo de falla posible.
 */

/** Versión de la calibración. Viaja en `extraction` para poder auditar con qué malla se leyó. */
export const LAYOUT_VERSION = "reporte-equipos/2026-08-19-estimado"

export interface CellBox {
  /** Fracciones [0,1] del rectángulo exterior del formulario rectificado. */
  x0: number; y0: number; x1: number; y1: number
}

/* ── Las cuatro perillas ──────────────────────────────────────────────────
 * Son fracciones del formulario rectificado. Se ajustan mirando la salida de
 * `npm run forms:overlay-grid`: la malla tiene que caer DENTRO de las
 * casillas, no sobre las líneas. Valores medidos sobre la foto del N° 03101
 * rectificada con esquinas dadas a mano.
 */

/** Borde superior de la primera fila de datos (LUCES). */
const DATA_TOP = 0.383
/** Borde inferior de la última fila (ESTADO DE AMPLIROLL). */
const DATA_BOTTOM = 0.763
/** Borde izquierdo de la columna CAMIÓN/NORMAL. */
const MARKS_LEFT = 0.618
/** Borde derecho de la columna ACOPLADO/FALLA. */
const MARKS_RIGHT = 0.968

/**
 * Margen que se recorta de cada celda antes de medir tinta, como fracción de
 * su lado. Sin esto la línea de la grilla entra en la medición y toda celda
 * parece marcada.
 */
export const CELL_INSET = 0.22

/** Fracción de píxeles oscuros desde la cual la celda se considera marcada. */
export const INK_THRESHOLD = 0.045

/** Filas del papel, en orden. La 1:1 con la definición la fijan los tests. */
export const ROW_COUNT = REPORTE_EQUIPOS_FILAS.length

export type MarkColumn = "camion_normal" | "camion_falla" | "acoplado_normal" | "acoplado_falla"

export const MARK_COLUMNS: readonly MarkColumn[] = [
  "camion_normal", "camion_falla", "acoplado_normal", "acoplado_falla",
]

/** Caja de una celda de marca, en fracciones del formulario rectificado. */
export function cellBox(rowIndex: number, column: MarkColumn): CellBox {
  const rowHeight = (DATA_BOTTOM - DATA_TOP) / ROW_COUNT
  const columnWidth = (MARKS_RIGHT - MARKS_LEFT) / MARK_COLUMNS.length
  const columnIndex = MARK_COLUMNS.indexOf(column)
  return {
    x0: MARKS_LEFT + columnWidth * columnIndex,
    y0: DATA_TOP + rowHeight * rowIndex,
    x1: MARKS_LEFT + columnWidth * (columnIndex + 1),
    y1: DATA_TOP + rowHeight * (rowIndex + 1),
  }
}

/**
 * A qué ítem del checklist corresponde la fila `rowIndex` en cada columna.
 *
 * Se deriva de la definición, no se repite acá: el papel usa las mismas 25
 * filas para camión y acoplado, y `REPORTE_EQUIPOS_SECTIONS` ya garantiza el
 * espejo. Duplicar el mapa sería una segunda fuente de verdad que puede
 * desalinearse justo donde más caro sale.
 */
const SECTION_BY_ITEM_ID = new Map<string, string>(
  REPORTE_EQUIPOS_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, section.id] as const)),
)

export interface RowTarget {
  sectionId: string
  itemId: string
}

export function rowTarget(rowIndex: number, side: "camion" | "acoplado"): RowTarget | null {
  const row = REPORTE_EQUIPOS_FILAS[rowIndex]
  if (!row) return null
  const itemId = side === "acoplado" ? `acoplado_${row.id}` : row.id
  const sectionId = SECTION_BY_ITEM_ID.get(itemId)
  if (!sectionId) return null
  return { sectionId, itemId }
}
