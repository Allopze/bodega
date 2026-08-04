import { describe, expect, it } from "vitest"
import { expiryFilterInput, parseExpiryFilter } from "./expiry-filter"

describe("parseExpiryFilter", () => {
  it("acepta sólo los tres rangos declarados", () => {
    expect(parseExpiryFilter("7")).toBe("7")
    expect(parseExpiryFilter("30")).toBe("30")
    expect(parseExpiryFilter("vencidos")).toBe("vencidos")
    // Un valor arbitrario en la URL no debe recortar la lista en silencio.
    expect(parseExpiryFilter("90")).toBeNull()
    expect(parseExpiryFilter("")).toBeNull()
    expect(parseExpiryFilter(undefined)).toBeNull()
  })
})

describe("expiryFilterInput", () => {
  it("sin filtro no añade condiciones", () => {
    expect(expiryFilterInput(null)).toEqual({})
  })

  it("separa lo ya vencido de lo que está por vencer", () => {
    const vencidos = expiryFilterInput("vencidos")
    expect(vencidos.expiresBefore).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Mirar sólo hacia atrás: mezclar ambos casos infla la urgencia.
    expect(vencidos.expiresAfter).toBeUndefined()

    const proximos = expiryFilterInput("30")
    expect(proximos.expiresAfter).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(proximos.expiresBefore).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(proximos.expiresAfter! < proximos.expiresBefore!).toBe(true)
  })

  it("la ventana de 7 días cabe dentro de la de 30", () => {
    const semana = expiryFilterInput("7")
    const mes = expiryFilterInput("30")
    expect(semana.expiresAfter).toBe(mes.expiresAfter)
    expect(semana.expiresBefore! < mes.expiresBefore!).toBe(true)
  })
})
