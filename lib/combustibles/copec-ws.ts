/**
 * Web services de consulta de Copec (documento «Web Service TCT v2.1»): la
 * fuente de los informes de detalle sin navegador, sin código por correo y sin
 * una sesión de portal que cuidar.
 *
 * La respuesta real no es la del PDF (verificado el 2026-10-30 contra ene-2026:
 * 505 cargas, las mismas del Excel del portal, sin una diferencia):
 * - SOAP trae la guía de despacho en `CDENROGUIA`, que el PDF no lista, y no
 *   trae `FACTURA`. El éxito es `ID_MENSAJE` "1", no "OK".
 * - `ID_MENSAJE` "0" sirve igual para «No hay registros para el filtro
 *   seleccionado.» que para un error («El rango máximo a consultar es de 31
 *   días.»): se distingue por el texto.
 * - SOAP es sólo diésel. BlueMax es otro servicio, responde JSON (no XML) bajo
 *   `detalle.item` y también trae guía y odómetro.
 *
 * Cada fila se traduce a las MISMAS columnas del Excel de «Descargar Detalle»,
 * con los mismos valores, y pasa por los mismos parsers. No es cosmético: la
 * identidad de una carga en el ledger es un hash de fecha, hora, patente,
 * tarjeta, litros, precio, monto y estación (`copec-events.ts`). Una carga
 * traída por acá tiene que dar el mismo hash que la misma carga importada antes
 * desde el Excel; si no, cada mes ya importado aparecería entero como
 * «corrección pendiente de revisión».
 *
 * Credenciales: las del portal (`COPEC_USERNAME`/`COPEC_PASSWORD`, usuario
 * ADMINISTRADOR CLIENTE) más `COPEC_CLIENT_RUT`. BlueMax las exige en la query
 * string, así que ningún error de este módulo repite la URL ni el mensaje de
 * `fetch`, que la puede incluir.
 */

import { XMLParser } from "fast-xml-parser"
import { cleanRut, validateRut } from "@/lib/rut"
import {
  CopecReportFailure,
  CopecReportTimeoutFailure,
  retryCopecRequest,
  withCopecPortalSession,
  type CopecChannel,
  type CopecPortalSession,
  type CopecProduct,
  type CopecReportDownloadResult,
  type CopecReportRequest,
} from "@/lib/combustibles/copec-reports"

const SOAP_URL = "https://ventas-api.copec.cl/WS_consTCTTAC/services/ConsultaTCTWSS"
const SOAP_ACTION = "http://www.example.org/WS_consTCTTACNEW/ConsultaTCTWSS"
/** El PDF dice `www.copec.cl`, que desde 2026-10-30 responde 308 hacia este host. */
const BLUEMAX_URL = "https://tarjetas-api.copec.cl/WS_ConsumosTCTBlue/api/WS_ConsumosTCTBlue/consultaConsumosBlue"
/** Copec ya movió un servicio una vez; se sigue la redirección sólo dentro de sus dominios, porque la URL de BlueMax lleva la clave. */
const MAX_REDIRECTS = 2

/** Un mes completo tardó 2–4 s en las pruebas; el portal tardaba hasta un minuto. */
const REQUEST_TIMEOUT_MS = 60_000
const MAX_BYTES = 25 * 1024 * 1024
/** Lo responde Copec al pasarse: «El rango máximo a consultar es de 31 días.» */
const MAX_RANGE_DAYS = 31

export const COPEC_WS_PARSER_VERSION = "copec-ws-v1"

const PRODUCT_LABEL: Record<CopecProduct, string> = { diesel: "Diésel", bluemax: "BlueMax" }

/** `CDEMARCTAE` → el «Tipo de Tarjeta» que escribe el Excel. */
const CARD_TYPE: Record<string, string> = { "3": "TCT", "1": "TCT PREMIUM", "9": "TAE" }

export type CopecSource = "ws" | "portal"

/**
 * `COPEC_SOURCE` elige la fuente. Sin él, el web service se usa en cuanto hay
 * `COPEC_CLIENT_RUT`, y si no, el portal: un despliegue que todavía no tiene el
 * RUT sigue sincronizando como antes en vez de quedarse sin fuente.
 */
export function copecSource(): CopecSource {
  const explicit = process.env.COPEC_SOURCE?.trim().toLowerCase()
  if (explicit === "ws" || explicit === "portal") return explicit
  return process.env.COPEC_CLIENT_RUT?.trim() ? "ws" : "portal"
}

/**
 * `COPEC_SOURCE=portal` es la palanca para volver al portal: un valor mal
 * escrito («portall») no puede dejar la fuente en `ws` sin que nadie lo note.
 * Lo valida la corrida; la pantalla sólo describe y usa `copecSource`.
 */
function assertCopecSourceSetting() {
  const explicit = process.env.COPEC_SOURCE?.trim()
  if (explicit && !["ws", "portal"].includes(explicit.toLowerCase())) {
    throw new Error("COPEC_SOURCE debe ser «ws» o «portal» (o quedar vacío).")
  }
}

interface CopecWsConfig {
  username: string
  password: string
  /** `12345678-9`, como lo pide SOAP y BlueMax. */
  clientRut: string
}

/**
 * Lanza un `Error` plano, no una `CopecReportFailure`: sin configuración no hay
 * mes que registrar como fallido, y la corrida entera tiene que caer con un
 * motivo que se pueda corregir.
 */
function readCopecWsConfig(): CopecWsConfig {
  const username = process.env.COPEC_USERNAME?.trim()
  const password = process.env.COPEC_PASSWORD?.trim()
  const rawRut = process.env.COPEC_CLIENT_RUT?.trim()
  if (!username || !password) throw new Error("Faltan COPEC_USERNAME y COPEC_PASSWORD para consultar los web services de Copec.")
  if (!rawRut) throw new Error("Falta COPEC_CLIENT_RUT (RUT de la empresa cliente de Copec) para consultar los web services de Copec.")
  if (!validateRut(rawRut)) throw new Error("COPEC_CLIENT_RUT no es un RUT válido.")
  return { username, password, clientRut: cleanRut(rawRut) }
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!)
}

/** Copec rellena con espacios y ceros a la izquierda, y escribe los decimales con punto. */
function wsNumber(value: unknown): number | string | null {
  const raw = text(value)
  if (!raw) return null
  // Un texto con punto llegaría a `parseExactChileanDecimal`, que lee el punto
  // como separador de miles: 54.15 litros serían 5.415. Como número, el parser
  // lo trata igual que la celda numérica del Excel. Lo que no tenga forma de
  // número sigue como texto para que el parser lo rechace con su motivo.
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw
}

/** El Excel entrega la fecha como `Date` a medianoche UTC. */
function wsDate(value: unknown): Date | string | null {
  const raw = text(value)
  if (!raw) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : raw
}

/** …y la hora como `Date` sobre la época de Excel (1899-12-30), en UTC. */
function wsTime(value: unknown): Date | null {
  const raw = text(value)
  return /^\d{2}:\d{2}:\d{2}$/.test(raw) ? new Date(`1899-12-30T${raw}.000Z`) : null
}

/**
 * `000660016527` → `660016527`, que es lo que dice la celda numérica del Excel.
 * Una guía toda en ceros es el relleno de Copec para «sin guía», no la guía 0:
 * como «0» juntaría en una sola identidad todas las cargas sin guía.
 */
function wsGuide(value: unknown): string | null {
  const raw = text(value)
  return raw && !/^0+$/.test(raw) ? raw.replace(/^0+(?=\d)/, "") : null
}

/**
 * La etiqueta de estación del Excel: «2017-RUTA 5 SUR KM 383,3». El web service
 * entrega el código SAP de la instalación (`0000020017`) y la descripción por
 * separado. El portal muestra un código de cuatro dígitos, que es el primero
 * del SAP más sus tres últimos (20017 → 2017, 60470 → 6470), y corta la
 * etiqueta en 40 caracteres. Reconstruida así coincidió en las 505 cargas de
 * ene-2026.
 *
 * La etiqueta entra en la identidad de la carga. Un código con otra forma se
 * deja entero: si esa carga ya había entrado por el Excel, queda en revisión
 * como posible corrección, en vez de duplicarse en silencio.
 */
export function copecStationLabel(installation: unknown, description: unknown): string | null {
  const code = text(installation).replace(/^0+(?=\d)/, "")
  const name = text(description)
  if (!code && !name) return null
  const portalCode = /^\d0\d{3}$/.test(code) ? `${code[0]}${code.slice(2)}` : code
  return (portalCode ? `${portalCode}-${name}` : name).slice(0, 40)
}

/** SOAP mezcla mayúsculas y minúsculas (`CDEVOLCONS`, `dESCUENTO`); BlueMax va todo en minúscula. */
function fieldReader(item: Record<string, unknown>) {
  const byKey = new Map(Object.entries(item).map(([key, value]) => [key.toLowerCase(), value]))
  return (name: string) => byKey.get(name)
}

/**
 * Una fila del web service con las columnas del Excel. El RUT del conductor no
 * se copia: el parser lo descartaría igual (`withoutPersonalData`), y así ni
 * siquiera pasa por acá.
 */
export function copecWsItemToRecord(item: Record<string, unknown>, product: CopecProduct, channel: CopecChannel, index: number): Record<string, unknown> & { __row: number } {
  const get = fieldReader(item)
  const cardType = text(get("cdemarctae"))
  const assignedTo = text(get("cdepatcond"))
  return {
    __row: index + 1,
    Producto: PRODUCT_LABEL[product],
    Tarjeta: text(get("tarjeta")),
    "Tipo de Tarjeta": CARD_TYPE[cardType] ?? cardType,
    // TAE no tiene patente: en esa columna Copec pone el nombre de la vasija,
    // cortado en 12 caracteres igual que en el Excel («PLANTA MASIS»).
    ...(channel === "TAE" ? { "Asignación": assignedTo } : { Patente: assignedTo }),
    "N° Vehículo": wsNumber(get("cdevehcond")),
    Departamento: text(get("dptodesc")),
    Región: text(get("region")),
    "Estación de Servicio": copecStationLabel(get("instalacion"), get("insdesc")),
    "Fecha Transacción": wsDate(get("fecha_trx")),
    "Hora Transacción": wsTime(get("hora_trx")),
    "Guía de Despacho": wsGuide(get("cdenroguia")),
    Precio: wsNumber(get("cdeprecio")),
    Volumen: wsNumber(get("cdevolcons")),
    Monto: wsNumber(get("cdemoncons")),
    "Odómetro (Kms.)": wsNumber(get("cdeodom")),
    "Rendimiento (Kms. por Litro)": wsNumber(get("cdekmlt")),
    "Rendimiento ($ por Km.)": wsNumber(get("cdepesokm")),
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Todo como texto: «000660016527» no puede perder sus ceros antes de que
  // decidamos qué es, ni «54.15» pasar por coma flotante dos veces.
  parseTagValue: false,
  trimValues: false,
  // `&#xD1;UBLE` → «ÑUBLE», `N&#xB0;` → «N°»: el Excel trae el texto ya decodificado.
  htmlEntities: true,
  isArray: (name) => name === "item",
})

interface WsEnvelope {
  id: string
  message: string
  clientRut: string
  items: Record<string, unknown>[]
}

/** El `soap:Fault` de una respuesta, si la hay: SOAP 1.1 lo manda con HTTP 500. */
function soapFault(body: Buffer): Record<string, unknown> | null {
  try {
    const document = xmlParser.parse(body.toString("utf8")) as Record<string, unknown>
    const soapBody = ((document.Envelope ?? {}) as Record<string, unknown>).Body as Record<string, unknown> | undefined
    const fault = soapBody?.Fault
    return fault && typeof fault === "object" ? fault as Record<string, unknown> : null
  } catch {
    return null
  }
}

function faultFailure(fault: Record<string, unknown>, label: string, redact: (value: string) => string): CopecReportFailure {
  const reason = text(fault.faultstring)
  const message = `Copec rechazó la consulta ${label}: ${redact(reason).slice(0, 200) || "error SOAP sin detalle"}.`
  return ACCESS_MESSAGE.test(reason) ? new CopecWsAccessFailure(message) : new CopecReportFailure("provider_rejected", message)
}

function readSoapEnvelope(body: Buffer, label: string, redact: (value: string) => string): WsEnvelope {
  let document: Record<string, unknown>
  try {
    document = xmlParser.parse(body.toString("utf8")) as Record<string, unknown>
  } catch {
    throw new CopecReportFailure("invalid_file", `Copec devolvió una respuesta ${label} que no es XML.`)
  }
  const envelope = (document.Envelope ?? {}) as Record<string, unknown>
  const soapBody = (envelope.Body ?? {}) as Record<string, unknown>
  const fault = soapBody.Fault as Record<string, unknown> | undefined
  if (fault) throw faultFailure(fault, label, redact)
  const result = soapBody.consultaTCTTACReturn as Record<string, unknown> | undefined
  if (!result || typeof result !== "object") throw new CopecReportFailure("invalid_file", `La respuesta ${label} de Copec no trae el resultado de la consulta.`)
  const detail = result.DETALLE as { item?: Record<string, unknown>[] } | string | undefined
  return {
    id: text(result.ID_MENSAJE),
    message: text(result.DESC_MENSAJE),
    clientRut: text(result.RUT_CLIENTE),
    items: typeof detail === "object" && detail?.item ? detail.item : [],
  }
}

function readBluemaxEnvelope(body: Buffer, label: string): WsEnvelope {
  let document: Record<string, unknown>
  try {
    document = JSON.parse(body.toString("utf8")) as Record<string, unknown>
  } catch {
    throw new CopecReportFailure("invalid_file", `Copec devolvió una respuesta ${label} que no es JSON.`)
  }
  if (!document || typeof document !== "object") throw new CopecReportFailure("invalid_file", `La respuesta ${label} de Copec está vacía.`)
  const detail = document.detalle as { item?: unknown } | null | undefined
  // Un serializador XML→JSON entrega un objeto suelto cuando hay una sola fila.
  const items = detail?.item === undefined || detail.item === null ? [] : [detail.item].flat() as Record<string, unknown>[]
  return { id: text(document.idMensaje), message: text(document.descMensaje), clientRut: text(document.rutCliente), items }
}

/**
 * Un rechazo de acceso (HTTP 401/403, o un mensaje de Copec sobre usuario,
 * clave o cliente) corta el resto de la sesión: con las credenciales del portal,
 * repetir el intento por cada producto, canal y mes podría bloquear la cuenta.
 * Es lo que hace el portal con `LOGIN_FAILURES`.
 */
export class CopecWsAccessFailure extends CopecReportFailure {
  constructor(message: string) {
    super("provider_rejected", message)
    this.name = "CopecWsAccessFailure"
  }
}

const ACCESS_MESSAGE = /usuario|clave|contrase|credencial|autentic|autoriz|cliente no (?:existe|vigente)/i

/** El texto que devuelve Copec se muestra y se guarda: nunca con las credenciales, ni aunque las repita. */
function redactor(config: CopecWsConfig) {
  const secrets = [config.username, config.password].flatMap((value) => [value, escapeXml(value), encodeURIComponent(value)])
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)
  return (value: string) => secrets.reduce((result, secret) => result.split(secret).join("***"), value)
}

/**
 * La fecha y la hora entran en la identidad de la carga. El Excel siempre las
 * trajo, y el web service en `YYYY-MM-DD` y `HH:MM:SS` (ene y oct-2026). Otra
 * forma es un cambio de formato de Copec: se falla el producto en vez de
 * fecharla a medianoche o leer el día y el mes al revés.
 */
function assertItemDates(items: Record<string, unknown>[], label: string) {
  for (const item of items) {
    const get = fieldReader(item)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(get("fecha_trx"))) || !/^\d{2}:\d{2}:\d{2}$/.test(text(get("hora_trx")))) {
      throw new CopecReportFailure("invalid_file", `Copec cambió el formato de fecha u hora de las cargas ${label}; no se importó para no fecharlas mal.`)
    }
  }
}

/** Lo que significa la respuesta, ya separadas las filas de «no hubo nada» y de un rechazo. */
function interpretEnvelope(envelope: WsEnvelope, expectedRut: string, label: string, redact: (value: string) => string): "records" | "no_records" {
  if (envelope.id === "1") {
    if (envelope.clientRut && cleanRut(envelope.clientRut) !== expectedRut) {
      throw new CopecReportFailure("invalid_file", `Copec respondió la consulta ${label} con datos de otro cliente.`)
    }
    // El encabezado anuncia cuántas filas manda. Una respuesta cortada en el
    // camino se parsea igual, sólo que con menos cargas: sin este cruce el mes
    // quedaría «completo» con litros de menos.
    // «1.234» con separador de miles también cuenta: no es 1.
    const announced = /Cantidad de registros:\s*(\d[\d.,]*)/i.exec(envelope.message)
    const announcedCount = announced ? Number(announced[1]!.replace(/[.,]/g, "")) : null
    if (announcedCount !== null && announcedCount !== envelope.items.length) {
      throw new CopecReportFailure("invalid_file", `Copec anunció ${announcedCount} cargas ${label} y entregó ${envelope.items.length}.`)
    }
    if (!envelope.items.length) throw new CopecReportFailure("invalid_file", `Copec respondió la consulta ${label} como exitosa pero sin cargas.`)
    return "records"
  }
  if (/no hay registros/i.test(envelope.message)) return "no_records"
  const message = `Copec rechazó la consulta ${label}: ${redact(envelope.message).slice(0, 200) || "sin mensaje"}.`
  throw ACCESS_MESSAGE.test(envelope.message) ? new CopecWsAccessFailure(message) : new CopecReportFailure("provider_rejected", message)
}

/**
 * Destino de una redirección, sólo si sigue en HTTPS y en un dominio de Copec.
 * `fetch` la seguiría a cualquier parte con la query intacta, clave incluida.
 */
function allowedRedirect(response: Response, from: string): string | null {
  if (![301, 302, 307, 308].includes(response.status)) return null
  const location = response.headers.get("location")
  if (!location) return null
  let target: URL
  try { target = new URL(location, from) } catch { return null }
  return target.protocol === "https:" && (target.hostname === "copec.cl" || target.hostname.endsWith(".copec.cl")) ? target.toString() : null
}

/** Ni la URL ni el error de `fetch`: en BlueMax la URL lleva usuario y clave. */
async function requestCopec(url: string, init: RequestInit, label: string, redact: (value: string) => string): Promise<{ body: Buffer; contentType: string }> {
  let response: Response
  let body: Buffer
  try {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    let target = url
    response = await fetch(target, { ...init, redirect: "manual", signal })
    // 301/302 sólo en GET: con POST, un cliente puede cambiarlos a GET y perder el sobre SOAP.
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const next = (init.method ?? "GET") === "GET" || [307, 308].includes(response.status) ? allowedRedirect(response, target) : null
      if (!next) break
      await response.body?.cancel()
      target = next
      response = await fetch(target, { ...init, redirect: "manual", signal })
    }
    body = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    // `AbortSignal.timeout` rechaza con un `DOMException`: se compara por nombre.
    if ((error as { name?: unknown } | null)?.name === "TimeoutError") throw new CopecReportTimeoutFailure(`Copec no respondió la consulta ${label} a tiempo.`)
    throw new CopecReportFailure("network", `No fue posible conectar con el web service de Copec (${label}).`)
  }
  if (response.status >= 300 && response.status < 400) throw new CopecReportFailure("provider_rejected", `Copec respondió la consulta ${label} con una redirección que no se sigue (HTTP ${response.status}): sólo se siguen las que van por HTTPS a un servicio de Copec, y nunca las que cambiarían un POST.`)
  if (response.status === 401 || response.status === 403) throw new CopecWsAccessFailure(`Copec rechazó la consulta ${label} por credenciales (HTTP ${response.status}).`)
  if (response.status === 429) throw new CopecReportFailure("provider_limit", `Copec limitó las consultas ${label} (HTTP 429).`)
  // Un Fault no es una caída: es Copec rechazando la consulta. Reintentarlo
  // sólo repetiría el envío de las credenciales.
  const fault = response.status >= 500 ? soapFault(body) : null
  if (fault) throw faultFailure(fault, label, redact)
  if (response.status >= 500) throw new CopecReportFailure("network", `El web service de Copec falló en la consulta ${label} (HTTP ${response.status}).`)
  if (response.status !== 200) throw new CopecReportFailure("provider_rejected", `Copec respondió la consulta ${label} con HTTP ${response.status}.`)
  if (body.byteLength === 0) throw new CopecReportFailure("invalid_file", `Copec respondió la consulta ${label} sin contenido.`)
  if (body.byteLength > MAX_BYTES) throw new CopecReportFailure("invalid_file", `La respuesta ${label} de Copec excede el tamaño permitido.`)
  return { body, contentType: response.headers.get("content-type") ?? "application/octet-stream" }
}

function soapRequest(config: CopecWsConfig, channel: CopecChannel, from: string, to: string): RequestInit {
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wss="wss.constcttac.services.wtmc.copec.cl" xmlns:con="http://constcttac.model.wtmc.copec.cl">`
    + `<soapenv:Header/><soapenv:Body><wss:in0>`
    + `<con:RUT_CLIENTE>${escapeXml(config.clientRut)}</con:RUT_CLIENTE>`
    + `<con:USUARIO>${escapeXml(config.username)}</con:USUARIO>`
    + `<con:PASSWORD>${escapeXml(config.password)}</con:PASSWORD>`
    + `<con:PRODUCTO>${channel}</con:PRODUCTO>`
    + `<con:FECHA_INI>${from}</con:FECHA_INI>`
    + `<con:FECHA_FIN>${to}</con:FECHA_FIN>`
    + `<con:PATENTE></con:PATENTE>`
    + `</wss:in0></soapenv:Body></soapenv:Envelope>`
  return { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: SOAP_ACTION }, body }
}

function bluemaxUrl(config: CopecWsConfig, channel: CopecChannel, from: string, to: string): string {
  const query = new URLSearchParams({ rut_cliente: config.clientRut, usuario: config.username, password: config.password, producto: channel, fechaIni: from, fechaFin: to, patente: "" })
  return `${BLUEMAX_URL}?${query}`
}

function assertRequest(request: CopecReportRequest) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.from) || !/^\d{4}-\d{2}-\d{2}$/.test(request.to)) throw new Error("Las fechas de la consulta Copec deben tener formato YYYY-MM-DD")
  if (request.from > request.to) throw new Error("La fecha desde no puede ser posterior a la fecha hasta")
  const days = (Date.parse(`${request.to}T00:00:00Z`) - Date.parse(`${request.from}T00:00:00Z`)) / 86_400_000 + 1
  if (days > MAX_RANGE_DAYS) throw new Error(`Copec permite consultar hasta ${MAX_RANGE_DAYS} días por vez`)
}

interface WsSessionState {
  readonly config: CopecWsConfig
  readonly redact: (value: string) => string
  /** Copec ya entregó cargas de ESTE cliente en la sesión: las credenciales y el RUT sirven. */
  accessConfirmed: boolean
  /** Rechazo de acceso de esta sesión: el resto de las consultas no se envía. */
  blocked: { kind: CopecReportFailure["kind"]; message: string } | null
}

async function downloadDetail(state: WsSessionState, request: CopecReportRequest, channel: CopecChannel): Promise<CopecReportDownloadResult> {
  const { product, from, to } = request
  const { config, redact } = state
  const label = `${channel} ${PRODUCT_LABEL[product]} ${from.slice(0, 7)}`
  const response = await retryCopecRequest(() => product === "diesel"
    ? requestCopec(SOAP_URL, soapRequest(config, channel, from, to), label, redact)
    : requestCopec(bluemaxUrl(config, channel, from, to), { method: "GET" }, label, redact))
  const envelope = product === "diesel" ? readSoapEnvelope(response.body, label, redact) : readBluemaxEnvelope(response.body, label)
  if (interpretEnvelope(envelope, config.clientRut, label, redact) === "no_records") {
    // «No hay registros» cierra un mes cerrado como vacío para siempre. Sólo
    // vale si Copec ya mostró en esta sesión que estas credenciales leen cargas
    // de este cliente; antes de eso podría ser su forma de decir «nada para
    // ti» (otro RUT, otro usuario), y entonces no prueba nada.
    return { product, unavailable: true, reason: state.accessConfirmed ? "no_records" : "no_results" }
  }
  assertItemDates(envelope.items, label)
  state.accessConfirmed = true
  return {
    product,
    unavailable: false,
    report: {
      buffer: response.body,
      fileName: `copec-ws-${channel.toLowerCase()}-${product}-${from.slice(0, 7)}.${product === "diesel" ? "xml" : "json"}`,
      contentType: response.contentType,
      records: envelope.items.map((item, index) => copecWsItemToRecord(item, product, channel, index)),
    },
  }
}

/**
 * Misma forma que la sesión del portal, así que la sincronización no distingue
 * de dónde vino el informe. Cada producto se consulta por separado: una falla
 * de diésel no se lleva BlueMax, igual que en el portal. La excepción es un
 * rechazo de acceso, que corta lo que queda de la sesión (`CopecWsAccessFailure`).
 */
export async function withCopecWebServiceSession<T>(run: (session: CopecPortalSession) => Promise<T>): Promise<T> {
  const config = readCopecWsConfig()
  const state: WsSessionState = { config, redact: redactor(config), accessConfirmed: false, blocked: null }
  return run({
    async download(requests, channel) {
      for (const request of requests) assertRequest(request)
      const results: CopecReportDownloadResult[] = []
      for (const request of requests) {
        if (state.blocked) {
          results.push({ product: request.product, unavailable: false, failure: state.blocked })
          continue
        }
        try {
          results.push(await downloadDetail(state, request, channel))
        } catch (error) {
          if (!(error instanceof CopecReportFailure)) throw error
          const failure = { kind: error.kind, message: error.message }
          if (error instanceof CopecWsAccessFailure) state.blocked = failure
          results.push({ product: request.product, unavailable: false, failure })
        }
      }
      return results
    },
  })
}

/** La sesión de la fuente configurada (`copecSource`): una por corrida, como la del portal. */
export async function withCopecSourceSession<T>(run: (session: CopecPortalSession) => Promise<T>): Promise<T> {
  assertCopecSourceSetting()
  return copecSource() === "ws" ? withCopecWebServiceSession(run) : withCopecPortalSession(run)
}
