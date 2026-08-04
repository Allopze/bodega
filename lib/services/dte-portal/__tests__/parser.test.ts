import { describe, it, expect } from "vitest"
import { parseDteTable, parseEstadoSii, parseEstadoIntercambio, extractPdfPostUrl, parseMonto } from "../parser"
import { PANELDTE_COMPRAS_PERIODO_FIXTURE, PANELDTE_VACIO_FIXTURE } from "./fixtures/paneldte-compras-periodo.html"

describe("parseDteTable", () => {
  it("parses a valid table with 2 document rows", () => {
    const result = parseDteTable(PANELDTE_COMPRAS_PERIODO_FIXTURE, "433")

    expect(result.docs).toHaveLength(2)
    expect(result.currentPage).toBe(1)
    expect(result.totalPages).toBe(2)
    expect(result.periodo).toBe("2026-07")
  })

  it("extracts all fields from the first document row", () => {
    const result = parseDteTable(PANELDTE_COMPRAS_PERIODO_FIXTURE, "433")
    const doc = result.docs[0]!

    expect(doc.folio).toBe(12715)
    expect(doc.tipoDoc).toBe("33")
    expect(doc.fecha).toBe("2026-01-15")
    expect(doc.razonSocial).toBe("Proveedor SpA")
    expect(doc.estado).toBe("Emitido")
    expect(doc.estadoSii).toBe("aceptado")
    expect(doc.montoNeto).toBe(100000)
    expect(doc.montoTotal).toBe(119000)
    expect(doc.codEmp).toBe("433")
    expect(doc.rowId).toBe("12715")
    expect(doc.pdfUrl).toContain("pdf_dte.php?post=")
    expect(doc.pdfUrl).toContain("aW52b2ljZV9pZD0xMjcxNSZ0b2tlbj14eXo%3D")
    expect(doc.xmlUrl).toBeNull() // No hay href directo, solo icono
  })

  it("extracts fields from the second document row (NC with negative values)", () => {
    const result = parseDteTable(PANELDTE_COMPRAS_PERIODO_FIXTURE, "433")
    const doc = result.docs[1]!

    expect(doc.folio).toBe(8901)
    expect(doc.tipoDoc).toBe("61")
    expect(doc.fecha).toBe("2026-01-20")
    expect(doc.razonSocial).toBe("Señalética Ltda")
    expect(doc.estadoSii).toBe("pendiente_envio")
    expect(doc.montoTotal).toBe(0) // NC tiene monto total 0 porque no se declara en el fixture
  })

  it("returns empty docs array for a table with no results", () => {
    const result = parseDteTable(PANELDTE_VACIO_FIXTURE, "433")
    expect(result.docs).toHaveLength(0)
  })

  it("throws DtePortalError for HTML without a table", () => {
    expect(() => parseDteTable("<html><body>Sin tabla</body></html>", "433")).toThrow("No se encontró la tabla")
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