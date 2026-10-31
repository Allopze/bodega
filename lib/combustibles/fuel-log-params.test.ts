import { describe, expect, it } from "vitest"
import { FUEL_PATHS } from "./routes"
import { withCargasParams } from "./fuel-log-params"

/** Los parámetros de un enlace, para no depender del orden en que quedaron en la cadena. */
function paramsOf(href: string): URLSearchParams {
  return new URL(href, "http://localhost").searchParams
}

describe("withCargasParams: la URL de Cargas con un filtro más", () => {
  it("apunta a Cargas y conserva el período, la faena y los demás filtros de la URL actual", () => {
    const href = withCargasParams({ periodo: "2026-10", faena: "w-1", q: "CA-14", como: "qr,app" }, { estado: "por-validar" })
    expect(new URL(href, "http://localhost").pathname).toBe(FUEL_PATHS.cargas)
    expect(Object.fromEntries(paramsOf(href))).toEqual({ periodo: "2026-10", faena: "w-1", q: "CA-14", como: "qr,app", estado: "por-validar" })
  })

  it("el parámetro que se fija reemplaza al que ya estaba, sin duplicarlo", () => {
    const href = withCargasParams({ estado: "validada", faena: "w-1" }, { estado: "por-validar" })
    expect(paramsOf(href).getAll("estado")).toEqual(["por-validar"])
    expect(paramsOf(href).get("faena")).toBe("w-1")
  })

  it("siempre suelta la página: `pagina` y la `page` de antes del rediseño", () => {
    const href = withCargasParams({ pagina: "3", page: "2", periodo: "2026-10" }, { sello: "faltante" })
    expect(paramsOf(href).has("pagina")).toBe(false)
    expect(paramsOf(href).has("page")).toBe(false)
    expect(Object.fromEntries(paramsOf(href))).toEqual({ periodo: "2026-10", sello: "faltante" })
  })

  it("un valor nulo, indefinido o vacío quita el parámetro", () => {
    const href = withCargasParams({ estado: "validada", sello: "faltante", evidencia: "faltante", q: "x" }, { estado: null, sello: undefined, evidencia: "" })
    expect(Object.fromEntries(paramsOf(href))).toEqual({ q: "x" })
  })

  it("conserva los parámetros repetidos (`?como=qr&como=app`) y se salta los indefinidos", () => {
    const href = withCargasParams({ como: ["qr", "app"], q: undefined, periodo: "2026-10" }, { evidencia: "faltante" })
    expect(paramsOf(href).getAll("como")).toEqual(["qr", "app"])
    expect(paramsOf(href).has("q")).toBe(false)
    expect(paramsOf(href).get("evidencia")).toBe("faltante")
  })

  it("sin ningún parámetro que conservar ni fijar devuelve la ruta limpia", () => {
    expect(withCargasParams({}, {})).toBe(FUEL_PATHS.cargas)
    expect(withCargasParams({ pagina: "2" }, { estado: null })).toBe(FUEL_PATHS.cargas)
  })

  it("codifica los valores que lo necesitan", () => {
    const href = withCargasParams({ q: "CA 14&x=1" }, { estado: "con-observacion" })
    expect(paramsOf(href).get("q")).toBe("CA 14&x=1")
    expect(paramsOf(href).has("x")).toBe(false)
  })

  it("no modifica el objeto que recibe", () => {
    const current = { periodo: "2026-10", pagina: "3" }
    withCargasParams(current, { estado: "por-validar" })
    expect(current).toEqual({ periodo: "2026-10", pagina: "3" })
  })
})
