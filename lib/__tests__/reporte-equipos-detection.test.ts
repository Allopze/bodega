/**
 * Pruebas del mecanismo de detección de marcas.
 *
 * Los fixtures se generan acá y son sintéticos **a propósito y con límite
 * declarado**: prueban que la maquinaria lee lo que se dibujó —geometría,
 * umbral, mapeo fila→ítem, rectificación— y NADA sobre el acierto con fotos
 * reales. Una planilla dibujada desde el mismo layout que la lee cae por
 * construcción en las celdas correctas; eso es probar el código contra sus
 * propias suposiciones.
 *
 * El acierto real se mide en modo sombra, comparando `extraction` contra lo
 * que teclea la persona. Mismo criterio que `invoice-ocr.test.ts`, que también
 * genera sus fixtures y cuya auditoría dejó dicho que "los layouts sintéticos
 * cubren las degradaciones del motor, no los layouts de cada proveedor".
 */
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  detectMarksInPhoto,
  detectMarksOnCanvas,
  inkRatio,
} from "@/lib/services/inspection-forms/detect-marks"
import {
  LAYOUT_VERSION,
  MARK_COLUMNS,
  ROW_COUNT,
  cellBox,
  rowTarget,
} from "@/lib/services/inspection-forms/reporte-equipos-layout"
import type { RectifiedImage } from "@/lib/services/inspection-forms/rectify"

const WIDTH = 700
const HEIGHT = 950

/** Lienzo en blanco con el borde exterior del formulario dibujado. */
function blankForm(): RectifiedImage {
  const data = new Uint8Array(WIDTH * HEIGHT).fill(255)
  const image = { data, width: WIDTH, height: HEIGHT }
  // Borde exterior: es lo que `detectFormQuad` busca.
  for (let x = 0; x < WIDTH; x++) {
    for (let t = 0; t < 3; t++) {
      data[t * WIDTH + x] = 0
      data[(HEIGHT - 1 - t) * WIDTH + x] = 0
    }
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let t = 0; t < 3; t++) {
      data[y * WIDTH + t] = 0
      data[y * WIDTH + (WIDTH - 1 - t)] = 0
    }
  }
  return image
}

/** Dibuja un aspa que ocupa el centro de la celda, como un tilde a mano. */
function mark(image: RectifiedImage, rowIndex: number, column: (typeof MARK_COLUMNS)[number]) {
  const box = cellBox(rowIndex, column)
  const x0 = Math.round(box.x0 * image.width)
  const x1 = Math.round(box.x1 * image.width)
  const y0 = Math.round(box.y0 * image.height)
  const y1 = Math.round(box.y1 * image.height)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const radius = Math.min(x1 - x0, y1 - y0) * 0.28
  for (let dy = -radius; dy <= radius; dy += 0.5) {
    for (const dx of [dy, -dy]) {
      for (let thickness = -1; thickness <= 1; thickness++) {
        const x = Math.round(cx + dx + thickness)
        const y = Math.round(cy + dy)
        if (x >= 0 && x < image.width && y >= 0 && y < image.height) image.data[y * image.width + x] = 0
      }
    }
  }
}

async function toPng(image: RectifiedImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 1 } })
    .png()
    .toBuffer()
}

describe("Detección de marcas del Reporte de Equipos", () => {
  it("mapea cada fila al ítem del checklist, en ambos lados", () => {
    // La 1:1 con la definición es lo que hace posible leer por posición.
    expect(rowTarget(0, "camion")).toEqual({ sectionId: "estado_camion", itemId: "luces" })
    expect(rowTarget(0, "acoplado")).toEqual({ sectionId: "estado_acoplado", itemId: "acoplado_luces" })
    expect(rowTarget(ROW_COUNT - 1, "camion")).toEqual({ sectionId: "exclusivo_camion", itemId: "estado_ampliroll" })
    expect(rowTarget(19, "camion")).toEqual({ sectionId: "exclusivo_carga", itemId: "estado_rotor" })
    expect(rowTarget(ROW_COUNT, "camion")).toBeNull()
  })

  it("las 25 celdas de una columna no se solapan y van de arriba a abajo", () => {
    const boxes = Array.from({ length: ROW_COUNT }, (_, index) => cellBox(index, "camion_normal"))
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index]!.y0).toBeGreaterThanOrEqual(boxes[index - 1]!.y1 - 1e-9)
    }
    // Y las cuatro columnas son disjuntas entre sí.
    const columns = MARK_COLUMNS.map((column) => cellBox(0, column))
    for (let index = 1; index < columns.length; index++) {
      expect(columns[index]!.x0).toBeGreaterThanOrEqual(columns[index - 1]!.x1 - 1e-9)
    }
  })

  it("una celda vacía no tiene tinta y una marcada sí", () => {
    const image = blankForm()
    expect(inkRatio(image, cellBox(3, "camion_normal"))).toBe(0)
    mark(image, 3, "camion_normal")
    expect(inkRatio(image, cellBox(3, "camion_normal"))).toBeGreaterThan(0.04)
    // Y no contamina la vecina.
    expect(inkRatio(image, cellBox(3, "camion_falla"))).toBe(0)
    expect(inkRatio(image, cellBox(4, "camion_normal"))).toBe(0)
  })

  it("lee NORMAL como cumple y FALLA como no cumple", () => {
    const image = blankForm()
    mark(image, 0, "camion_normal")   // luces normal
    mark(image, 2, "camion_falla")    // bocina en falla
    mark(image, 3, "camion_falla")    // alarma de retroceso en falla

    const result = detectMarksOnCanvas(image)
    expect(result.layoutVersion).toBe(LAYOUT_VERSION)
    const byItem = new Map(result.cells.map((cell) => [cell.itemId, cell]))
    expect(byItem.get("luces")).toMatchObject({ result: "conforming", sectionId: "estado_camion" })
    expect(byItem.get("bocina")).toMatchObject({ result: "non_conforming" })
    expect(byItem.get("alarma_retroceso")).toMatchObject({ result: "non_conforming" })
    // Lo que no se marcó no se inventa.
    expect(byItem.has("baliza")).toBe(false)
  })

  it("lee la columna del acoplado en los ítems espejo", () => {
    const image = blankForm()
    mark(image, 0, "acoplado_normal")
    mark(image, 10, "acoplado_falla")
    const byItem = new Map(detectMarksOnCanvas(image).cells.map((cell) => [cell.itemId, cell]))
    expect(byItem.get("acoplado_luces")).toMatchObject({ result: "conforming", sectionId: "estado_acoplado" })
    expect(byItem.get("acoplado_neumaticos_llantas")).toMatchObject({ result: "non_conforming" })
  })

  it("no decide una fila con las dos casillas marcadas", () => {
    const image = blankForm()
    mark(image, 5, "camion_normal")
    mark(image, 5, "camion_falla")
    const result = detectMarksOnCanvas(image)
    expect(result.cells.find((cell) => cell.itemId === "espejos")).toBeUndefined()
    expect(result.ambiguousRows).toContainEqual({ rowIndex: 5, reason: "both" })
  })

  it("reporta las filas del camión sin marcar, y calla las del acoplado", () => {
    const image = blankForm()
    mark(image, 0, "camion_normal")
    const result = detectMarksOnCanvas(image)
    // 24 filas del camión quedaron vacías; el acoplado entero también, pero
    // eso es lo normal —la mayoría de los equipos no lleva— y no se reporta.
    expect(result.ambiguousRows.filter((row) => row.reason === "empty")).toHaveLength(ROW_COUNT - 1)
  })

  it("rectifica y lee una foto de la planilla", async () => {
    const image = blankForm()
    mark(image, 1, "camion_falla")
    const png = await toPng(image)
    const result = await detectMarksInPhoto(png)
    expect(result.warning).toBeUndefined()
    expect(result.cells.find((cell) => cell.itemId === "baliza")).toMatchObject({ result: "non_conforming" })
  })

  it("avisa en vez de inventar cuando no encuentra la hoja", async () => {
    // Una foto donde no hay una región clara grande: de noche, a contraluz, o
    // apuntando a cualquier otra cosa. Devolver un cuadrilátero acá produciría
    // 25 filas de ruido con forma de dato, que es peor que no leer nada.
    const dark = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 20, g: 20, b: 20 } },
    }).png().toBuffer()
    const result = await detectMarksInPhoto(dark)
    expect(result.cells).toHaveLength(0)
    expect(result.warning).toMatch(/no se reconoció/i)
  })
})
