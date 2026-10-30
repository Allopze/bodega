import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { computeRutDv } from "@/lib/rut"
import { parseCopecDetail } from "../consumption-import"
import { parseTaeReceiptRecords } from "../tae-receipt-import"
import { buildCopecTransactionRows } from "../copec-events"
import { copecSource, copecStationLabel, copecWsItemToRecord, withCopecSourceSession, withCopecWebServiceSession } from "../copec-ws"
import type { CopecReportDownloadResult } from "../copec-reports"

// Datos inventados con la forma exacta de las respuestas reales del 2026-10-30
// (relleno con espacios, ceros a la izquierda, entidades numéricas, mezcla de
// mayúsculas en SOAP y minúsculas en BlueMax).
const RUT = `76123456-${computeRutDv("76123456")}`
const PASSWORD = "cl@ve<9&"

function soapItem(over: Record<string, string> = {}): Record<string, string> {
  return {
    CDEFCHCONS: "2026-01-01", CDEHORCONS: "13:57:33", CDEKMLT: "18.37", CDEKMREC: "995.00", CDEMARCTAE: "3",
    CDEMONCONS: "52142.000", CDENROGUIA: "000770000001", CDEODOANT: "000000106535", CDEODOM: "000000107530",
    CDEPATCOND: "ZZXX-11     ", CDEPERANIO: "2026", CDEPERIMES: "1", CDEPESOKM: "52.40", CDEPRECIO: "963.000",
    CDESUBKMLT: "9.19", CDEVEHCOND: "0107", CDEVOLCONS: "54.15", CLISAP: "0000000001", DIG_CONDUCT: "9",
    DPTODESC: "TCT CAMIONETAS                                    ", DPTSAP: "0008", FECHA_TRX: "2026-01-01",
    HORA_TRX: "13:57:33", INSDESC: "RUTA 5 SUR KM 383,3                     ", INSTALACION: "0000020017",
    NUMEROROLLO: "000128619101", PCONS: "0000000001", RUT_CLIENTE: RUT, RUT_CONDUCT: "11111111",
    TARJETA: "1-000000-00001-3-6  ", dESCUENTO: "2896.00", dIRECCIONESTACION: "RUTA 5 SUR KM 383,3                     ",
    rEGION: "&#xD1;UBLE",
    ...over,
  }
}

function soapResponse(input: { id?: string; desc?: string; items?: Record<string, string>[]; rut?: string } = {}): string {
  const items = input.items ?? []
  const detail = items.length
    ? `<DETALLE>${items.map((item) => `<item xmlns="">${Object.entries(item).map(([key, value]) => `<${key}>${value}</${key}>`).join("")}</item>`).join("")}</DETALLE>`
    : `<DETALLE xsi:nil="true"/>`
  return `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><consultaTCTTACReturn xmlns="wss.constcttac.services.wtmc.copec.cl"><DESC_MENSAJE>${input.desc ?? `Cantidad de registros: ${items.length}.`}</DESC_MENSAJE>${detail}<ID_MENSAJE>${input.id ?? "1"}</ID_MENSAJE><PERIODO>Inicio: 2026-01-01 Fin: 2026-01-31</PERIODO><RUT_CLIENTE>${input.rut ?? RUT}</RUT_CLIENTE></consultaTCTTACReturn></soapenv:Body></soapenv:Envelope>`
}

function bluemaxItem(over: Record<string, string> = {}): Record<string, string> {
  return {
    rut_cliente: `${RUT}  `, fecha_trx: "2026-01-02", hora_trx: "15:54:08", tarjeta: "1-000000-00002-1-0  ", instalacion: "0000020501",
    rut_conduct: "22222222", cdepatcond: "ZZYY-22     ", cdevolcons: "24.05", cdeodom: "000000382412", cdemarctae: "1",
    clisap: "0000000001", pcons: "0000000001", cdeperimes: "1", cdeperanio: "2026", cdenroguia: "000770000002", cdevehcond: "0101",
    cdefchcons: "2026-01-02", cdehorcons: "15:54:08", cdeprecio: "685.000", cdemoncons: "16474.000", dptsap: "0000",
    dptodesc: "TRANSPORTES DEMO LTDA.                            ", cdekmlt: "33.43", cdepesokm: "20.49",
    insdesc: "RUTA Q 50, KM 11 DESDE  CABRERO A C     ", cdesubkmlt: "33.43", cdeodoant: "0", cdekmrec: "804.00",
    numerorollo: "000000280743", descuento: "73703633.00", region: "BIOBIO", direccionestacion: "RUTA Q 50, KM 11 DESDE CABRERO A C      ",
    ...over,
  }
}

function bluemaxResponse(input: { id?: string; desc?: string; items?: unknown; rut?: string } = {}): string {
  const items = input.items as Record<string, string>[] | Record<string, string> | undefined
  const count = Array.isArray(items) ? items.length : items ? 1 : 0
  return JSON.stringify({
    idMensaje: input.id ?? "1",
    descMensaje: input.desc ?? `Cantidad de registros: ${count}.`,
    rutCliente: input.rut ?? RUT,
    periodo: "Inicio: 2026-01-01 Fin: 2026-01-31",
    detalle: items === undefined ? null : { item: items },
  })
}

/** La fila que entrega `sheetToRecords` para la misma carga, tal como quedó guardada en `raw_payload`. */
const EXCEL_TCT_DIESEL: Record<string, unknown> = {
  Producto: "Diésel", Tarjeta: "1-000000-00001-3-6", "Tipo de Tarjeta": "TCT", "N° Vehículo": 107, "Tipo de Vehículo": "CAMIONETA",
  Departamento: "TCT CAMIONETAS", "Rut Chofer": "11111111-9", Región: "ÑUBLE", Comuna: "SAN CARLOS",
  "Estación de Servicio": "2017-RUTA 5 SUR KM 383,3", Patente: "ZZXX-11",
  "Fecha Transacción": new Date("2026-01-01T00:00:00.000Z"), "Hora Transacción": new Date("1899-12-30T13:57:33.000Z"),
  "Guía de Despacho": 770000001, "Rut Atendedor": "-", Precio: 963, Volumen: 54.15, Monto: 52142,
  "Odómetro (Kms.)": 107530, "Rendimiento (Kms. por Litro)": 18.37, "Rendimiento ($ por Km.)": 52.4, __row: 382,
}

const EXCEL_TCT_BLUEMAX: Record<string, unknown> = {
  Producto: "BlueMax", Tarjeta: "1-000000-00002-1-0", "Tipo de Tarjeta": "TCT PREMIUM", "N° Vehículo": 101, "Tipo de Vehículo": "TRACTO CAMION",
  Departamento: "TRANSPORTES DEMO LTDA.", Región: "BIOBIO", Comuna: "CABRERO",
  "Estación de Servicio": "2501-RUTA Q 50, KM 11 DESDE  CABRERO A C", Patente: "ZZYY-22",
  "Fecha Transacción": new Date("2026-01-02T00:00:00.000Z"), "Hora Transacción": new Date("1899-12-30T15:54:08.000Z"),
  "Guía de Despacho": 770000002, Precio: 685, Volumen: 24.05, Monto: 16474,
  "Odómetro (Kms.)": 382412, "Rendimiento (Kms. por Litro)": 33.43, "Rendimiento ($ por Km.)": 20.49, __row: 83,
}

const EXCEL_TAE_DIESEL: Record<string, unknown> = {
  Producto: "Diésel", Tarjeta: "1-000000-00003-9-8", "Tipo de Tarjeta": "TAE", "Asignación": "PLANTA DEMOS", "N° Vehículo": 9,
  "Tipo de Vehículo": "CAMIONETA", Departamento: "DEPARTAMENTO TAE", Región: "BIOBIO", Comuna: "LAJA",
  "Estación de Servicio": "2703-AV. LOS RIOS N° 745",
  "Fecha Transacción": new Date("2026-01-02T00:00:00.000Z"), "Hora Transacción": new Date("1899-12-30T08:58:50.000Z"),
  "Guía de Despacho": 38296840, Precio: 965, Volumen: 367, Monto: 354155,
  "Odómetro (Kms.)": 0, "Rendimiento (Kms. por Litro)": 0, "Rendimiento ($ por Km.)": 0, __row: 43,
}

const TAE_SOAP_ITEM = soapItem({
  CDEMARCTAE: "9", CDEMONCONS: "354155.000", CDENROGUIA: "000038296840", CDEODOANT: "000000000000", CDEODOM: "000000000000",
  CDEPATCOND: "PLANTA DEMOS", CDEPRECIO: "965.000", CDEVOLCONS: "367.00", CDEVEHCOND: "0009", CDEKMLT: "0.00", CDEPESOKM: "0.00",
  DPTODESC: "DEPARTAMENTO TAE                                  ", FECHA_TRX: "2026-01-02", HORA_TRX: "08:58:50",
  INSDESC: "AV. LOS RIOS N&#xB0; 745                     ", INSTALACION: "0000020703", TARJETA: "1-000000-00003-9-8  ", rEGION: "BIOBIO",
})

/** Lo que fast-xml-parser entrega de un `<item>`: los valores ya sin entidades. */
function decoded(item: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value.replace(/&#x([0-9A-F]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))]))
}

const PERIOD = { from: "2026-01-01", to: "2026-01-31" }
const withoutRaw = <T extends { rawPayload?: unknown; rowIndex?: unknown }>(value: T) => ({ ...value, rawPayload: undefined, rowIndex: undefined })

describe("paridad con el Excel del portal", () => {
  // Si una sola de estas comparaciones se rompe, cada carga ya importada desde
  // el Excel vuelve por el web service con otra identidad y el mes entero queda
  // como «corrección pendiente de revisión».
  it("una carga TCT Diésel da la misma identidad, la misma lectura de odómetro y el mismo agregado", () => {
    const fromExcel = parseCopecDetail([EXCEL_TCT_DIESEL], { expectedProduct: "diesel", period: PERIOD })
    const fromWs = parseCopecDetail([copecWsItemToRecord(decoded(soapItem()), "diesel", "TCT", 0)], { expectedProduct: "diesel", period: PERIOD })

    expect(fromWs.errors).toEqual([])
    expect(fromWs.transactions.map(withoutRaw)).toEqual(fromExcel.transactions.map(withoutRaw))
    expect(buildCopecTransactionRows(PERIOD.from, PERIOD.to, "diesel", fromWs.transactions).map((row) => row.sourceRowKey))
      .toEqual(buildCopecTransactionRows(PERIOD.from, PERIOD.to, "diesel", fromExcel.transactions).map((row) => row.sourceRowKey))
    expect(fromWs.detail.map((reading) => ({ ...reading, rawPayload: undefined }))).toEqual(fromExcel.detail.map((reading) => ({ ...reading, rawPayload: undefined })))
    expect(fromWs.rows.map((row) => ({ ...row, rowIndex: undefined, rawRow: undefined }))).toEqual(fromExcel.rows.map((row) => ({ ...row, rowIndex: undefined, rawRow: undefined })))
    expect(fromWs.transactions[0]).toMatchObject({ sourceRef: "770000001", plate: "ZZXX-11", cardNumber: "1-000000-00001-3-6", liters: 54.15, unitPrice: 963, amount: 52142, station: "2017-RUTA 5 SUR KM 383,3" })
  })

  it("una carga TCT BlueMax (servicio REST) da la misma identidad", () => {
    const fromExcel = parseCopecDetail([EXCEL_TCT_BLUEMAX], { expectedProduct: "bluemax", period: PERIOD })
    const fromWs = parseCopecDetail([copecWsItemToRecord(bluemaxItem(), "bluemax", "TCT", 0)], { expectedProduct: "bluemax", period: PERIOD })

    expect(fromWs.errors).toEqual([])
    expect(fromWs.transactions.map(withoutRaw)).toEqual(fromExcel.transactions.map(withoutRaw))
    expect(buildCopecTransactionRows(PERIOD.from, PERIOD.to, "bluemax", fromWs.transactions).map((row) => row.sourceRowKey))
      .toEqual(buildCopecTransactionRows(PERIOD.from, PERIOD.to, "bluemax", fromExcel.transactions).map((row) => row.sourceRowKey))
  })

  it("una recepción TAE da la misma guía, vasija, instante y estación", () => {
    const fromExcel = parseTaeReceiptRecords([EXCEL_TAE_DIESEL], { ...PERIOD, expectedProduct: "diesel" })
    const fromWs = parseTaeReceiptRecords([copecWsItemToRecord(decoded(TAE_SOAP_ITEM), "diesel", "TAE", 0)], { ...PERIOD, expectedProduct: "diesel" })

    expect(fromWs.errors).toEqual([])
    const strip = (row: (typeof fromWs.rows)[number]) => ({ ...row, rowIndex: undefined, rawRow: undefined })
    expect(fromWs.rows.map(strip)).toEqual(fromExcel.rows.map(strip))
    expect(fromWs.rows[0]).toMatchObject({ documentNumber: "38296840", assignment: "PLANTA DEMOS", station: "2703-AV. LOS RIOS N° 745", liters: 367 })
  })

  it("una guía toda en ceros es «sin guía», no la guía 0", () => {
    const record = copecWsItemToRecord(decoded(soapItem({ CDENROGUIA: "000000000000" })), "diesel", "TCT", 0)
    expect(record["Guía de Despacho"]).toBeNull()
    const parsed = parseCopecDetail([record], { expectedProduct: "diesel", period: PERIOD })
    expect(parsed.transactions[0]?.sourceRef).toBeNull()
  })

  it("no copia el RUT del conductor a la fila", () => {
    const record = copecWsItemToRecord(decoded(soapItem()), "diesel", "TCT", 0)
    expect(JSON.stringify(record)).not.toContain("11111111")
    expect(Object.keys(record).some((key) => /rut/i.test(key))).toBe(false)
  })

  it("un tipo de tarjeta desconocido no se adivina: el parser rechaza la fila", () => {
    const parsed = parseCopecDetail([copecWsItemToRecord(decoded(soapItem({ CDEMARCTAE: "5" })), "diesel", "TCT", 0)], { expectedProduct: "diesel", period: PERIOD })
    expect(parsed.transactions).toEqual([])
    expect(parsed.errors[0]).toMatchObject({ field: "Tipo de Tarjeta" })
  })
})

describe("copecStationLabel", () => {
  it("reconstruye el código de cuatro dígitos del portal y corta en 40 caracteres", () => {
    expect(copecStationLabel("0000020017", "RUTA 5 SUR KM 383,3     ")).toBe("2017-RUTA 5 SUR KM 383,3")
    expect(copecStationLabel("0000060470", "X")).toBe("6470-X")
    expect(copecStationLabel("0000020071", "RUTA 5 KM 786 SAN JOSE DE LA MARIQUINA   ")).toBe("2071-RUTA 5 KM 786 SAN JOSE DE LA MARIQU")
  })

  it("deja entero un código con otra forma y tolera datos ausentes", () => {
    expect(copecStationLabel("0000123456", "ESTACION")).toBe("123456-ESTACION")
    expect(copecStationLabel("", "ESTACION")).toBe("ESTACION")
    expect(copecStationLabel(undefined, undefined)).toBeNull()
  })
})

describe("copecSource", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("usa el web service cuando hay RUT cliente y el portal cuando no", () => {
    vi.stubEnv("COPEC_SOURCE", "")
    vi.stubEnv("COPEC_CLIENT_RUT", "")
    expect(copecSource()).toBe("portal")
    vi.stubEnv("COPEC_CLIENT_RUT", RUT)
    expect(copecSource()).toBe("ws")
  })

  it("COPEC_SOURCE manda sobre el RUT", () => {
    vi.stubEnv("COPEC_CLIENT_RUT", RUT)
    vi.stubEnv("COPEC_SOURCE", " Portal ")
    expect(copecSource()).toBe("portal")
    vi.stubEnv("COPEC_CLIENT_RUT", "")
    vi.stubEnv("COPEC_SOURCE", "ws")
    expect(copecSource()).toBe("ws")
  })
})

describe("withCopecWebServiceSession", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("COPEC_USERNAME", "usuario")
    vi.stubEnv("COPEC_PASSWORD", PASSWORD)
    // Con puntos, como lo escribiría una persona: el servicio recibe la forma sin puntos.
    vi.stubEnv("COPEC_CLIENT_RUT", "76.123.456-" + computeRutDv("76123456"))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const xmlResponse = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/xml;charset=utf-8" } })
  const jsonResponse = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json;charset=UTF-8" } })
  const download = (requests: Array<{ product: "diesel" | "bluemax"; from: string; to: string }>, channel: "TCT" | "TAE" = "TCT") =>
    withCopecWebServiceSession((session) => session.download(requests, channel))
  const failureOf = (result: CopecReportDownloadResult | undefined) => (result && "failure" in result ? result.failure : undefined)

  it("consulta diésel por SOAP y BlueMax por REST, y entrega la respuesta como evidencia junto a sus filas", async () => {
    const soap = soapResponse({ items: [soapItem()] })
    const rest = bluemaxResponse({ items: [bluemaxItem()] })
    fetchMock.mockResolvedValueOnce(xmlResponse(soap)).mockResolvedValueOnce(jsonResponse(rest))

    const [diesel, bluemax] = await download([{ product: "diesel", ...PERIOD }, { product: "bluemax", ...PERIOD }])

    expect(diesel).toMatchObject({ product: "diesel", unavailable: false, report: { fileName: "copec-ws-tct-diesel-2026-01.xml" } })
    expect(bluemax).toMatchObject({ product: "bluemax", unavailable: false, report: { fileName: "copec-ws-tct-bluemax-2026-01.json" } })
    const dieselReport = diesel && "report" in diesel ? diesel.report : undefined
    expect(dieselReport?.buffer.toString("utf8")).toBe(soap)
    expect(dieselReport?.records).toHaveLength(1)
    expect(dieselReport?.records?.[0]).toMatchObject({ Patente: "ZZXX-11", Región: "ÑUBLE", "Guía de Despacho": "770000001", Volumen: 54.15 })

    const [soapUrl, soapInit] = fetchMock.mock.calls[0]!
    expect(soapUrl).toBe("https://ventas-api.copec.cl/WS_consTCTTAC/services/ConsultaTCTWSS")
    expect(soapInit?.headers).toMatchObject({ SOAPAction: "http://www.example.org/WS_consTCTTACNEW/ConsultaTCTWSS" })
    // Credenciales escapadas: una clave con `<` o `&` no rompe el XML.
    expect(String(soapInit?.body)).toContain("<con:PASSWORD>cl@ve&lt;9&amp;</con:PASSWORD>")
    expect(String(soapInit?.body)).toContain(`<con:RUT_CLIENTE>${RUT}</con:RUT_CLIENTE>`)
    expect(String(soapInit?.body)).toContain("<con:PRODUCTO>TCT</con:PRODUCTO>")
    const restUrl = new URL(String(fetchMock.mock.calls[1]![0]))
    expect(restUrl.searchParams.get("producto")).toBe("TCT")
    expect(restUrl.searchParams.get("password")).toBe(PASSWORD)
    expect(restUrl.searchParams.get("fechaIni")).toBe("2026-01-01")
  })

  it("el canal TAE pide PRODUCTO=TAE en los dos servicios", async () => {
    fetchMock
      .mockResolvedValueOnce(xmlResponse(soapResponse({ items: [TAE_SOAP_ITEM] })))
      .mockResolvedValueOnce(jsonResponse(bluemaxResponse({ id: "0", desc: "No hay registros para el filtro seleccionado.", rut: " " })))

    const [diesel, bluemax] = await download([{ product: "diesel", ...PERIOD }, { product: "bluemax", ...PERIOD }], "TAE")

    expect(String(fetchMock.mock.calls[0]![1]?.body)).toContain("<con:PRODUCTO>TAE</con:PRODUCTO>")
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get("producto")).toBe("TAE")
    // Pasa por el parser XML real: `N&#xB0;` llega decodificado a la etiqueta de estación.
    expect(diesel && "report" in diesel ? diesel.report.records?.[0] : undefined).toMatchObject({ "Asignación": "PLANTA DEMOS", "Tipo de Tarjeta": "TAE", "Estación de Servicio": "2703-AV. LOS RIOS N° 745" })
    expect(bluemax).toEqual({ product: "bluemax", unavailable: true, reason: "no_records" })
  })

  it("«No hay registros» por SOAP es un mes sin cargas una vez que Copec ya entregó cargas de este cliente", async () => {
    const noRecords = () => xmlResponse(soapResponse({ id: "0", desc: "No hay registros para el filtro seleccionado.", rut: " " }))
    fetchMock.mockResolvedValueOnce(jsonResponse(bluemaxResponse({ items: [bluemaxItem()] }))).mockResolvedValueOnce(noRecords())
    const results = await withCopecWebServiceSession(async (session) => [
      ...await session.download([{ product: "bluemax", ...PERIOD }], "TCT"),
      ...await session.download([{ product: "diesel", ...PERIOD }], "TAE"),
    ])
    expect(results[1]).toEqual({ product: "diesel", unavailable: true, reason: "no_records" })
  })

  it("antes de cualquier carga, «No hay registros» no prueba nada: podría ser la respuesta a otro RUT", async () => {
    // `no_records` cierra un mes cerrado como vacío para siempre.
    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ id: "0", desc: "No hay registros para el filtro seleccionado.", rut: " " })))
    await expect(download([{ product: "diesel", ...PERIOD }])).resolves.toEqual([{ product: "diesel", unavailable: true, reason: "no_results" }])
  })

  it("un ID_MENSAJE 0 que no dice «No hay registros» es un rechazo con el motivo de Copec", async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ id: "0", desc: "El rango m&#xE1;ximo a consultar es de 31 d&#xED;as." })))
    const [result] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(result)).toEqual({ kind: "provider_rejected", message: expect.stringContaining("El rango máximo a consultar es de 31 días.") })
  })

  it("rechaza una respuesta cortada: anuncia más cargas de las que trae", async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ desc: "Cantidad de registros: 2.", items: [soapItem()] })))
    const [result] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(result)).toMatchObject({ kind: "invalid_file", message: expect.stringContaining("anunció 2") })
  })

  it("rechaza una respuesta de otro cliente", async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ items: [soapItem()], rut: `11111111-${computeRutDv("11111111")}` })))
    const [result] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(result)).toMatchObject({ kind: "invalid_file", message: expect.stringContaining("otro cliente") })
  })

  it("BlueMax con una sola carga como objeto suelto también se lee", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(bluemaxResponse({ items: bluemaxItem() })))
    const [result] = await download([{ product: "bluemax", ...PERIOD }])
    expect(result && "report" in result ? result.report.records : undefined).toHaveLength(1)
  })

  it("un cuerpo que no es XML o JSON es un archivo inválido", async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse("<html>mantención</html>")).mockResolvedValueOnce(jsonResponse("<html>"))
    const [diesel, bluemax] = await download([{ product: "diesel", ...PERIOD }, { product: "bluemax", ...PERIOD }])
    expect(failureOf(diesel)?.kind).toBe("invalid_file")
    expect(failureOf(bluemax)?.kind).toBe("invalid_file")
  })

  it("HTTP 403 es un rechazo y no se reintenta", async () => {
    fetchMock.mockResolvedValue(new Response("Authentication parameters missing", { status: 403 }))
    const [result] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(result)).toMatchObject({ kind: "provider_rejected", message: expect.stringContaining("HTTP 403") })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("una falla de red se reintenta una vez y su mensaje nunca repite la URL con la clave", async () => {
    // undici incluye la URL en algunos errores; en BlueMax la URL lleva la clave.
    const leaky = new TypeError(`fetch failed for https://www.copec.cl/?password=${encodeURIComponent(PASSWORD)}`)
    fetchMock.mockRejectedValueOnce(leaky).mockResolvedValueOnce(jsonResponse(bluemaxResponse({ items: [bluemaxItem()] })))
    const [recovered] = await download([{ product: "bluemax", ...PERIOD }])
    expect(recovered).toMatchObject({ unavailable: false, report: expect.anything() })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    fetchMock.mockRejectedValue(leaky)
    const [failed] = await download([{ product: "bluemax", ...PERIOD }])
    expect(failureOf(failed)?.kind).toBe("network")
    expect(JSON.stringify(failed)).not.toContain(PASSWORD)
    expect(JSON.stringify(failed)).not.toContain(encodeURIComponent(PASSWORD))
  })

  it("un plazo vencido no se reintenta", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    const [result] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(result)).toMatchObject({ kind: "network", message: expect.stringContaining("a tiempo") })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("sigue la redirección de Copec a otro de sus hosts, con la consulta intacta", async () => {
    // 2026-10-30: www.copec.cl respondió 308 hacia tarjetas-api.copec.cl.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 308, headers: { location: "https://otro-api.copec.cl/WS_ConsumosTCTBlue/consulta?x=1" } }))
      .mockResolvedValueOnce(jsonResponse(bluemaxResponse({ items: [bluemaxItem()] })))
    const [result] = await download([{ product: "bluemax", ...PERIOD }])
    expect(result).toMatchObject({ unavailable: false, report: expect.anything() })
    expect(new URL(String(fetchMock.mock.calls[1]![0])).host).toBe("otro-api.copec.cl")
  })

  it("no sigue una redirección fuera de Copec ni a HTTP: la URL lleva la clave", async () => {
    for (const location of ["https://copec.cl.example.com/x", "http://tarjetas-api.copec.cl/x"]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(new Response(null, { status: 308, headers: { location } }))
      const [result] = await download([{ product: "bluemax", ...PERIOD }])
      expect(failureOf(result)).toMatchObject({ kind: "provider_rejected", message: expect.stringContaining("redirección que no se sigue") })
      expect(fetchMock).toHaveBeenCalledOnce()
    }
  })

  it("una falla de diésel no se lleva BlueMax", async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse("<html>mantención</html>")).mockResolvedValueOnce(jsonResponse(bluemaxResponse({ items: [bluemaxItem()] })))
    const [diesel, bluemax] = await download([{ product: "diesel", ...PERIOD }, { product: "bluemax", ...PERIOD }])
    expect(failureOf(diesel)?.kind).toBe("invalid_file")
    expect(bluemax).toMatchObject({ unavailable: false })
  })

  it("un rechazo de acceso corta el resto de la sesión: no se insiste con las credenciales", async () => {
    for (const rejection of [new Response("", { status: 401 }), xmlResponse(soapResponse({ id: "0", desc: "Cliente no Existe" }))]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(rejection)
      const results = await withCopecWebServiceSession(async (session) => [
        ...await session.download([{ product: "diesel", ...PERIOD }, { product: "bluemax", ...PERIOD }], "TCT"),
        ...await session.download([{ product: "diesel", ...PERIOD }], "TAE"),
      ])
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(results.map((result) => failureOf(result)?.kind)).toEqual(["provider_rejected", "provider_rejected", "provider_rejected"])
      expect(failureOf(results[2])?.message).toBe(failureOf(results[0])?.message)
    }
  })

  it("un SOAP Fault con HTTP 500 es un rechazo con su motivo, no una caída, y no se reintenta", async () => {
    const fault = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>Parametro invalido: PRODUCTO</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`
    fetchMock.mockResolvedValue(xmlResponse(fault, 500))
    const [result] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(result)).toMatchObject({ kind: "provider_rejected", message: expect.stringContaining("Parametro invalido: PRODUCTO") })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("un 5xx sin Fault se reintenta una vez y queda como falla de red; un 429 es un límite", async () => {
    // Una respuesta nueva por llamada: el cuerpo de un `Response` se lee una sola vez.
    fetchMock.mockImplementation(async () => new Response("Bad Gateway", { status: 502 }))
    const [down] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(down)).toMatchObject({ kind: "network", message: expect.stringContaining("HTTP 502") })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response("", { status: 429 }))
    const [limited] = await download([{ product: "bluemax", ...PERIOD }])
    expect(failureOf(limited)?.kind).toBe("provider_limit")
  })

  it("el texto de Copec se tacha si repite las credenciales", async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ id: "0", desc: `Usuario usuario con clave ${PASSWORD.replace("&", "&amp;").replace("<", "&lt;")} bloqueado` })))
    const [result] = await download([{ product: "diesel", ...PERIOD }])
    const message = failureOf(result)?.message ?? ""
    expect(message).toContain("bloqueado")
    expect(message).not.toContain(PASSWORD)
    expect(message).not.toMatch(/\busuario\b.*\busuario\b/)
  })

  it("una respuesta exitosa sin cargas, o con el conteo con separador de miles que no calza, es inválida", async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ desc: "Cantidad de registros: 0." })))
    const [empty] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(empty)).toMatchObject({ kind: "invalid_file", message: expect.stringContaining("sin cargas") })

    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ desc: "Cantidad de registros: 1.234.", items: [soapItem()] })))
    const [short] = await download([{ product: "diesel", ...PERIOD }])
    expect(failureOf(short)).toMatchObject({ kind: "invalid_file", message: expect.stringContaining("anunció 1234") })
  })

  it("una fecha u hora con otra forma falla el producto en vez de fechar la carga a medianoche", async () => {
    const variants: Record<string, string>[] = [{ HORA_TRX: "9:05:00" }, { HORA_TRX: "" }, { FECHA_TRX: "05-01-2026" }]
    for (const over of variants) {
      fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ items: [soapItem(over)] })))
      const [result] = await download([{ product: "diesel", ...PERIOD }])
      expect(failureOf(result)).toMatchObject({ kind: "invalid_file", message: expect.stringContaining("formato de fecha u hora") })
    }
  })

  it("COPEC_SOURCE=ws despacha al web service, y un valor mal escrito detiene la corrida", async () => {
    vi.stubEnv("COPEC_SOURCE", "ws")
    fetchMock.mockResolvedValueOnce(xmlResponse(soapResponse({ items: [soapItem()] })))
    const [result] = await withCopecSourceSession((session) => session.download([{ product: "diesel", ...PERIOD }], "TCT"))
    expect(result).toMatchObject({ unavailable: false })
    expect(fetchMock).toHaveBeenCalledOnce()

    vi.stubEnv("COPEC_SOURCE", "portall")
    await expect(withCopecSourceSession(async () => "no debería correr")).rejects.toThrow(/COPEC_SOURCE/)
  })

  it("no consulta más de 31 días por vez", async () => {
    await expect(download([{ product: "diesel", from: "2026-01-01", to: "2026-02-28" }])).rejects.toThrow(/31 días/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin RUT cliente, o con uno inválido, la corrida cae antes de consultar", async () => {
    vi.stubEnv("COPEC_CLIENT_RUT", "")
    await expect(download([{ product: "diesel", ...PERIOD }])).rejects.toThrow(/COPEC_CLIENT_RUT/)
    vi.stubEnv("COPEC_CLIENT_RUT", "76123456-X")
    await expect(download([{ product: "diesel", ...PERIOD }])).rejects.toThrow(/no es un RUT válido/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
