import { describe, it, expect } from "vitest"
import { parseDteXml, matchDteItemsToOcItems } from "./dte-parser"

const SAMPLE_DTE = `<?xml version="1.0" encoding="UTF-8"?>
<DTE version="1.0">
  <Documento ID="33-25-2026-12345">
    <Encabezado>
      <IdDoc>
        <TipoDTE>33</TipoDTE>
        <Folio>12345</Folio>
        <FechaEmision>2026-01-15</FechaEmision>
      </IdDoc>
      <Emisor>
        <RUTEmisor>76.123.456-7</RUTEmisor>
        <RznSocEmisor>Proveedor SpA</RznSocEmisor>
      </Emisor>
      <Receptor>
        <RUTRecep>76.987.654-3</RUTRecep>
        <RznSocRecep>Cliente Ltda</RznSocRecep>
      </Receptor>
      <Totales>
        <MntNeto>100000</MntNeto>
        <IVA>19000</IVA>
        <MntTotal>119000</MntTotal>
      </Totales>
    </Encabezado>
    <Detalle>
      <Item>
        <NroLinea>1</NroLinea>
        <CdgItem><TpoCod>INT1</TpoCod><VlrCod>SKU001</VlrCod></CdgItem>
        <NmItem>Producto Alpha</NmItem>
        <QtyItem>10</QtyItem>
        <UnmdItem>UN</UnmdItem>
        <PrcItem>5000</PrcItem>
        <MontoItem>50000</MontoItem>
      </Item>
      <Item>
        <NroLinea>2</NroLinea>
        <NmItem>Producto Beta</NmItem>
        <QtyItem>5</QtyItem>
        <UnmdItem>UN</UnmdItem>
        <PrcItem>10000</PrcItem>
        <MontoItem>50000</MontoItem>
      </Item>
    </Detalle>
  </Documento>
</DTE>`

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
    expect(result!.items[0]).toEqual({
      lineNumber: 1,
      productCode: "SKU001",
      productName: "Producto Alpha",
      description: null,
      quantity: 10,
      unitOfMeasure: "UN",
      unitPrice: 5000,
      discount: 0,
      amount: 50000,
    })
    expect(result!.items[1]?.productName).toBe("Producto Beta")
    expect(result!.items[1]?.quantity).toBe(5)
  })

  it("returns null for invalid XML", () => {
    expect(parseDteXml("not xml")).toBeNull()
  })

  it("returns null for XML without DTE structure", () => {
    expect(parseDteXml('<?xml version="1.0"?><root><data/></root>')).toBeNull()
  })

  it("handles DTE without wrapper (direct Documento)", () => {
    const xml = `<?xml version="1.0"?>
    <Documento>
      <Encabezado>
        <IdDoc><Folio>999</Folio><FechaEmision>2026-06-01</FechaEmision></IdDoc>
        <Totales><MntTotal>50000</MntTotal></Totales>
      </Encabezado>
      <Detalle>
        <Item>
          <NroLinea>1</NroLinea>
          <NmItem>Test</NmItem>
          <QtyItem>1</QtyItem>
          <PrcItem>50000</PrcItem>
          <MontoItem>50000</MontoItem>
        </Item>
      </Detalle>
    </Documento>`
    const result = parseDteXml(xml)
    expect(result).not.toBeNull()
    expect(result!.invoiceNumber).toBe("999")
    expect(result!.totalAmount).toBe(50000)
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
