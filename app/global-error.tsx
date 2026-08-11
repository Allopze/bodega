"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"

const BODY_STYLE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  fontFamily: "system-ui, sans-serif",
  color: "var(--color-text)",
  background: "var(--color-bg)",
  margin: 0,
} as const

const PANEL_STYLE = { textAlign: "center", maxWidth: "24rem" } as const
const BUTTON_STYLE = {
  padding: "0.5rem 1.25rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-neutral-100)",
  cursor: "pointer",
  fontSize: "0.875rem",
} as const

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // A global boundary can receive errors from arbitrary server/client paths.
    // The detailed failure is captured at its server boundary with redaction;
    // never forward a potentially credential-bearing message or stack from the
    // browser to Sentry here.
    Sentry.captureMessage("CHOME_GLOBAL_ERROR", "error")
  }, [error.digest])

  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error · Chome</title>
      </head>
      <body style={BODY_STYLE}>
        <div style={PANEL_STYLE}>
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Error inesperado</p>
          <p style={{ color: "var(--color-text-muted)", marginBottom: "1.25rem", fontSize: "0.875rem" }}>
            Ocurrió un error crítico. Por favor recarga la página.
          </p>
          <button
            type="button"
            onClick={reset}
            style={BUTTON_STYLE}
          >
            Recargar
          </button>
        </div>
      </body>
    </html>
  )
}
