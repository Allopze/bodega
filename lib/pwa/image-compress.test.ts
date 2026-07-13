// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { compressPhoto } from "./image-compress"

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

function mockToBlob(sizes: number[]) {
  let call = 0
  return vi.fn(function (this: HTMLCanvasElement, callback: BlobCallback) {
    const size = sizes[Math.min(call, sizes.length - 1)]!
    call++
    callback(new Blob([new Uint8Array(size)], { type: "image/jpeg" }))
  })
}

describe("compressPhoto", () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const originalToBlob = HTMLCanvasElement.prototype.toBlob

  beforeEach(() => {
    // @ts-expect-error jsdom no implementa getContext("2d") de forma útil por defecto
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }))
  })

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap
    HTMLCanvasElement.prototype.getContext = originalGetContext
    HTMLCanvasElement.prototype.toBlob = originalToBlob
    vi.restoreAllMocks()
  })

  it("no toca archivos que no son imagen", async () => {
    globalThis.createImageBitmap = vi.fn()
    const file = new File(["hola"], "nota.txt", { type: "text/plain" })
    const result = await compressPhoto(file)
    expect(result).toBe(file)
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled()
  })

  it("redimensiona y reencoda una foto grande a JPEG bajo el máximo", async () => {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(fakeBitmap(3000, 2000))
    HTMLCanvasElement.prototype.toBlob = mockToBlob([2 * 1024 * 1024]) // 2MB, bajo el máximo de 5MB
    const original = new File([new Uint8Array(6 * 1024 * 1024)], "odometro.png", { type: "image/png" })

    const result = await compressPhoto(original)

    expect(result.type).toBe("image/jpeg")
    expect(result.name).toBe("odometro.jpg")
    expect(result.size).toBeLessThan(original.size)
  })

  it("baja la calidad en pasos hasta quedar bajo el máximo de 5MB", async () => {
    const toBlob = mockToBlob([8 * 1024 * 1024, 7 * 1024 * 1024, 4 * 1024 * 1024])
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(fakeBitmap(4000, 3000))
    HTMLCanvasElement.prototype.toBlob = toBlob
    const original = new File([new Uint8Array(9 * 1024 * 1024)], "sello.jpg", { type: "image/jpeg" })

    const result = await compressPhoto(original)

    expect(toBlob).toHaveBeenCalledTimes(3)
    expect(result.size).toBe(4 * 1024 * 1024)
  })

  it("devuelve el archivo original si el canvas no está disponible", async () => {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(fakeBitmap(2000, 2000))
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
    const original = new File([new Uint8Array(1024)], "litros.jpg", { type: "image/jpeg" })

    const result = await compressPhoto(original)
    expect(result).toBe(original)
  })

  it("devuelve el archivo original si algo lanza (ej. createImageBitmap falla)", async () => {
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error("decode error"))
    const original = new File([new Uint8Array(1024)], "sello2.jpg", { type: "image/jpeg" })

    const result = await compressPhoto(original)
    expect(result).toBe(original)
  })
})
