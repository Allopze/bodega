/**
 * POST /api/pwa/aviso — el aviso de estado que mandan las apps del teléfono
 * (PPA Digital, Mantención y Control TAE) al abrirse y tras cada envío.
 *
 * Es pública y vive en su propio prefijo, fuera de `/api/apps/*` (las rutas
 * autenticadas del lanzador), para que se vea en la ruta que no pide sesión.
 * Por eso cada paso va del más barato al más caro y antes de escribir nada:
 * cuota por IP → `Content-Type: application/json` (un `fetch` `no-cors` de otro
 * sitio sólo puede mandar `text/plain`) → rechazo de peticiones de otro sitio →
 * cuerpo acotado a 4 KB → JSON y esquema estricto → cuota de teléfonos nuevos
 * por IP → cuota por teléfono. Todas las respuestas van sin cuerpo:
 * 204 guardado (o módulo apagado), 400 inválido, 403 de otro sitio, 413 demasiado
 * grande, 415 tipo de contenido, 429 sobre la cuota. El cliente se traga
 * cualquier error y no reintenta.
 *
 * Un dato que Postgres rechaza (SQLSTATE clase 22: fecha fuera de rango, byte
 * nulo…) es un 400 del llamador, no un fallo nuestro: se registra como aviso y
 * sin el `Error`, para que no genere un evento de Sentry por petición.
 */
import { pwaHeartbeatSchema, HEARTBEAT_LIMITS } from "@/lib/pwa/heartbeat-contract"
import { logger } from "@/lib/logger"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { isCrossOriginMutation } from "@/lib/security/same-origin"
import { isKnownPwaDevice, recordPwaHeartbeat } from "@/lib/services/pwa-heartbeat"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const WINDOW_MS = 5 * 60 * 1000
const PER_IP = 600
const PER_DEVICE = 20
/** Teléfonos nuevos por IP y hora: cada uno crea una fila, y el UUID lo inventa quien llama. */
const NEW_DEVICES_PER_IP = 60
const NEW_DEVICES_WINDOW_MS = 60 * 60 * 1000

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } })

/** Lee el cuerpo sin pasar de `max` bytes (no confía en `Content-Length`). `null` si lo supera. */
async function readBoundedText(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > max) return null
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * ¿Error de datos de Postgres (SQLSTATE clase 22)? Drizzle envuelve el error del
 * driver y deja el original en `cause`, así que se mira la cadena.
 */
function postgresDataErrorCode(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === "string" && code.startsWith("22")) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

export async function POST(request: Request) {
  try {
    const ip = resolveTrustedClientIp(request.headers)
    const byIp = await consumeFixedWindowLimit(`pwa-aviso-ip:${ip}`, { maxAttempts: PER_IP, lockMs: WINDOW_MS })
    if (!byIp.allowed) return empty(429)

    if (!request.headers.get("content-type")?.trim().toLowerCase().startsWith("application/json")) return empty(415)

    if (isCrossOriginMutation({
      method: request.method,
      headers: request.headers,
      configuredOrigin: process.env.AUTH_URL ?? process.env.APP_URL ?? null,
    })) return empty(403)

    const text = await readBoundedText(request, HEARTBEAT_LIMITS.maxBodyBytes)
    if (text === null) return empty(413)

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return empty(400)
    }
    const parsed = pwaHeartbeatSchema.safeParse(json)
    if (!parsed.success) return empty(400)
    const heartbeat = parsed.data

    // Un teléfono que aún no existe crea una fila: se acota por IP (y hora) para que
    // nadie llene la tabla inventando UUID. Los ya conocidos sólo pagan la cuota por teléfono.
    if (!await isKnownPwaDevice(heartbeat.app, heartbeat.deviceId)) {
      const byNewDevice = await consumeFixedWindowLimit(
        `pwa-aviso-new:${ip}`,
        { maxAttempts: NEW_DEVICES_PER_IP, lockMs: NEW_DEVICES_WINDOW_MS },
      )
      if (!byNewDevice.allowed) return empty(429)
    }

    const byDevice = await consumeFixedWindowLimit(
      `pwa-aviso-dev:${heartbeat.app}:${heartbeat.deviceId}`,
      { maxAttempts: PER_DEVICE, lockMs: WINDOW_MS },
    )
    if (!byDevice.allowed) return empty(429)

    const authorization = request.headers.get("authorization")
    const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null
    await recordPwaHeartbeat(heartbeat, { bearer })
    return empty(204)
  } catch (error) {
    const dataErrorCode = postgresDataErrorCode(error)
    if (dataErrorCode) {
      // Sin el `Error`: lo manda a Sentry y esto lo provoca cualquiera con un POST.
      logger.warn(`[pwa:aviso] Aviso con un dato que la base rechaza (SQLSTATE ${dataErrorCode})`)
      return empty(400)
    }
    logger.error("[pwa:aviso] No se pudo registrar el aviso", error)
    return empty(500)
  }
}
