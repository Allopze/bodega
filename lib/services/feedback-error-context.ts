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
    priority: "normal" as const,
  }
}
