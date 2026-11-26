/**
 * Resolución automática del reCAPTCHA v2 de Auth0 en OnWay.
 *
 * Portado de `referencia-resolver-onway/src/prt/captcha.ts` y `vision.ts`. La
 * diferencia de integración es deliberada: aquí el solver **no abre navegador**,
 * trabaja sobre la página que ya tiene `state.browserSession` en
 * `onway-client.ts`. Abrir una sesión propia duplicaría cookies y competiría con
 * el lock del cron.
 *
 * Nunca declara éxito por su cuenta: quien llama debe confirmar con
 * `isOnwaySessionEstablished`. El 2026-11-24 la vista se dio por resuelta porque
 * Auth0 devolvió la portada pública y el sync siguiente volvió a pedir el
 * CAPTCHA — el síntoma «resolví el captcha y al minuto dijo que no resolvió».
 *
 * Todo el cálculo de qué casillas marcar vive en `onway-captcha-contract.ts`,
 * que es puro y tiene pruebas. Aquí sólo está el manejo del navegador.
 */

import type { BrowserContext, Frame, Page } from "playwright"
import { logger } from "@/lib/logger"
import {
  ONWAY_CAPTCHA_CLASSES,
  ONWAY_CAPTCHA_MAX_DYNAMIC_ROUNDS,
  onwayCaptchaBoardGrid,
  onwayCaptchaObjectiveFromPrompt,
  selectOnwayCaptchaTiles,
  translateOnwayCaptchaObjective,
} from "./onway-captcha-contract"
import {
  classifyOnwayCaptchaBoard,
  hasOnwayCaptchaClassifier,
  type OnwayCaptchaTileRankings,
} from "./onway-captcha-classifier"

/** Cómo se obtuvo el token; `null` cuando no se obtuvo. */
export type OnwayCaptchaOutcome = "instant" | "images"

export type OnwayCaptchaFailure =
  | "ONWAY_CAPTCHA_UNAVAILABLE"
  | "ONWAY_CAPTCHA_NOT_RECOGNIZED"
  | "ONWAY_CAPTCHA_REJECTED"
  | "ONWAY_CAPTCHA_BLOCKED"

export interface OnwayCaptchaSolveResult {
  ok: boolean
  outcome: OnwayCaptchaOutcome | null
  failure: OnwayCaptchaFailure | null
  /** Cuántas casillas se marcaron, para la bitácora. */
  tilesSelected: number
  /** Rondas de tablero dinámico usadas. */
  rounds: number
}

export interface OnwayCaptchaSolveOptions {
  /** Intentos completos de desafío antes de rendirse. Cada rechazo degrada el perfil: no subir sin medir. */
  maxAttempts?: number
  /** Tope de tiempo para toda la resolución. */
  deadlineMs?: number
  log?: (message: string) => void
}

const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_DEADLINE_MS = 90_000

/**
 * `true` si hay motor instalado y el operador lo habilitó.
 *
 * Apagado por defecto a propósito: cada rechazo degrada la confianza del perfil
 * y el referente documenta que insistir la hunde. Se enciende con
 * `ONWAY_CAPTCHA_SOLVER=true` cuando hay evidencia de que mejora el resultado.
 */
export function onwayCaptchaSolverEnabled(): boolean {
  if (process.env.ONWAY_CAPTCHA_SOLVER !== "true") return false
  return hasOnwayCaptchaClassifier()
}

function logOf(options: OnwayCaptchaSolveOptions): (message: string) => void {
  return options.log ?? ((message) => logger.info("[flota/onway/captcha]", { message }))
}

function challengeFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.url().includes("recaptcha") && frame.url().includes("bframe"))
}

async function checkboxFrame(page: Page): Promise<Frame | undefined> {
  for (const frame of page.frames()) {
    if (!frame.url().includes("recaptcha") || !frame.url().includes("anchor")) continue
    const present = await frame.locator("#recaptcha-anchor").count().catch(() => 0)
    if (present > 0) return frame
  }
  return page.frames().find((frame) => frame.url().includes("recaptcha") && frame.url().includes("anchor"))
}

/**
 * ¿El widget ya entregó una respuesta válida?
 *
 * **No** sirve mirar `#recaptcha-token` del `bframe`: ese input lleva el token
 * del **desafío**, no el de la respuesta, y aparece en cuanto el desafío se
 * pinta. Medido el 2026-11-25 contra la demo oficial de reCAPTCHA v2: a los
 * 681 ms de pulsar la casilla ya tenía 4302 caracteres, mientras
 * `getResponse()` seguía vacío y la casilla sin marcar. Usarlo como señal de
 * éxito hacía que el solver se declarara resuelto sin haber resuelto nada: en
 * producción devolvió `outcome: instant` a los 587 ms y Auth0 rechazó el
 * envío 45 s después (`ONWAY_INTERACTIVE_AUTH_REQUIRED`).
 *
 * Señal correcta, tomada de `hayTokenVerificado` del referente:
 *  1. `grecaptcha.getResponse()` no vacío (lo que Auth0 lee de verdad), o
 *  2. la casilla marcada en el frame `anchor`.
 */
export async function hasOnwayCaptchaToken(page: Page): Promise<boolean> {
  const fromWidget = await page
    .evaluate(() => {
      const g = (window as unknown as { grecaptcha?: { getResponse?: () => string } }).grecaptcha
      try {
        return g?.getResponse?.()?.length ?? 0
      } catch {
        // El widget puede no estar listo todavía.
        return 0
      }
    })
    .catch(() => 0)
  if (fromWidget > 20) return true

  // En el portal real el token queda además en el textarea oculto.
  const fromTextarea = await page
    .evaluate(() => {
      const el = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLInputElement | null
      return el ? el.value.length : 0
    })
    .catch(() => 0)
  if (fromTextarea > 20) return true

  return isCheckboxChecked(page)
}

/**
 * Longitud del token de desafío del `bframe`. **Sólo para diagnóstico**: no es
 * una señal de éxito (ver `hasOnwayCaptchaToken`).
 */
export async function onwayCaptchaChallengeTokenLength(page: Page): Promise<number> {
  let longest = 0
  for (const frame of page.frames()) {
    if (!frame.url().includes("recaptcha")) continue
    const length = await frame
      .locator("#recaptcha-token")
      .getAttribute("value")
      .then((value) => value?.length ?? 0)
      .catch(() => 0)
    longest = Math.max(longest, length)
  }
  return longest
}

async function isCheckboxChecked(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (!frame.url().includes("recaptcha") || !frame.url().includes("anchor")) continue
    const checked = await frame.locator("#recaptcha-anchor.recaptcha-checkbox-checked").count().catch(() => 0)
    if (checked > 0) return true
  }
  return false
}

/**
 * Detecta el bloqueo de Google por consultas automatizadas.
 *
 * En ese estado no hay captcha que resolver: es una sanción temporal y cada
 * reintento la alarga. Insistir es el error que el referente documenta.
 */
export async function isOnwayCaptchaBlocked(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (!frame.url().includes("recaptcha")) continue
    const text = await frame.evaluate(() => document.body.innerText ?? "").catch(() => "")
    if (/consultas automatizadas|no podemos procesar tu solicitud/i.test(text)) return true
  }
  return false
}

async function waitForToken(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await hasOnwayCaptchaToken(page)) return true
    await page.waitForTimeout(400).catch(() => undefined)
  }
  return false
}

/** Espera a que el panel de desafío monte la consigna, en vez de dormir un plazo fijo. */
async function waitForImagePanel(page: Page, timeoutMs = 8_000): Promise<Frame | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!frame.url().includes("recaptcha") || !frame.url().includes("bframe")) continue
      const hasPrompt = await frame
        .locator(".rc-imageselect-desc-wrapper, .rc-imageselect-desc-no-canonical, .rc-imageselect-desc")
        .count()
        .catch(() => 0)
      if (hasPrompt > 0) return frame
    }
    await page.waitForTimeout(300).catch(() => undefined)
  }
  return undefined
}

async function readPrompt(frame: Frame): Promise<string> {
  return frame
    .evaluate(() => {
      const node = document.querySelector(
        ".rc-imageselect-desc-wrapper, .rc-imageselect-desc-no-canonical, .rc-imageselect-desc",
      )
      return (node?.textContent ?? "").replace(/\s+/g, " ").trim()
    })
    .catch(() => "")
}

interface OnwayCapturedBoard {
  image: Buffer
  tiles: Array<{ col: number; row: number; grid: number }>
  /** Identidad de la imagen: los 4×4 se refrescan solos cada pocos segundos. */
  signature: string
}

/**
 * Captura el tablero.
 *
 * Google sirve **una sola imagen** y cada casilla la muestra desplazada por CSS
 * (`top`/`left` en porcentajes de −100 %, −200 %…). Descargar el `src` por
 * casilla devolvía siempre la misma imagen y el modelo puntuaba todas igual:
 * por eso se descarga una vez y se anotan los recortes.
 */
async function captureBoard(frame: Frame, context: BrowserContext): Promise<OnwayCapturedBoard | null> {
  const info = await frame
    .evaluate(() => {
      const images = [...document.querySelectorAll("#rc-imageselect-target td img")] as HTMLImageElement[]
      return {
        origin: images[0]?.src ?? "",
        cells: images.map((image) => {
          const top = Number.parseFloat(image.style.top) || 0
          const left = Number.parseFloat(image.style.left) || 0
          return { col: Math.abs(left) / 100, row: Math.abs(top) / 100 }
        }),
      }
    })
    .catch(() => null)

  if (!info || !info.origin || info.cells.length === 0) return null

  const grid = onwayCaptchaBoardGrid(info.cells)
  try {
    const response = await context.request.get(info.origin)
    if (!response.ok()) return null
    return {
      image: await response.body(),
      signature: info.origin,
      tiles: info.cells.map((cell) => ({ col: Math.round(cell.col), row: Math.round(cell.row), grid })),
    }
  } catch {
    return null
  }
}

async function boardUnchanged(frame: Frame, signature: string): Promise<boolean> {
  const current = await frame
    .evaluate(() => {
      const image = document.querySelector("#rc-imageselect-target td img") as HTMLImageElement | null
      return image?.src ?? ""
    })
    .catch(() => "")
  return current === signature
}

/** Confirma qué casillas quedaron seleccionadas de verdad: en dinámicos el click se pierde. */
async function currentSelection(frame: Frame): Promise<number[]> {
  return frame
    .evaluate(() => {
      const marked = document.querySelectorAll("#rc-imageselect-target .rc-imageselect-tileselected")
      return [...marked]
        .map((element) => Number((element.closest("td") as HTMLElement | null)?.id ?? -1))
        .filter((index) => Number.isInteger(index) && index >= 0)
    })
    .catch(() => [])
}

/** Click real de Playwright: forzar el estado por JavaScript no registra en el widget. */
async function markTiles(frame: Frame, indices: number[]): Promise<void> {
  const cells = await frame.$$("#rc-imageselect-target td")
  for (const index of indices) {
    const cell = cells[index]
    if (!cell) continue
    await cell.click({ timeout: 5_000 }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
}

/** `true` en cuanto hay token; corta en el acto si el portal rechaza. */
async function waitForImageVerdict(page: Page, panel: Frame, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await hasOnwayCaptchaToken(page)) return true
    const rejection = await panel
      .evaluate(() => {
        const selectors = [
          ".rc-imageselect-error-select-more",
          ".rc-imageselect-error-dynamic-more",
          ".rc-imageselect-incorrect-response",
        ]
        for (const selector of selectors) {
          const error = document.querySelector(selector)
          if (error && (error as HTMLElement).offsetParent !== null) {
            const text = (error.textContent ?? "").trim()
            if (text) return text
          }
        }
        return ""
      })
      .catch(() => "")
    if (rejection) return false
    await page.waitForTimeout(300).catch(() => undefined)
  }
  return false
}

/**
 * Tableros 3×3 dinámicos: al pulsar una casilla se reemplaza por otra imagen y
 * hay que seguir marcando hasta que no quede ninguna.
 */
async function resolveDynamicReplacements(
  frame: Frame,
  context: BrowserContext,
  objetivo: string,
  initial: OnwayCapturedBoard,
  pressed: number[],
  log: (message: string) => void,
): Promise<number> {
  const seen = new Set<string>([initial.signature])
  let candidates = [...pressed]
  let usedRounds = 0

  for (let round = 1; round <= ONWAY_CAPTCHA_MAX_DYNAMIC_ROUNDS && candidates.length > 0; round++) {
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    const sources = await frame
      .evaluate(() => {
        const images = [...document.querySelectorAll("#rc-imageselect-target td img")] as HTMLImageElement[]
        return images.map((image) => image.src ?? "")
      })
      .catch(() => [] as string[])
    if (sources.length !== 9) break

    const replacements: Array<{ tileIndex: number; url: string; tile: { col: number; row: number; grid: number } }> = []
    for (const index of candidates) {
      const source = sources[index] ?? ""
      if (!source || seen.has(source)) continue
      seen.add(source)
      replacements.push({ tileIndex: index, url: source, tile: { col: 0, row: 0, grid: 1 } })
    }
    if (replacements.length === 0) break

    const boards = await Promise.all(replacements.map(async (replacement) => {
      try {
        const response = await context.request.get(replacement.url)
        if (!response.ok()) return null
        return { ...replacement, image: await response.body() }
      } catch {
        return null
      }
    }))
    const usable = boards.filter((board): board is NonNullable<typeof board> => board !== null)
    if (usable.length === 0) break

    let rankings: OnwayCaptchaTileRankings | null = null
    for (const board of usable) {
      const single = await classifyOnwayCaptchaBoard({ image: board.image, tiles: [board.tile] })
      if (single) {
        rankings = [...(rankings ?? []), ...single]
      }
    }
    if (!rankings) break

    const chosen = selectOnwayCaptchaTiles(rankings, objetivo)
      .map((position) => usable[position]?.tileIndex)
      .filter((index): index is number => typeof index === "number")
    if (chosen.length === 0) break

    log(`reemplazo dinámico 3×3 (ronda ${round}): casillas ${chosen.join(", ")}`)
    await markTiles(frame, chosen)
    candidates = chosen
    usedRounds = round
  }

  return usedRounds
}

/**
 * Un intento completo sobre el tablero ya montado.
 * Devuelve `true` sólo si quedó marcado; la validación la hace quien llama.
 */
async function solveImageBoard(
  page: Page,
  context: BrowserContext,
  panel: Frame,
  log: (message: string) => void,
): Promise<{ marked: boolean; selected: number; rounds: number }> {
  const prompt = await readPrompt(panel)
  if (!prompt) {
    log("no se pudo leer la consigna del desafío de imágenes")
    return { marked: false, selected: 0, rounds: 0 }
  }

  const rawObjective = onwayCaptchaObjectiveFromPrompt(prompt)
  const objetivo = translateOnwayCaptchaObjective(rawObjective)

  // Si la traducción no devolvió una de las clases del modelo, la consigna está
  // fuera de repertorio ("barcos", "autos voladores"): insistir sólo gasta
  // intentos y degrada el perfil.
  if (!(ONWAY_CAPTCHA_CLASSES as readonly string[]).includes(objetivo) || objetivo === "Other") {
    log(`consigna «${rawObjective}» fuera de las clases del modelo; se entrega a una persona`)
    return { marked: false, selected: 0, rounds: 0 }
  }
  log(`desafío de imágenes «${rawObjective}» → ${objetivo}`)

  const board = await captureBoard(panel, context)
  if (!board) {
    log("no se pudo capturar el tablero del desafío")
    return { marked: false, selected: 0, rounds: 0 }
  }

  const rankings = await classifyOnwayCaptchaBoard({ image: board.image, tiles: board.tiles })
  if (!rankings) {
    log("el clasificador no está disponible")
    return { marked: false, selected: 0, rounds: 0 }
  }

  const indices = selectOnwayCaptchaTiles(rankings, objetivo)

  // En un tablero 4×4 vacío es mejor pedir otro desafío que enviar un tablero
  // sin marcas: reCAPTCHA lo rechaza, y el referente midió que cada rechazo
  // baja la confianza del perfil y hace más difícil el siguiente. En 3×3, en
  // cambio, «ninguna casilla» es una respuesta legítima cuando de verdad no hay
  // ningún objeto.
  if (indices.length === 0 && board.tiles.length === 16) {
    log("tablero 4×4 sin coincidencias claras; se pide uno nuevo en vez de arriesgar un rechazo")
    return { marked: false, selected: 0, rounds: 0 }
  }

  // El desafío pudo refrescarse mientras el modelo clasificaba: los índices ya
  // no valdrían y marcaríamos casillas equivocadas.
  if (!(await boardUnchanged(panel, board.signature))) {
    log("el tablero cambió durante la clasificación; se reintenta")
    return { marked: false, selected: 0, rounds: 0 }
  }

  await markTiles(panel, indices)

  const markedSelection = await currentSelection(panel)
  const missing = indices.filter((index) => !markedSelection.includes(index))
  if (missing.length > 0) {
    log(`${missing.length} casilla(s) no quedaron marcadas; se reintenta`)
    await markTiles(panel, missing)
    const afterRetry = await currentSelection(panel)
    const stillMissing = missing.filter((index) => !afterRetry.includes(index))
    if (stillMissing.length > 0) {
      log(`no se pudieron marcar las casillas ${stillMissing.join(", ")}; se recarga el desafío`)
      return { marked: false, selected: 0, rounds: 0 }
    }
  }

  let rounds = 1
  if (board.tiles.length === 9 && indices.length > 0) {
    const dynamicRounds = await resolveDynamicReplacements(panel, context, objetivo, board, indices, log)
    rounds = Math.max(rounds, dynamicRounds)
  }

  return { marked: true, selected: indices.length, rounds }
}

/**
 * Intenta resolver el reCAPTCHA de la página.
 *
 * Nunca lanza por un fallo del solver: devuelve el motivo acotado para que el
 * llamador decida entre reintentar la lectura o entregar a una persona.
 */
export async function solveOnwayCaptcha(
  page: Page,
  context: BrowserContext,
  options: OnwayCaptchaSolveOptions = {},
): Promise<OnwayCaptchaSolveResult> {
  const log = logOf(options)
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS)

  if (!hasOnwayCaptchaClassifier()) {
    return { ok: false, outcome: null, failure: "ONWAY_CAPTCHA_UNAVAILABLE", tilesSelected: 0, rounds: 0 }
  }

  const checkbox = await checkboxFrame(page)
  if (!checkbox) {
    log("el widget de reCAPTCHA no cargó en la página")
    return { ok: false, outcome: null, failure: "ONWAY_CAPTCHA_NOT_RECOGNIZED", tilesSelected: 0, rounds: 0 }
  }

  // Descartar el token de una consulta anterior: reenviado, Google rechaza la
  // validación y el portal devuelve vacío.
  await page
    .evaluate(() => {
      const element = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLInputElement | null
      if (element) element.value = ""
    })
    .catch(() => undefined)
  await page.waitForTimeout(300).catch(() => undefined)

  await checkbox.locator("#recaptcha-anchor").click({ timeout: 20_000 }).catch((error: Error) => {
    log(`no se pudo marcar la casilla: ${error.message.split("\n")[0] ?? "error"}`)
  })
  if (await waitForToken(page, 6_000)) {
    return { ok: true, outcome: "instant", failure: null, tilesSelected: 0, rounds: 0 }
  }

  let totalSelected = 0
  let totalRounds = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() >= deadline) break
    if (await isOnwayCaptchaBlocked(page)) {
      log("Google bloqueó las consultas automatizadas; hay que esperar antes de reintentar")
      return { ok: false, outcome: null, failure: "ONWAY_CAPTCHA_BLOCKED", tilesSelected: totalSelected, rounds: totalRounds }
    }

    const panel = await waitForImagePanel(page, attempt === 1 ? 8_000 : 4_000)
    if (!panel) {
      // Sin tablero el desafío no es de imágenes (audio, OTP u otro widget).
      if (await isCheckboxChecked(page)) {
        return { ok: true, outcome: "instant", failure: null, tilesSelected: totalSelected, rounds: totalRounds }
      }
      log("el desafío no es un tablero de imágenes")
      return { ok: false, outcome: null, failure: "ONWAY_CAPTCHA_NOT_RECOGNIZED", tilesSelected: totalSelected, rounds: totalRounds }
    }

    const solved = await solveImageBoard(page, context, panel, log)
    totalSelected += solved.selected
    totalRounds = Math.max(totalRounds, solved.rounds)

    if (solved.marked) {
      await panel.locator("#recaptcha-verify-button").click({ timeout: 15_000 }).catch(() => undefined)
      if (await waitForImageVerdict(page, panel, 12_000)) {
        log(`captcha resuelto por imágenes (intento ${attempt}/${maxAttempts})`)
        return { ok: true, outcome: "images", failure: null, tilesSelected: totalSelected, rounds: totalRounds }
      }
      log("el portal rechazó el tablero; se recarga el desafío")
    }

    const current = challengeFrame(page)
    await current?.locator("#recaptcha-reload-button").click({ timeout: 10_000 }).catch(() => undefined)
    await page.waitForTimeout(1_500)
  }

  if (await isOnwayCaptchaBlocked(page)) {
    return { ok: false, outcome: null, failure: "ONWAY_CAPTCHA_BLOCKED", tilesSelected: totalSelected, rounds: totalRounds }
  }
  return { ok: false, outcome: null, failure: "ONWAY_CAPTCHA_REJECTED", tilesSelected: totalSelected, rounds: totalRounds }
}
