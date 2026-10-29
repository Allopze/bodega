import { describe, expect, it } from "vitest"
import { exifDateToIso, readExif } from "../exif"
import { fitWithin, stampBar, stampText } from "../photo-capture"

/** JPEG mínimo con un APP1/EXIF little-endian: Make, puntero al sub-IFD y DateTimeOriginal. */
function jpegWithExif(options: { make?: string; taken?: string } = {}): Uint8Array {
  const make = `${options.make ?? "Pixel"}\0`
  const taken = `${options.taken ?? "2026:10:28 14:05:09"}\0`
  const ifd0At = 8
  const exifIfdAt = ifd0At + 2 + 2 * 12 + 4
  const makeAt = exifIfdAt + 2 + 12 + 4
  const takenAt = makeAt + make.length
  const tiff = new Uint8Array(takenAt + taken.length)
  const view = new DataView(tiff.buffer)
  tiff.set([0x49, 0x49], 0)
  view.setUint16(2, 42, true)
  view.setUint32(4, ifd0At, true)
  view.setUint16(ifd0At, 2, true)
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true); view.setUint32(at + 8, value, true)
  }
  entry(ifd0At + 2, 0x010f, 2, make.length, makeAt)
  entry(ifd0At + 14, 0x8769, 4, 1, exifIfdAt)
  view.setUint16(exifIfdAt, 1, true)
  entry(exifIfdAt + 2, 0x9003, 2, taken.length, takenAt)
  tiff.set(new TextEncoder().encode(make), makeAt)
  tiff.set(new TextEncoder().encode(taken), takenAt)

  const payload = new Uint8Array([...new TextEncoder().encode("Exif\0\0"), ...tiff])
  const length = payload.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...payload, 0xff, 0xd9])
}

describe("EXIF mínimo de una foto JPEG", () => {
  it("lee la hora original y el aparato", () => {
    const exif = readExif(jpegWithExif())
    expect(exif?.fields.Make).toBe("Pixel")
    expect(exif?.fields.DateTimeOriginal).toBe("2026:10:28 14:05:09")
    expect(exif?.takenAt).toBe(new Date(2026, 9, 28, 14, 5, 9).toISOString())
  })

  it("respeta el huso horario cuando la foto lo trae", () => {
    expect(exifDateToIso("2026:10:28 14:05:09", "-03:00")).toBe("2026-10-28T17:05:09.000Z")
    expect(exifDateToIso("2026:10:28 14:05:09", "+02:00")).toBe("2026-10-28T12:05:09.000Z")
  })

  it("una fecha imposible no se inventa", () => {
    expect(exifDateToIso("0000:00:00 00:00:00")).toBeNull()
    expect(exifDateToIso("2026:13:40 25:61:61")).toBeNull()
    expect(exifDateToIso("hola")).toBeNull()
  })

  it("nunca lanza: lo que no es JPEG, o viene cortado o dañado, devuelve null", () => {
    expect(readExif(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(readExif(new Uint8Array(0))).toBeNull()
    expect(readExif(new TextEncoder().encode("GIF89a-no-es-jpeg-nada"))).toBeNull()
    const whole = jpegWithExif()
    for (const cut of [5, 12, 20, 40, 60]) expect(() => readExif(whole.slice(0, cut))).not.toThrow()
    const broken = whole.slice()
    broken.fill(0xff, 24, 60)
    expect(() => readExif(broken)).not.toThrow()
  })

  it("un JPEG sin APP1 no tiene EXIF", () => {
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0, 0]))).toBeNull()
  })
})

describe("foto: tamaño y sello", () => {
  it("el lado largo queda en 1.600 px y la proporción se conserva", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it("el sello lleva fecha y hora, código y patente (o sólo el código si no hay patente)", () => {
    const when = new Date("2026-10-28T17:05:00Z")
    expect(stampText(when, "KA-140", "SGCP-84")).toMatch(/^28-10-2026 \d{2}:\d{2} {2}· {2}KA-140 {2}· {2}SGCP-84$/)
    expect(stampText(when, "TO-37", "TO-37")).toMatch(/^28-10-2026 \d{2}:\d{2} {2}· {2}TO-37$/)
  })

  it("la franja del sello crece con la imagen", () => {
    expect(stampBar(1200).bar).toBeGreaterThan(stampBar(600).bar)
    expect(stampBar(1200).fontPx).toBeGreaterThanOrEqual(12)
  })
})
