/**
 * SOP-001 (auditoría 2026-09-14) — con qué prioridad entra una caída de la
 * aplicación.
 *
 * Este reporte lo arma el límite de error del cliente: se ofrece cuando una
 * pantalla se cae. Entraba con `priority: "normal"` fijo, y esa prioridad
 * gobierna el SLA (`computeDueAt` en `lib/services/feedback.ts`): cinco días,
 * los mismos que una sugerencia de mejora. El único canal que reporta fallas
 * reales de la plataforma partía su contador con el plazo de una consulta.
 *
 * Se sube a `alta` (48 h). No a `critica` (24 h), que queda para lo que
 * declara una persona: la caída de una pantalla no distingue por sí sola entre
 * un módulo entero abajo y un caso borde de una vista. Quien triagea puede
 * subirla o bajarla; lo que ya no hace es nacer con el plazo más largo de la
 * escala.
 *
 * Es un **valor por defecto pendiente de confirmación** por quien opera
 * Soporte: no hay política escrita que diga qué prioridad merece una caída.
 * Está aquí, con nombre, para que cambiarlo sea una línea.
 */
export const BOUNDARY_ERROR_PRIORITY = "alta" as const

interface BoundaryErrorReportInput {
  description: string
  pathname: string
  errorDigest?: string
}

function safePathname(pathname: string): string {
  const route = pathname.split(/[?#]/, 1)[0]?.trim() ?? ""
  if (!route.startsWith("/") || route.startsWith("//")) return "/"
  return route || "/"
}

/**
 * Builds the context sent by a client error boundary without copying the
 * original error message or URL query parameters into the support ticket.
 */
export function buildBoundaryErrorReport(input: BoundaryErrorReportInput) {
  const pathname = safePathname(input.pathname)
  const digest = input.errorDigest?.trim().slice(0, 200)
  const description = input.description.trim()

  return {
    tipo: "bug" as const,
    titulo: `Error en ${pathname}`.slice(0, 160),
    descripcion: [
      description,
      digest ? `Código de error: ${digest}` : null,
      `Ruta: ${pathname}`,
    ].filter((part): part is string => Boolean(part)).join("\n\n").slice(0, 4000),
    pagina: pathname,
    priority: BOUNDARY_ERROR_PRIORITY,
  }
}
