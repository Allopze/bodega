import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import { GET } from "./route"

/**
 * La ruta vieja ya no genera el archivo: redirige a la de Bodega. El test fija
 * que la query sobreviva al salto — sin ella un export filtrado por faena y
 * fechas volvería con la trazabilidad completa.
 */
describe("GET /api/trazabilidad/export (compatibilidad)", () => {
  it("redirige a /api/bodega/trazabilidad/export preservando la query", () => {
    const response = GET(
      new NextRequest("http://localhost/api/trazabilidad/export?faena=ws-1&desde=2026-01-01&estado=entregado"),
    )

    expect(response.status).toBe(308)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.pathname).toBe("/api/bodega/trazabilidad/export")
    expect(location.searchParams.get("faena")).toBe("ws-1")
    expect(location.searchParams.get("desde")).toBe("2026-01-01")
    expect(location.searchParams.get("estado")).toBe("entregado")
  })

  it("redirige sin query cuando no hay filtros", () => {
    const response = GET(new NextRequest("http://localhost/api/trazabilidad/export"))

    expect(response.status).toBe(308)
    expect(new URL(response.headers.get("location") ?? "").search).toBe("")
  })
})
