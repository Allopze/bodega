import { describe, it, expect, vi } from "vitest"
import { parseBandejaRows, parseBandejaResult, extractBandejaTotal, extractBandejaXmlUrl } from "../bandeja-entrada"
import {
  PANELCORREO_BANDEJA_FIXTURE,
  PANELCORREO_BANDEJA_DISCREPANCIA_FIXTURE,
  PANELCORREO_BANDEJA_VACIA_FIXTURE,
} from "./fixtures/panelcorreo-bandeja.html"

describe("parseBandejaRows", () => {
  it("parses a valid response with 3 document rows", () => {
    const rows = parseBandejaRows(PANELCORREO_BANDEJA_FIXTURE)
    expect(rows).toHaveLength(3)
  })

  it("extracts all fields from a row pending to platform (penplata.gif)", () => {
    const rows = parseBandejaRows(PANELCORREO_BANDEJA_FIXTURE)
    const doc = rows[0]!

    expect(doc.fecha).toBe("2026-06-01")
    expect(doc.tipoDoc).toBe("33")
    expect(doc.folio).toBe(100001)
    expect(doc.rutEmisor).toBe("11111111-1")
    expect(doc.razonSocial).toBe("PROVEEDOR UNO SPA")
    expect(doc.montoTotal).toBe(50000)
    expect(doc.estadoPlataforma).toBe("Pendiente de envio a la Plataforma")
    expect(doc.tipoRef).toBe("801")
    expect(doc.folioRef).toBe("0")
    expect(doc.fechaRef).toBe("2026-06-01")
    expect(doc.nreguist).toBe("9000001")
    expect(doc.pdfUrl).toContain("dtepdfX.php?post=")
    expect(doc.xmlUrl).toBe("../empr/Chome/DTEProveedores/PRV_11111111-1_33_100001.xml")
  })

  it("does not confuse a dead HTML comment ('PENDIENTE') with the real estadoPlataforma", () => {
    const rows = parseBandejaRows(PANELCORREO_BANDEJA_FIXTURE)
    // La fila "enviada" no tiene penplata.gif -> estadoPlataforma debe ser null,
    // no "PENDIENTE" (que solo existe dentro de un comentario HTML muerto).
    const enviada = rows.find((r) => r.folio === 200002)!
    expect(enviada.estadoPlataforma).toBeNull()
  })

  it("extracts a non-numeric tipoRef ('OBS') without crashing", () => {
    const rows = parseBandejaRows(PANELCORREO_BANDEJA_FIXTURE)
    const doc = rows.find((r) => r.folio === 200002)!
    expect(doc.tipoDoc).toBe("52") // Guia de Despacho Electronica
    expect(doc.tipoRef).toBe("OBS")
    expect(doc.rutEmisor).toBe("22222222-2")
  })

  it("extracts a Nota de Credito row referencing another folio", () => {
    const rows = parseBandejaRows(PANELCORREO_BANDEJA_FIXTURE)
    const doc = rows.find((r) => r.folio === 100050)!
    expect(doc.tipoDoc).toBe("61")
    expect(doc.folioRef).toBe("100001")
    expect(doc.xmlUrl).toContain("_61_100050.xml")
  })

  it("returns an empty array when the period has no received documents", () => {
    const rows = parseBandejaRows(PANELCORREO_BANDEJA_VACIA_FIXTURE)
    expect(rows).toHaveLength(0)
  })

  it("parses identically when the portal drops the dead HTML comment", () => {
    // El mapa de columnas no puede depender de markup comentado que el
    // navegador nunca renderiza: si el portal lo saca del template, las filas
    // deben seguir leyéndose igual.
    const sinComentarios = PANELCORREO_BANDEJA_FIXTURE.replace(/<!--[\s\S]*?-->/g, "")
    expect(parseBandejaRows(sinComentarios)).toEqual(parseBandejaRows(PANELCORREO_BANDEJA_FIXTURE))
  })

  it("exposes the reception date already parsed (the query filters by document date)", () => {
    const doc = parseBandejaRows(PANELCORREO_BANDEJA_FIXTURE)[0]!
    expect(doc.fechaRecepcion).toBe("2026-06-01 09:09")
    expect(doc.fechaRecepcionDate).toBe("2026-06-01")
  })

  it("logs the discarded row with period, correlationId and folio", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const conFechaRota = PANELCORREO_BANDEJA_FIXTURE.replace(
      "<td align='center'>2026-06-01</td>",
      "<td align='center'>2026-13-45</td>",
    )

    const rows = parseBandejaRows(conFechaRota, { correlationId: "batch-X", periodo: "2026-06" })

    expect(rows).toHaveLength(2)
    const output = String(warnSpy.mock.calls[0]?.[0])
    expect(output).toContain("DTE_BANDEJA_DATE_INVALID")
    expect(output).toContain('"correlationId":"batch-X"')
    expect(output).toContain('"periodo":"2026-06"')
    expect(output).toContain('"folio":"100001"')
    warnSpy.mockRestore()
  })
})

describe("extractBandejaTotal", () => {
  it("reads tbxTotalRegistros", () => {
    expect(extractBandejaTotal(PANELCORREO_BANDEJA_FIXTURE)).toBe(3)
    expect(extractBandejaTotal(PANELCORREO_BANDEJA_VACIA_FIXTURE)).toBe(0)
  })

  it("returns null when the field is missing", () => {
    expect(extractBandejaTotal("<html></html>")).toBeNull()
  })
})

describe("extractBandejaXmlUrl", () => {
  it("extracts the direct XML link (no intermediate hop)", () => {
    const cell = "<a href=../empr/Chome/DTEProveedores/PRV_12345678-9_33_555.xml target='_blank'><img src='../img/file-xml.png'/></a>"
    expect(extractBandejaXmlUrl(cell)).toBe("../empr/Chome/DTEProveedores/PRV_12345678-9_33_555.xml")
  })

  it("returns null when there is no XML link", () => {
    expect(extractBandejaXmlUrl("<a href='#'>sin xml</a>")).toBeNull()
  })
})

describe("parseBandejaResult", () => {
  it("returns rows and totalRegistros when they match", () => {
    const result = parseBandejaResult(PANELCORREO_BANDEJA_FIXTURE)
    expect(result.rows).toHaveLength(3)
    expect(result.totalRegistros).toBe(3)
  })

  it("emits a redacted structured warning when declared total does not match rows", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = parseBandejaResult(PANELCORREO_BANDEJA_DISCREPANCIA_FIXTURE)

    expect(result.rows).toHaveLength(3)
    expect(result.totalRegistros).toBe(5)
    const output = String(warnSpy.mock.calls[0]?.[0])
    expect(output).toContain("DTE_BANDEJA_TOTAL_MISMATCH")
    expect(output).toContain('"declared":5')
    expect(output).toContain('"parsed":3')
    expect(output).not.toContain("PANELCORREO")
    warnSpy.mockRestore()
  })

  it("throws DtePortalError when there are no rows and no tbxTotalRegistros", () => {
    const rawPortalHtml = "<html><body>Sin filas ni marcador clave=secret-never-persist</body></html>"
    const error = (() => {
      try {
        parseBandejaResult(rawPortalHtml)
      } catch (caught) {
        return caught
      }
      throw new Error("Expected DtePortalError")
    })()

    expect(error).toBeInstanceOf(Error)
    expect(JSON.stringify(error)).not.toContain("secret-never-persist")
    expect(() => { throw error }).toThrow("No se encontró tbxTotalRegistros")
  })

  it("does not throw for a genuinely empty period (tbxTotalRegistros=0)", () => {
    const result = parseBandejaResult(PANELCORREO_BANDEJA_VACIA_FIXTURE)
    expect(result.rows).toHaveLength(0)
    expect(result.totalRegistros).toBe(0)
    expect(result.declaredTotal).toBe(0)
  })

  it("reports declaredTotal=null (and warns) when the portal stops declaring the total", () => {
    // Sin el marcador, comparar totalRegistros contra las filas es compararlas
    // consigo mismas: quien consuma el resultado debe poder saber que la
    // completitud NO se verificó.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sinTotal = PANELCORREO_BANDEJA_FIXTURE.replace(
      '<input type="hidden" name="tbxTotalRegistros" id="tbxTotalRegistros" value="3">',
      "",
    )

    const result = parseBandejaResult(sinTotal, { periodo: "2026-06" })

    expect(result.rows).toHaveLength(3)
    expect(result.declaredTotal).toBeNull()
    const output = String(warnSpy.mock.calls[0]?.[0])
    expect(output).toContain("DTE_BANDEJA_TOTAL_MISSING")
    expect(output).toContain('"periodo":"2026-06"')
    warnSpy.mockRestore()
  })
})
