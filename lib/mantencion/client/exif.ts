/**
 * Lector mínimo de EXIF para JPEG (segmento APP1). Sin dependencias: la foto se
 * comprime en un canvas, que descarta el EXIF, así que se lee ANTES de comprimir
 * (decisión D5). Sólo extrae lo útil para auditar una foto —cuándo, con qué
 * aparato— y nunca lanza: una foto sin EXIF, o con uno dañado, devuelve `null`.
 */

export interface ExifData {
  /** `DateTimeOriginal` como ISO con huso; `null` si la foto no lo trae. */
  takenAt: string | null
  /** Campos legibles, cada valor de hasta 200 caracteres. */
  fields: Record<string, string>
}

const TAGS_IFD0: Record<number, string> = {
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x0131: "Software",
  0x0132: "DateTime",
}
const TAGS_EXIF: Record<number, string> = {
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
  0x9011: "OffsetTimeOriginal",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0xa434: "LensModel",
}
const EXIF_IFD_POINTER = 0x8769
const MAX_VALUE_LENGTH = 200
const MAX_ENTRIES = 200

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }

function readValue(view: DataView, tiff: number, little: boolean, entry: number): string | number | null {
  const type = view.getUint16(entry + 2, little)
  const count = view.getUint32(entry + 4, little)
  const size = (TYPE_SIZE[type] ?? 0) * count
  if (size === 0) return null
  const dataAt = size <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little)
  if (dataAt < 0 || dataAt + size > view.byteLength) return null
  if (type === 2) {
    let text = ""
    for (let i = 0; i < Math.min(count, MAX_VALUE_LENGTH + 1); i++) {
      const code = view.getUint8(dataAt + i)
      if (code === 0) break
      text += String.fromCharCode(code)
    }
    return text.trim().slice(0, MAX_VALUE_LENGTH)
  }
  if (type === 3) return view.getUint16(dataAt, little)
  if (type === 4) return view.getUint32(dataAt, little)
  return null
}

function readIfd(view: DataView, tiff: number, little: boolean, offset: number, tags: Record<number, string>, out: Record<string, string>): number | null {
  const start = tiff + offset
  if (start < 0 || start + 2 > view.byteLength) return null
  const entries = Math.min(view.getUint16(start, little), MAX_ENTRIES)
  let exifPointer: number | null = null
  for (let i = 0; i < entries; i++) {
    const entry = start + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    const tag = view.getUint16(entry, little)
    if (tag === EXIF_IFD_POINTER) {
      const pointer = readValue(view, tiff, little, entry)
      if (typeof pointer === "number") exifPointer = pointer
      continue
    }
    const name = tags[tag]
    if (!name) continue
    const value = readValue(view, tiff, little, entry)
    if (value !== null && value !== "") out[name] = String(value)
  }
  return exifPointer
}

/** `2026:10:28 14:05:09` (+ `+03:00` opcional) → ISO. Sin huso se asume la hora del teléfono. */
export function exifDateToIso(text: string, offset?: string): string | null {
  const match = text.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number]
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  const tz = offset?.match(/^([+-])(\d{2}):(\d{2})$/)
  const date = tz
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second) - (tz[1] === "-" ? -1 : 1) * (Number(tz[2]) * 60 + Number(tz[3])) * 60_000)
    : new Date(year, month - 1, day, hour, minute, second)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function readExif(bytes: Uint8Array): ExifData | null {
  try {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = 2
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1] as number
      if (marker === 0xda || marker === 0xd9) return null
      const length = view.getUint16(at + 2)
      if (marker === 0xe1 && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 && bytes[at + 6] === 0x69 && bytes[at + 7] === 0x66) {
        const tiff = at + 10
        const little = bytes[tiff] === 0x49
        if (!little && bytes[tiff] !== 0x4d) return null
        if (view.getUint16(tiff + 2, little) !== 42) return null
        const fields: Record<string, string> = {}
        const exifPointer = readIfd(view, tiff, little, view.getUint32(tiff + 4, little), TAGS_IFD0, fields)
        if (exifPointer !== null) readIfd(view, tiff, little, exifPointer, TAGS_EXIF, fields)
        const original = fields.DateTimeOriginal ?? fields.DateTime
        return { takenAt: original ? exifDateToIso(original, fields.OffsetTimeOriginal) : null, fields }
      }
      at += 2 + length
    }
    return null
  } catch {
    return null
  }
}
