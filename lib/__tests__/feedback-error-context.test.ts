import { describe, expect, it } from "vitest"
import { buildBoundaryErrorReport } from "@/lib/services/feedback-error-context"

describe("buildBoundaryErrorReport", () => {
  it("preserves a safe route and digest without retaining the original error message", () => {
    const reportInput = {
      description: "  Al confirmar la recepción, la pantalla dejó de responder.  ",
      pathname: "/recepcion?oc=OC-2026-0007#detalle",
      errorDigest: "digest-abc123",
      message: "password=super-secret database connection refused",
    }
    const report = buildBoundaryErrorReport(reportInput)

    expect(report).toEqual({
      tipo: "bug",
      titulo: "Error en /recepcion",
      descripcion: "Al confirmar la recepción, la pantalla dejó de responder.\n\nCódigo de error: digest-abc123\n\nRuta: /recepcion",
      pagina: "/recepcion",
      priority: "normal",
    })
    expect(JSON.stringify(report)).not.toContain("super-secret")
    expect(JSON.stringify(report)).not.toContain("database connection refused")
  })

  it("falls back to the root route when pathname is malformed", () => {
    expect(buildBoundaryErrorReport({
      description: "No pude guardar el formulario",
      pathname: "https://otro-dominio.example/ruta",
    })).toMatchObject({
      titulo: "Error en /",
      pagina: "/",
    })
  })
})
