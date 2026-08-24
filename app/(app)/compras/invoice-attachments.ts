/** Server-only storage helpers for purchase-order invoice attachments. */

import { promises as fs } from "node:fs"
import path from "node:path"
import { nanoid } from "@/lib/id"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { createInvoiceAttachmentPath, resolvePurchaseOrdersDir } from "@/lib/storage/config"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"

export interface InvoiceAttachment {
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

export type PersistedInvoiceAttachment = {
  attachment: InvoiceAttachment
  absolutePath: string
}

export type PersistedInvoiceUpload = PersistedInvoiceAttachment & { verifiedBuffer: Buffer }

export async function persistInvoiceFile(value: FormDataEntryValue | null): Promise<
  | { ok: true; attachment: PersistedInvoiceUpload | null }
  | { ok: false; message: string }
> {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: true, attachment: null }
  }

  try {
    const maxBytes = await getInvoiceMaxBytes()
    // FormData ya conoce el tamaño. Rechazar acá evita una segunda copia del
    // archivo completo en memoria para cargas que nunca podrán guardarse.
    if (value.size > maxBytes) {
      return { ok: false, message: `El archivo supera el límite de ${maxBytes / 1024 / 1024} MB` }
    }

    const buffer = Buffer.from(await value.arrayBuffer())
    const persisted = await persistInvoiceBuffer(buffer, value.name || "factura", maxBytes)
    return { ok: true, attachment: { ...persisted, verifiedBuffer: buffer } }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo guardar el archivo de la factura" }
  }
}

/**
 * Persiste una copia PDF propiedad de la factura. No reutiliza el caché del
 * DTE: borrar/corregir una factura no puede dejar su evidencia apuntando a un
 * archivo temporal compartido.
 */
export async function persistInvoicePdf(buffer: Buffer, fileName: string): Promise<PersistedInvoiceAttachment> {
  const persisted = await persistInvoiceBuffer(buffer, fileName)
  if (persisted.attachment.mimeType !== "application/pdf") {
    await removeInvoiceAttachment(persisted.absolutePath)
    throw new Error("El archivo del DTE no es un PDF válido")
  }
  return persisted
}

export async function removeInvoiceAttachment(absolutePath: string | undefined): Promise<void> {
  if (!absolutePath) return
  await fs.unlink(absolutePath).catch(() => undefined)
}

async function persistInvoiceBuffer(
  buffer: Buffer,
  originalName: string,
  maxBytes?: number,
): Promise<PersistedInvoiceAttachment> {
  const limit = maxBytes ?? await getInvoiceMaxBytes()
  if (buffer.length > limit) {
    throw new Error(`El archivo supera el límite de ${limit / 1024 / 1024} MB`)
  }

  const validation = validateFileBuffer(buffer, buffer.length, MimeType.INVOICE)
  if (validation.error) throw new Error(validation.error)

  const safeName = sanitizeFileName(originalName)
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolvePurchaseOrdersDir()
  const absolutePath = path.join(storageDir, storageName)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, buffer, { flag: "wx" })

  return {
    absolutePath,
    attachment: {
      fileName: safeName,
      filePath: createInvoiceAttachmentPath(storageName),
      fileSize: buffer.length,
      mimeType: validation.mimeType,
    },
  }
}

async function getInvoiceMaxBytes(): Promise<number> {
  return (await getPdfMaxSizeMb()) * 1024 * 1024
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "factura"
}
