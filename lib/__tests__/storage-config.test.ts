import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createDeliveryAttachmentPath,
  resolveDeliveryAttachmentFile,
} from "@/lib/storage/config"

describe("delivery storage config", () => {
  const previousStoragePath = process.env.STORAGE_PATH

  afterEach(() => {
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_PATH
    } else {
      process.env.STORAGE_PATH = previousStoragePath
    }
  })

  it("keeps persisted attachment paths portable while resolving files from STORAGE_PATH", () => {
    process.env.STORAGE_PATH = "/mnt/bodega-storage"

    const persistedPath = createDeliveryAttachmentPath("proof.pdf")

    expect(persistedPath).toBe("storage/deliveries/proof.pdf")
    expect(resolveDeliveryAttachmentFile(persistedPath)).toBe(
      path.join("/mnt/bodega-storage", "deliveries", "proof.pdf"),
    )
  })

  it("rejects attachment paths outside the delivery storage prefix", () => {
    expect(resolveDeliveryAttachmentFile("storage/other/proof.pdf")).toBeNull()
    expect(resolveDeliveryAttachmentFile("storage/deliveries/../secret.pdf")).toBeNull()
    expect(resolveDeliveryAttachmentFile("storage/deliveries/nested/proof.pdf")).toBeNull()
  })
})
