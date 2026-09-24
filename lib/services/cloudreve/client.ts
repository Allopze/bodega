/**
 * Cliente HTTP delgado contra el endpoint WebDAV de Cloudreve (`/dav/`).
 *
 * Por qué WebDAV y no la API REST `/api/v4/`:
 * - el login de la API v4 crea una sesión que expira y puede exigir captcha;
 * - el upload simple de la API v4 sirve solo para archivos ≤ chunk_size
 *   (default 25 MB, justo el tope de la biblioteca SST) — más grande obliga a
 *   implementar el flujo de chunks;
 * - WebDAV expone PUT/GET/DELETE por path y PROPFIND devuelve el tamaño sin
 *   descargar el archivo (lo que `bulk-download` necesita ANTES de leer, ver
 *   app/api/prevencion/documentacion/bulk-download/route.ts).
 *
 * El secreto nunca aparece en errores ni logs: los errores tipificados llevan
 * un `code` seguro y, a lo más, el path relativo (que es un nanoid, no un
 * nombre de usuario).
 */

import { logger } from "@/lib/logger"
import { readCloudreveConfig } from "./settings"
import { remoteSstKey, sstLogicalSegments } from "./sst-path"
import { backupRemoteKey } from "./backup"

const DEFAULT_TIMEOUT_MS = 120_000
/** Errores de red donde reintentar NO puede duplicar datos. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export type CloudreveErrorCode =
  | "CLOUDREVE_NOT_CONFIGURED"
  | "CLOUDREVE_UPSTREAM"
  | "CLOUDREVE_NOT_FOUND"
  | "CLOUDREVE_AUTH"
  | "CLOUDREVE_TIMEOUT"
  | "CLOUDREVE_IO"

export class CloudreveError extends Error {
  constructor(readonly code: CloudreveErrorCode, message: string, readonly status?: number) {
    super(message)
    this.name = "CloudreveError"
  }
}

const MAX_RETRIES = 1

export function readCloudreveRequestTimeout(): number {
  const raw = process.env.CLOUDREVE_REQUEST_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.trunc(parsed) : DEFAULT_TIMEOUT_MS
}

/**
 * `<baseUrl>/dav/<clave remota>`, el único punto donde se arma una URL del
 * WebDAV. Una URL base mal escrita (`cloudreve.chome.cl`, sin esquema) hacía
 * que `new URL` lanzara un `TypeError: Invalid URL` crudo en mitad de cada
 * subida y descarga, que ningún caller sabía clasificar; acá se convierte en un
 * CloudreveError accionable que nombra dónde corregirlo.
 */
function davUrlFromKey(baseUrl: string, remoteKey: string, isCollection = false): URL {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  const suffix = remoteKey.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  const href = encodeURI(`${base}dav/`) + suffix + (isCollection && suffix ? "/" : "")

  let url: URL
  try {
    url = new URL(href)
  } catch {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", INVALID_BASE_URL_MESSAGE)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", INVALID_BASE_URL_MESSAGE)
  }
  return url
}

const INVALID_BASE_URL_MESSAGE =
  "La URL base de Cloudreve no es una dirección http(s) válida. Corríjala en Administración › Almacenamiento de documentos."

async function request(
  filePath: string,
  init: RequestInit,
  retriesLeft = MAX_RETRIES,
): Promise<Response> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError(
      "CLOUDREVE_NOT_CONFIGURED",
      "Cloudreve no está configurado. Configure las credenciales en Administración.",
    )
  }
  return requestKey(remoteSstKey(config.sstPath, filePath), init, retriesLeft)
}

/**
 * Igual que `request` pero sobre una clave remota arbitraria (no mapeada al
 * espacio SST). La usan los helpers de respaldo para operar en la carpeta de
 * snapshots (`backups/plataforma/...`), ajena a `sstPath`.
 */
async function requestKey(
  remoteKey: string,
  init: RequestInit,
  retriesLeft = MAX_RETRIES,
): Promise<Response> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError(
      "CLOUDREVE_NOT_CONFIGURED",
      "Cloudreve no está configurado. Configure las credenciales en Administración.",
    )
  }

  return send(davUrlFromKey(config.baseUrl, remoteKey), basicAuth(config), init, retriesLeft, remoteKey)
}

async function send(
  url: URL,
  auth: string,
  init: RequestInit,
  retriesLeft: number,
  logKey: string,
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: auth,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError"
    throw new CloudreveError(
      aborted ? "CLOUDREVE_TIMEOUT" : "CLOUDREVE_IO",
      aborted ? "Cloudreve no respondió a tiempo" : "No se pudo conectar con Cloudreve",
    )
  }

  if (response.ok) return response

  const status = response.status
  // Consumir el cuerpo para liberar la conexión (keep-alive de Node).
  await response.text().catch(() => undefined)

  if (status === 401 || status === 403) {
    throw new CloudreveError("CLOUDREVE_AUTH", "Cloudreve rechazó las credenciales", status)
  }
  if (status === 404) {
    throw new CloudreveError("CLOUDREVE_NOT_FOUND", "Archivo no encontrado en Cloudreve", status)
  }
  // Una escritura ambigua no se reintenta: el PUT puede haber aterrizado y el
  // error venir después; repetirlo a ciegas es inofensivo para el contenido
  // (mismo buffer) pero duplica el costo sin evidencia de fallo. DELETE es
  // idempotente, pero reintentar tras un 5xx tampoco aporta: el cleanup tolera
  // el error y el GC natural lo recoge después.
  const retryable = RETRYABLE_STATUSES.has(status)
    && init.method !== "PUT"
    && init.method !== "DELETE"
    && retriesLeft > 0
  if (retryable) {
    logger.warn("[storage/cloudreve] respuesta transitoria, reintentando", { logKey, status })
    return send(url, auth, init, retriesLeft - 1, logKey)
  }
  throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status}`, status)
}

/** Sube (o reemplaza) el contenido de un archivo en el espacio SST. */
export async function putCloudreveFile(filePath: string, buffer: Buffer): Promise<void> {
  const response = await request(filePath, {
    method: "PUT",
    body: new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
  })
  await response.text().catch(() => undefined)
}

/** Descarga el contenido de un archivo. Lanza CLOUDREVE_NOT_FOUND si no existe. */
export async function getCloudreveFile(filePath: string): Promise<Buffer> {
  const response = await request(filePath, { method: "GET" })
  return Buffer.from(await response.arrayBuffer())
}

/** Elimina un archivo. No lanza si no existe (mismo contrato que fs.unlink de cleanup). */
export async function deleteCloudreveFile(filePath: string): Promise<void> {
  try {
    const response = await request(filePath, { method: "DELETE" })
    await response.text().catch(() => undefined)
  } catch (error) {
    if (error instanceof CloudreveError && error.code === "CLOUDREVE_NOT_FOUND") return
    throw error
  }
}

/**
 * Tamaño del archivo vía PROPFIND `getcontentlength`, sin descargarlo.
 * Devuelve null si el archivo no existe (contrato de `statSstDocument`).
 */
export async function statCloudreveFile(filePath: string): Promise<{ size: number } | null> {
  let response: Response
  try {
    response = await request(filePath, {
      method: "PROPFIND",
      headers: { Depth: "0", "Content-Type": "application/xml" },
    })
  } catch (error) {
    if (error instanceof CloudreveError && error.code === "CLOUDREVE_NOT_FOUND") return null
    throw error
  }

  const body = await response.text()
  // Cloudreve puede responder con o sin prefijo de namespace en los tags DAV,
  // y con mayúsculas o minúsculas según el servidor WebDAV que lo atiende.
  const match = /<(?:d:)?getcontentlength>(\d+)<\/(?:d:)?getcontentlength>/i.exec(body)
  const size = match ? Number(match[1]) : null
  if (size === null || !Number.isFinite(size)) {
    // Un servidor que no entrega el tamaño rompe el preflight de bytes del
    // bulk-download: fallar en vez de dejar pasar un archivo sin medir.
    throw new CloudreveError("CLOUDREVE_IO", "PROPFIND no devolvió el tamaño del archivo")
  }
  return { size }
}

/** Lista los nombres de archivo del espacio SST en Cloudreve (para el backup del orquestador). */
export async function listSstDir(): Promise<string[]> {
  const response = await request("storage/sst-documents", {
    method: "PROPFIND",
    headers: { Depth: "1", "Content-Type": "application/xml" },
  })
  const body = await response.text()
  // Cada <response> de una PROPFIND Depth:1 lleva un <href> con la ruta.
  // Se ignoran las URLs de directorios y del propio root: los nombres de
  // archivo vienen al final de la ruta y no pueden contener "/" (validado
  // al subir), así que basta el último segmento.
  const names: string[] = []
  const responseBlocks = body.split(/<[a-zA-Z0-9]+:response\b|(?:\/)?<response\b/)
  for (const block of responseBlocks) {
    const href = /<[a-zA-Z0-9]+:href>([^<]+)<\/[a-zA-Z0-9]+:href>|<href>([^<]+)<\/href>/.exec(block)
    const raw = href?.[1] ?? href?.[2]
    if (!raw) continue
    const decoded = decodeURIComponent(raw.split("/").pop() ?? "")
    if (!decoded || decoded === "storage" || decoded === "sst-documents") continue
    names.push(decoded)
  }
  return names
}

/** Crea una colección (carpeta) en Cloudreve. Idempotente: 409/405 = ya existe. */
export async function mkdirCloudreveCollection(logicalPath: string): Promise<void> {
  // logicalPath = "storage/sst-documents/<seg>/..." → mapeo al sstPath configurado.
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  }
  const relKey = remoteSstKey(config.sstPath, logicalPath)
  const remoteSegments = relKey.split("/").filter(Boolean)
  if (remoteSegments.length === 0) {
    throw new CloudreveError("CLOUDREVE_IO", "Ruta de colección vacía")
  }
  const url = davUrlFromKey(config.baseUrl, remoteSegments.join("/"), true)
  const auth = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")

  let response: Response
  try {
    response = await fetch(url, {
      method: "MKCOL",
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch {
    throw new CloudreveError("CLOUDREVE_IO", "No se pudo crear la carpeta en Cloudreve")
  }
  if (response.ok) return
  const status = response.status
  await response.text().catch(() => undefined)
  if (status === 405 || status === 409 || status === 301) return // ya existe
  if (status === 401 || status === 403) {
    throw new CloudreveError("CLOUDREVE_AUTH", "Cloudreve rechazó las credenciales", status)
  }
  throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al crear la carpeta`, status)
}

/** Asegura que existan las carpetas padre de un path lógico de archivo. */
export async function ensureParentDirs(logicalFilePath: string): Promise<void> {
  const segments = sstLogicalSegments(logicalFilePath)
  // El último segmento es el archivo: sus padres son los segmentos previos.
  const parents = segments.slice(0, -1)
  for (let i = 1; i <= parents.length; i += 1) {
    await mkdirCloudreveCollection(`storage/sst-documents/${parents.slice(0, i).join("/")}`)
  }
}

/** Mueve una entrada (archivo o colección) dentro del WebDAV. */
export async function moveCloudreveEntry(fromLogical: string, toLogical: string): Promise<void> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  }
  const fromKey = remoteSstKey(config.sstPath, fromLogical)
  const toKey = remoteSstKey(config.sstPath, toLogical)
  const fromUrl = davUrlFromKey(config.baseUrl, fromKey)
  const toUrl = davUrlFromKey(config.baseUrl, toKey)
  const auth = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")

  let response: Response
  try {
    response = await fetch(fromUrl, {
      method: "MOVE",
      headers: {
        Authorization: `Basic ${auth}`,
        Destination: toUrl.href,
        Overwrite: "F",
      },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch {
    throw new CloudreveError("CLOUDREVE_IO", "No se pudo mover la entrada en Cloudreve")
  }
  if (response.ok) return
  const status = response.status
  await response.text().catch(() => undefined)
  if (status === 405 || status === 501) {
    // El servidor no soporta MOVE: fallback copy+delete.
    await copyThenDelete(fromKey, toKey)
    return
  }
  if (status === 401 || status === 403) {
    throw new CloudreveError("CLOUDREVE_AUTH", "Cloudreve rechazó las credenciales", status)
  }
  throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al mover`, status)
}

/** Copy+delete para servidores sin MOVE (colecciones). Opera por clave remota. */
async function copyThenDelete(fromKey: string, toKey: string): Promise<void> {
  // Para el espacio SST las colecciones no son enormes: listar + copiar.
  const files = await listRemoteFilesRecursive(fromKey)
  for (const file of files) {
    const buffer = await fetchRemoteBuffer(`${fromKey}/${file}`)
    await putRemoteBuffer(`${toKey}/${file}`, buffer)
  }
  // Borrado del origen (mejor esfuerzo, el árbol se re-verifica en migración).
  for (const file of files) {
    await deleteRemote(`${fromKey}/${file}`).catch(() => undefined)
  }
}

/** GET directo por clave remota (sin validación de path lógico). */
async function fetchRemoteBuffer(remoteKey: string): Promise<Buffer> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  const url = remoteDavUrl(config, remoteKey)
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuth(config) },
    signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
  })
  if (!response.ok) {
    const status = response.status
    await response.text().catch(() => undefined)
    throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al leer`, status)
  }
  return Buffer.from(await response.arrayBuffer())
}

/** PUT directo por clave remota. */
async function putRemoteBuffer(remoteKey: string, buffer: Buffer): Promise<void> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  const url = remoteDavUrl(config, remoteKey)
  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: basicAuth(config) },
    body: new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
    signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
  })
  if (!response.ok) {
    const status = response.status
    await response.text().catch(() => undefined)
    throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al escribir`, status)
  }
  await response.text().catch(() => undefined)
}

/** DELETE directo por clave remota (no lanza si no existe). */
async function deleteRemote(remoteKey: string): Promise<void> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  const url = remoteDavUrl(config, remoteKey)
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: basicAuth(config) },
    signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
  })
  if (!response.ok && response.status !== 404) {
    const status = response.status
    await response.text().catch(() => undefined)
    throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al borrar`, status)
  }
  await response.text().catch(() => undefined)
}

function remoteDavUrl(config: { baseUrl: string }, remoteKey: string): URL {
  return davUrlFromKey(config.baseUrl, remoteKey)
}

/** Pathname (sin slash final) de un href, sea absoluto o relativo a /dav/. */
function hrefPathname(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "")
  try {
    return new URL(trimmed).pathname.replace(/\/+$/, "")
  } catch {
    return trimmed.replace(/\/+$/, "")
  }
}

/**
 * Prueba la configuración GUARDADA (no la escrita en el formulario) con un
 * PROPFIND sobre la carpeta remota del espacio SST —no sobre la raíz del
 * WebDAV—: la carpeta mal configurada es el error más frecuente y contra la
 * raíz pasaba la prueba igual. No expone credenciales: el veredicto es acotado.
 */
export async function probeCloudreveConnection(): Promise<{ ok: boolean; message: string }> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    return { ok: false, message: "Faltan credenciales de Cloudreve: configure URL, usuario y contraseña antes de probar." }
  }

  let url: URL
  try {
    url = davUrlFromKey(config.baseUrl, remoteSstKey(config.sstPath, "storage/sst-documents"), true)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof CloudreveError ? error.message : "La configuración de Cloudreve no es válida.",
    }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: "PROPFIND",
      headers: { Authorization: basicAuth(config), Depth: "0", "Content-Type": "application/xml" },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch {
    return { ok: false, message: "No se pudo conectar con Cloudreve: revise la URL y que el servidor sea alcanzable." }
  }

  await response.text().catch(() => undefined)
  const folderLabel = config.sstPath === "" ? "la raíz de la cuenta WebDAV" : `«${config.sstPath}»`
  if (response.ok) {
    return { ok: true, message: `Conexión con Cloudreve verificada sobre ${folderLabel}.` }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: "Cloudreve rechazó las credenciales (401/403): revise el usuario y la contraseña." }
  }
  if (response.status === 404) {
    return { ok: false, message: `Cloudreve respondió, pero la carpeta remota ${folderLabel} no existe: revise el campo «Carpeta remota».` }
  }
  return { ok: false, message: `Cloudreve respondió ${response.status} en el PROPFIND de verificación.` }
}

function basicAuth(config: { username: string; password: string }): string {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`
}

async function listRemoteFilesRecursive(prefixKey: string): Promise<string[]> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  }
  const url = remoteDavUrl(config, prefixKey)
  const auth = basicAuth(config)

  const response = await fetch(url, {
    method: "PROPFIND",
    headers: { Authorization: auth, Depth: "1", "Content-Type": "application/xml" },
    signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
  })
  if (!response.ok) {
    const status = response.status
    await response.text().catch(() => undefined)
    if (status === 404) return []
    throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al listar`, status)
  }

  // La entrada del propio directorio se identifica por su pathname igual a la
  // URL pedida: descartarla evita que el walk se trague a sí mismo como hijo,
  // incluido el caso raíz (prefixKey vacío).
  const selfPath = url.pathname.replace(/\/+$/, "")

  const body = await response.text()
  const blocks = body.split(/<[a-zA-Z0-9]+:response\b|(?:\/)?<response\b/)
  const children: string[] = []
  const collections: string[] = []
  for (const block of blocks) {
    const href = /<[a-zA-Z0-9]+:href>([^<]+)<\/[a-zA-Z0-9]+:href>|<href>([^<]+)<\/href>/.exec(block)
    const raw = href?.[1] ?? href?.[2]
    if (!raw) continue
    const isCollection = /<[a-zA-Z0-9]+:collection\s*\/?>/.test(block)
    const decodedPath = hrefPathname(raw)
    if (decodedPath === selfPath) continue
    const name = decodeURIComponent(decodedPath.split("/").pop() ?? "")
    if (!name) continue
    if (isCollection) collections.push(name)
    else children.push(name)
  }

  const files: string[] = [...children]
  for (const collection of collections) {
    const nested = await listRemoteFilesRecursive(`${prefixKey ? `${prefixKey}/` : ""}${collection}`)
    for (const file of nested) files.push(`${collection}/${file}`)
  }
  return files
}

/**
 * Lista recursiva de los paths relativos de ARCHIVOS en el espacio SST
 * (incluye subcarpetas y Archivados), para el backup del orquestador.
 */
export async function listSstFilesRecursive(): Promise<string[]> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  }
  return listRemoteFilesRecursive(config.sstPath)
}

// ── Respaldos (carpeta de snapshots, fuera del espacio SST) ───────────────────

/** MKCOL sobre una clave remota arbitraria. Idempotente: 405/409/301 = ya existe. */
async function mkcolRemoteKey(remoteKey: string): Promise<void> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  }
  const url = davUrlFromKey(config.baseUrl, remoteKey, true)
  const auth = basicAuth(config)

  let response: Response
  try {
    response = await fetch(url, {
      method: "MKCOL",
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch {
    throw new CloudreveError("CLOUDREVE_IO", "No se pudo crear la carpeta en Cloudreve")
  }
  if (response.ok) return
  const status = response.status
  await response.text().catch(() => undefined)
  if (status === 405 || status === 409 || status === 301) return // ya existe
  if (status === 401 || status === 403) {
    throw new CloudreveError("CLOUDREVE_AUTH", "Cloudreve rechazó las credenciales", status)
  }
  throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al crear la carpeta`, status)
}

/** Crea las colecciones padre de un snapshot: `basePath` y `basePath/<fecha>`. */
export async function ensureCloudreveBackupCollection(basePath: string, dateStr: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error("Fecha de snapshot inválida")
  const segments = basePath ? basePath.split("/") : []
  let acc = ""
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment
    await mkcolRemoteKey(acc)
  }
  await mkcolRemoteKey(basePath ? `${basePath}/${dateStr}` : dateStr)
}

/** Sube (o reemplaza) un artefacto de snapshot en la carpeta de respaldos. */
export async function putCloudreveBackupFile(
  basePath: string,
  dateStr: string,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  await putCloudreveKey(backupRemoteKey(basePath, dateStr, fileName), buffer)
}

/** Descarga un artefacto de snapshot. Lanza CLOUDREVE_NOT_FOUND si no existe. */
export async function getCloudreveBackupFile(
  basePath: string,
  dateStr: string,
  fileName: string,
): Promise<Buffer> {
  const response = await requestKey(backupRemoteKey(basePath, dateStr, fileName), { method: "GET" })
  return Buffer.from(await response.arrayBuffer())
}

/** Tamaño remoto de un artefacto vía PROPFIND; null si no existe. */
export async function statCloudreveBackupFile(
  basePath: string,
  dateStr: string,
  fileName: string,
): Promise<{ size: number } | null> {
  return statCloudreveKey(backupRemoteKey(basePath, dateStr, fileName))
}

/** Fechas (YYYY-MM-DD) de los snapshots presentes bajo `basePath`. */
export async function listCloudreveBackupDates(basePath: string): Promise<string[]> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")
  }
  const url = davUrlFromKey(config.baseUrl, basePath, true)
  const auth = basicAuth(config)

  let response: Response
  try {
    response = await fetch(url, {
      method: "PROPFIND",
      headers: { Authorization: auth, Depth: "1", "Content-Type": "application/xml" },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch {
    throw new CloudreveError("CLOUDREVE_IO", "No se pudo listar la carpeta de respaldos en Cloudreve")
  }
  if (!response.ok) {
    const status = response.status
    await response.text().catch(() => undefined)
    if (status === 404) return []
    throw new CloudreveError("CLOUDREVE_UPSTREAM", `Cloudreve respondió ${status} al listar respaldos`, status)
  }

  const body = await response.text()
  const selfPath = url.pathname.replace(/\/+$/, "")
  const dates: string[] = []
  const blocks = body.split(/<[a-zA-Z0-9]+:response\b|(?:\/)?<response\b/)
  for (const block of blocks) {
    const isCollection = /<[a-zA-Z0-9]+:collection\s*\/?>/.test(block)
    if (!isCollection) continue
    const href = /<[a-zA-Z0-9]+:href>([^<]+)<\/[a-zA-Z0-9]+:href>|<href>([^<]+)<\/href>/.exec(block)
    const raw = href?.[1] ?? href?.[2]
    if (!raw) continue
    const decodedPath = hrefPathname(raw)
    if (decodedPath === selfPath) continue
    const name = decodeURIComponent(decodedPath.split("/").pop() ?? "")
    if (/^\d{4}-\d{2}-\d{2}$/.test(name)) dates.push(name)
  }
  return dates
}

/** Elimina una carpeta de snapshot. No lanza si ya no existe. */
export async function deleteCloudreveBackupDate(basePath: string, dateStr: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error("Fecha de snapshot inválida")
  const remoteKey = basePath ? `${basePath}/${dateStr}` : dateStr
  try {
    const response = await requestKey(remoteKey, { method: "DELETE" })
    await response.text().catch(() => undefined)
  } catch (error) {
    if (error instanceof CloudreveError && error.code === "CLOUDREVE_NOT_FOUND") return
    throw error
  }
}

/**
 * Prueba la configuración GUARDADA contra la carpeta de respaldos. A diferencia
 * del probe del espacio SST, un 404 acá es esperable (la carpeta se crea en el
 * primer respaldo) y NO es un fallo: lo que se valida son credenciales y URL.
 */
export async function probeCloudreveBackupPath(basePath: string): Promise<{ ok: boolean; message: string }> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    return { ok: false, message: "Faltan credenciales de Cloudreve: configúrelas en Administración › Almacenamiento de documentos." }
  }

  let url: URL
  try {
    url = davUrlFromKey(config.baseUrl, basePath, true)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof CloudreveError ? error.message : "La configuración de Cloudreve no es válida.",
    }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: "PROPFIND",
      headers: { Authorization: basicAuth(config), Depth: "0", "Content-Type": "application/xml" },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch {
    return { ok: false, message: "No se pudo conectar con Cloudreve: revise la URL y que el servidor sea alcanzable." }
  }

  await response.text().catch(() => undefined)
  const folderLabel = basePath === "" ? "la raíz de la cuenta WebDAV" : `«${basePath}»`
  if (response.ok) {
    return { ok: true, message: `Conexión con Cloudreve verificada sobre ${folderLabel}.` }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: "Cloudreve rechazó las credenciales (401/403): revise el usuario y la contraseña." }
  }
  if (response.status === 404) {
    return { ok: true, message: `Credenciales y URL OK. La carpeta ${folderLabel} se creará en el primer respaldo.` }
  }
  return { ok: false, message: `Cloudreve respondió ${response.status} en el PROPFIND de verificación.` }
}

// ── Claves remotas arbitrarias (documentos generados) ─────────────────────────
//
// El espacio SST y los respaldos tienen cada uno su mapeo de rutas; los
// documentos generados arman la clave completa con
// `lib/services/generated-documents/remote-key.ts`. Estas funciones solo
// comprueban que la clave no pueda retroceder: `new URL()` resuelve `..` como
// segmento de retroceso y la escritura saldría de la carpeta pedida.

function assertGenericRemoteKey(remoteKey: string): void {
  const segments = remoteKey.split("/")
  const invalid = segments.length === 0 || segments.some((segment) => (
    !segment
    || segment === "."
    || segment === ".."
    || segment.includes("\\")
    || /[\u0000-\u001f]/.test(segment)
  ))
  if (invalid) throw new CloudreveError("CLOUDREVE_IO", "Clave remota inválida")
}

/**
 * Crea cada carpeta de `folderKey`, de la más externa a la más interna. MKCOL
 * responde 409 cuando falta la carpeta padre, y `mkcolRemoteKey` lo toma como
 * "ya existe": ir en orden es lo que hace que esa lectura sea cierta.
 */
export async function ensureCloudreveCollections(folderKey: string): Promise<void> {
  assertGenericRemoteKey(folderKey)
  const segments = folderKey.split("/")
  for (let i = 1; i <= segments.length; i += 1) {
    await mkcolRemoteKey(segments.slice(0, i).join("/"))
  }
}

/** PUT sobre una clave remota. WebDAV reemplaza sin avisar: quien llama decide si la clave está libre. */
export async function putCloudreveKey(remoteKey: string, buffer: Buffer): Promise<void> {
  assertGenericRemoteKey(remoteKey)
  const response = await requestKey(remoteKey, {
    method: "PUT",
    body: new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
  })
  await response.text().catch(() => undefined)
}

/** Tamaño de un archivo remoto vía PROPFIND Depth 0; null si no existe. */
export async function statCloudreveKey(remoteKey: string): Promise<{ size: number } | null> {
  assertGenericRemoteKey(remoteKey)
  let response: Response
  try {
    response = await requestKey(remoteKey, {
      method: "PROPFIND",
      headers: { Depth: "0", "Content-Type": "application/xml" },
    })
  } catch (error) {
    if (error instanceof CloudreveError && error.code === "CLOUDREVE_NOT_FOUND") return null
    throw error
  }
  const body = await response.text()
  const match = /<(?:d:)?getcontentlength>(\d+)<\/(?:d:)?getcontentlength>/i.exec(body)
  const size = match ? Number(match[1]) : null
  if (size === null || !Number.isFinite(size)) {
    throw new CloudreveError("CLOUDREVE_IO", "PROPFIND no devolvió el tamaño del archivo")
  }
  return { size }
}

export type CloudreveFolderProbe = "exists" | "missing" | "auth" | "unreachable" | "not_configured" | "error"

/**
 * PROPFIND Depth 0 sobre una carpeta con la configuración guardada. Solo
 * clasifica el resultado: cada pantalla lo cuenta con sus palabras (para la de
 * documentos generados, una carpeta que falta se crea en la primera subida).
 */
export async function probeCloudreveFolderKey(folderKey: string): Promise<CloudreveFolderProbe> {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) return "not_configured"
  assertGenericRemoteKey(folderKey)
  let url: URL
  try {
    url = davUrlFromKey(config.baseUrl, folderKey, true)
  } catch {
    return "not_configured"
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: "PROPFIND",
      headers: { Authorization: basicAuth(config), Depth: "0", "Content-Type": "application/xml" },
      signal: AbortSignal.timeout(readCloudreveRequestTimeout()),
    })
  } catch {
    return "unreachable"
  }
  await response.text().catch(() => undefined)
  if (response.ok) return "exists"
  if (response.status === 404) return "missing"
  if (response.status === 401 || response.status === 403) return "auth"
  return "error"
}
