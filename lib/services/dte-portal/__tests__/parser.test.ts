import { describe, it, expect } from "vitest"
import { parseDteTable, parseEstadoSii, parseEstadoIntercambio, extractPdfPostUrl, parseMonto, parseFechaPortal, resolveTipoDocFromText } from "../parser"
import { PANELDTE_COMPRAS_PERIODO_FIXTURE, PANELDTE_VACIO_FIXTURE } from "./fixtures/paneldte-compras-periodo.html"

describe("parseDteTable", () => {
  it("parses a valid response with 2 document rows", () => {
    const result = parseDteTable(PANELDTE_COMPRAS_PERIODO_FIXTURE, "433")

    expect(result.docs).toHaveLength(2)
    expect(result.currentPage).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(result.totalDocs).toBe(2)
    expect(result.periodo).toBe("2026-07")
  })

  it("extracts all fields from the first document row (anulada)", () => {
    const result = parseDteTable(PANELDTE_COMPRAS_PERIODO_FIXTURE, "433")
    const doc = result.docs[0]!

    expect(doc.folio).toBe(12715)
    expect(doc.tipoDoc).toBe("33")
    expect(doc.fecha).toBe("2026-01-15")
    expect(doc.razonSocial).toBe("Proveedor Ficticio SpA")
    expect(doc.estadoSii).toBe("anulado")
    expect(doc.estadoIntercambio).toBeNull()
    expect(doc.montoNeto).toBe(0)
    expect(doc.montoTotal).toBe(0)
    expect(doc.codEmp).toBe("433")
    expect(doc.rowId).toBe("1000001")
    expect(doc.pdfUrl).toContain("pdf_dte.php?post=")
    expect(doc.pdfUrl).toContain("Ced=1")
    // La primera fila no tiene el onclick popupd(estadodoc.php) que expone el XML
    expect(doc.xmlUrl).toBeNull()
  })

  it("extracts all fields from the second document row (NC aceptada, montos negativos)", () => {
    const result = parseDteTable(PANELDTE_COMPRAS_PERIODO_FIXTURE, "433")
    const doc = result.docs[1]!

    expect(doc.folio).toBe(8901)
    expect(doc.tipoDoc).toBe("61")
    expect(doc.fecha).toBe("2026-01-20")
    expect(doc.razonSocial).toBe("Señalética Ltda")
    expect(doc.estadoSii).toBe("aceptado")
    expect(doc.estadoIntercambio).toBe("aceptado")
    expect(doc.montoNeto).toBe(-50000)
    expect(doc.montoTotal).toBe(-59500)
    expect(doc.rowId).toBe("1000002")
    // Esta fila sí trae el onclick popupd(estadodoc.php) con folio/tipodoc
    expect(doc.xmlUrl).toContain("estadodoc.php")
    expect(doc.xmlUrl).toContain("folio=12716")
    expect(doc.xmlUrl).toContain("tipodoc=61")
  })

  it("returns empty docs array when the portal declares no results", () => {
    const result = parseDteTable(PANELDTE_VACIO_FIXTURE, "433")
    expect(result.docs).toHaveLength(0)
    expect(result.totalDocs).toBe(0)
  })

  // El libro de ventas vacío no trae la frase "No se encontraron documentos":
  // sólo declara tbxTotalDocumentos="0". Verificado contra el portal real el
  // 2026-08-11 (2026-08 sin ventas). Antes de contemplarlo, todo mes sin
  // ventas emitidas reventaba con PARSE_FAILED culpando a las credenciales.
  it("returns empty docs when tbxTotalDocumentos is 0 without the text marker", () => {
    const html = `<html><body><input type="hidden" id="tbxTotalDocumentos" value="0"></body></html>`
    const result = parseDteTable(html, "433")
    expect(result.docs).toHaveLength(0)
    expect(result.totalDocs).toBe(0)
  })

  it("throws DtePortalError when there are no rows and no empty-result marker", () => {
    expect(() => parseDteTable("<html><body>Sin filas ni marcador</body></html>", "433"))
      .toThrow("No se encontraron filas de documentos")
  })
})

describe("resolveTipoDocFromText", () => {
  it("resolves 'Factura Electronica' to 33", () => {
    expect(resolveTipoDocFromText("Factura Electronica")).toBe("33")
  })

  it("resolves 'Nota de Credito Electronica' to 61, not confused with 'Nota de Credito'", () => {
    expect(resolveTipoDocFromText("Nota de Credito Electronica")).toBe("61")
  })

  it("does not confuse 'Factura Exenta Electronica' with 'Factura Exenta'", () => {
    expect(resolveTipoDocFromText("Factura Exenta Electronica")).toBe("34")
  })

  it("ignores trailing noise like the [POS] ticket link text", () => {
    expect(resolveTipoDocFromText("Factura Electronica [POS]")).toBe("33")
  })

  it("resolves 'Boleta Afecta Electronica' to 39 (verificado contra la Bandeja de Entrada real)", () => {
    expect(resolveTipoDocFromText("Boleta Afecta Electronica")).toBe("39")
  })

  it("resolves 'Boleta Exenta Electronica' to 41", () => {
    expect(resolveTipoDocFromText("Boleta Exenta Electronica")).toBe("41")
  })

  it("returns null for unrecognized text", () => {
    expect(resolveTipoDocFromText("Algo Desconocido")).toBeNull()
  })
})

describe("parseFechaPortal", () => {
  it("parses the real portal format (ISO yyyy-mm-dd)", () => {
    expect(parseFechaPortal("2026-07-07")).toBe("2026-07-07")
  })

  it("parses dd-mm-yyyy as a fallback", () => {
    expect(parseFechaPortal("07-07-2026")).toBe("2026-07-07")
  })

  it("returns null for unrecognized format", () => {
    expect(parseFechaPortal("no es una fecha")).toBeNull()
  })
})

describe("parseEstadoSii", () => {
  it("detects aceptado from SiiEnvRec.png", () => {
    expect(parseEstadoSii('<img src="SiiEnvRec.png" />')).toBe("aceptado")
  })

  it("detects pendiente_envio from SiiPen.png", () => {
    expect(parseEstadoSii('<img src="SiiPen.png" />')).toBe("pendiente_envio")
  })

  it("detects anulado from SiiAnu.png", () => {
    expect(parseEstadoSii('<img src="SiiAnu.png" />')).toBe("anulado")
  })

  it("detects rechazado from SiiEnvPen.png", () => {
    expect(parseEstadoSii('<img src="SiiEnvPen.png" />')).toBe("rechazado")
  })

  it("detects enviado from SiiEnv.png", () => {
    expect(parseEstadoSii('<img src="SiiEnv.png" />')).toBe("enviado")
  })

  it("detects manual from SiiMan.png", () => {
    expect(parseEstadoSii('<img src="SiiMan.png" />')).toBe("manual")
  })

  it("returns null when no icon is found", () => {
    expect(parseEstadoSii("<td>Sin estado</td>")).toBeNull()
  })
})

describe("parseEstadoIntercambio", () => {
  it("detects aceptado from flag_green.png", () => {
    expect(parseEstadoIntercambio('<img src="flag_green.png" />')).toBe("aceptado")
  })

  it("detects pendiente from flag_blue.png", () => {
    expect(parseEstadoIntercambio('<img src="flag_blue.png" />')).toBe("pendiente")
  })

  it("detects rechazado from flag_red.png", () => {
    expect(parseEstadoIntercambio('<img src="flag_red.png" />')).toBe("rechazado")
  })

  it("returns null when no flag icon is found", () => {
    expect(parseEstadoIntercambio("<td>Sin estado</td>")).toBeNull()
  })
})

describe("extractPdfPostUrl", () => {
  it("extracts the pdf_dte.php URL from a cell", () => {
    const html = '<a href="pdf_dte.php?post=aW52b2ljZV9pZD0xMjcxNSZ0b2tlbj14eXo="><img src="pdf_buttonCED.png" /></a>'
    expect(extractPdfPostUrl(html)).toBe("pdf_dte.php?post=aW52b2ljZV9pZD0xMjcxNSZ0b2tlbj14eXo=")
  })

  it("returns null when no pdf_dte link is found", () => {
    expect(extractPdfPostUrl("<td>Sin PDF</td>")).toBeNull()
  })
})

describe("parseMonto", () => {
  it("parses Chilean formatted number 100.000", () => {
    expect(parseMonto("100.000")).toBe(100000)
  })

  it("parses negative number -50.000", () => {
    expect(parseMonto("-50.000")).toBe(-50000)
  })

  it("parses zero", () => {
    expect(parseMonto("0")).toBe(0)
  })

  it("returns null for empty string", () => {
    expect(parseMonto("")).toBeNull()
  })

  it("returns null for non-numeric text", () => {
    expect(parseMonto("Sin información")).toBeNull()
  })
})
