import { auth } from "@/lib/auth/auth"
import { NextResponse } from "next/server"
import { createCspHeader } from "@/lib/security/csp"

function withSecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp)
  return response
}

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = createCspHeader(nonce)
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)

  // Public paths — no auth required
  // NOTE: "/ppa" es el formulario público del trabajador (sin login). El panel
  // autenticado vive en "/prevencion/ppa" y NO calza con este prefijo.
  // NOTE: "/tae" es la PWA pública de carga TAE (sin login, acceso por QR/token).
  // El panel autenticado vive en "/combustibles/tae" y NO calza con este prefijo.
  // Las rutas API públicas del formulario se listan explícitas (no "/api/tae"
  // completo) para que "/api/tae/evidence/[id]" —lectura privada de fotos—
  // siga exigiendo sesión también a nivel de proxy, no solo dentro del handler.
  const publicPaths = [
    "/login", "/registro", "/recuperar", "/api/auth", "/api/health",
    "/ppa",
    "/tae", "/api/tae/access", "/api/tae/submit", "/api/tae/identity",
  ]
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    // Redirect authenticated users away from login
    if (isLoggedIn && (pathname === "/login" || pathname === "/registro")) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", req.url)), csp)
    }
    return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp)
  }

  // All other paths require authentication
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return withSecurityHeaders(NextResponse.redirect(loginUrl), csp)
  }

  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp)
})

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next internals (static files, image optimization, HMR)
     * - favicon.ico
     * - public folder files
     */
    "/((?!_next|favicon.ico|.*\\..*).*)",
  ],
}
