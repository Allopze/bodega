import { describe, expect, it } from "vitest"
import { BOUNDARY_ERROR_PRIORITY, buildBoundaryErrorReport } from "@/lib/services/feedback-error-context"

/** Las mismas horas por prioridad que aplica `computeDueAt` en feedback.ts. */
const SLA_HORAS = { baja: 240, normal: 120, alta: 48, critica: 24 } as const

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
      /*
       * SOP-001 (auditoría 2026-09-14): esta prueba afirmaba `priority:
       * "normal"`, es decir, consagraba que una caída de la aplicación entrara
       * con el plazo de una sugerencia de mejora (5 días, según `computeDueAt`).
       * El único canal que reporta fallas reales de la plataforma partía su
       * contador con la prioridad de una consulta.
       */
      priority: "alta",
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

  it("una caída de la aplicación entra con un plazo más corto que una sugerencia (SOP-001)", () => {
    const reporte = buildBoundaryErrorReport({
      description: "La pantalla dejó de responder",
      pathname: "/ti/tickets",
    })
    expect(reporte.priority).toBe(BOUNDARY_ERROR_PRIORITY)
    // La prioridad no es decorativa: gobierna el vencimiento del reporte.
    expect(SLA_HORAS[reporte.priority]).toBeLessThan(SLA_HORAS.normal)
  })
})
