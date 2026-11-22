/**
 * lib/pwa/heartbeat.ts — El aviso que cada app del teléfono manda a
 * `POST /api/pwa/aviso`: qué versión corre, si está instalada y cuánto trabajo
 * tiene sin enviar. Con eso TI › Apps ve si las apps funcionan.
 *
 * Reglas que no se negocian:
 * - **Nunca estorba.** Va en segundo plano (`keepalive`), no muestra nada, no se
 *   reintenta y se traga cualquier error: un aviso perdido no cambia nada, el
 *   próximo lo repone.
 * - **No viaja nada del trabajador** (nombre, RUT, empresa) ni el token de TAE en
 *   claro: del token sale sólo su SHA-256, que es lo que guarda el servidor.
 * - **Freno.** Al abrir la app se manda siempre (`force`). Después, sólo si
 *   pasaron 5 minutos desde el último o si cambió `pending` o `failed`: el motor
 *   del mecánico intenta cada 60 s y no puede producir un aviso por intento.
 *   Sin red no se manda.
 *
 * El tipo `PwaHeartbeat` se importa con `import type`: el esquema de zod vive en
 * `heartbeat-contract.ts` y no debe entrar al bundle de las apps.
 */
import type { FieldAppId } from "@/lib/apps/field-apps"
import { BUILD_ID, BUILD_TIME } from "@/lib/build-info"
import { deviceLabel, isStandalone } from "@/lib/pwa/environment"
import type { PwaHeartbeat } from "@/lib/pwa/heartbeat-contract"

/** Estado de la cola local de una app, ya reducido a lo que viaja. */
export interface QueueSnapshot {
  pending: number
  failed: number
  oldestPendingAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
}

export interface HeartbeatContext {
  /** Credencial del mecánico: el servidor asocia el teléfono a la persona. */
  bearer?: string
  /** Sólo PPA: la faena del último envío. */
  worksiteId?: string
  /** Sólo TAE: el token de acceso en claro; se hashea acá y nunca viaja. */
  linkToken?: string
}

export const HEARTBEAT_MIN_INTERVAL_MS = 300_000

const ENDPOINT = "/api/pwa/aviso"
const DEVICE_KEY_PREFIX = "chome:pwa-device:"
// Mismos topes que `HEARTBEAT_LIMITS`; se repiten para no importar zod.
const MAX_COUNT = 10_000
const MAX_ERROR_CHARS = 200
const MAX_VERSION_CHARS = 40
const MAX_PLATFORM_CHARS = 60
const MAX_WORKSITE_CHARS = 64

interface LastSend { at: number; pending: number; failed: number }
const lastSends = new Map<FieldAppId, LastSend>()
const sessionDeviceIds = new Map<string, string>()

/** Sólo para tests. */
export function __resetHeartbeatThrottle(): void {
  lastSends.clear()
  sessionDeviceIds.clear()
}

/** UUID v4; `randomUUID` sólo existe en contexto seguro, `getRandomValues` en todos. */
function newUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Identificador de este teléfono para PPA o TAE (Mantención usa el suyo, en
 * IndexedDB). Si el navegador no deja guardarlo (modo privado), vale uno por
 * sesión: mejor un teléfono contado de más que ningún aviso.
 */
export function getOrCreateDeviceId(app: "ppa" | "tae"): string {
  const key = DEVICE_KEY_PREFIX + app
  try {
    const stored = localStorage.getItem(key)
    if (stored) return stored
    const created = newUuid()
    localStorage.setItem(key, created)
    return created
  } catch {
    let session = sessionDeviceIds.get(key)
    if (!session) {
      session = newUuid()
      sessionDeviceIds.set(key, session)
    }
    return session
  }
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(MAX_COUNT, Math.max(0, Math.trunc(value)))
}

/** Fecha ISO normalizada, o null si no es una fecha. */
function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

async function sha256Hex(text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  } catch {
    // Contexto sin Web Crypto: el aviso sale sin enlace, no se cancela.
    return null
  }
}

/**
 * Manda el aviso. Devuelve `true` si salió el `fetch` (no si el servidor lo
 * aceptó: eso no le importa a nadie en el teléfono).
 */
export async function sendHeartbeat(
  app: FieldAppId,
  deviceId: string,
  snapshot: QueueSnapshot,
  ctx: HeartbeatContext = {},
  opts: { force?: boolean; now?: number } = {},
): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false
    const now = opts.now ?? Date.now()
    const pending = clampCount(snapshot.pending)
    const failed = clampCount(snapshot.failed)

    const last = lastSends.get(app)
    const due = opts.force === true
      || !last
      || now - last.at >= HEARTBEAT_MIN_INTERVAL_MS
      || last.pending !== pending
      || last.failed !== failed
    if (!due) return false
    // Se anota ANTES de esperar el hash: dos llamadas seguidas no pueden salir ambas.
    lastSends.set(app, { at: now, pending, failed })

    const body: PwaHeartbeat = {
      app,
      deviceId,
      version: (BUILD_ID || "dev").slice(0, MAX_VERSION_CHARS),
      builtAt: isoOrNull(BUILD_TIME),
      installed: isStandalone(),
      platform: deviceLabel().slice(0, MAX_PLATFORM_CHARS),
      pending,
      failed,
      oldestPendingAt: isoOrNull(snapshot.oldestPendingAt),
      lastAttemptAt: isoOrNull(snapshot.lastAttemptAt),
      lastError: snapshot.lastError ? snapshot.lastError.slice(0, MAX_ERROR_CHARS) : null,
    }
    if (ctx.worksiteId) body.worksiteId = ctx.worksiteId.slice(0, MAX_WORKSITE_CHARS)
    if (ctx.linkToken) {
      const linkHash = await sha256Hex(ctx.linkToken)
      if (linkHash) body.linkHash = linkHash
    }

    const headers: Record<string, string> = { "content-type": "application/json" }
    if (ctx.bearer) headers.authorization = `Bearer ${ctx.bearer}`
    // Un fallo de red o un rechazo del servidor no cambian nada en el teléfono.
    await fetch(ENDPOINT, { method: "POST", keepalive: true, headers, body: JSON.stringify(body) }).catch(() => {})
    return true
  } catch {
    return false
  }
}
