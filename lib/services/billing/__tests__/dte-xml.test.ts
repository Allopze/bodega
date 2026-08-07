import { describe, it, expect } from "vitest"
import { parseSaleDteXml } from "../dte-xml"

/**
 * XML de factura electrónica de venta con la estructura real del SII
 * (EnvioDTE → SetDTE → DTE → Documento). Datos ficticios.
 */
const SALE_INVOICE_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0">
  <SetDTE ID="SetDoc">
    <DTE version="1.0">
      <Documento ID="F1234T33">
        <Encabezado>
          <IdDoc>
            <TipoDTE>33</TipoDTE>
            <Folio>1234</Folio>
            <FchEmis>2026-07-15</FchEmis>
            <FmaPago>2</FmaPago>
            <FchVenc>2026-08-14</FchVenc>
          </IdDoc>
          <Emisor>
            <RUTEmisor>78023530-6</RUTEmisor>
            <RznSoc>SERVICIOS INDUSTRIALES CHOME LTDA</RznSoc>
            <GiroEmis>Servicios industriales</GiroEmis>
          </Emisor>
          <Receptor>
            <RUTRecep>76.543.210-K</RUTRecep>
            <RznSocRecep>MINERA EJEMPLO SPA</RznSocRecep>
            <DirRecep>Camino Interior 100</DirRecep>
          </Receptor>
          <Totales>
            <MntNeto>4200000</MntNeto>
            <MntExe>150000</MntExe>
            <TasaIVA>19</TasaIVA>
            <IVA>798000</IVA>
            <MntTotal>5148000</MntTotal>
          </Totales>
        </Encabezado>
        <Detalle>
          <NroLinDet>1</NroLinDet>
          <NmbItem>Servicio de aseo industrial julio 2026</NmbItem>
          <QtyItem>1</QtyItem>
          <UnmdItem>SERV</UnmdItem>
          <PrcItem>4200000</PrcItem>
          <MontoItem>4200000</MontoItem>
        </Detalle>
        <Detalle>
          <NroLinDet>2</NroLinDet>
          <NmbItem>Traslado exento</NmbItem>
          <QtyItem>1</QtyItem>
          <PrcItem>150000</PrcItem>
          <MontoItem>150000</MontoItem>
        </Detalle>
      </Documento>
    </DTE>
  </SetDTE>
</EnvioDTE>`

/**
 * NC de compra con la estructura real del portal (EnvioDTE → SetDTE →
 * Caratula + DTE → Documento, con Referencia y tags vacíos). Datos ficticios;
 * los montos y la forma vienen de un documento real del 2026-08-06.
 */
const CREDIT_NOTE_ENVELOPE_XML = `<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0">
<SetDTE ID="EnvioDte1">
<Caratula version="1.0">
<RutEmisor>76111222-3</RutEmisor>
<RutReceptor>78023530-6</RutReceptor>
<SubTotDTE><TpoDTE>61</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>
</Caratula>
<DTE xmlns="http://www.sii.cl/SiiDte" version="1.0">
<Documento ID="R76111222F376999T61">
<Encabezado>
<IdDoc>
<TipoDTE>61</TipoDTE>
<Folio>376999</Folio>
<FchEmis>2026-08-06</FchEmis>
<FmaPago>2</FmaPago>
<TermPagoCdg/>
<FchVenc>2026-09-05</FchVenc>
</IdDoc>
<Emisor>
<RUTEmisor>76111222-3</RUTEmisor>
<RznSoc>Proveedora Austral SpA</RznSoc>
<Sucursal/>
</Emisor>
<Receptor>
<RUTRecep>78023530-6</RUTRecep>
<CdgIntRecep/>
<RznSocRecep>SERVICIOS INDUSTRIALES CHOME LTDA</RznSocRecep>
<CiudadPostal/>
</Receptor>
<Totales>
<MntNeto>392787</MntNeto>
<TasaIVA>19.00</TasaIVA>
<IVA>74630</IVA>
<MntTotal>467417</MntTotal>
<MontoNF>0</MontoNF>
<VlrPagar>0</VlrPagar>
</Totales>
</Encabezado>
<Detalle>
<NroLinDet>1</NroLinDet>
<CdgItem><TpoCodigo>INT1</TpoCodigo><VlrCodigo>830974</VlrCodigo></CdgItem>
<NmbItem>Neumático 11 R 22.5</NmbItem>
<QtyItem>2</QtyItem>
<UnmdItem/>
<PrcItem>260296</PrcItem>
<DescuentoMonto>127805</DescuentoMonto>
<MontoItem>392787</MontoItem>
</Detalle>
<Referencia>
<NroLinRef>1</NroLinRef>
<TpoDocRef>33</TpoDocRef>
<FolioRef>0005358218</FolioRef>
<FchRef>2026-08-05</FchRef>
<CodRef>1</CodRef>
<RazonRef/>
</Referencia>
</Documento>
</DTE>
</SetDTE>
</EnvioDTE>`

describe("parseSaleDteXml", () => {
  it("extrae la identidad tributaria completa, incluido el receptor", () => {
    const doc = parseSaleDteXml(SALE_INVOICE_XML)
    expect(doc).not.toBeNull()
    expect(doc!.docType).toBe("33")
    expect(doc!.folio).toBe(1234)
    expect(doc!.issueDate).toBe("2026-07-15")
    expect(doc!.issuerTaxId).toBe("78023530-6")
    expect(doc!.issuerName).toBe("SERVICIOS INDUSTRIALES CHOME LTDA")
    // El RUT del receptor es exactamente lo que el listado del portal NO trae.
    expect(doc!.receiverTaxId).toBe("76543210-K")
    expect(doc!.receiverName).toBe("MINERA EJEMPLO SPA")
  })

  it("lee el vencimiento declarado (FchVenc), no lo infiere", () => {
    expect(parseSaleDteXml(SALE_INVOICE_XML)!.dueDate).toBe("2026-08-14")
  })

  it("separa neto, IVA, exento y total", () => {
    const doc = parseSaleDteXml(SALE_INVOICE_XML)!
    expect(doc.netAmount).toBe(4200000)
    expect(doc.taxAmount).toBe(798000)
    expect(doc.exemptAmount).toBe(150000)
    expect(doc.totalAmount).toBe(5148000)
  })

  it("lee los ítems en orden", () => {
    const items = parseSaleDteXml(SALE_INVOICE_XML)!.items
    expect(items).toHaveLength(2)
    expect(items[0]!.description).toBe("Servicio de aseo industrial julio 2026")
    expect(items[0]!.unit).toBe("SERV")
    expect(items[1]!.lineNumber).toBe(2)
  })

  it("normaliza el RUT al formato del maestro interno", () => {
    const xml = SALE_INVOICE_XML.replace("76.543.210-K", "76543210k")
    expect(parseSaleDteXml(xml)!.receiverTaxId).toBe("76543210-K")
  })

  it("acepta un documento sin ítems (factura de servicio de una línea)", () => {
    const xml = SALE_INVOICE_XML.replace(/<Detalle>[\s\S]*<\/Detalle>/, "")
    const doc = parseSaleDteXml(xml)
    expect(doc).not.toBeNull()
    expect(doc!.items).toEqual([])
  })

  it("acepta un documento sin vencimiento declarado", () => {
    const xml = SALE_INVOICE_XML.replace("<FchVenc>2026-08-14</FchVenc>", "")
    expect(parseSaleDteXml(xml)!.dueDate).toBeNull()
  })

  it("descarta el documento si falta identidad mínima", () => {
    expect(parseSaleDteXml(SALE_INVOICE_XML.replace("<Folio>1234</Folio>", ""))).toBeNull()
    expect(parseSaleDteXml(SALE_INVOICE_XML.replace("<RUTRecep>76.543.210-K</RUTRecep>", ""))).toBeNull()
    expect(parseSaleDteXml(SALE_INVOICE_XML.replace("<MntTotal>5148000</MntTotal>", ""))).toBeNull()
    expect(parseSaleDteXml(SALE_INVOICE_XML.replace("<FchEmis>2026-07-15</FchEmis>", ""))).toBeNull()
  })

  it("descarta una fecha con formato inesperado en vez de reinterpretarla", () => {
    const xml = SALE_INVOICE_XML.replace("<FchEmis>2026-07-15</FchEmis>", "<FchEmis>15/07/2026</FchEmis>")
    expect(parseSaleDteXml(xml)).toBeNull()
  })

  it("no explota con basura", () => {
    expect(parseSaleDteXml("")).toBeNull()
    expect(parseSaleDteXml("no soy xml")).toBeNull()
    expect(parseSaleDteXml("<html><body>404</body></html>")).toBeNull()
  })

  it("acepta un RUT de receptor extranjero convencional (55555555-5)", () => {
    const xml = SALE_INVOICE_XML.replace("76.543.210-K", "55555555-5")
    expect(parseSaleDteXml(xml)!.receiverTaxId).toBe("55555555-5")
  })

  it("una nota de crédito (TipoDTE 61) invierte el signo de todos los montos", () => {
    // El XML del SII declara magnitudes sin signo; la convención interna
    // (derivePaymentStatus) exige total negativo para que la NC reste deuda.
    const xml = SALE_INVOICE_XML.replace("<TipoDTE>33</TipoDTE>", "<TipoDTE>61</TipoDTE>")
    const doc = parseSaleDteXml(xml)!
    expect(doc.docType).toBe("61")
    expect(doc.netAmount).toBe(-4200000)
    expect(doc.taxAmount).toBe(-798000)
    expect(doc.exemptAmount).toBe(-150000)
    expect(doc.totalAmount).toBe(-5148000)
  })

  it("procesa una NC real del portal: sobre EnvioDTE completo, signos invertidos y campos vacíos", () => {
    // Estructura calcada de una NC de compra real recibida el 2026-08-06
    // (Caratula + Referencia + tags vacíos como <UnmdItem/>), con RUT, nombres
    // y folios ficticios. Valida en un documento del mundo real lo que los
    // casos sintéticos prueban por partes.
    const doc = parseSaleDteXml(CREDIT_NOTE_ENVELOPE_XML)
    expect(doc).not.toBeNull()
    expect(doc!.docType).toBe("61")
    expect(doc!.folio).toBe(376999)
    expect(doc!.issuerTaxId).toBe("76111222-3")
    expect(doc!.receiverTaxId).toBe("78023530-6")
    expect(doc!.dueDate).toBe("2026-09-05")
    // El XML del SII declara magnitudes sin signo (confirmado contra el
    // documento real): la convención interna exige NC negativa.
    expect(doc!.netAmount).toBe(-392787)
    expect(doc!.taxAmount).toBe(-74630)
    expect(doc!.totalAmount).toBe(-467417)
    expect(doc!.items).toHaveLength(1)
    expect(doc!.items[0]!.quantity).toBe(2)
    expect(doc!.items[0]!.unit).toBeNull()
    expect(doc!.items[0]!.discount).toBe(127805)
  })

  it("lee decimales XSD del XML (punto decimal, sin separador de miles)", () => {
    // "6.00" son 6 unidades, no 600: el contenido XML no usa formato chileno.
    const xml = SALE_INVOICE_XML
      .replace("<QtyItem>1</QtyItem>\n          <UnmdItem>SERV</UnmdItem>", "<QtyItem>6.00</QtyItem>\n          <UnmdItem>SERV</UnmdItem>")
    const doc = parseSaleDteXml(xml)!
    expect(doc.items[0]!.quantity).toBe(6)
  })
})
