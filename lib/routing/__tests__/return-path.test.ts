import { describe, expect, it } from "vitest"
import { safeInternalPath, sectionLabelFromPath } from "../return-path"

describe("safeInternalPath", () => {
  it("acepta rutas internas, incluidas las que llevan guion o query", () => {
    expect(safeInternalPath("/prevencion/capa")).toBe("/prevencion/capa")
    expect(safeInternalPath("/prevencion/gestion-cambio")).toBe("/prevencion/gestion-cambio")
    expect(safeInternalPath("/compras?estado=sent")).toBe("/compras?estado=sent")
  })

  it("rechaza cualquier destino que no sea una ruta interna", () => {
    // Aceptarlos convertiría la pantalla de error en una redirección abierta.
    expect(safeInternalPath("//evil.example.com")).toBeNull()
    expect(safeInternalPath("https://evil.example.com")).toBeNull()
    expect(safeInternalPath("/\\evil.example.com")).toBeNull()
    expect(safeInternalPath("/compras\nSet-Cookie: x=1")).toBeNull()
    expect(safeInternalPath(undefined)).toBeNull()
    expect(safeInternalPath(["/a", "/b"])).toBeNull()
  })
})

describe("sectionLabelFromPath", () => {
  it("nombra la sección de forma legible", () => {
    expect(sectionLabelFromPath("/prevencion/capa")).toBe("CAPA")
    expect(sectionLabelFromPath("/solicitudes")).toBe("Solicitudes")
    expect(sectionLabelFromPath("/prevencion/gestion-cambio")).toBe("Gestion cambio")
    expect(sectionLabelFromPath("/")).toBe("el panel")
  })
})
