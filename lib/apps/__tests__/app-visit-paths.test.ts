import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

const { appIdForPath } = await import("@/lib/services/app-visits")

describe("app de una ruta", () => {
  it.each([
    ["/combustibles", "combustibles"],
    ["/combustibles/cargas/123", "combustibles"],
    ["/mantencion/repuestos", "repuestos"],
    ["/mantencion/ot/abc", "mantencion_equipos"],
    ["/ti/apps", "ti"],
    ["/admin/usuarios", "admin"],
    ["/reportes", "reports"],
    ["/solicitudes/nueva", "requests"],
  ])("%s → %s", (pathname, appId) => {
    expect(appIdForPath(pathname)).toBe(appId)
  })

  it("Inicio y rutas fuera de una app no se registran", () => {
    expect(appIdForPath("/dashboard")).toBeNull()
    expect(appIdForPath("/perfil")).toBeNull()
  })
})
