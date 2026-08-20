import {
  CELL_INSET,
  INK_THRESHOLD,
  LAYOUT_VERSION,
  MARK_COLUMNS,
  ROW_COUNT,
  cellBox,
  rowTarget,
  type MarkColumn,
} from "./reporte-equipos-layout"
import { detectFormQuad, loadGrayscale, warpToRectangle, type RectifiedImage } from "./rectify"

/**
 * Lectura de las casillas NORMAL/FALLA del Reporte de Equipos.
 *
 * No es OCR: el talonario es de layout fijo, así que la marca se decide por
 * **densidad de tinta en una celda conocida**. Tesseract queda fuera de acá —
 * la auditoría de facturas ya concluyó que sobre escaneo pierde hasta el folio
 * de un documento *impreso*, y esto es manuscrito.
 *
 * ⚠️ **Modo sombra.** Lo que devuelve esta función NO pre-llena respuestas: se
 * guarda en `prevention_inspection_run_documents.extraction` y se compara
 * contra lo que teclee la persona. El pre-llenado se enciende cuando la
 * medición contra fotos reales lo respalde, no antes: un detector sin medir es
 * una conjetura, y acá alimentaría una ratificación humana que la daría por
 * buena.
 */

/** Tamaño del lienzo rectificado. Fijo para que las mediciones sean comparables entre fotos. */
const CANVAS_WIDTH = 1400
const CANVAS_HEIGHT = 1900

export interface DetectedCell {
  sectionId: string
  itemId: string
  /** Vocabulario del motor de inspecciones, no del papel. */
  result: "conforming" | "non_conforming"
  /** [0,1]. Separación entre la casilla marcada y la vacía de la misma fila. */
  confidence: number
}

export interface DetectionResult {
  layoutVersion: string
  cells: DetectedCell[]
  /** Filas donde no se pudo decidir: ninguna marca, o las dos. */
  ambiguousRows: { rowIndex: number; reason: "empty" | "both" }[]
  warning?: string
}

/** Fracción de píxeles oscuros dentro de la celta, descontado el margen. */
export function inkRatio(image: RectifiedImage, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const insetX = (box.x1 - box.x0) * CELL_INSET
  const insetY = (box.y1 - box.y0) * CELL_INSET
  const x0 = Math.max(0, Math.round((box.x0 + insetX) * image.width))
  const x1 = Math.min(image.width, Math.round((box.x1 - insetX) * image.width))
  const y0 = Math.max(0, Math.round((box.y0 + insetY) * image.height))
  const y1 = Math.min(image.height, Math.round((box.y1 - insetY) * image.height))
  if (x1 <= x0 || y1 <= y0) return 0

  let dark = 0
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (image.data[y * image.width + x]! < 140) dark++
      total++
    }
  }
  return total === 0 ? 0 : dark / total
}

/** Lee las 4 columnas de una fila y decide, para cada lado, si hay marca. */
function readRow(canvas: RectifiedImage, rowIndex: number): Record<MarkColumn, number> {
  const ratios = {} as Record<MarkColumn, number>
  for (const column of MARK_COLUMNS) {
    ratios[column] = inkRatio(canvas, cellBox(rowIndex, column))
  }
  return ratios
}

/**
 * Decide una fila para un lado (camión o acoplado).
 *
 * La confianza es la **separación** entre las dos casillas, no la cantidad de
 * tinta: un tilde grueso y uno tenue son igual de válidos mientras la otra
 * casilla esté vacía. Lo que hace dudosa una lectura es que ambas se parezcan.
 */
function decideSide(
  normal: number,
  falla: number,
): { result: "conforming" | "non_conforming"; confidence: number } | { reason: "empty" | "both" } {
  const normalMarked = normal >= INK_THRESHOLD
  const fallaMarked = falla >= INK_THRESHOLD
  if (!normalMarked && !fallaMarked) return { reason: "empty" }
  if (normalMarked && fallaMarked) return { reason: "both" }
  const winner = normalMarked ? normal : falla
  const loser = normalMarked ? falla : normal
  return {
    result: normalMarked ? "conforming" : "non_conforming",
    confidence: Math.max(0, Math.min(1, (winner - loser) / Math.max(winner, 1e-6))),
  }
}

/** Lee un lienzo ya rectificado. Separada para poder probarla sin fotografía. */
export function detectMarksOnCanvas(canvas: RectifiedImage): DetectionResult {
  const cells: DetectedCell[] = []
  const ambiguousRows: DetectionResult["ambiguousRows"] = []

  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++) {
    const ratios = readRow(canvas, rowIndex)
    for (const side of ["camion", "acoplado"] as const) {
      const decision = decideSide(
        ratios[side === "camion" ? "camion_normal" : "acoplado_normal"],
        ratios[side === "camion" ? "camion_falla" : "acoplado_falla"],
      )
      // El acoplado vacío es lo normal —la mayoría de los equipos no lleva—,
      // así que sólo se reporta como ambigua la fila del camión sin marca.
      if ("reason" in decision) {
        if (side === "camion" || decision.reason === "both") {
          ambiguousRows.push({ rowIndex, reason: decision.reason })
        }
        continue
      }
      const target = rowTarget(rowIndex, side)
      if (!target) continue
      cells.push({ ...target, result: decision.result, confidence: decision.confidence })
    }
  }

  return { layoutVersion: LAYOUT_VERSION, cells, ambiguousRows }
}

/** Camino completo: foto → rectificación → lectura. */
export async function detectMarksInPhoto(buffer: Buffer): Promise<DetectionResult> {
  const image = await loadGrayscale(buffer)
  const quad = detectFormQuad(image)
  if (!quad) {
    return {
      layoutVersion: LAYOUT_VERSION,
      cells: [],
      ambiguousRows: [],
      warning: "No se reconoció el borde del formulario en la foto.",
    }
  }
  const canvas = warpToRectangle(image, quad, CANVAS_WIDTH, CANVAS_HEIGHT)
  if (!canvas) {
    return {
      layoutVersion: LAYOUT_VERSION,
      cells: [],
      ambiguousRows: [],
      warning: "No se pudo rectificar la perspectiva de la foto.",
    }
  }
  return detectMarksOnCanvas(canvas)
}
