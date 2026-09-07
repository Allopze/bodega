import { describe, it, expect } from "vitest"
import { parseDteXml, matchDteItemsToOcItems, normalizeOrderCodeRef } from "./dte-parser"
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

  it("preserves a missing document unit as unknown instead of inventing UN", () => {
    const xmlWithoutUnit = SAMPLE_DTE.replaceAll("<UnmdItem>UN</UnmdItem>", "")

    expect(parseDteXml(xmlWithoutUnit)?.items[0]?.unitOfMeasure).toBeNull()
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

  it("decodes a declared ISO-8859-1 DTE without granting quality to incomplete XML", async () => {
    const isoBuffer = Buffer.from(SII_DTE, "latin1")
    const result = await extractInvoiceData(isoBuffer, "application/xml", "factura.xml")
    expect(result).toMatchObject({
      method: "dte_xml",
      // Un DTE no pasa por OCR, así que no hay confianza de motor que declarar.
      quality: { coverage: 1, engineConfidence: null, totalsConsistent: true },
      data: expect.objectContaining({ supplierName: "Señalética Ñuble SpA" }),
    })
    expect(result.data?.items[1]).toMatchObject({ productName: "Guante dieléctrico", unitOfMeasure: "PAR" })

    const incomplete = await extractInvoiceData(Buffer.from("<DTE><Documento><Encabezado><IdDoc><Folio>1</Folio></IdDoc></Encabezado></Documento></DTE>"), "application/xml", "incompleto.xml")
    expect(incomplete).toEqual({
      data: null,
      method: "manual",
      quality: { coverage: 0, engineConfidence: null, totalsConsistent: null },
    })
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

describe("extracción del código de producto (CdgItem)", () => {
  const wrap = (detalle: string) => `<?xml version="1.0" encoding="ISO-8859-1"?><EnvioDTE><SetDTE><DTE><Documento><Encabezado>
<IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio><FchEmis>2026-07-21</FchEmis></IdDoc>
<Emisor><RUTEmisor>96542490-3</RUTEmisor><RznSoc>TRECK S A</RznSoc></Emisor>
<Totales><MntNeto>100</MntNeto><IVA>19</IVA><MntTotal>119</MntTotal></Totales></Encabezado>
${detalle}</Documento></DTE></SetDTE></EnvioDTE>`

  const linea = (cdg: string) => wrap(`<Detalle><NroLinDet>1</NroLinDet>${cdg}
    <NmbItem>Buzo Dupont Tyvek</NmbItem><QtyItem>1</QtyItem><PrcItem>100</PrcItem><MontoItem>100</MontoItem></Detalle>`)

  // Regresión real: TRECK manda dos CdgItem por línea y el código se perdía
  // entero porque asRecord() devuelve null ante un array.
  it("toma el código INT cuando el proveedor manda varios CdgItem", () => {
    const xml = linea(`<CdgItem><TpoCodigo>INT</TpoCodigo><VlrCodigo>06-08-001-T-XL</VlrCodigo></CdgItem>
      <CdgItem><TpoCodigo>QBLI</TpoCodigo><VlrCodigo>0</VlrCodigo></CdgItem>`)
    expect(parseDteXml(xml)?.items[0]?.productCode).toBe("06-08-001-T-XL")
  })

  it("sigue funcionando con un solo CdgItem", () => {
    const xml = linea(`<CdgItem><TpoCodigo>INT</TpoCodigo><VlrCodigo>ABC-1</VlrCodigo></CdgItem>`)
    expect(parseDteXml(xml)?.items[0]?.productCode).toBe("ABC-1")
  })

  it("descarta el relleno \"0\" en vez de usarlo como código", () => {
    const xml = linea(`<CdgItem><TpoCodigo>QBLI</TpoCodigo><VlrCodigo>0</VlrCodigo></CdgItem>`)
    expect(parseDteXml(xml)?.items[0]?.productCode).toBeNull()
  })

  it("cae a cualquier código útil si ninguno es INT", () => {
    const xml = linea(`<CdgItem><TpoCodigo>QBLI</TpoCodigo><VlrCodigo>0</VlrCodigo></CdgItem>
      <CdgItem><TpoCodigo>EAN</TpoCodigo><VlrCodigo>7801234567890</VlrCodigo></CdgItem>`)
    expect(parseDteXml(xml)?.items[0]?.productCode).toBe("7801234567890")
  })

  it("devuelve null cuando la línea no trae CdgItem (caso APRO)", () => {
    const xml = linea("")
    expect(parseDteXml(xml)?.items[0]?.productCode).toBeNull()
  })
})

/**
 * Referencia con la forma exacta de las facturas reales de TRECK y APRO
 * (`docs/facturas_apro_treck_kupfer`): 654 de 667 traen un TpoDocRef 801 y las
 * emitidas desde que la plataforma existe citan el código sin el prefijo "OC-".
 */
function withReferencia(inner: string) {
  return SII_DTE.replace("</Documento>", `<Referencia>${inner}</Referencia></Documento>`)
}

describe("referencias a orden de compra", () => {
  it("lee el código de OC que el proveedor citó en TpoDocRef 801", () => {
    const xml = withReferencia("<NroLinRef>1</NroLinRef><TpoDocRef>801</TpoDocRef><FolioRef>2026-0020</FolioRef><FchRef>2026-08-07</FchRef>")

    expect(parseDteXml(xml)!.referencedOrderCodes).toEqual(["20260020"])
  })

  it("ignora las referencias que no son órdenes de compra", () => {
    // Las guías de despacho (52) y las facturas referenciadas (33) aparecen en
    // las mismas facturas reales: tomarlas cruzaría contra folios ajenos.
    const xml = withReferencia("<NroLinRef>1</NroLinRef><TpoDocRef>52</TpoDocRef><FolioRef>2026-0020</FolioRef>")

    expect(parseDteXml(xml)!.referencedOrderCodes).toEqual([])
  })

  it("junta varias referencias 801 sin repetir", () => {
    const xml = SII_DTE.replace(
      "</Documento>",
      "<Referencia><TpoDocRef>801</TpoDocRef><FolioRef>2026-0020</FolioRef></Referencia>"
      + "<Referencia><TpoDocRef>801</TpoDocRef><FolioRef>OC 2026 0020</FolioRef></Referencia>"
      + "<Referencia><TpoDocRef>801</TpoDocRef><FolioRef>2026-0021</FolioRef></Referencia></Documento>",
    )

    expect(parseDteXml(xml)!.referencedOrderCodes).toEqual(["20260020", "20260021"])
  })

  it("deja la lista vacía cuando el documento no cita ninguna orden", () => {
    expect(parseDteXml(SII_DTE)!.referencedOrderCodes).toEqual([])
  })
})

describe("normalizeOrderCodeRef", () => {
  it("colapsa nuestro código y el del proveedor a la misma forma", () => {
    expect(normalizeOrderCodeRef("OC-2026-0025")).toBe("20260025")
    expect(normalizeOrderCodeRef("2026-0025")).toBe("20260025")
    expect(normalizeOrderCodeRef("oc 2026 0025")).toBe("20260025")
  })

  it("normaliza la numeración sucia que mandan igual los proveedores", () => {
    // Valores textuales de las facturas reales: no identifican una OC nuestra,
    // pero tampoco pueden reventar ni inventar una coincidencia.
    expect(normalizeOrderCodeRef("585.")).toBe("585")
    expect(normalizeOrderCodeRef("OC206")).toBe("206")
    expect(normalizeOrderCodeRef("25/09/2025")).toBe("25092025")
    expect(normalizeOrderCodeRef("SINOC080426")).toBe("SINOC080426")
  })

  it("descarta lo que es demasiado corto para identificar una orden", () => {
    expect(normalizeOrderCodeRef("N")).toBeNull()
    expect(normalizeOrderCodeRef("-")).toBeNull()
    expect(normalizeOrderCodeRef("")).toBeNull()
    expect(normalizeOrderCodeRef(null)).toBeNull()
  })

  it("conserva el correlativo de dos dígitos que el proveedor cita sin el año", () => {
    // 46 de los 667 XML reales citan sólo el correlativo ("26", "17", "14").
    // Descartarlos entero perdía la única pista que traía el documento; quien
    // decide qué tan fuerte es esa pista es la clasificación, no el largo.
    expect(normalizeOrderCodeRef("26")).toBe("26")
    expect(normalizeOrderCodeRef("OC 17")).toBe("17")
  })
})
