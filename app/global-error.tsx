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
      <body style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
        color: "oklch(0.218 0.006 100)",
        background: "oklch(0.974 0.005 155)",
        margin: 0,
      }}>
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Error inesperado</p>
          <p style={{ color: "oklch(0.421 0.010 155)", marginBottom: "1.25rem", fontSize: "0.875rem" }}>
            Ocurrió un error crítico. Por favor recarga la página.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.375rem",
              border: "1px solid oklch(0.882 0.008 155)",
              background: "oklch(0.962 0.007 155)",
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
