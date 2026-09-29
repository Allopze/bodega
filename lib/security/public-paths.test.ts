import { describe, expect, it } from "vitest"
import { isPublicPath } from "./public-paths"

describe("rutas públicas del proxy", () => {
  // PRV-15 (auditoría 2026-09-28): el canal de reporte de incidentes es sin sesión.
  it("deja pasar el reporte público de incidentes", () => {
    expect(isPublicPath("/reportar-incidente")).toBe(true)
    expect(isPublicPath("/reportar-incidente/gracias")).toBe(true)
  })

  it("no abre el módulo de incidentes autenticado", () => {
    expect(isPublicPath("/prevencion/incidentes")).toBe(false)
    expect(isPublicPath("/reportar-incidentes-admin")).toBe(false)
  })

  it("abre sólo la configuración de respaldos, no el resto de /api/backups", () => {
    expect(isPublicPath("/api/backups/config")).toBe(true)
    expect(isPublicPath("/api/backups/status")).toBe(false)
  })
})
