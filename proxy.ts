import { auth } from "@/lib/auth/auth"
import { NextResponse } from "next/server"
import { createCspHeader } from "@/lib/security/csp"
import { getNavigationToggleState, MODULE_TOGGLE_RECOVERY_PATH, resolveModuleRoute, routeIsEnabled } from "@/lib/services/module-toggles"
import { verifyCronSecret } from "@/lib/security/cron-auth"

function withSecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp)
  return response
}

function matchesRoutePrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = createCspHeader(nonce)
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-nonce", nonce)
  // Cabecera interna upstream: permite que layouts y Server Actions apliquen
  // el toggle de la ruta exacta sin confiar en un valor enviado por el cliente.
  requestHeaders.set("x-chome-pathname", pathname)
  requestHeaders.set("Content-Security-Policy", csp)

  // Public paths — no auth required
  // NOTE: "/ppa" es el formulario público del trabajador (sin login). El panel
  // autenticado vive en "/prevencion/ppa" y NO calza con este prefijo.
  // NOTE: "/tae" es la PWA pública de carga TAE (sin login, acceso por QR/token).
  // El panel autenticado vive en "/combustibles/tae" y NO calza con este prefijo.
  // Las rutas API públicas del formulario se listan explícitas (no "/api/tae"
  // completo) para que "/api/tae/evidence/[id]" —lectura privada de fotos—
  // siga exigiendo sesión también a nivel de proxy, no solo dentro del handler.
  // NOTE: "/api/cron" es público *para este proxy*, no para el mundo: cada una
  // de las rutas bajo ese prefijo empieza verificando CRON_SECRET con
  // comparación en tiempo constante (lib/security/cron-auth.ts) y responde 401
  // sin él. Sin esta línea el proxy las redirige al login con un 307 antes de
  // que el handler corra, y como un 307 no es error para `curl --fail` ni para
  // `wget` con redirecciones, los schedulers reportaban éxito sin ejecutar
  // nada. Al agregar una ruta nueva bajo /api/cron, verificar el secreto es
  // obligatorio: acá ya no hay sesión que la proteja.
  // NOTE: se lista "/api/backups/config" y NO "/api/backups". El cotejo es por
  // prefijo, así que el prefijo corto habría abierto también `/status` y
  // `/drive-health`, que se protegen por sesión y permiso. Sólo `config` se
  // autentica con CRON_SECRET —la consume el backup-scheduler—, así que sólo
  // ella puede prescindir de la sesión.
  const publicPaths = [
    "/login", "/registro", "/recuperar", "/api/auth", "/api/health",
    "/api/cron",
    "/api/backups/config",
    "/ppa",
    "/tae", "/api/tae/access", "/api/tae/submit", "/api/tae/identity",
  ]
  if (publicPaths.some((prefix) => matchesRoutePrefix(pathname, prefix))) {
    // Redirect authenticated users away from login
    if (isLoggedIn && (pathname === "/login" || pathname === "/registro")) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", req.url)), csp)
    }
    // Los jobs son públicos sólo para que alcancen su verificador de secreto.
    // Consultar el toggle antes del secreto convertiría el 401 uniforme en un
    // oráculo de configuración; con secreto válido sí se bloquea centralmente.
    const isSecretProtectedAutomation = pathname.startsWith("/api/cron/") || pathname === "/api/backups/config"
    if (isSecretProtectedAutomation) {
      const secret = process.env.CRON_SECRET
      const secretIsValid = !!secret && verifyCronSecret(req.headers.get("authorization"), secret)
      if (secretIsValid && resolveModuleRoute(pathname)) {
        try {
          const state = await getNavigationToggleState()
          if (!routeIsEnabled(pathname, state)) {
            return withSecurityHeaders(NextResponse.json({ error: "Módulo inactivo" }, { status: 503 }), csp)
          }
        } catch {
          return withSecurityHeaders(NextResponse.json({ error: "No se pudo verificar el estado del módulo" }, { status: 503 }), csp)
        }
      }
    }
    return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp)
  }

  // All other paths require authentication
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return withSecurityHeaders(NextResponse.redirect(loginUrl), csp)
  }

  // Punto único de aplicación para TODO lo autenticado, páginas incluidas.
  //
  // No basta con hacerlo en app/(app)/layout.tsx: Next no vuelve a ejecutar un
  // layout compartido en una navegación RSC parcial, así que quien ya está
  // dentro de la app podía abrir la página de un módulo apagado sin recargar.
  // Tampoco basta con `/api/*`: los grupos (print) y (public) tienen su propio
  // layout. El proxy sí corre en cada request, incluidas las de RSC y las
  // Server Actions. Crons y APIs públicas se guardan dentro de cada handler,
  // después de su secreto/token.
  const recoveryDoor = matchesRoutePrefix(pathname, MODULE_TOGGLE_RECOVERY_PATH)
  if (!recoveryDoor && resolveModuleRoute(pathname)) {
    const isApi = pathname.startsWith("/api/")
    try {
      const state = await getNavigationToggleState()
      if (!routeIsEnabled(pathname, state)) {
        return withSecurityHeaders(isApi
          ? NextResponse.json({ error: "Módulo inactivo" }, { status: 503 })
          : NextResponse.redirect(new URL(`/modulo-inactivo?desde=${encodeURIComponent(pathname)}`, req.url)), csp)
      }
    } catch {
      // Fail-closed, pero recuperable: la puerta de recuperación quedó exenta
      // arriba, así que un fallo de lectura no deja la plataforma sin salida.
      return withSecurityHeaders(isApi
        ? NextResponse.json({ error: "No se pudo verificar el estado del módulo" }, { status: 503 })
        : NextResponse.redirect(new URL("/modulo-inactivo?estado=desconocido", req.url)), csp)
    }
  }

  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp)
})

export const config = {
  matcher: [
    // Las descargas API pueden terminar en `.pdf`/`.jpg`; deben atravesar el
    // proxy aunque el matcher general excluya archivos estáticos.
    "/api/:path*",
    /*
     * Match all request paths except:
     * - _next internals (static files, image optimization, HMR)
     * - favicon.ico
     * - public folder files
     */
    "/((?!_next|favicon.ico|.*\\..*).*)",
  ],
}
