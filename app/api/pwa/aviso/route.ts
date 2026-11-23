/**
 * POST /api/pwa/aviso — el aviso de estado que mandan las apps del teléfono
 * (PPA Digital, Mantención y Control TAE) al abrirse y tras cada envío.
 *
 * Es pública y vive en su propio prefijo, fuera de `/api/apps/*` (las rutas
 * autenticadas del lanzador), para que se vea en la ruta que no pide sesión.
 * Por eso: cuota por IP antes de leer nada, cuerpo acotado a 4 KB, esquema
 * estricto y cuota por teléfono. Todas las respuestas van sin cuerpo:
 * 204 guardado (o módulo apagado), 400 inválido, 413 demasiado grande,
 * 429 sobre la cuota. El cliente se traga cualquier error y no reintenta.
 */
import { pwaHeartbeatSchema, HEARTBEAT_LIMITS } from "@/lib/pwa/heartbeat-contract"
import { logger } from "@/lib/logger"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { recordPwaHeartbeat } from "@/lib/services/pwa-heartbeat"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const WINDOW_MS = 5 * 60 * 1000
const PER_IP = 600
const PER_DEVICE = 20

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

export async function POST(request: Request) {
  try {
    const ip = resolveTrustedClientIp(request.headers)
    const byIp = await consumeFixedWindowLimit(`pwa-aviso-ip:${ip}`, { maxAttempts: PER_IP, lockMs: WINDOW_MS })
    if (!byIp.allowed) return empty(429)

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
    logger.error("[pwa:aviso] No se pudo registrar el aviso", error)
    return empty(500)
  }
}
