import { DtePortalError } from "./types"
import { DtePortalStartsPausedError } from "./operation-lease"

export interface SafeDteFailure {
  code: string
  summary: string
}

/** Maps failures to non-sensitive operational facts; raw portal errors never leave the process. */
export function classifyDteFailure(error: unknown, secrets: readonly string[] = []): SafeDteFailure {
  const message = error instanceof Error ? error.message : ""
  if (secrets.some((secret) => secret.length >= 4 && message.includes(secret))) {
    return { code: "DTE_SECRET_REDACTED", summary: "La operación DTE falló por una configuración de credenciales." }
  }
  if (error instanceof DtePortalStartsPausedError) {
    return {
      code: "DTE_PORTAL_STARTS_PAUSED",
      summary: "La sincronización DTE está pausada temporalmente por un cambio seguro de credenciales.",
    }
  }
  if (error instanceof DtePortalError) {
    const details: Record<DtePortalError["code"], SafeDteFailure> = {
      AUTH_FAILED: { code: "DTE_AUTH_FAILED", summary: "El portal DTE rechazó la autenticación." },
      NOT_FOUND: { code: "DTE_NOT_FOUND", summary: "El portal no encontró el recurso solicitado." },
      PARSE_FAILED: { code: "DTE_PARSE_FAILED", summary: "La respuesta del portal no se pudo interpretar." },
      RATE_LIMITED: { code: "DTE_RATE_LIMITED", summary: "El portal limitó temporalmente la consulta." },
      TIMEOUT: { code: "DTE_TIMEOUT", summary: "El portal DTE no respondió dentro del tiempo esperado." },
      NETWORK_ERROR: { code: "DTE_NETWORK_ERROR", summary: "No se pudo conectar al portal DTE." },
      INVALID_RESPONSE: { code: "DTE_INVALID_RESPONSE", summary: "El portal respondió un formato no esperado." },
      UNKNOWN: { code: "DTE_UNKNOWN", summary: "El portal DTE devolvió un error no clasificado." },
    }
    return details[error.code]
  }
  if (/^DTE_SETTINGS_|DTE_PORTAL_ORIGIN_/.test(message)) {
    return { code: "DTE_SETTINGS_INVALID", summary: "La configuración segura de DTE requiere revisión." }
  }
  return { code: "DTE_UNEXPECTED", summary: "La operación DTE falló de forma inesperada." }
}
