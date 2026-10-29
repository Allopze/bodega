import { getUserRbacById } from "@/lib/auth/rbac"
import { logger } from "@/lib/logger"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { authenticateDeviceToken } from "./device-credentials"
import type { MantViewer } from "./access"

/**
 * Autenticación de `/api/mantencion/sync/*`. Estas rutas están en `PUBLIC_PATHS`
 * (el proxy no exige sesión) porque la tablet compartida las llama con la
 * credencial de SU autor, no con la cookie del navegador. Por eso la ÚNICA
 * autenticación válida es `Authorization: Bearer <credencial de dispositivo>`:
 * jamás se mira la cookie (así tampoco hay CSRF) y todo lo que el proxy haría
 * por una ruta protegida se repite aquí a mano: usuario activo, permiso fresco
 * desde la base, interruptor del módulo y límite de tasa.
 */

export type SyncAuthFailureCode = "unauthorized" | "forbidden" | "rate_limited" | "error"

export interface SyncAuthFailure {
  status: 401 | 403 | 429 | 503
  code: SyncAuthFailureCode
  message: string
  retryAfterSeconds?: number
}

/** Quién envía: la persona dueña de la credencial y el dispositivo que ésta acredita (no el que declare el cuerpo). */
export interface SyncContext {
  viewer: MantViewer
  userName: string
  deviceId: string
  credentialId: string
}

export type SyncAuthResult =
  | { ok: true; context: SyncContext }
  | { ok: false; failure: SyncAuthFailure }

/** 600 llamadas por minuto y usuario: una tablet vaciando una cola larga con fotos cabe de sobra. */
const RATE_LIMIT = { maxAttempts: 600, lockMs: 60_000 } as const

const FAILURES = {
  noToken: { status: 401, code: "unauthorized", message: "Falta la credencial del dispositivo. Entra de nuevo con señal." },
  badToken: { status: 401, code: "unauthorized", message: "La credencial del dispositivo venció o fue revocada. Entra de nuevo con señal." },
  inactive: { status: 401, code: "unauthorized", message: "Tu cuenta ya no está activa. Habla con jefatura." },
  noPermission: { status: 403, code: "forbidden", message: "Tu cuenta no tiene permiso para usar la app del mecánico." },
  moduleOff: { status: 503, code: "error", message: "La mantención está inactiva temporalmente. Tus registros siguen guardados en el teléfono." },
  limited: { status: 429, code: "rate_limited", message: "Demasiados envíos seguidos. Se reintenta solo en un minuto.", retryAfterSeconds: 60 },
} as const satisfies Record<string, SyncAuthFailure>

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match?.[1] ?? null
}

export async function authenticateSyncRequest(request: Request, options: { pathname: string }): Promise<SyncAuthResult> {
  const token = bearerToken(request)
  if (!token) return { ok: false, failure: FAILURES.noToken }

  const credential = await authenticateDeviceToken(token)
  if (!credential) return { ok: false, failure: FAILURES.badToken }

  // RBAC SIEMPRE fresco (sin caché de 5 s): revocar el rol corta la sync al instante.
  const rbac = await getUserRbacById(credential.userId, true)
  if (!rbac || !rbac.isActive) return { ok: false, failure: FAILURES.inactive }
  if (!rbac.permissions.includes("mant:app:use")) return { ok: false, failure: FAILURES.noPermission }

  if (!(await isRouteOperational(options.pathname))) return { ok: false, failure: FAILURES.moduleOff }

  const limit = await consumeFixedWindowLimit(`mant-sync:${rbac.id}`, RATE_LIMIT)
  if (!limit.allowed) return { ok: false, failure: FAILURES.limited }

  return {
    ok: true,
    context: {
      userName: rbac.name,
      deviceId: credential.deviceId,
      credentialId: credential.credentialId,
      viewer: {
        userId: rbac.id,
        email: rbac.email,
        permissions: rbac.permissions,
        worksiteIds: rbac.worksiteIds,
        isGlobal: rbac.isGlobal,
      },
    },
  }
}

/** Cuerpo JSON de un fallo de autenticación, con la misma forma que `SyncRecordResponse` en error. */
export function syncFailureResponse(failure: SyncAuthFailure): Response {
  return Response.json(
    { ok: false, code: failure.code, message: failure.message },
    {
      status: failure.status,
      headers: {
        "Cache-Control": "no-store",
        ...(failure.retryAfterSeconds ? { "Retry-After": String(failure.retryAfterSeconds) } : {}),
        ...(failure.status === 401 ? { "WWW-Authenticate": 'Bearer realm="mantencion"' } : {}),
      },
    },
  )
}

/** Respuesta 500 genérica de un handler de sync: el detalle va al log, nunca al teléfono. */
export function syncErrorResponse(context: string, error: unknown): Response {
  logger.error(`[mantencion:sync:${context}]`, error)
  return Response.json(
    { ok: false, code: "error", message: "No pudimos procesar el envío. Se reintenta solo." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  )
}
