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
  it("TI: oculto donde la lista busca en servidor; visible en licencias y entregas", () => {
    for (const path of ["/ti", "/ti/reportes", "/ti/activos", "/ti/activos/a-1", "/ti/tickets", "/ti/tickets/t-1"]) {
      expect(hidesShellSearch(path), path).toBe(true)
    }
    for (const path of ["/ti/licencias", "/ti/asignaciones"]) {
      expect(hidesShellSearch(path), path).toBe(false)
    }
  })
  it("Entregas busca en servidor (BOD-01): sin input de la shell en la lista", () => {
    expect(hidesShellSearch("/entregas")).toBe(true)
  })
  it("Seguimiento de solicitudes trae su propio buscador por código: sin input de la shell", () => {
    expect(hidesShellSearch("/seguimiento")).toBe(true)
  })
  it("Inicio (TRV-04): sin lista que filtrar, la shell no ofrece input en ninguna vista", () => {
    expect(hidesShellSearch("/dashboard")).toBe(true)
  })
  it("Capacitación trae su propio buscador rotulado: sin input de la shell", () => {
    expect(hidesShellSearch("/prevencion/capacitacion")).toBe(true)
    // Las demás pantallas de Prevención conservan el de la shell.
    expect(hidesShellSearch("/prevencion/capa")).toBe(false)
  })
  it("Flota (F1): la lista y la ficha traen su búsqueda; Conductores y Monitoreo usan la de la shell", () => {
    for (const path of ["/flota", "/flota/veh-1"]) expect(hidesShellSearch(path), path).toBe(true)
    for (const path of ["/flota/conductores", "/flota/monitoreo"]) expect(hidesShellSearch(path), path).toBe(false)
  })
})
