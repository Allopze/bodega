import { describe, it, expect } from "vitest"
import { parseDteXml, matchDteItemsToOcItems } from "./dte-parser"
import { extractInvoiceData } from "./invoice-extractor"

// Single-line XML to avoid DOMParser whitespace issues in vitest
const SAMPLE_DTE = '<DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>12345</Folio><FechaEmision>2026-01-15</FechaEmision></IdDoc><Emisor><RUTEmisor>76.123.456-7</RUTEmisor><RznSocEmisor>Proveedor SpA</RznSocEmisor></Emisor><Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales></Encabezado><Detalle><Item><NroLinea>1</NroLinea><CdgItem><TpoCod>INT1</TpoCod><VlrCod>SKU001</VlrCod></CdgItem><NmItem>Producto Alpha</NmItem><QtyItem>10</QtyItem><UnmdItem>UN</UnmdItem><PrcItem>5000</PrcItem><MontoItem>50000</MontoItem></Item><Item><NroLinea>2</NroLinea><NmItem>Producto Beta</NmItem><QtyItem>5</QtyItem><UnmdItem>UN</UnmdItem><PrcItem>10000</PrcItem><MontoItem>50000</MontoItem></Item></Detalle></Documento></DTE>'
const SII_DTE = '<?xml version="1.0" encoding="ISO-8859-1"?><EnvDTE><SetDTE><DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>45678</Folio><FchEmis>2026-07-28</FchEmis></IdDoc><Emisor><RUTEmisor>76.987.654-3</RUTEmisor><RznSoc>Señalética Ñuble SpA</RznSoc></Emisor><Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales></Encabezado><Detalle><NroLinDet>1</NroLinDet><CdgItem><TpoCodigo>INT1</TpoCodigo><VlrCodigo>CAS-01</VlrCodigo></CdgItem><NmbItem>Casco amarillo</NmbItem><QtyItem>10</QtyItem><UnmdItem>UN</UnmdItem><PrcItem>5000</PrcItem><MontoItem>50000</MontoItem></Detalle><Detalle><NroLinDet>2</NroLinDet><NmbItem>Guante dieléctrico</NmbItem><QtyItem>5</QtyItem><UnmdItem>PAR</UnmdItem><PrcItem>10000</PrcItem><MontoItem>50000</MontoItem></Detalle></Documento></DTE></SetDTE></EnvDTE>'

describe("parseDteXml", () => {
  it("parses a valid Chilean DTE", () => {
    const result = parseDteXml(SAMPLE_DTE)
    expect(result).not.toBeNull()
    expect(result!.invoiceNumber).toBe("12345")
    expect(result!.issueDate).toBe("2026-01-15")
    expect(result!.supplierRut).toBe("76.123.456-7")
    expect(result!.supplierName).toBe("Proveedor SpA")
    expect(result!.totalAmount).toBe(119000)
    expect(result!.netAmount).toBe(100000)
    expect(result!.taxAmount).toBe(19000)
    expect(result!.items).toHaveLength(2)
  })

  it("extracts line items correctly", () => {
    const result = parseDteXml(SAMPLE_DTE)
    const items = result!.items
    expect(items[0]!.productName).toBe("Producto Alpha")
    expect(items[0]!.quantity).toBe(10)
    expect(items[0]!.unitPrice).toBe(5000)
    expect(items[0]!.amount).toBe(50000)
    expect(items[1]!.productName).toBe("Producto Beta")
    expect(items[1]!.quantity).toBe(5)
  })

  it("returns null for invalid XML", () => {
    expect(parseDteXml("not xml")).toBeNull()
  })

  it("returns null for XML without DTE structure", () => {
    expect(parseDteXml('<?xml version="1.0"?><root><data/></root>')).toBeNull()
  })

  it("parses the regular SII aliases and repeated Detalle nodes", () => {
    const result = parseDteXml(SII_DTE)
    expect(result).toMatchObject({
      invoiceNumber: "45678",
      issueDate: "2026-07-28",
      supplierName: "Señalética Ñuble SpA",
      totalAmount: 119000,
    })
    expect(result?.items).toEqual([
      expect.objectContaining({ lineNumber: 1, productCode: "CAS-01", productName: "Casco amarillo" }),
      expect.objectContaining({ lineNumber: 2, productName: "Guante dieléctrico" }),
    ])
  })

  it("decodes a declared ISO-8859-1 DTE without granting confidence to incomplete XML", async () => {
    const isoBuffer = Buffer.from(SII_DTE, "latin1")
    const result = await extractInvoiceData(isoBuffer, "application/xml", "factura.xml")
    expect(result).toMatchObject({
      method: "dte_xml",
      confidence: expect.any(Number),
      data: expect.objectContaining({ supplierName: "Señalética Ñuble SpA" }),
    })
    expect(result.data?.items[1]).toMatchObject({ productName: "Guante dieléctrico", unitOfMeasure: "PAR" })

    const incomplete = await extractInvoiceData(Buffer.from("<DTE><Documento><Encabezado><IdDoc><Folio>1</Folio></IdDoc></Encabezado></Documento></DTE>"), "application/xml", "incompleto.xml")
    expect(incomplete).toEqual({ data: null, method: "manual", confidence: 0 })
  })
})

describe("matchDteItemsToOcItems", () => {
  const ocItems = [
    { id: "oc-1", productId: "SKU001", productNameFree: null, quantity: 10 },
    { id: "oc-2", productId: null, productNameFree: "Producto Beta", quantity: 5 },
  ]

  it("matches by product code", () => {
    const dteItems = [{ lineNumber: 1, productCode: "SKU001", productName: "Alpha", description: null, quantity: 10, unitOfMeasure: "UN", unitPrice: 5000, discount: 0, amount: 50000 }]
    const result = matchDteItemsToOcItems(dteItems, ocItems)
    expect(result[0]?.ocItemId).toBe("oc-1")
    expect(result[0]?.matchType).toBe("code")
  })

  it("matches by product name (substring)", () => {
    const dteItems = [{ lineNumber: 1, productCode: null, productName: "Producto Beta Plus", description: null, quantity: 5, unitOfMeasure: "UN", unitPrice: 10000, discount: 0, amount: 50000 }]
    const result = matchDteItemsToOcItems(dteItems, ocItems)
    expect(result[0]?.ocItemId).toBe("oc-2")
    expect(result[0]?.matchType).toBe("name")
  })

  it("returns null ocItemId when no match", () => {
    const dteItems = [{ lineNumber: 1, productCode: null, productName: "Unknown Product", description: null, quantity: 1, unitOfMeasure: "UN", unitPrice: 1000, discount: 0, amount: 1000 }]
    const result = matchDteItemsToOcItems(dteItems, ocItems)
    expect(result[0]?.ocItemId).toBeNull()
    expect(result[0]?.matchType).toBe("none")
  })
})
