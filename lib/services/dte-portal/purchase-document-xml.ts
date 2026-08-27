import path from "node:path"
import { promises as fs } from "node:fs"
import { and, eq, isNull, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { dteDocumentItems, dteDocuments } from "@/db/schema"
import { cleanRut } from "@/lib/rut"
import { mkdirp, readBuffer, writeBuffer } from "@/lib/storage/helpers"
import { createDtePath, resolveDteDir, resolveDteFile } from "@/lib/storage/config"
import { decodeXmlBuffer, DtePortalClient } from "./client"
import { buildDtePortalClientConfig, readDtePortalConfig } from "./config"
import { downloadDteXml, MAX_DTE_XML_BYTES } from "./download"
import { parseDteXml, type DteData, type DteItem } from "@/lib/services/purchasing-module/dte-parser"

export interface DteXmlDetail {
  tipoDte: string | null
  invoiceNumber: string
  issueDate: string | null
  supplierRut: string | null
  netAmount: number
  taxAmount: number
  totalAmount: number
  items: DteItem[]
  /** Códigos de OC citados por el proveedor en `<Referencia>`, normalizados. */
  referencedOrderCodes: string[]
}

export type PurchaseDteXmlErrorCode =
  | "DTE_XML_NOT_FOUND"
  | "DTE_XML_COMPANY_MISMATCH"
  | "DTE_XML_INVALID_SUPPLIER"
  | "DTE_XML_DOWNLOAD_FAILED"
  | "DTE_XML_PARSE_FAILED"
  | "DTE_XML_IDENTITY_MISMATCH"
  | "DTE_XML_STORAGE_FAILED"

export class PurchaseDteXmlError extends Error {
  constructor(readonly code: PurchaseDteXmlErrorCode, message: string) {
    super(message)
  }
}

type DteDocumentIdentity = {
  id: string
  tipoDte: string
  folio: number
  rutEmisor: string
  codEmp: string
  montoTotal: number
  xmlPath: string | null
}

export function toDteDocumentItemRows(dteDocumentId: string, items: DteItem[]) {
  const now = new Date().toISOString()
  return items.map((item) => ({
    id: `dte-line:${dteDocumentId}:${item.lineNumber}`,
    dteDocumentId,
    lineNumber: item.lineNumber,
    productCode: item.productCode,
    productName: item.productName,
    description: item.description,
    unitOfMeasure: item.unitOfMeasure,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    amount: item.amount,
    updatedAt: now,
  }))
}

/** Servicio interno: la acción o cron que lo invoque conserva el gate de autorización. */
export async function getPurchaseDteXmlDetail(dteDocumentId: string): Promise<DteXmlDetail> {
  const doc = await db.query.dteDocuments.findFirst({
    where: eq(dteDocuments.id, dteDocumentId),
    columns: { id: true, tipoDte: true, folio: true, rutEmisor: true, codEmp: true, montoTotal: true, xmlPath: true },
  })
  if (!doc) throw new PurchaseDteXmlError("DTE_XML_NOT_FOUND", "Documento DTE no encontrado")

  const cached = doc.xmlPath ? await readCachedXml(doc.xmlPath) : null
  if (cached) {
    assertSameIdentity(doc, cached)
    return toDetail(cached)
  }

  const configuredCodEmp = (await readDtePortalConfig()).credentials.codEmp
  if (!configuredCodEmp || doc.codEmp !== configuredCodEmp) {
    throw new PurchaseDteXmlError("DTE_XML_COMPANY_MISMATCH", "El XML de este documento pertenece a otra empresa del portal DTE")
  }
  if (!/^\d{1,9}-[\dkK]$/.test(doc.rutEmisor)) {
    throw new PurchaseDteXmlError("DTE_XML_INVALID_SUPPLIER", "El RUT del emisor de este DTE no es válido")
  }

  const relativeUrl = `empr/Chome/DTEProveedores/PRV_${doc.rutEmisor}_${doc.tipoDte}_${doc.folio}.xml`
  let downloaded: Awaited<ReturnType<typeof downloadDteXml>>
  try {
    const client = new DtePortalClient(await buildDtePortalClientConfig())
    downloaded = await downloadDteXml(client, relativeUrl)
  } catch {
    throw new PurchaseDteXmlError("DTE_XML_DOWNLOAD_FAILED", "No se pudo descargar el XML del portal DTE")
  }

  const parsed = parseDteXml(downloaded.xml)
  if (!parsed) throw new PurchaseDteXmlError("DTE_XML_PARSE_FAILED", "No se pudo interpretar el XML del proveedor")
  assertSameIdentity(doc, parsed)
  await cacheVerifiedXml(doc, downloaded.buffer, parsed)
  return toDetail(parsed)
}

export async function enrichDteDocumentLines(dteDocumentId: string): Promise<
  { ok: true; lineCount: number } | { ok: false; errorCode: PurchaseDteXmlErrorCode | "DTE_XML_ENRICHMENT_FAILED" }
> {
  await db.update(dteDocuments).set({
    lineEnrichmentStatus: "pending",
    lineEnrichmentAttempts: sql`${dteDocuments.lineEnrichmentAttempts} + 1`,
    lineEnrichmentErrorCode: null,
  }).where(eq(dteDocuments.id, dteDocumentId))

  try {
    const detail = await getPurchaseDteXmlDetail(dteDocumentId)
    const rows = toDteDocumentItemRows(dteDocumentId, detail.items)
    const lineNumbers = rows.map((row) => row.lineNumber)

    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: dteDocuments.id })
        .from(dteDocuments)
        .where(eq(dteDocuments.id, dteDocumentId))
        .for("update")
      if (!locked) throw new PurchaseDteXmlError("DTE_XML_NOT_FOUND", "Documento DTE no encontrado")

      for (const row of rows) {
        await tx.insert(dteDocumentItems).values(row).onConflictDoUpdate({
          target: [dteDocumentItems.dteDocumentId, dteDocumentItems.lineNumber],
          set: {
            productCode: row.productCode,
            productName: row.productName,
            description: row.description,
            unitOfMeasure: row.unitOfMeasure,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            discount: row.discount,
            amount: row.amount,
            updatedAt: row.updatedAt,
          },
        })
      }
      await tx.delete(dteDocumentItems).where(and(
        eq(dteDocumentItems.dteDocumentId, dteDocumentId),
        notInArray(dteDocumentItems.lineNumber, lineNumbers),
      ))
      await tx.update(dteDocuments).set({
        lineEnrichmentStatus: "ready",
        lineEnrichedAt: new Date().toISOString(),
        lineEnrichmentErrorCode: null,
        // Sale del mismo XML que las líneas y en la misma transacción: un
        // documento "ready" con la referencia sin leer sería un candidato al
        // que le falta justo la evidencia más fuerte.
        //
        // Cadena vacía y no NULL cuando el proveedor no citó ninguna OC: NULL
        // significa "nunca se examinó el XML" y es lo que busca el backfill
        // `backfill-dte-order-refs`. Confundirlos lo haría releer para siempre
        // los documentos que ya sabemos que no traen referencia.
        referencedOrderCodes: detail.referencedOrderCodes.join(","),
      }).where(eq(dteDocuments.id, dteDocumentId))
    })

    return { ok: true, lineCount: rows.length }
  } catch (error) {
    const errorCode = error instanceof PurchaseDteXmlError ? error.code : "DTE_XML_ENRICHMENT_FAILED"
    await db.update(dteDocuments).set({
      lineEnrichmentStatus: "failed",
      lineEnrichmentErrorCode: errorCode,
    }).where(eq(dteDocuments.id, dteDocumentId))
    return { ok: false, errorCode }
  }
}

function assertSameIdentity(doc: DteDocumentIdentity, parsed: DteData) {
  const parsedFolio = /^\d+$/.test(parsed.invoiceNumber.trim()) ? Number(parsed.invoiceNumber.trim()) : null
  const sameIdentity = parsed.tipoDte === doc.tipoDte
    && parsedFolio === doc.folio
    && cleanRut(parsed.supplierRut ?? "") === cleanRut(doc.rutEmisor)
    && Math.abs(parsed.totalAmount - doc.montoTotal) <= 1
  if (!sameIdentity) {
    throw new PurchaseDteXmlError("DTE_XML_IDENTITY_MISMATCH", "El XML del portal no corresponde a este documento")
  }
}

function toDetail(parsed: DteData): DteXmlDetail {
  return {
    tipoDte: parsed.tipoDte,
    invoiceNumber: parsed.invoiceNumber,
    issueDate: parsed.issueDate,
    supplierRut: parsed.supplierRut,
    netAmount: parsed.netAmount,
    taxAmount: parsed.taxAmount,
    totalAmount: parsed.totalAmount,
    items: parsed.items,
    referencedOrderCodes: parsed.referencedOrderCodes,
  }
}

/**
 * Lee y parsea el XML ya verificado en disco. Exportada para el backfill de
 * `referenced_order_codes`, que necesita releer documentos ya enriquecidos sin
 * pasar por `enrichDteDocumentLines` —eso los devolvería a `pending` y podría
 * dejarlos en `failed`— y sin poder salir al portal.
 */
export async function readCachedXml(xmlPath: string): Promise<DteData | null> {
  const absolutePath = resolveDteFile(xmlPath)
  if (!absolutePath) return null
  try {
    const stat = await fs.stat(absolutePath)
    if ((typeof stat.isFile === "function" && !stat.isFile()) || stat.size > MAX_DTE_XML_BYTES) return null
    const buffer = await readBuffer(absolutePath)
    if (buffer.length > MAX_DTE_XML_BYTES) return null
    return parseDteXml(decodeXmlBuffer(buffer))
  } catch {
    return null
  }
}

async function cacheVerifiedXml(doc: DteDocumentIdentity, buffer: Buffer, parsed: DteData) {
  const storageName = `${Date.now()}-${doc.id}-${doc.tipoDte}-${doc.folio}.xml`
  const storageDir = resolveDteDir()
  const absolutePath = path.join(storageDir, storageName)
  try {
    await mkdirp(storageDir)
    await writeBuffer(absolutePath, buffer)
    const cachePredicate = doc.xmlPath ? eq(dteDocuments.xmlPath, doc.xmlPath) : isNull(dteDocuments.xmlPath)
    const updated = await db.update(dteDocuments).set({
      montoNeto: parsed.netAmount,
      iva: parsed.taxAmount,
      xmlPath: createDtePath(storageName),
    }).where(and(eq(dteDocuments.id, doc.id), cachePredicate)).returning({ id: dteDocuments.id })
    if (updated.length === 0) await fs.unlink(absolutePath).catch(() => undefined)
  } catch {
    await fs.unlink(absolutePath).catch(() => undefined)
    throw new PurchaseDteXmlError("DTE_XML_STORAGE_FAILED", "No se pudo guardar el XML del DTE")
  }
}
