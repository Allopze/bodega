import { auth } from "@/lib/auth/auth"
import { NextResponse } from "next/server"

function createCspHeader(nonce: string) {
  const isDev = process.env.NODE_ENV === "development"
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // 'unsafe-inline' en style-src es un riesgo conocido y aceptado: Tailwind v4
    // y Radix inyectan estilos inline en runtime. No afecta script-src (que sí
    // usa nonce + strict-dynamic). Revisar si se migra a estilos con nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

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
  const publicPaths = ["/login", "/registro", "/api/auth"]
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
