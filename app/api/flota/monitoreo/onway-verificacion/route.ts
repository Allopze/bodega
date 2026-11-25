import { NextResponse } from "next/server"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import {
  OnwayChallengeError,
  OnwayClientError,
  startOnwayInteractiveAuthentication,
  type OnwayChallengeErrorCode,
  type OnwayClientErrorCode,
} from "@/lib/integrations/onway/onway-client"
import { readOnwayConfig } from "@/lib/integrations/onway/onway-settings"
import { logger } from "@/lib/logger"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Abrir Auth0 y esperar el desafío puede tardar; no llega al tope de 110 s del cliente.
export const maxDuration = 120

const NO_STORE = { "cache-control": "no-store" }

const CHALLENGE_MESSAGE: Partial<Record<OnwayChallengeErrorCode, { status: number; message: string }>> = {
  ONWAY_CHALLENGE_BUSY: { status: 409, message: "Hay una sincronización de OnWay en curso. Espera a que termine y vuelve a intentarlo." },
  ONWAY_CHALLENGE_ACTIVE: { status: 409, message: "Otra persona está resolviendo la verificación de OnWay. Pídele que termine o espera unos minutos." },
  ONWAY_CHALLENGE_NOT_FOUND: { status: 404, message: "La verificación ya no está disponible. Vuelve a abrirla." },
  ONWAY_CHALLENGE_FORBIDDEN: { status: 403, message: "No tienes acceso a esta verificación." },
  ONWAY_CHALLENGE_EXPIRED: { status: 410, message: "La verificación expiró. Vuelve a abrirla." },
  ONWAY_CHALLENGE_CLOSED: { status: 410, message: "La verificación se cerró. Vuelve a abrirla." },
  ONWAY_CHALLENGE_SOLVED: { status: 409, message: "La verificación ya se completó." },
  ONWAY_CHALLENGE_FRAME_UNAVAILABLE: { status: 503, message: "La imagen de la verificación no está disponible todavía." },
  ONWAY_CHALLENGE_INPUT_INVALID: { status: 400, message: "La interacción con la verificación no es válida." },
}

const CLIENT_MESSAGE: Partial<Record<OnwayClientErrorCode, { status: number; message: string }>> = {
  ONWAY_CREDENTIALS_REQUIRED: { status: 409, message: "Configura las credenciales de OnWay antes de verificar." },
  ONWAY_CREDENTIALS_INVALID: { status: 422, message: "Las credenciales configuradas no son válidas." },
  ONWAY_AUTH_REJECTED: { status: 409, message: "OnWay rechazó el usuario o la contraseña." },
  ONWAY_INTERACTIVE_AUTH_REQUIRED: { status: 409, message: "OnWay volvió a pedir la verificación antes de mostrarla. Inténtalo de nuevo." },
  ONWAY_PORTAL_TIMEOUT: { status: 504, message: "OnWay no respondió dentro del tiempo esperado." },
  ONWAY_RESPONSE_INVALID: { status: 502, message: "OnWay respondió con un formato no reconocido." },
  ONWAY_SNAPSHOT_EMPTY: { status: 502, message: "OnWay aceptó la cuenta pero no devolvió equipos." },
  ONWAY_SYNC_FAILED: { status: 502, message: "No se pudo abrir la verificación de OnWay." },
  ONWAY_CAPTCHA_UNAVAILABLE: { status: 503, message: "El solver automático no está instalado. Resuelve la verificación a mano." },
  ONWAY_CAPTCHA_NOT_RECOGNIZED: { status: 409, message: "OnWay pidió un desafío que el solver no reconoce. Resuélvelo a mano." },
  ONWAY_CAPTCHA_REJECTED: { status: 409, message: "El portal rechazó la resolución automática. Resuelve la verificación a mano." },
  ONWAY_CAPTCHA_BLOCKED: { status: 429, message: "Google bloqueó las consultas automatizadas desde este equipo. Espera unas horas antes de reintentar." },
}

/**
 * POST /api/flota/monitoreo/onway-verificacion
 *
 * Abre el navegador del scraper contra Auth0 y, si el portal pide un desafío,
 * devuelve el id de una vista de un solo uso para que una persona lo resuelva.
 * El cron y el refresco en vivo quedan bloqueados mientras esa vista exista.
 */
export async function POST() {
  let session
  try {
    session = await requirePermission("flota:manage_gps")
  } catch {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", message: "Sin permisos para verificar el acceso a OnWay." },
      { status: 403, headers: NO_STORE },
    )
  }

  // Abrir un navegador es caro: tres intentos cada diez minutos alcanzan para
  // reintentar un error real sin convertir el botón en un multiplicador de IP.
  const quota = await consumeFixedWindowLimit(`onway-interactive-auth:${session.user.id}`, {
    maxAttempts: 3,
    lockMs: 10 * 60_000,
  }).catch(() => ({ allowed: true, remaining: 3 }))
  if (!quota.allowed) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", message: "Abriste la verificación demasiadas veces. Espera unos minutos." },
      { status: 429, headers: NO_STORE },
    )
  }

  const config = await readOnwayConfig()
  if (!config.hasCredentials) {
    return NextResponse.json(
      { ok: false, code: "ONWAY_CREDENTIALS_REQUIRED", message: "Configura las credenciales de OnWay antes de verificar." },
      { status: 409, headers: NO_STORE },
    )
  }

  try {
    const result = await startOnwayInteractiveAuthentication(
      { username: config.username, password: config.password },
      session.user.id,
    )
    if (result.status === "authenticated") {
      return NextResponse.json({ ok: true, status: "authenticated" }, { headers: NO_STORE })
    }

    // La vista muestra un navegador autenticado: queda registrado quién la abrió.
    // La auditoría no debe retrasar la apertura; su fallo se registra aparte.
    void recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "login",
      entityType: "fleet_onway_interactive_auth",
      entityId: result.challenge.id,
      newState: { outcome: "opened" },
    }).catch((error: unknown) => {
      logger.error("[flota/onway/verificacion] no se pudo auditar la apertura", error)
    })

    return NextResponse.json(
      { ok: true, ...result.challenge },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof OnwayChallengeError) {
      const mapped = CHALLENGE_MESSAGE[error.code] ?? { status: 500, message: "No se pudo abrir la verificación de OnWay." }
      logger.warn("[flota/onway/verificacion]", { code: error.code })
      return NextResponse.json(
        { ok: false, code: error.code, message: mapped.message },
        { status: mapped.status, headers: NO_STORE },
      )
    }
    if (error instanceof OnwayClientError) {
      const mapped = CLIENT_MESSAGE[error.code] ?? { status: 502, message: "No se pudo abrir la verificación de OnWay." }
      logger.error("[flota/onway/verificacion]", { code: error.code })
      return NextResponse.json(
        { ok: false, code: error.code, message: mapped.message },
        { status: mapped.status, headers: NO_STORE },
      )
    }
    logger.error("[flota/onway/verificacion]", { code: "UNKNOWN" })
    return NextResponse.json(
      { ok: false, code: "ONWAY_VERIFICATION_FAILED", message: "No se pudo abrir la verificación de OnWay." },
      { status: 502, headers: NO_STORE },
    )
  }
}
