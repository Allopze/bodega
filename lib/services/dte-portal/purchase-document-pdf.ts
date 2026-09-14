/**
 * Recuperación server-side del PDF de un DTE recibido por Compras.
 *
 * El PDF nunca se expone como URL del portal: se valida, se cachea bajo el
 * prefijo DTE y se entrega únicamente desde una ruta autenticada de Chome.
 */

import { promises as fs } from "node:fs"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { cleanRut } from "@/lib/rut"
import { nanoid } from "@/lib/id"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { createDtePath, resolveDteDir, resolveDteFile, resolveStorageFile } from "@/lib/storage/config"
import { buildDtePortalClientConfig } from "./config"
import { DtePortalClient } from "./client"
import { downloadDtePdf } from "./download"
import { fetchBandejaEntrada } from "./bandeja-entrada"

export interface DteDocumentPdf {
  buffer: Buffer
  fileName: string
}

export class DteDocumentPdfError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "UNAVAILABLE" | "INVALID_DOCUMENT",
  ) {
    super(message)
  }
}

/**
 * Construye el único formato de URL PDF verificado para la Bandeja de Entrada.
 * `Nreguist` sólo tiene significado junto al código de empresa del portal.
 */
export function buildDtePurchasePdfUrl(codEmp: string, portalRecordId: string): string {
  if (!/^\d{1,20}$/.test(codEmp) || !/^\d{1,40}$/.test(portalRecordId)) {
    throw new DteDocumentPdfError("El identificador del PDF DTE no es válido", "INVALID_DOCUMENT")
  }
  const post = Buffer.from(`Cod_Emp=${codEmp}&Nreguist=${portalRecordId}`, "utf8").toString("base64")
  // El href original se lee dentro de `/PanelCorreo/`, donde `../` vuelve a
  // `/facturaenlinea/`. El cliente, en cambio, resuelve desde esa raíz: dejar
  // el traversal lo rechazaba (y permitirlo lo llevaría a otra ruta). Guardar
  // la forma canónica conserva el origen cerrado y llega al PHP correcto.
  return `dtepdfX.php?post=${encodeURIComponent(post)}`
}

/**
 * Obtiene el PDF validado, primero desde el caché local y luego desde el
 * portal. Esta función no autoriza: la ruta o acción que la invoca debe hacerlo
 * antes de llamar; así no se mezcla control de acceso con I/O del proveedor.
 */
export async function getDteDocumentPdf(dteDocumentId: string): Promise<DteDocumentPdf> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(dteDocumentId)) {
    throw new DteDocumentPdfError("Documento DTE no encontrado", "NOT_FOUND")
  }

  try {
    const doc = await db.query.dteDocuments.findFirst({
      where: eq(dteDocuments.id, dteDocumentId),
      columns: {
        id: true,
        tipoDte: true,
        folio: true,
        rutEmisor: true,
        fechaEmision: true,
        codEmp: true,
        periodo: true,
        portalRecordId: true,
        pdfPath: true,
      },
    })
    if (!doc) throw new DteDocumentPdfError("Documento DTE no encontrado", "NOT_FOUND")

    const maxBytes = await getDtePdfMaxBytes()

    if (doc.pdfPath) {
      const cached = await readCachedPdf(doc.pdfPath, maxBytes)
      if (cached) return { buffer: cached, fileName: pdfFileName(doc.tipoDte, doc.folio) }
    }

    const client = new DtePortalClient(await buildDtePortalClientConfig())
    const pdfUrl = await resolvePdfUrl(doc, client)
    const buffer = await downloadDtePdf(client, pdfUrl, { maxBytes })
    await assertValidPdf(buffer, maxBytes)

    // El cache es una optimización, no la fuente de verdad de esta respuesta.
    // Si la BD cae después de descargar, el usuario igual recibe el PDF válido;
    // el archivo temporal se compensa y el próximo acceso lo reintentará.
    await cachePdf(doc, buffer)

    return { buffer, fileName: pdfFileName(doc.tipoDte, doc.folio) }
  } catch (error) {
    if (error instanceof DteDocumentPdfError) throw error
    throw new DteDocumentPdfError("No se pudo obtener el PDF del DTE", "UNAVAILABLE")
  }
}

function pdfFileName(tipoDte: string, folio: number) {
  return `DTE-${tipoDte.replace(/[^0-9A-Za-z_-]/g, "") || "documento"}-${folio}.pdf`
}

async function resolvePdfUrl(
  doc: {
    id: string
    tipoDte: string
    folio: number
    rutEmisor: string
    fechaEmision: string
    codEmp: string
    periodo: string
    portalRecordId: string | null
  },
  client: DtePortalClient,
): Promise<string> {
  if (doc.portalRecordId) {
    return buildDtePurchasePdfUrl(doc.codEmp, doc.portalRecordId)
  }

  // DTE sincronizados antes de portalRecordId: se busca una sola vez la fila
  // exacta de su período. No se selecciona por folio solamente porque no es
  // globalmente único entre emisores ni tipos.
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(doc.periodo)
  if (!match) throw new DteDocumentPdfError("El período del documento DTE no es válido", "INVALID_DOCUMENT")

  // Este raspado es la consulta más cara del portal (~80 s, 681 filas para un
  // mes) y la dispara un clic de usuario. Sin freno, veinte clics en la
  // pestaña Facturación de una OC = veinte raspados concurrentes del mes
  // entero con las credenciales de la empresa. Dos frenos en memoria:
  //   1. una sola corrida por (empresa, período) a la vez — las demás esperan;
  //   2. los documentos que no calzan no se vuelven a buscar por un rato (sin
  //      esto, los que nunca calzan repiten el raspado en cada petición).
  // ponytail: memoria del proceso, no de la BD; el freno duradero exige una
  // marca persistida (columna nueva) y por tanto una migración.
  if (isLookupRecentlyFailed(doc.id)) {
    throw new DteDocumentPdfError("No se encontró un PDF verificable para este DTE", "UNAVAILABLE")
  }
  const inbox = await fetchInboxOnce(client, doc.codEmp, match[1]!, match[2]!)
  const matches = inbox.rows.filter((row) => (
    row.tipoDoc === doc.tipoDte
    && row.folio === doc.folio
    && cleanRut(row.rutEmisor) === cleanRut(doc.rutEmisor)
    && row.fecha === doc.fechaEmision
    && Boolean(row.pdfUrl)
  ))
  if (matches.length !== 1 || !matches[0]!.pdfUrl) {
    rememberLookupFailure(doc.id)
    throw new DteDocumentPdfError("No se encontró un PDF verificable para este DTE", "UNAVAILABLE")
  }

  const row = matches[0]!
  if (row.nreguist) {
    // Sólo completa un valor ausente: si otra solicitud ganó la carrera, no se
    // pisa su referencia. La URL de esta misma fila sirve igualmente ahora.
    await db.update(dteDocuments)
      .set({ portalRecordId: row.nreguist })
      .where(and(eq(dteDocuments.id, doc.id), isNull(dteDocuments.portalRecordId)))
    return buildDtePurchasePdfUrl(doc.codEmp, row.nreguist)
  }
  const pdfUrl = row.pdfUrl
  if (!pdfUrl) {
    throw new DteDocumentPdfError("No se encontró un PDF verificable para este DTE", "UNAVAILABLE")
  }
  return normalizeLegacyPurchasePdfUrl(pdfUrl)
}

/** Raspados de bandeja en vuelo, por (empresa, período). */
const inflightInbox = new Map<string, Promise<Awaited<ReturnType<typeof fetchBandejaEntrada>>>>()

function fetchInboxOnce(client: DtePortalClient, codEmp: string, anio: string, mes: string) {
  const key = `${codEmp}:${anio}-${mes}`
  const existing = inflightInbox.get(key)
  if (existing) return existing
  // El contexto acompaña a los warns de fila descartada: sin él, los de este
  // raspado quedan mezclados con los del cron y sin forma de atribuirlos. Acá no
  // hay corrida, así que la clave del raspado (empresa+período) hace de
  // correlativo y además delata que el origen es el PDF bajo demanda.
  const pending = fetchBandejaEntrada(
    client,
    { anio, mes, codEmp, estadoPlataforma: "", rutProveedor: "" },
    { correlationId: `dte-pdf:${key}`, periodo: `${anio}-${mes}` },
  ).finally(() => { inflightInbox.delete(key) })
  inflightInbox.set(key, pending)
  return pending
}

/** Documentos legados cuya búsqueda ya falló, con el instante del intento. */
const failedLookups = new Map<string, number>()
const FAILED_LOOKUP_TTL_MS = 60 * 60 * 1000

function isLookupRecentlyFailed(dteDocumentId: string): boolean {
  const at = failedLookups.get(dteDocumentId)
  if (at === undefined) return false
  if (Date.now() - at < FAILED_LOOKUP_TTL_MS) return true
  failedLookups.delete(dteDocumentId)
  return false
}

function rememberLookupFailure(dteDocumentId: string): void {
  failedLookups.set(dteDocumentId, Date.now())
}

function normalizeLegacyPurchasePdfUrl(pdfUrl: string): string {
  try {
    // El enlace histórico se extrajo del HTML de PanelCorreo, no de la raíz
    // del portal. Se reconstruye sólo el `post` y se descartan parámetros
    // ajenos antes de entregarlo al cliente autenticado.
    const url = new URL(pdfUrl, "https://clientes.dtefacturaenlinea.cl/facturaenlinea/PanelCorreo/")
    const expectedOrigin = "https://clientes.dtefacturaenlinea.cl"
    const expectedPath = "/facturaenlinea/dtepdfX.php"
    const posts = url.searchParams.getAll("post")
    if (url.origin !== expectedOrigin || url.pathname !== expectedPath || posts.length !== 1 || !posts[0]) {
      throw new Error("invalid legacy DTE PDF URL")
    }
    return `dtepdfX.php?post=${encodeURIComponent(posts[0])}`
  } catch {
    throw new DteDocumentPdfError("No se encontró un PDF verificable para este DTE", "UNAVAILABLE")
  }
}

async function readCachedPdf(pdfPath: string, maxBytes: number): Promise<Buffer | null> {
  const absolutePath = resolveDteFile(pdfPath)
  if (!absolutePath) return null

  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile() || stat.size > maxBytes) return null
    const buffer = await fs.readFile(absolutePath)
    return await isValidPdfBuffer(buffer) ? buffer : null
  } catch {
    return null
  }
}

async function assertValidPdf(buffer: Buffer, maxBytes: number): Promise<void> {
  if (buffer.length > maxBytes) {
    throw new DteDocumentPdfError("El PDF del DTE supera el límite permitido", "INVALID_DOCUMENT")
  }
  if (!await isValidPdfBuffer(buffer)) {
    throw new DteDocumentPdfError("El contenido del DTE no es un PDF válido", "INVALID_DOCUMENT")
  }
}

async function isValidPdfBuffer(buffer: Buffer): Promise<boolean> {
  const validation = validateFileBuffer(buffer, buffer.length, MimeType.INVOICE)
  if (validation.error || validation.mimeType !== "application/pdf") return false

  // La firma sola acepta ocho bytes como "%PDF-1.7", que no es una factura
  // visualizable. Antes de entregar o cachear un archivo externo, el parser
  // legacy valida el catálogo y al menos una página sin renderizarla.
  if (buffer.length < 64) return false
  const header = buffer.toString("latin1", 0, Math.min(buffer.length, 16))
  if (!/^%PDF-\d\.\d/.test(header)) return false
  const trailer = buffer.toString("latin1", Math.max(0, buffer.length - 1024))
  if (!trailer.includes("%%EOF")) return false

  let loadingTask: { destroy(): Promise<void> } | undefined
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
    // Copy the bounded provider buffer: pdfjs may transfer its TypedArray to a
    // worker, and it must never detach the buffer we are about to return/cache.
    const task = getDocument({
      data: new Uint8Array(buffer),
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      enableXfa: false,
      stopAtErrors: true,
    })
    loadingTask = task
    const pdf = await task.promise
    try {
      if (pdf.numPages < 1) return false
      await pdf.getPage(1)
      return true
    } finally {
      await task.destroy().catch(() => undefined)
    }
  } catch {
    await loadingTask?.destroy().catch(() => undefined)
    return false
  }
}

async function getDtePdfMaxBytes(): Promise<number> {
  return (await getPdfMaxSizeMb()) * 1024 * 1024
}

async function cachePdf(
  doc: {
    id: string
    tipoDte: string
    folio: number
    pdfPath: string | null
  },
  buffer: Buffer,
): Promise<void> {
  const storageDir = resolveDteDir()
  const storageName = `${Date.now()}-${nanoid()}-${doc.tipoDte}-${doc.folio}.pdf`
  const relativePath = createDtePath(storageName)
  const finalPath = resolveStorageFile(storageDir, storageName)
  const temporaryPath = `${finalPath}.${nanoid(8)}.tmp`

  try {
    await fs.mkdir(storageDir, { recursive: true })
    await fs.writeFile(temporaryPath, buffer, { flag: "wx" })
    await fs.rename(temporaryPath, finalPath)
  } catch {
    await fs.unlink(temporaryPath).catch(() => undefined)
    return
  }

  try {
    const unchangedCachePredicate = doc.pdfPath
      ? eq(dteDocuments.pdfPath, doc.pdfPath)
      : isNull(dteDocuments.pdfPath)
    const updated = await db.update(dteDocuments)
      .set({ pdfPath: relativePath })
      .where(and(eq(dteDocuments.id, doc.id), unchangedCachePredicate))
      .returning({ id: dteDocuments.id })

    if (updated.length > 0) {
      const previousPath = doc.pdfPath ? resolveDteFile(doc.pdfPath) : null
      if (previousPath && previousPath !== finalPath) {
        await fs.unlink(previousPath).catch(() => undefined)
      }
      return
    }
  } catch {
    // El cache no es transaccional con disco. La copia nunca debe quedar
    // huérfana si no alcanzó a convertirse en la referencia de la fila.
  }

  await fs.unlink(finalPath).catch(() => undefined)
}
