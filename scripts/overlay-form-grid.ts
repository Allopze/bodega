/**
 * scripts/overlay-form-grid.ts
 *
 * Dibuja la malla de calibración sobre una foto de la planilla y la guarda como
 * PNG, para poder ver de un vistazo si cada casilla cae DENTRO de su recuadro o
 * encima de las líneas.
 *
 *   npx tsx scripts/overlay-form-grid.ts <foto.jpg> [salida.png]
 *
 * Es el lazo de ajuste de `reporte-equipos-layout.ts`: se mira el resultado, se
 * corrigen las constantes del layout, se vuelve a correr. Un desplazamiento
 * sistemático de media celda produce lecturas plausibles y equivocadas, y ése
 * es el modo de falla que ninguna prueba sintética puede ver — la planilla
 * dibujada desde el mismo layout que la lee cae siempre bien por construcción.
 *
 * Además imprime la densidad de tinta por celda, que es lo que decide la marca:
 * sirve para elegir `INK_THRESHOLD` con números en vez de a ojo.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { inkRatio } from "@/lib/services/inspection-forms/detect-marks"
import {
  INK_THRESHOLD,
  LAYOUT_VERSION,
  MARK_COLUMNS,
  ROW_COUNT,
  cellBox,
  rowTarget,
} from "@/lib/services/inspection-forms/reporte-equipos-layout"
import { detectFormQuad, loadGrayscale, warpToRectangle, type Quad } from "@/lib/services/inspection-forms/rectify"

const CANVAS_WIDTH = 1400
const CANVAS_HEIGHT = 1900

/**
 * Esquinas explícitas, en fracciones [0,1] del ancho y alto de la foto:
 * `--corners=x0,y0,x1,y1,x2,y2,x3,y3` en orden TL, TR, BR, BL.
 *
 * Existe porque la detección automática busca la región clara más grande, y un
 * escritorio de madera clara con otros papeles encima la derrota: en la foto
 * del N° 03101 el 70 % del encuadre pasa por "claro". Antes de invertir en
 * segmentación fina conviene calibrar con las esquinas dadas a mano — y en
 * producción esto mismo es el recurso cuando la foto no se deja reconocer:
 * que la persona ajuste las cuatro esquinas.
 */
function parseCorners(argv: string[]): Quad | null {
  const flag = argv.find((value) => value.startsWith("--corners="))
  if (!flag) return null
  const parts = flag.slice("--corners=".length).split(",").map(Number)
  if (parts.length !== 8 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error("--corners espera 8 números: TLx,TLy,TRx,TRy,BRx,BRy,BLx,BLy (fracciones 0-1)")
  }
  const [ax, ay, bx, by, cx, cy, dx, dy] = parts as number[]
  return {
    topLeft: { x: ax!, y: ay! }, topRight: { x: bx!, y: by! },
    bottomRight: { x: cx!, y: cy! }, bottomLeft: { x: dx!, y: dy! },
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const [input, output] = argv.filter((value) => !value.startsWith("--"))
  if (!input) {
    console.error("Uso: npx tsx scripts/overlay-form-grid.ts <foto.jpg> [salida.png] [--corners=…]")
    process.exit(1)
  }
  const manualCorners = parseCorners(argv)
  const target = output ?? path.join(path.dirname(input), `${path.basename(input, path.extname(input))}-malla.png`)

  const image = await loadGrayscale(await fs.readFile(input))
  console.log(`Foto: ${image.width}×${image.height} · layout ${LAYOUT_VERSION}`)

  const quad = manualCorners
    ? {
        topLeft: { x: manualCorners.topLeft.x * image.width, y: manualCorners.topLeft.y * image.height },
        topRight: { x: manualCorners.topRight.x * image.width, y: manualCorners.topRight.y * image.height },
        bottomRight: { x: manualCorners.bottomRight.x * image.width, y: manualCorners.bottomRight.y * image.height },
        bottomLeft: { x: manualCorners.bottomLeft.x * image.width, y: manualCorners.bottomLeft.y * image.height },
      }
    : detectFormQuad(image)
  if (!quad) {
    console.error("No se reconoció la hoja. Prueba con --corners=TLx,TLy,TRx,TRy,BRx,BRy,BLx,BLy (fracciones 0-1).")
    process.exit(2)
  }
  if (manualCorners) console.log("Esquinas dadas a mano.")
  console.log(`Formulario detectado: (${quad.topLeft.x},${quad.topLeft.y}) → (${quad.bottomRight.x},${quad.bottomRight.y})`)

  const canvas = warpToRectangle(image, quad, CANVAS_WIDTH, CANVAS_HEIGHT)
  if (!canvas) {
    console.error("No se pudo rectificar la perspectiva.")
    process.exit(3)
  }

  // Lienzo RGB: la foto en gris, la malla en rojo.
  const rgb = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT * 3)
  for (let index = 0; index < CANVAS_WIDTH * CANVAS_HEIGHT; index++) {
    const value = canvas.data[index]!
    rgb[index * 3] = value
    rgb[index * 3 + 1] = value
    rgb[index * 3 + 2] = value
  }
  const paint = (x: number, y: number, marked: boolean) => {
    if (x < 0 || y < 0 || x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) return
    const offset = (y * CANVAS_WIDTH + x) * 3
    rgb[offset] = marked ? 0 : 255
    rgb[offset + 1] = marked ? 200 : 0
    rgb[offset + 2] = 0
  }

  console.log("")
  console.log("fila  ítem                             cam.NOR  cam.FAL  aco.NOR  aco.FAL")
  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++) {
    const ratios: number[] = []
    for (const column of MARK_COLUMNS) {
      const box = cellBox(rowIndex, column)
      const ratio = inkRatio(canvas, box)
      ratios.push(ratio)
      const x0 = Math.round(box.x0 * CANVAS_WIDTH)
      const x1 = Math.round(box.x1 * CANVAS_WIDTH)
      const y0 = Math.round(box.y0 * CANVAS_HEIGHT)
      const y1 = Math.round(box.y1 * CANVAS_HEIGHT)
      const marked = ratio >= INK_THRESHOLD
      for (let x = x0; x <= x1; x++) { paint(x, y0, marked); paint(x, y1, marked) }
      for (let y = y0; y <= y1; y++) { paint(x0, y, marked); paint(x1, y, marked) }
    }
    const label = rowTarget(rowIndex, "camion")?.itemId ?? "?"
    const cells = ratios.map((value) => value.toFixed(3).padStart(7)).join("  ")
    console.log(`${String(rowIndex + 1).padStart(4)}  ${label.padEnd(30)} ${cells}`)
  }

  await sharp(Buffer.from(rgb), { raw: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, channels: 3 } })
    .png()
    .toFile(target)

  console.log("")
  console.log(`Malla escrita en ${target}`)
  console.log(`Umbral actual: ${INK_THRESHOLD}. Verde = leída como marcada, rojo = vacía.`)
  console.log("Si una casilla cae sobre la línea de la grilla, ajusta ESTADO_BLOCK/MARKS_* en reporte-equipos-layout.ts.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
