"use server"

/**
 * Descarga bajo demanda el XML del proveedor para un documento DTE ya
 * sincronizado (dteDocuments), lo persiste localmente y extrae neto/IVA/ítems.
 *
 * El enlace al XML es directo y determinista — verificado 681/681 filas
 * contra el portal real (2026-08-04): `empr/Chome/DTEProveedores/PRV_<RUT
 * emisor>_<tipo>_<folio>.xml`. No hace falta guardar la URL cruda del
 * portal: se reconstruye desde los campos ya guardados en dteDocuments.
 *
 * @see EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md § 7.3
 */

import path from "node:path"
import { promises as fs } from "node:fs"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { cleanRut } from "@/lib/rut"
import { nanoid } from "@/lib/id"
import { mkdirp, readBuffer, writeBuffer } from "@/lib/storage/helpers"
import { createDtePath, resolveDteDir, resolveDteFile } from "@/lib/storage/config"
import { DtePortalClient, decodeXmlBuffer } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { downloadDteXml, MAX_DTE_XML_BYTES } from "@/lib/services/dte-portal/download"
import { parseDteXml, type DteItem } from "@/lib/services/purchasing-module/dte-parser"

export interface DteXmlDetail {
  tipoDte: string | null
  invoiceNumber: string
  issueDate: string | null
  supplierRut: string | null
  netAmount: number
  taxAmount: number
  totalAmount: number
  items: DteItem[]
}

export type DteXmlDownloadResult =
  | { ok: true; detail: DteXmlDetail }
  | { ok: false; error: string }

/**
 * Devuelve el detalle del XML de un documento DTE, descargándolo del portal
 * solo la primera vez (write-through: las siguientes llamadas leen el
 * archivo ya guardado en storage/dte/).
 */
export async function downloadDteDocumentXml(dteDocumentId: string): Promise<DteXmlDownloadResult> {
  // SEC-2: sin scoping por faena — es seguro solo porque hoy TODOS los
  // titulares de `purchasing:view` son roles globales (admin, jefa_chome,
  // secretaria, jefe_mantencion), y los DTE son documentos tributarios del
  // SII, org-wide por naturaleza. Si algún día se otorga `purchasing:view` a
  // un rol de faena, esto pasa a filtrar montos/ítems de DTE de todas las
  // faenas — hay que agregar scoping por faena antes de ese cambio de grants.
  await requirePermission("purchasing:view")

  const doc = await db.query.dteDocuments.findFirst({
    where: eq(dteDocuments.id, dteDocumentId),
    columns: { id: true, tipoDte: true, folio: true, rutEmisor: true, codEmp: true, montoTotal: true, xmlPath: true },
  })
  if (!doc) return { ok: false, error: "Documento DTE no encontrado" }

  if (doc.xmlPath) {
    const cached = await readCachedXml(doc.xmlPath)
    if (cached) return { ok: true, detail: cached }
    // El archivo guardado no está disponible (borrado, movido) — re-descargar.
  }

  // La ruta del XML lleva la carpeta de empresa fija ('Chome') y no incluye
  // el codEmp, que sí forma parte de dte_documents_unique_key: para un
  // documento de OTRA empresa del portal bajaría de la carpeta equivocada. El
  // nombre de carpeta no es derivable del codEmp (un número), así que hasta
  // que exista un mapa codEmp→carpeta se rechaza la descarga cruzada.
  const configuredCodEmp = (await readDtePortalConfig()).credentials.codEmp
  if (!configuredCodEmp || doc.codEmp !== configuredCodEmp) {
    return { ok: false, error: "El XML de este documento pertenece a otra empresa del portal DTE" }
  }
  // `rutEmisor` viene del portal y se interpola en la ruta: acotarlo evita
  // que un valor inesperado salga del directorio de DTE del proveedor.
  if (!/^\d{1,9}-[\dkK]$/.test(doc.rutEmisor)) {
    return { ok: false, error: "El RUT del emisor de este DTE no es válido" }
  }

  const relativeUrl = `empr/Chome/DTEProveedores/PRV_${doc.rutEmisor}_${doc.tipoDte}_${doc.folio}.xml`

  let xml: string
  let buffer: Buffer
  try {
    const client = new DtePortalClient(await buildDtePortalClientConfig())
    const downloaded = await downloadDteXml(client, relativeUrl)
    xml = downloaded.xml
    buffer = downloaded.buffer
  } catch {
    // Nunca propagar detalles del proveedor: pueden incluir URLs legacy o
    // parámetros operativos. La acción de adjuntar ya presenta este error en
    // lenguaje de usuario.
    return { ok: false, error: "No se pudo descargar el XML del portal DTE" }
  }

  const parsed = parseDteXml(xml)
  if (!parsed) return { ok: false, error: "No se pudo interpretar el XML del proveedor" }

  // La identidad se comprueba ANTES de persistir. La única verificación del
  // sistema vivía aguas abajo, en la transacción de la factura: cuando ésa
  // rechazaba, ya se habían commiteado monto_neto/iva/xml_path del documento
  // equivocado — y `xml_path` deja ese archivo cacheado para siempre. Los
  // mismos campos alimentan el Libro de Compras Electrónico.
  const parsedFolio = /^\d+$/.test(parsed.invoiceNumber.trim()) ? Number(parsed.invoiceNumber.trim()) : null
  const sameIdentity = (
    parsed.tipoDte === doc.tipoDte
    && parsedFolio === doc.folio
    && cleanRut(parsed.supplierRut ?? "") === cleanRut(doc.rutEmisor)
    && Math.abs(parsed.totalAmount - doc.montoTotal) <= 1
  )
  if (!sameIdentity) {
    return { ok: false, error: "El XML del portal no corresponde a este documento" }
  }

  const storageName = `${Date.now()}-${nanoid()}-${doc.tipoDte}-${doc.folio}.xml`
  const storageDir = resolveDteDir()
  const absolutePath = path.join(storageDir, storageName)
  try {
    await mkdirp(storageDir)
    await writeBuffer(absolutePath, buffer)

    const cachePredicate = doc.xmlPath
      ? eq(dteDocuments.xmlPath, doc.xmlPath)
      : isNull(dteDocuments.xmlPath)
    const updated = await db.update(dteDocuments).set({
      montoNeto: parsed.netAmount,
      iva: parsed.taxAmount,
      xmlPath: createDtePath(storageName),
    }).where(and(eq(dteDocuments.id, dteDocumentId), cachePredicate)).returning({ id: dteDocuments.id })
    if (updated.length === 0) {
      // Otra descarga ganó la referencia duradera; esta copia es un perdedor.
      await fs.unlink(absolutePath).catch(() => undefined)
    }
  } catch {
    await fs.unlink(absolutePath).catch(() => undefined)
    return { ok: false, error: "No se pudo guardar el XML del DTE" }
  }

  return {
    ok: true,
    detail: {
      netAmount: parsed.netAmount,
      taxAmount: parsed.taxAmount,
      totalAmount: parsed.totalAmount,
      tipoDte: parsed.tipoDte,
      invoiceNumber: parsed.invoiceNumber,
      issueDate: parsed.issueDate,
      supplierRut: parsed.supplierRut,
      items: parsed.items,
    },
  }
}

async function readCachedXml(xmlPath: string): Promise<DteXmlDetail | null> {
  const absolutePath = resolveDteFile(xmlPath)
  if (!absolutePath) return null

  try {
    const stat = await fs.stat(absolutePath)
    if (stat.size > MAX_DTE_XML_BYTES) return null
    const buffer = await readBuffer(absolutePath)
    if (buffer.length > MAX_DTE_XML_BYTES) return null
    const parsed = parseDteXml(decodeXmlBuffer(buffer))
    if (!parsed) return null
    return {
      tipoDte: parsed.tipoDte,
      invoiceNumber: parsed.invoiceNumber,
      issueDate: parsed.issueDate,
      supplierRut: parsed.supplierRut,
      netAmount: parsed.netAmount,
      taxAmount: parsed.taxAmount,
      totalAmount: parsed.totalAmount,
      items: parsed.items,
    }
  } catch {
    return null
  }
}
