/**
 * Clasificador local del desafío de imágenes del reCAPTCHA.
 *
 * El referente (`referencia-resolver-onway`) ejecuta el clasificador en un
 * subproceso de Python con `onnxruntime`. Aquí no: la imagen de producción es
 * `node:22-alpine` (musl) y `onnxruntime-node` publica binarios glibc que no
 * cargan ahí (`ERR_DLOPEN_FAILED: ld-linux-x86-64.so.2`). `onnxruntime-web`
 * corre en WASM y sí funciona — verificado en musl con el modelo real.
 *
 * Este archivo sólo entrega los rankings por casilla. Qué marcar se decide en
 * `onway-captcha-contract.ts`, que es puro y tiene pruebas.
 *
 * El modelo es un YOLO11x-cls entrenado por DannyLuna con 57 000 imágenes
 * reales de reCAPTCHA. Metadatos del ONNX: `task: classify`,
 * `imgsz: [640, 640]`, `dynamic: true`, 14 clases, **licencia AGPL-3.0**.
 * No se embarca en la imagen: se descarga con
 * `node scripts/install-onway-vision-model.mjs` a un volumen.
 */

import { existsSync } from "node:fs"
import { ONWAY_CAPTCHA_CLASSES, ONWAY_CAPTCHA_INPUT_SIDE, type OnwayCaptchaTileRanking } from "./onway-captcha-contract"

/** Ruta por defecto donde el one-shot deja el modelo. */
export const ONWAY_VISION_DEFAULT_MODEL_PATH = "/data/onway-models/recaptcha_cls.onnx"

export interface OnwayCaptchaBoardTile {
  /** Columna del recorte dentro del sprite (0-based). */
  col: number
  /** Fila del recorte dentro del sprite (0-based). */
  row: number
  /** Lado del tablero, para calcular la fracción que ocupa cada casilla. */
  grid: number
}

export interface OnwayCaptchaBoard {
  /** Imagen completa que sirve Google (un solo sprite, no una por casilla). */
  image: Buffer
  /** Lado del tablero: 3 o 4 (1 en teselas reemplazadas dinámicamente). */
  tiles: OnwayCaptchaBoardTile[]
}

export interface OnwayCaptchaClassifierOptions {
  /** Ruta al `.onnx`. Sin ella se usa `ONWAY_VISION_MODEL_PATH` o la ruta por defecto. */
  modelPath?: string
  /** Lado al que se redimensiona cada recorte antes de clasificar. */
  inputSide?: number
  /** Umbral por debajo del cual un recorte se descarta sin inferir. */
  minimumTilePixels?: number
}

/** Un tablero completo: un ranking de clases por casilla. */
export type OnwayCaptchaTileRankings = OnwayCaptchaTileRanking[]

export function resolveOnwayVisionModelPath(options: OnwayCaptchaClassifierOptions = {}): string {
  const explicit = options.modelPath?.trim() || process.env.ONWAY_VISION_MODEL_PATH?.trim()
  if (explicit) return existsSync(explicit) ? explicit : ""
  return existsSync(ONWAY_VISION_DEFAULT_MODEL_PATH) ? ONWAY_VISION_DEFAULT_MODEL_PATH : ""
}

/**
 * `true` si hay modelo instalado. No carga el modelo: sólo comprueba el archivo.
 * El arranque de la app nunca depende de esto; sin modelo, el desafío se entrega
 * a una persona con `ONWAY_CAPTCHA_UNAVAILABLE`.
 */
export function hasOnwayCaptchaClassifier(options: OnwayCaptchaClassifierOptions = {}): boolean {
  return resolveOnwayVisionModelPath(options) !== ""
}

/**
 * Recorta una casilla del sprite y la deja como tensor CHW normalizado 0..1.
 *
 * reCAPTCHA sirve **una sola imagen** y cada casilla la muestra desplazada por
 * CSS. El recorte es una fracción `1/grid` del original; descargar el `src` de
 * cada casilla devolvía siempre la misma imagen y el modelo puntuaba todas
 * igual (bug ya resuelto en el referente).
 */
export function cropOnwayCaptchaTile(
  image: { width: number; height: number; channels: number; data: Buffer },
  tile: OnwayCaptchaBoardTile,
  inputSide: number,
): Float32Array | null {
  const grid = Math.max(1, Math.trunc(tile.grid))
  const { width, height, channels, data } = image
  if (width <= 0 || height <= 0 || channels < 1) return null

  const cellWidth = width / grid
  const cellHeight = height / grid
  if (Math.trunc(cellWidth) < 2 || Math.trunc(cellHeight) < 2) return null

  const originX = tile.col * cellWidth
  const originY = tile.row * cellHeight
  const out = new Float32Array(inputSide * inputSide * 3)
  const pixel = (x: number, y: number, channel: number): number => {
    const cx = Math.min(width - 1, Math.max(0, Math.trunc(x)))
    const cy = Math.min(height - 1, Math.max(0, Math.trunc(y)))
    return data[(cy * width + cx) * channels + Math.min(channel, channels - 1)]! / 255
  }

  for (let y = 0; y < inputSide; y++) {
    const sourceY = originY + (y * cellHeight) / inputSide
    const y0 = Math.trunc(sourceY)
    const y1 = y0 + 1
    const fy = sourceY - y0
    for (let x = 0; x < inputSide; x++) {
      const sourceX = originX + (x * cellWidth) / inputSide
      const x0 = Math.trunc(sourceX)
      const x1 = x0 + 1
      const fx = sourceX - x0
      for (let channel = 0; channel < 3; channel++) {
        const top = pixel(x0, y0, channel) * (1 - fx) + pixel(x1, y0, channel) * fx
        const bottom = pixel(x0, y1, channel) * (1 - fx) + pixel(x1, y1, channel) * fx
        out[channel * inputSide * inputSide + y * inputSide + x] = top * (1 - fy) + bottom * fy
      }
    }
  }

  return out
}

/**
 * El modelo ya entrega **probabilidades** (softmax incluido en el grafo: las 14
 * salidas suman 1.0000, verificado con el ONNX real). Aplicar softmax otra vez
 * aplanaba todo a ~0.17 y ninguna casilla quedaba seleccionable; el referente
 * también lee la salida directo. Aquí sólo se ordena y se recorta a las tres
 * primeras.
 */
function topRanking(probabilities: ArrayLike<number>, offset: number, length: number): OnwayCaptchaTileRanking {
  const row: Array<[string, number]> = []
  for (let index = 0; index < length; index++) {
    row.push([ONWAY_CAPTCHA_CLASSES[index] ?? "Other", probabilities[offset + index] ?? 0])
  }
  return row.sort((a, b) => b[1] - a[1]).slice(0, 3)
}

/**
 * Clasifica un tablero completo.
 *
 * Se infiere **de a una casilla**: medido en musl con el modelo real, un lote de
 * 4 tarda 8,3 s (2,1 s por casilla) y 2 tarda 6,2 s, mientras que la casilla
 * suelta tarda ~1,1 s. El lote además dispara el RSS por sobre 1 GB en un
 * contenedor de 2 GB. La latencia no viene del tamaño del lote sino del grafo.
 */
export async function classifyOnwayCaptchaBoard(
  board: OnwayCaptchaBoard,
  options: OnwayCaptchaClassifierOptions = {},
): Promise<OnwayCaptchaTileRankings | null> {
  const modelPath = resolveOnwayVisionModelPath(options)
  if (!modelPath) return null

  const { decodeOnwayCaptchaImage } = await import("./onway-captcha-image")
  const image = await decodeOnwayCaptchaImage(board.image)
  if (!image) return null

  const inputSide = options.inputSide ?? ONWAY_CAPTCHA_INPUT_SIDE
  const tensors = board.tiles.map((tile) => cropOnwayCaptchaTile(image, tile, inputSide))
  if (tensors.every((tensor) => tensor === null)) return null

  const ort = await import("onnxruntime-web")
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] })
  const inputName = session.inputNames[0]!
  const outputName = session.outputNames[0]!

  const rankings: OnwayCaptchaTileRankings = []
  for (const tensor of tensors) {
    if (!tensor) {
      rankings.push([])
      continue
    }
    const output = await session.run({
      [inputName]: new ort.Tensor("float32", tensor, [1, 3, inputSide, inputSide]),
    })
    const logits = output[outputName]!
    const classes = logits.dims[logits.dims.length - 1] ?? ONWAY_CAPTCHA_CLASSES.length
    rankings.push(topRanking(logits.data as Float32Array, 0, classes))
  }

  return rankings
}
