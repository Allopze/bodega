import path from "node:path"

const DELIVERY_ATTACHMENT_PREFIX = "storage/deliveries/"

/**
 * Resolves the base storage directory.
 *
 * Use the env var STORAGE_PATH to override the default location
 * (process.cwd() + "/storage").  On ephemeral / serverless hosts this
 * should point to a persistent volume or object-storage mount.
 */
export function resolveStorageDir(): string {
  if (process.env.STORAGE_PATH?.trim()) {
    return path.resolve(process.env.STORAGE_PATH)
  }
  return path.join(process.cwd(), "storage")
}

export function resolveDeliveriesDir(): string {
  return path.join(resolveStorageDir(), "deliveries")
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

  return path.join(resolveDeliveriesDir(), storageName)
}

function isSafeStorageName(storageName: string): boolean {
  return Boolean(storageName)
    && storageName !== "."
    && storageName !== ".."
    && storageName === path.posix.basename(storageName)
}
