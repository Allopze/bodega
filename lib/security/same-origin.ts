/**
 * M-02 (auditoría de production readiness 2026-09-28): las rutas `/api/**`
 * que mutan (subidas de evidencia, anulaciones, ejecución de solicitudes de
 * privacidad…) sólo se protegían con la cookie de sesión. Las Server Actions ya
 * traen su propia verificación de origen en Next; los route handlers no.
 *
 * Criterio, del lado seguro sin romper automatizaciones:
 *
 * - GET/HEAD/OPTIONS no se tocan: no deben mutar.
 * - `Sec-Fetch-Site: cross-site` se rechaza siempre: el navegador afirma que
 *   la petición la originó otro sitio.
 * - Un `Origin` presente tiene que ser el mismo host que atiende la petición
 *   (`Host`/`X-Forwarded-Host`) o el de `AUTH_URL`. `Origin: null` (iframe
 *   sandbox, redirección opaca) no es un origen propio.
 * - Sin `Origin` ni `Sec-Fetch-Site` (curl, scripts de operación) se deja
 *   pasar: un navegador moderno siempre manda al menos uno en una mutación, así
 *   que su ausencia no la origina una página ajena.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

export function isCrossOriginMutation(input: {
  method: string
  headers: Headers
  /** `AUTH_URL` u otro origen público configurado. */
  configuredOrigin?: string | null
}): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false
  const fetchSite = input.headers.get("sec-fetch-site")?.toLowerCase()
  if (fetchSite === "cross-site") return true

  const origin = input.headers.get("origin")
  if (origin === null) return false
  const originHost = hostOf(origin)
  if (!originHost) return true

  const allowed = new Set<string>()
  for (const header of ["host", "x-forwarded-host"]) {
    // X-Forwarded-Host puede traer una lista si hay varios proxies.
    for (const value of input.headers.get(header)?.split(",") ?? []) {
      const host = value.trim().toLowerCase()
      if (host) allowed.add(host)
    }
  }
  const configured = hostOf(input.configuredOrigin)
  if (configured) allowed.add(configured)
  return !allowed.has(originHost)
}
