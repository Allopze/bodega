import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { extractMeterReading } from "./tae-ocr"

async function generateOdometerImage(digits: string, options?: { blur?: boolean; dark?: boolean; fontSize?: number }): Promise<Buffer> {
  const width = 800
  const height = 200
  const fontSize = options?.fontSize ?? 60
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="${options?.dark ? "#1a1a1a" : "#f0f0f0"}" />
    <text x="${width / 2}" y="${height / 2 + fontSize / 3}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="${options?.dark ? "#f0f0f0" : "#1a1a1a"}">${digits}</text>
  </svg>`
  let image = sharp(Buffer.from(svg))
  if (options?.blur) {
    image = image.blur(2)
  }
  return image.png().toBuffer()
}

describe("extractMeterReading", () => {
  it("extracts clear digital odometer digits", async () => {
    const buffer = await generateOdometerImage("123456")
    const result = await extractMeterReading(buffer)
    expect(result.value).toBe(123456)
    expect(result.confidence).toBeGreaterThan(0)
  }, 30000)

  it("extracts 7-digit odometer values", async () => {
    const buffer = await generateOdometerImage("9999999")
    const result = await extractMeterReading(buffer)
    expect(result.value).toBe(9999999)
  }, 30000)

  it("returns null for blurry images that can't be read", async () => {
    const buffer = await generateOdometerImage("123456", { blur: true, fontSize: 20 })
    const result = await extractMeterReading(buffer)
    expect(result.value).toBeNull()
  }, 30000)

  it("returns null for images with no digits", async () => {
    const svg = `<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="200" fill="#888" />
      <text x="200" y="100" text-anchor="middle" font-family="monospace" font-size="40" fill="#333">ABCDEF</text>
    </svg>`
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer()
    const result = await extractMeterReading(buffer)
    expect(result.value).toBeNull()
  }, 30000)

  it("returns null for completely blank images", async () => {
    const buffer = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#fff" } }).png().toBuffer()
    const result = await extractMeterReading(buffer)
    expect(result.value).toBeNull()
  }, 30000)

  it("handles dark background with light digits", async () => {
    const buffer = await generateOdometerImage("789012", { dark: true })
    const result = await extractMeterReading(buffer)
    expect(result.value).toBe(789012)
  }, 30000)

  it("rejects values above 9,999,999", async () => {
    const buffer = await generateOdometerImage("12345678")
    const result = await extractMeterReading(buffer)
    expect(result.value).toBeNull()
  }, 30000)

  it("procesa varias solicitudes concurrentes sin perder resultados", async () => {
    const images = await Promise.all(["123001", "123002", "123003"].map((digits) => generateOdometerImage(digits)))
    const results = await Promise.all(images.map((image) => extractMeterReading(image)))
    expect(results.map((result) => result.value)).toEqual([123001, 123002, 123003])
  }, 60000)
})
