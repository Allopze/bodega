import { describe, expect, it } from "vitest"
import {
  PDF_DOCUMENT_LIST,
  PDF_DOCUMENT_SPECS,
  PDF_ENGINE_LABELS,
  PDF_ENGINES,
  parsePdfEngine,
  resolvePdfEngine,
  type PdfDocumentId,
} from "@/lib/pdf/engines"

const ALL_DOCS = PDF_DOCUMENT_LIST.map((spec) => spec.id)

describe("catálogo de documentos", () => {
  it("expone los seis documentos imprimibles, sin repetir clave de ajuste", () => {
    expect(ALL_DOCS).toHaveLength(6)
    const keys = PDF_DOCUMENT_LIST.map((spec) => spec.settingKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("la lista y el mapa no pueden divergir", () => {
    for (const spec of PDF_DOCUMENT_LIST) {
      expect(PDF_DOCUMENT_SPECS[spec.id]).toBe(spec)
    }
    expect(ALL_DOCS.sort()).toEqual(Object.keys(PDF_DOCUMENT_SPECS).sort())
  })

  it("todo motor listado por un documento tiene etiqueta y existe en PDF_ENGINES", () => {
    for (const spec of PDF_DOCUMENT_LIST) {
      for (const engine of spec.engines) {
        expect(PDF_ENGINES).toContain(engine)
        expect(PDF_ENGINE_LABELS[engine]).toBeTruthy()
      }
    }
  })

  it("el motor por defecto de cada documento está entre los que declara", () => {
    for (const spec of PDF_DOCUMENT_LIST) {
      expect(spec.engines).toContain(spec.defaultEngine)
    }
  })
})

describe("parsePdfEngine", () => {
  it("acepta un motor disponible para el documento, tolerando espacios y mayúsculas", () => {
    expect(parsePdfEngine("oc", "chromium")).toBe("chromium")
    expect(parsePdfEngine("oc", "  CHROMIUM  ")).toBe("chromium")
  })

  it("rechaza valores vacíos, nulos o desconocidos", () => {
    for (const value of [null, undefined, "", "   ", "basura", "puppeteer"]) {
      expect(parsePdfEngine("oc", value)).toBeNull()
    }
  })

  it("rechaza un motor real que ese documento no implementa", () => {
    // Es la salvaguarda del selector: la lista por documento manda sobre el
    // catálogo global de motores.
    for (const spec of PDF_DOCUMENT_LIST) {
      const noImplementado = PDF_ENGINES.find((engine) => !spec.engines.includes(engine))
      if (!noImplementado) continue
      expect(parsePdfEngine(spec.id, noImplementado)).toBeNull()
    }
  })
})

describe("resolvePdfEngine", () => {
  it("sin override ni ajuste, cae al motor por defecto del documento", () => {
    for (const spec of PDF_DOCUMENT_LIST) {
      expect(resolvePdfEngine(spec.id, {})).toBe(spec.defaultEngine)
      expect(resolvePdfEngine(spec.id, { override: null, configured: null })).toBe(spec.defaultEngine)
    }
  })

  it("el ajuste guardado manda cuando no hay override", () => {
    expect(resolvePdfEngine("oc", { configured: "chromium" })).toBe("chromium")
  })

  it("el override gana al ajuste guardado", () => {
    expect(resolvePdfEngine("oc", { override: "chromium", configured: "chromium" })).toBe("chromium")
  })

  it("un escalón con un motor no implementado cae al siguiente, no lanza", () => {
    // Un ajuste huérfano en base de datos (motor retirado del código) no debe
    // dejar el documento sin generar.
    const huerfano = "pdfcn" as const
    for (const spec of PDF_DOCUMENT_LIST) {
      if (spec.engines.includes(huerfano)) continue
      expect(resolvePdfEngine(spec.id, { configured: huerfano })).toBe(spec.defaultEngine)
      expect(resolvePdfEngine(spec.id, { override: huerfano })).toBe(spec.defaultEngine)
      expect(resolvePdfEngine(spec.id, { override: huerfano, configured: huerfano }))
        .toBe(spec.defaultEngine)
    }
  })

  it("resuelve siempre a un motor que el documento implementa", () => {
    const docs: PdfDocumentId[] = ALL_DOCS
    for (const doc of docs) {
      for (const override of [...PDF_ENGINES, null]) {
        for (const configured of [...PDF_ENGINES, null]) {
          const resolved = resolvePdfEngine(doc, { override, configured })
          expect(PDF_DOCUMENT_SPECS[doc].engines).toContain(resolved)
        }
      }
    }
  })

  it("matriz de precedencia sobre la OC, que sí tiene dos motores", () => {
    expect(PDF_DOCUMENT_SPECS.oc.engines).toEqual(["chromium", "pdfcn"])

    // ajuste solo
    expect(resolvePdfEngine("oc", { configured: "pdfcn" })).toBe("pdfcn")
    expect(resolvePdfEngine("oc", { configured: "chromium" })).toBe("chromium")

    // el override gana en los dos sentidos
    expect(resolvePdfEngine("oc", { override: "pdfcn", configured: "chromium" })).toBe("pdfcn")
    expect(resolvePdfEngine("oc", { override: "chromium", configured: "pdfcn" })).toBe("chromium")

    // sin override, el ajuste sigue mandando
    expect(resolvePdfEngine("oc", { override: null, configured: "pdfcn" })).toBe("pdfcn")

    // sin nada, el defecto
    expect(resolvePdfEngine("oc", {})).toBe("chromium")
  })

  it("un motor válido para la OC no lo es para un documento que no lo implementa", () => {
    expect(parsePdfEngine("oc", "pdfcn")).toBe("pdfcn")
    expect(parsePdfEngine("sst", "pdfcn")).toBeNull()
    expect(resolvePdfEngine("sst", { override: "pdfcn", configured: "pdfcn" })).toBe("chromium")
  })
})
