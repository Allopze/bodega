import { describe, expect, it } from "vitest"
import {
  compareSizeLabels,
  isSizeAttributeName,
  normalizeSizeLabel,
  parseSizeOptions,
  resolveProductSize,
  suggestedWorkerSize,
  workerSizeFieldFor,
} from "./product-size"

describe("isSizeAttributeName", () => {
  it("reconoce los atributos de talla del catálogo real", () => {
    expect(isSizeAttributeName("Talla")).toBe(true)
    expect(isSizeAttributeName("Talla calzado")).toBe(true)
    expect(isSizeAttributeName("Talla guantes")).toBe(true)
    expect(isSizeAttributeName("TÁLLA")).toBe(true)
    expect(isSizeAttributeName("Size")).toBe(true)
  })

  it("no confunde otros atributos con una talla", () => {
    expect(isSizeAttributeName("Color")).toBe(false)
    expect(isSizeAttributeName("Material")).toBe(false)
    // «Medida» describe una dimensión (largo de cuerda), no una talla.
    expect(isSizeAttributeName("Medida")).toBe(false)
  })
})

describe("normalizeSizeLabel", () => {
  it("unifica las formas numéricas que trae el catálogo", () => {
    expect(normalizeSizeLabel("42")).toBe("42")
    expect(normalizeSizeLabel("42.0")).toBe("42")
    expect(normalizeSizeLabel("T42")).toBe("42")
    expect(normalizeSizeLabel("42 EUR")).toBe("42")
    expect(normalizeSizeLabel("Talla 42")).toBe("42")
    expect(normalizeSizeLabel(" 42 ")).toBe("42")
  })

  it("conserva las tallas fraccionarias", () => {
    expect(normalizeSizeLabel("8.5")).toBe("8.5")
    expect(normalizeSizeLabel("8,5")).toBe("8.5")
  })

  it("unifica las formas de la escala de ropa", () => {
    expect(normalizeSizeLabel("m")).toBe("M")
    expect(normalizeSizeLabel("M.")).toBe("M")
    expect(normalizeSizeLabel("Medium")).toBe("M")
    expect(normalizeSizeLabel("MEDIANA")).toBe("M")
    expect(normalizeSizeLabel("XXL")).toBe("2XL")
    expect(normalizeSizeLabel("2XL")).toBe("2XL")
    expect(normalizeSizeLabel("XXXL")).toBe("3XL")
  })

  it("normaliza las tallas compuestas de arnés", () => {
    expect(normalizeSizeLabel("s/m")).toBe("S/M")
    expect(normalizeSizeLabel("M - L")).toBe("M/L")
  })

  it("deja intacto lo que no reconoce, sin inventar una talla", () => {
    expect(normalizeSizeLabel("")).toBe("")
    expect(normalizeSizeLabel("NM")).toBe("NM")
  })

  it("unifica las formas de la talla única", () => {
    // El catálogo real escribe las dos: `Capa PVC` compró 60 unidades en
    // `UNICA` y el `Respirador Full Face` 2 en `UNIVERSAL`. Es la misma talla:
    // la prenda no se sizea.
    expect(normalizeSizeLabel("única")).toBe("UNICA")
    expect(normalizeSizeLabel("Unica")).toBe("UNICA")
    expect(normalizeSizeLabel("UNIVERSAL")).toBe("UNICA")
    expect(normalizeSizeLabel("universal")).toBe("UNICA")
    expect(normalizeSizeLabel("talla única")).toBe("UNICA")
    expect(compareSizeLabels("UNICA", "UNIVERSAL")).toBe(0)
  })

  it("lee `T/` como la abreviatura de «Talla», no como un código", () => {
    expect(normalizeSizeLabel("T/L")).toBe("L")
    expect(normalizeSizeLabel("t/xl")).toBe("XL")
    expect(normalizeSizeLabel("T-M")).toBe("M")
    expect(normalizeSizeLabel("T/42")).toBe("42")
  })

  it("lee `N` como la abreviatura de «número» del calzado y los guantes", () => {
    // El catálogo real trae `N41` (botines) y `N-9` (guantes Ansell): es la
    // numeración, no una escala aparte. Sin esto `N41` y `41` son dos tallas.
    expect(normalizeSizeLabel("N41")).toBe("41")
    expect(normalizeSizeLabel("n40")).toBe("40")
    expect(normalizeSizeLabel("N-9")).toBe("9")
    expect(normalizeSizeLabel("N-10")).toBe("10")
    expect(normalizeSizeLabel("N/42")).toBe("42")
  })

  it("no toma por «número» una letra que sólo empieza con N", () => {
    // No hay talla `N` sola ni escala que empiece con N seguida de letra.
    expect(normalizeSizeLabel("NM")).toBe("NM")
    expect(normalizeSizeLabel("N")).toBe("N")
  })

  it("no confunde una talla compuesta real con el prefijo", () => {
    // `S/M` es un rango de dos tallas, no «Talla M».
    expect(normalizeSizeLabel("S/M")).toBe("S/M")
    expect(normalizeSizeLabel("Talla 9-10")).toBe("9/10")
  })
})

describe("compareSizeLabels", () => {
  it("ordena la escala de ropa por talla y no alfabéticamente", () => {
    const sizes = ["L", "M", "S", "XL", "XS", "XXL", "3XL"]
    expect([...sizes].sort(compareSizeLabels)).toEqual(["XS", "S", "M", "L", "XL", "XXL", "3XL"])
  })

  it("ordena las tallas numéricas por valor y no por texto", () => {
    const sizes = ["38", "40", "41", "39", "43", "42", "9", "10"]
    expect([...sizes].sort(compareSizeLabels)).toEqual(["9", "10", "38", "39", "40", "41", "42", "43"])
  })

  it("trata las formas equivalentes como la misma posición", () => {
    expect(compareSizeLabels("42", "42.0")).toBe(0)
    expect(compareSizeLabels("XXL", "2XL")).toBe(0)
  })

  it("no intercala escalas distintas y manda lo desconocido al final", () => {
    const sizes = ["M", "40", "Única", "S", "39"]
    expect([...sizes].sort(compareSizeLabels)).toEqual(["39", "40", "S", "M", "Única"])
  })

  it("ordena las tallas compuestas por su primer tramo", () => {
    expect([...["M/L", "S/M", "L/XL"]].sort(compareSizeLabels)).toEqual(["S/M", "M/L", "L/XL"])
  })

  it("ordena el calzado numerado con `N` por su número", () => {
    // EPP-021 `N41` y EPP-022 `T41` son la misma talla; los botines V73 van
    // N41..N44 y antes caían todos al grupo «desconocido», ordenados por texto.
    expect(["N44", "N41", "N43", "N42"].sort(compareSizeLabels))
      .toEqual(["N41", "N42", "N43", "N44"])
    expect(["N-10", "N-9"].sort(compareSizeLabels)).toEqual(["N-9", "N-10"])
    expect(compareSizeLabels("N41", "T41")).toBe(0)
  })

  it("deja `T/L` en su lugar de la escala y no al final", () => {
    const ordered = ["2XL", "T/L", "XS", "M"].sort(compareSizeLabels)
    expect(ordered).toEqual(["XS", "M", "T/L", "2XL"])
  })
})

describe("parseSizeOptions", () => {
  it("lee el JSON actual y el texto separado por comas del catálogo antiguo", () => {
    expect(parseSizeOptions('["42"]')).toEqual(["42"])
    expect(parseSizeOptions("S, M, L")).toEqual(["S", "M", "L"])
    expect(parseSizeOptions(null)).toEqual([])
    expect(parseSizeOptions("")).toEqual([])
  })
})

describe("resolveProductSize", () => {
  it("lee la talla de una variante concreta", () => {
    expect(resolveProductSize([
      { name: "Color", options: '["Negro"]' },
      { name: "Talla calzado", options: '["42"]', sizeFamily: "calzado" },
    ])).toEqual({ attributeName: "Talla calzado", label: "42", sizeFamily: "calzado" })
  })

  it("devuelve null para un producto sin talla", () => {
    expect(resolveProductSize([{ name: "Color", options: '["Blanco"]' }])).toBeNull()
    expect(resolveProductSize([])).toBeNull()
  })

  it("devuelve null para un molde de catálogo con varias tallas sin generar", () => {
    // Un producto así no es una unidad entregable: no se le puede atribuir una
    // talla, y fabricar una sería inventar stock que no existe por talla.
    expect(resolveProductSize([{ name: "Talla", options: '["S","M","L"]' }])).toBeNull()
  })

  it("conserva la etiqueta tal como está guardada", () => {
    // El histórico se firma con la etiqueta del catálogo, no con la normalizada.
    expect(resolveProductSize([{ name: "Talla", options: '["42.0"]' }])?.label).toBe("42.0")
  })
})

describe("suggestedWorkerSize", () => {
  const worker = { sizeTop: "xxl", sizeShoe: "T42", sizeGloves: null }

  it("mapea cada atributo al campo del padrón que le corresponde", () => {
    expect(workerSizeFieldFor("Talla")).toBe("sizeTop")
    expect(workerSizeFieldFor("Talla calzado")).toBe("sizeShoe")
    expect(workerSizeFieldFor("talla guantes")).toBe("sizeGloves")
    expect(workerSizeFieldFor("Talla arnés")).toBeNull()
  })

  it("sugiere la talla habitual ya normalizada", () => {
    expect(suggestedWorkerSize("Talla", worker)).toBe("2XL")
    expect(suggestedWorkerSize("Talla calzado", worker)).toBe("42")
  })

  it("no sugiere nada cuando el padrón no la tiene", () => {
    expect(suggestedWorkerSize("Talla guantes", worker)).toBeNull()
    expect(suggestedWorkerSize("Talla", null)).toBeNull()
    expect(suggestedWorkerSize("Talla arnés", worker)).toBeNull()
  })
})
