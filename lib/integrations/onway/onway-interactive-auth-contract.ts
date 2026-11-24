/**
 * Contrato de la verificación interactiva de OnWay.
 *
 * Auth0 puede pedir un CAPTCHA u OTP antes de devolver la sesión del portal.
 * La plataforma no resuelve el desafío: lo muestra a una persona con
 * `flota:manage_gps` y reenvía sus clics y teclas al navegador del servidor.
 *
 * Este archivo es puro a propósito: lo comparten el cliente Playwright, las
 * rutas API y el diálogo del navegador, así que no puede importar `node:*`.
 */

export const ONWAY_PORTAL_ORIGIN = "https://onway.enteldigital.cl"
export const ONWAY_AUTH_ORIGIN = "https://lw-fleet-entel-cl.us.auth0.com"

/** Una verificación abandonada no puede retener el navegador indefinidamente. */
export const ONWAY_CHALLENGE_TTL_MS = 5 * 60_000

export const ONWAY_CHALLENGE_MAX_TEXT = 200

export type OnwayChallengeStatus = "awaiting" | "solved" | "expired" | "cancelled" | "failed"

export interface OnwayChallengeViewport {
  width: number
  height: number
}

/**
 * Teclas que se reenvían al navegador. La lista es deliberadamente corta: el
 * desafío necesita escribir un código, moverse entre campos o confirmar, no
 * atajos del navegador ni combinaciones con modificadores.
 */
export const ONWAY_CHALLENGE_KEYS = [
  "Enter",
  "Tab",
  "Backspace",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Shift+Tab",
] as const

export type OnwayChallengeKey = (typeof ONWAY_CHALLENGE_KEYS)[number]

export type OnwayChallengeInput =
  | { kind: "move"; x: number; y: number }
  | { kind: "down"; x: number; y: number }
  | { kind: "up"; x: number; y: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: OnwayChallengeKey }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validViewport(viewport: OnwayChallengeViewport): boolean {
  return Number.isInteger(viewport.width) && Number.isInteger(viewport.height)
    && viewport.width > 0 && viewport.height > 0
}

/**
 * El navegador del servidor no conoce el tamaño en pantalla del cliente: la
 * vista envía coordenadas normalizadas (0..1) y aquí se convierten a píxeles
 * del viewport real de Chromium.
 */
function pointOf(value: Record<string, unknown>, viewport: OnwayChallengeViewport): { x: number; y: number } | null {
  if (typeof value.x !== "number" || typeof value.y !== "number") return null
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return {
    x: Math.min(viewport.width - 1, Math.max(0, Math.round(value.x * (viewport.width - 1)))),
    y: Math.min(viewport.height - 1, Math.max(0, Math.round(value.y * (viewport.height - 1)))),
  }
}

export function parseOnwayChallengeInput(
  input: unknown,
  viewport: OnwayChallengeViewport,
): OnwayChallengeInput | null {
  if (!isRecord(input) || !validViewport(viewport)) return null
  switch (input.kind) {
    case "move":
    case "down":
    case "up": {
      const point = pointOf(input, viewport)
      return point ? { kind: input.kind, ...point } : null
    }
    case "text": {
      if (typeof input.text !== "string") return null
      const text = input.text
      if (text.length === 0 || text.length > ONWAY_CHALLENGE_MAX_TEXT) return null
      // Los caracteres de control no aportan a un código y sí permiten colar
      // secuencias raras en la página; Enter/Backspace viajan como `key`.
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return null
      return { kind: "text", text }
    }
    case "key": {
      if (typeof input.key !== "string") return null
      if (!(ONWAY_CHALLENGE_KEYS as readonly string[]).includes(input.key)) return null
      return { kind: "key", key: input.key as OnwayChallengeKey }
    }
    default:
      return null
  }
}

/** La app de seguimiento: la única ruta que no existe sin sesión válida. */
export function isOnwayTrackingPage(input: string): boolean {
  try {
    const url = new URL(input)
    return url.origin === ONWAY_PORTAL_ORIGIN
      && url.pathname.toLocaleLowerCase("en-US").startsWith("/onlinetracking")
  } catch {
    return false
  }
}

/**
 * Señal **fuerte** de sesión establecida: el portal está en la app de
 * seguimiento. Es la que se exige para persistir un snapshot o dar la
 * verificación por resuelta.
 *
 * Antes bastaba «cualquier ruta del portal salvo /home/login», y eso declaraba
 * resuelta la verificación en cuanto Auth0 devolvía a la portada pública:
 * medido el 2026-11-24, una navegación sin sesión aterriza en
 * `/Home/Index/en` con `#smalAuth0ActionLogin` **visible**. La vista decía
 * «Verificación completada. Actualizando…», la sincronización salía sin sesión,
 * Auth0 volvía a pedir el CAPTCHA y a los 45 s la persona veía «OnWay no
 * respondió en el tiempo» — el síntoma reportado como «luego de resolver el
 * captcha, al minuto dice que no resolvió».
 *
 * `/Home/...` queda deliberadamente fuera: es la portada, no prueba sesión. Para
 * ese caso ambiguo el cliente mira el botón de entrada (`isOnwaySessionEstablished`
 * en `onway-client.ts`), que es la señal funcional que sí lo distingue.
 */
export function isOnwayChallengeSolvedUrl(input: string): boolean {
  return isOnwayTrackingPage(input)
}

/**
 * Mientras una persona resuelve el desafío, el marco principal sólo puede
 * navegar entre el portal y el tenant exacto de Auth0. Los iframes del CAPTCHA
 * y sus CDN no pasan por esta regla: bloquearlos dejaría el desafío en blanco.
 */
export function isAllowedOnwayChallengeNavigation(input: string): boolean {
  if (input === "about:blank") return true
  try {
    const origin = new URL(input).origin
    return origin === ONWAY_PORTAL_ORIGIN || origin === ONWAY_AUTH_ORIGIN
  } catch {
    return false
  }
}

export function onwayChallengeRemainingMs(
  expiresAt: number,
  status: OnwayChallengeStatus,
  now: number = Date.now(),
): number {
  return status === "awaiting" ? Math.max(0, expiresAt - now) : 0
}
