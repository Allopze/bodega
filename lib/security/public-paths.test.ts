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

  // El shell offline RE-20 es estático: descifra en el cliente y no consulta
  // datos al servidor. Abrirlo no puede abrir el resto de /prevencion/incidentes.
  // La app del mecánico es una PWA con login propio: sólo su pantalla de entrar
  // es pública; la app misma, sus registros y su API de jefatura exigen sesión.
  it("abre sólo el login de la app del mecánico, no la app", () => {
    expect(isPublicPath("/m/mantencion/entrar")).toBe(true)
    expect(isPublicPath("/m/mantencion")).toBe(false)
    expect(isPublicPath("/m/mantencion/entrar-x")).toBe(false)
    expect(isPublicPath("/mantencion/registros")).toBe(false)
  })

  it("abre sólo el shell offline RE-20, no los expedientes", () => {
    expect(isPublicPath("/prevencion/incidentes/re20-offline")).toBe(true)
    expect(isPublicPath("/prevencion/incidentes/re20-offline-x")).toBe(false)
    expect(isPublicPath("/prevencion/incidentes/inc-123")).toBe(false)
    expect(isPublicPath("/prevencion/incidentes/inc-123/re20/print")).toBe(false)
  })

  it("abre sólo la configuración de respaldos, no el resto de /api/backups", () => {
    expect(isPublicPath("/api/backups/config")).toBe(true)
    expect(isPublicPath("/api/backups/status")).toBe(false)
  })
})
