import { describe, expect, it } from "vitest"
import { hidesShellSearch } from "./top-bar"

describe("buscador de la shell", () => {
  it("se oculta en el espacio de trabajo de una MIPER (dos tablas, buscadores propios)", () => {
    expect(hidesShellSearch("/prevencion/miper/riskmatrix-abc")).toBe(true)
  })
  it("se mantiene en la portada, el catálogo y la ficha de control", () => {
    expect(hidesShellSearch("/prevencion/miper")).toBe(false)
    expect(hidesShellSearch("/prevencion/miper/factores")).toBe(false)
    expect(hidesShellSearch("/prevencion/miper/controles/ctrl-1")).toBe(false)
  })
  it("TI: oculto en el resumen, reportes y fichas; visible en las listas de activos y licencias", () => {
    for (const path of ["/ti", "/ti/reportes", "/ti/activos/a-1", "/ti/tickets", "/ti/tickets/t-1"]) {
      expect(hidesShellSearch(path), path).toBe(true)
    }
    for (const path of ["/ti/activos", "/ti/licencias", "/ti/entregas"]) {
      expect(hidesShellSearch(path), path).toBe(false)
    }
  })
})
