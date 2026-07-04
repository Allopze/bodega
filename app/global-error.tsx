"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error — Chome</title>
      </head>
      <body style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
        color: "var(--color-text)",
        background: "var(--color-bg)",
        margin: 0,
      }}>
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Error inesperado</p>
          <p style={{ color: "var(--color-text-muted)", marginBottom: "1.25rem", fontSize: "0.875rem" }}>
            Ocurrió un error crítico. Por favor recarga la página.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-neutral-100)",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Recargar
          </button>
        </div>
      </body>
    </html>
  )
}
