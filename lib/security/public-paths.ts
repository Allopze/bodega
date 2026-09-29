/**
 * Rutas que el proxy deja pasar sin sesión. Vive fuera de `proxy.ts` para que
 * la lista se pueda probar sin levantar Auth.js.
 *
 * NOTE: se lista "/api/backups/config" y NO "/api/backups". El cotejo es por
 * prefijo, así que el prefijo corto habría abierto también `/status` y
 * `/drive-health`, que se protegen por sesión y permiso. Sólo `config` se
 * autentica con CRON_SECRET —la consume el backup-scheduler—, así que sólo
 * ella puede prescindir de la sesión.
 */
export const PUBLIC_PATHS = [
  "/login", "/registro", "/recuperar", "/api/auth", "/api/health",
  "/api/cron",
  "/api/backups/config",
  "/ppa",
  "/tae", "/api/tae/access", "/api/tae/submit", "/api/tae/identity",
  // CAP-002/PER-002: "/acuse" es la vía de acuse sin cuenta (capacitación y
  // AST de permiso). La credencial es el token HMAC de la propia URL, que el
  // servicio verifica; el panel autenticado sigue viviendo bajo /prevencion.
  "/acuse",
  // PRV-15 (auditoría 2026-09-28): el canal público de reporte de incidentes
  // (INC-001) se diseñó sin sesión, con cuota por IP, para que un trabajador
  // sin cuenta pueda reportar un cuasi accidente. Faltaba aquí y el proxy lo
  // mandaba al login.
  "/reportar-incidente",
] as const

export function matchesRoutePrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((prefix) => matchesRoutePrefix(pathname, prefix))
}
