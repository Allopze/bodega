import path from "node:path"

const DELIVERY_ATTACHMENT_PREFIX = "storage/deliveries/"
const INVOICE_ATTACHMENT_PREFIX = "storage/purchase-orders/"
const QUOTATION_ATTACHMENT_PREFIX = "storage/repuestos/"
const SERVICE_QUOTATION_PREFIX = "storage/servicios/"
const FLEET_DOCUMENT_PREFIX = "storage/flota/"
const SST_DOCUMENT_PREFIX = "storage/sst-documents/"
const PDTP_EVIDENCE_PREFIX = "storage/pdtp-evidence/"
const FUEL_IMPORT_PREFIX = "storage/imports/"
const FUEL_TAE_EVIDENCE_PREFIX = "storage/fuel-tae/"

/**
 * Resolves the base storage directory.
 *
 * Use the env var STORAGE_PATH to override the default location
 * (process.cwd() + "/storage").  On ephemeral / serverless hosts this
 * should point to a persistent volume or object-storage mount.
 *
 * All path.join / path.resolve calls below carry `turbopackIgnore: true`
 * because their first argument is always a runtime value (env var or
 * process.cwd()).  Without the comments Turbopack traces the entire project
 * directory into the standalone bundle and emits the "unexpected file in NFT
 * list" warning.
 */
export function resolveStorageDir(): string {
  if (process.env.STORAGE_PATH?.trim()) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_PATH)
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "storage")
}

export function resolveDeliveriesDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "deliveries")
}

export function createDeliveryAttachmentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid delivery attachment file name")
  }
  return `${DELIVERY_ATTACHMENT_PREFIX}${storageName}`
}

export function resolveDeliveryAttachmentFile(filePath: string): string | null {
  if (!filePath.startsWith(DELIVERY_ATTACHMENT_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(DELIVERY_ATTACHMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolveDeliveriesDir(), storageName)
}

export function resolvePurchaseOrdersDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "purchase-orders")
}

export function createInvoiceAttachmentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid invoice attachment file name")
  }
  return `${INVOICE_ATTACHMENT_PREFIX}${storageName}`
}

export function resolveInvoiceAttachmentFile(filePath: string): string | null {
  if (!filePath.startsWith(INVOICE_ATTACHMENT_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(INVOICE_ATTACHMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolvePurchaseOrdersDir(), storageName)
}

export function resolveRepuestosDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "repuestos")
}

export function resolveServiciosDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "servicios")
}

export function createQuotationAttachmentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid quotation attachment file name")
  }
  return `${QUOTATION_ATTACHMENT_PREFIX}${storageName}`
}

export function resolveQuotationAttachmentFile(filePath: string): string | null {
  if (!filePath.startsWith(QUOTATION_ATTACHMENT_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(QUOTATION_ATTACHMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolveRepuestosDir(), storageName)
}

export function createServiceQuotationPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid service quotation file name")
  }
  return `${SERVICE_QUOTATION_PREFIX}${storageName}`
}

export function resolveServiceQuotationFile(filePath: string): string | null {
  if (!filePath.startsWith(SERVICE_QUOTATION_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(SERVICE_QUOTATION_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolveServiciosDir(), storageName)
}

function isSafeStorageName(storageName: string): boolean {
  return Boolean(storageName)
    && storageName !== "."
    && storageName !== ".."
    && storageName === path.posix.basename(storageName)
}

export function resolveFleetDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "flota")
}

export function createFleetDocumentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid fleet document file name")
  }
  return `${FLEET_DOCUMENT_PREFIX}${storageName}`
}

export function resolveFleetDocumentFile(filePath: string): string | null {
  if (!filePath.startsWith(FLEET_DOCUMENT_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(FLEET_DOCUMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveFleetDir(), storageName)
}

/* ── Biblioteca SST ────────────────────────────────────────────────────────
 *
 * Almacenamiento para los documentos preventivos de la biblioteca SST.
 * NO comparte espacio con la flota ni con la bodega.
 * El `storageName` es siempre un nanoid con extensión segura; nunca se
 * acepta el nombre original del usuario para evitar traversal.
 */
export function resolveSstDocumentsDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "sst-documents")
}

export function createSstDocumentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid sst document storage name")
  }
  return `${SST_DOCUMENT_PREFIX}${storageName}`
}

export function resolveSstDocumentFile(filePath: string): string | null {
  if (!filePath.startsWith(SST_DOCUMENT_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(SST_DOCUMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveSstDocumentsDir(), storageName)
}

/* ── Evidencia PDTP ────────────────────────────────────────────────────────
 *
 * Almacenamiento para la evidencia (foto/archivo) de ejecuciones del
 * Programa de Trabajo Preventivo SG-SST. NO comparte espacio con la
 * biblioteca SST ni con el resto de módulos.
 * El `storageName` es siempre un nanoid con extensión segura; nunca se
 * acepta el nombre original del usuario para evitar traversal.
 */
export function resolvePdtpEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "pdtp-evidence")
}

export function createPdtpEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid pdtp evidence storage name")
  }
  return `${PDTP_EVIDENCE_PREFIX}${storageName}`
}

export function resolvePdtpEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(PDTP_EVIDENCE_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(PDTP_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolvePdtpEvidenceDir(), storageName)
}

/* ── Importaciones de combustible ────────────────────────────────────────────
 *
 * Almacenamiento para el archivo XLSX original de cada lote de importación de
 * consumos de combustible por patente (trazabilidad — ver AGENTS.md).
 * El `storageName` es siempre `${timestamp}-${nanoid}-${nombreSanitizado}`;
 * nunca se acepta el nombre original tal cual para evitar traversal.
 */
export function resolveFuelImportsDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "imports")
}

export function createFuelImportPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid fuel import file name")
  }
  return `${FUEL_IMPORT_PREFIX}${storageName}`
}

export function resolveFuelImportFile(filePath: string): string | null {
  if (!filePath.startsWith(FUEL_IMPORT_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(FUEL_IMPORT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveFuelImportsDir(), storageName)
}

/* ── Evidencia de cargas TAE ──────────────────────────────────────────────── */

export function resolveFuelTaeEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "fuel-tae")
}

export function createFuelTaeEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid TAE evidence storage name")
  }
  return `${FUEL_TAE_EVIDENCE_PREFIX}${storageName}`
}

export function resolveFuelTaeEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(FUEL_TAE_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(FUEL_TAE_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveFuelTaeEvidenceDir(), storageName)
}
