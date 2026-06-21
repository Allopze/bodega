import path from "node:path"

const DELIVERY_ATTACHMENT_PREFIX = "storage/deliveries/"
const INVOICE_ATTACHMENT_PREFIX = "storage/purchase-orders/"
const QUOTATION_ATTACHMENT_PREFIX = "storage/repuestos/"
const SERVICE_QUOTATION_PREFIX = "storage/servicios/"

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
