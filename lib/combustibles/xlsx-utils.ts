/**
 * Helpers Excel compartidos del módulo combustibles: parsers de importación
 * (facturas — `import.ts` — y consumos por patente — `consumption-import.ts`)
 * y la hoja de metadatos que llevan las 4 exportaciones del módulo.
 */

import ExcelJS from "exceljs"
export { addExportMetadataSheet } from "@/lib/reports/export-metadata"

/** Normaliza un encabezado de columna: colapsa espacios/saltos de línea,
 *  recorta y pasa a minúsculas, para comparar de forma tolerante. */
export function normKey(key: string): string {
  return key.replace(/\s+/g, " ").trim().toLowerCase()
}

/** Reduce un valor de celda de ExcelJS (texto enriquecido, fórmula, hipervínculo,
 *  error, fecha o primitivo) al valor plano que el resto del parser espera.
 *
 *  Una celda de error (`#N/D`, `#N/A`, `#REF!`…) llegaba como el objeto crudo
 *  de ExcelJS: `String(valor)` la volvía "[object Object]" en cualquier parser
 *  que la leyera como texto, y `parseChileanNumber` la volvía 0 silencioso en
 *  cualquiera que la leyera como número — el error de origen desaparecía sin
 *  dejar rastro. Se devuelve el código de error como STRING (p. ej. "#N/D"):
 *  sigue siendo "no numérico" para `parseChileanNumber` (mismo default 0 que
 *  antes para texto no parseable — comportamiento sin cambios ahí), pero ya
 *  no se pierde en un `[object Object]`, y `isExcelErrorText` permite a un
 *  parser detectarlo explícitamente y reportar la fila en vez de aceptar el 0. */
export function normalizeCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("")
    }
    // Una fórmula que resolvió en error trae `{result: {error: "#N/D"}, formula: ...}`.
    if ("result" in value) {
      const result = value.result
      if (result !== null && typeof result === "object" && "error" in result) return String(result.error)
      return result ?? null
    }
    // Una celda de error pura (sin fórmula) trae `{error: "#N/D"}`.
    if ("error" in value) return String(value.error)
    if ("text" in value) return value.text
  }
  return value
}

/** `true` si el valor (ya normalizado por `normalizeCellValue`) es un código
 *  de error de Excel — "#N/D", "#N/A", "#REF!", "#VALUE!", "#DIV/0!", etc. */
export function isExcelErrorText(value: unknown): boolean {
  return typeof value === "string" && /^#(N\/D|N\/A|REF!|VALUE!|DIV\/0!|NULL!|NUM!|NAME\?)$/i.test(value.trim())
}

/** Convierte la primera fila de la hoja en encabezados y el resto en objetos
 *  `{ encabezado: valor }`, replicando el comportamiento de `defval: null`.
 *  Cada registro lleva `__row` con el número de fila REAL de Excel (1-based):
 *  `eachRow` con `includeEmpty` no salta filas en blanco intercaladas, así que
 *  sin esto los parsers reconstruían la fila como `índice + 2` y esa cuenta se
 *  desalineaba apenas el archivo traía una fila vacía en medio. */
export function sheetToRecords(sheet: ExcelJS.Worksheet): Array<Record<string, unknown> & { __row: number }> {
  const headers: (string | null)[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const value = normalizeCellValue(cell.value)
    headers[colNumber] = value === null ? null : String(value)
  })

  const records: Array<Record<string, unknown> & { __row: number }> = []
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const record: Record<string, unknown> & { __row: number } = { __row: rowNumber }
    for (let col = 1; col < headers.length; col++) {
      const header = headers[col]
      if (!header) continue
      record[header] = normalizeCellValue(row.getCell(col).value)
    }
    records.push(record)
  })
  return records
}

const TZ = "America/Santiago"

/** Desfase real de la zona en un instante UTC dado (Chile alterna -03/-04). */
const ZONE_PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
})

function zoneOffsetMs(instant: Date): number {
  const parts = ZONE_PARTS_FORMAT.formatToParts(instant)
  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"))
  return asUtc - instant.getTime()
}

/**
 * Compone una fecha y una hora de Excel (dos celdas separadas, ambas
 * decodificadas por ExcelJS como si fueran UTC) en el instante real que
 * representan en hora de pared chilena. Interpretarlas ya como UTC corre cada
 * carga 3–4 horas y mueve de mes las de fin de mes por la noche — justo lo que
 * las conciliaciones mensuales necesitan cuadrar.
 */
export function santiagoInstant(date: Date, time: Date | null): string {
  const wall = Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    time?.getUTCHours() ?? 0, time?.getUTCMinutes() ?? 0, time?.getUTCSeconds() ?? 0,
  )
  // Dos pasadas: la primera estima el desfase, la segunda lo corrige si la
  // estimación cayó al otro lado de un cambio de horario.
  let utc = wall - zoneOffsetMs(new Date(wall))
  utc = wall - zoneOffsetMs(new Date(utc))
  return new Date(utc).toISOString()
}

/** Extrae "YYYY-MM-DD" de una fecha Excel usando componentes UTC — ExcelJS
 *  decodifica los seriales de fecha/hora de Excel como UTC, y los getters
 *  locales desplazarían el día según la zona del proceso o del navegador. */
export function formatExcelDateUTC(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * Fecha civil "YYYY-MM-DD" de una celda que puede venir como serial de Excel o
 * como texto.
 *
 * Los parsers hacían `new Date(texto)`, y `new Date("03/02/2026")` es el 2 de
 * marzo: JS lee mm/dd y en Chile eso es el 3 de febrero. Los días 1-12 se
 * reasignaban de mes EN SILENCIO (la carga quedaba contabilizada en otro mes) y
 * los 13-31 caían en "fecha inválida" por accidente, no por diseño.
 *
 * Acá el texto se parte con reglas explícitas: el grupo de 4 dígitos es el año y
 * el otro extremo es el día. Lo que no calza devuelve `null` para que el
 * llamador reporte la fila, que es lo que ya hace. Se rechaza a propósito el año
 * de dos dígitos ("03/02/26"): no hay forma de saber si es 1926 o 2026, y
 * adivinar es exactamente el bug que esto corrige.
 */
const SHEET_DATE_TEXT = /^(\d{1,4})([/-])(\d{1,2})\2(\d{1,4})(?:[ T].*)?$/

export function parseSheetDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatExcelDateUTC(value)
  if (typeof value !== "string") return null
  const match = SHEET_DATE_TEXT.exec(value.trim())
  if (!match) return null
  const [, first, , month, last] = match
  // Exactamente un extremo con 4 dígitos: con dos es ambiguo y con ninguno es
  // año de dos dígitos.
  if ((first!.length === 4) === (last!.length === 4)) return null
  const [year, day] = first!.length === 4 ? [first!, last!] : [last!, first!]
  const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  // `Date.UTC` "arregla" 30/02 corriéndolo al mes siguiente; el round-trip lo caza.
  if (utc.getUTCMonth() !== Number(month) - 1 || utc.getUTCDate() !== Number(day)) return null
  return formatExcelDateUTC(utc)
}

export type ExactChileanDecimalResult =
  | { status: "value"; units: bigint; normalized: string }
  | { status: "empty" }
  | { status: "invalid"; reason: "format" | "scale" | "range" | "excel_error" }

/**
 * Lee una cifra con escala fija sin pasar por coma flotante. En strings respeta
 * separadores chilenos; las celdas numéricas de Excel se interpretan como
 * números y no como texto con separador de miles. `units` representa la cifra
 * multiplicada por 10 ** scale (centavos para scale 2; 1/10.000 para litros).
 */
export function parseExactChileanDecimal(value: unknown, scale: number, precision = 14): ExactChileanDecimalResult {
  if (!Number.isInteger(scale) || scale < 0 || scale > 8 || !Number.isInteger(precision) || precision <= scale) {
    return { status: "invalid", reason: "range" }
  }
  if (value === null || value === undefined) return { status: "empty" }
  if (typeof value === "number" && !Number.isFinite(value)) return { status: "invalid", reason: "format" }
  if (typeof value !== "string" && typeof value !== "number") return { status: "invalid", reason: "format" }

  let text = String(value).trim().replace(/\u00a0/g, " ")
  if (!text || text === "-") return { status: "empty" }
  if (isExcelErrorText(text)) return { status: "invalid", reason: "excel_error" }
  text = text.replace(/\s/g, "")
  if (text.startsWith("$")) text = text.slice(1)

  let sign = ""
  if (text.startsWith("-") || text.startsWith("+")) {
    sign = text[0] === "-" ? "-" : ""
    text = text.slice(1)
  }
  if (!text) return { status: "invalid", reason: "format" }

  let integerPart = ""
  let fractionPart = ""
  const numericCell = typeof value === "number"

  if (numericCell) {
    const numericText = expandDecimalExponent(text)
    if (!numericText) return { status: "invalid", reason: "range" }
    const match = /^(\d+)(?:\.(\d+))?$/.exec(numericText)
    if (!match) return { status: "invalid", reason: "format" }
    integerPart = match[1]!
    fractionPart = match[2] ?? ""
  } else if (text.includes(",")) {
    if (text.indexOf(",") !== text.lastIndexOf(",")) return { status: "invalid", reason: "format" }
    const [rawInteger = "", rawFraction = ""] = text.split(",")
    if (!/^\d+$/.test(rawFraction)) return { status: "invalid", reason: "format" }
    if (/^\d{1,3}(?:\.\d{3})+$/.test(rawInteger)) integerPart = rawInteger.replace(/\./g, "")
    else if (/^\d+$/.test(rawInteger)) integerPart = rawInteger
    else return { status: "invalid", reason: "format" }
    fractionPart = rawFraction
  } else {
    const grouped = /^(\d{1,3}(?:\.\d{3})+)$/.exec(text)
    if (grouped) integerPart = grouped[1]!.replace(/\./g, "")
    else {
      const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
      if (!match) return { status: "invalid", reason: "format" }
      integerPart = match[1]!
      fractionPart = match[2] ?? ""
    }
  }

  if (fractionPart.length > scale) return { status: "invalid", reason: "scale" }
  const significantInteger = integerPart.replace(/^0+(?=\d)/, "")
  if (significantInteger.length > precision - scale) return { status: "invalid", reason: "range" }
  const normalizedInteger = significantInteger || "0"
  const normalizedFraction = fractionPart.padEnd(scale, "0")
  const unsignedUnits = BigInt(`${normalizedInteger}${normalizedFraction}` || "0")
  const units = sign && unsignedUnits !== BigInt(0) ? -unsignedUnits : unsignedUnits
  const normalized = `${units < BigInt(0) ? "-" : ""}${normalizedInteger}${scale ? `.${normalizedFraction}` : ""}`
  return { status: "value", units, normalized }
}

function expandDecimalExponent(value: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value)
  if (!match) return value
  const integer = match[1]!
  const fraction = match[2] ?? ""
  const exponent = Number(match[3])
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null
  const digits = `${integer}${fraction}`
  const decimalIndex = integer.length + exponent
  if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
}

/** Convierte un valor de celda (número, o texto con formato chileno —
 *  miles con "." y decimales con ",") a número. Vacío/no numérico → 0. */
export function parseChileanNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[$\s]/g, "")
    if (!cleaned || cleaned === "-") return 0
    // En notación chilena la coma es SIEMPRE el decimal: si hay coma, todo punto
    // es separador de miles. Sin coma, un punto seguido de exactamente 3 dígitos
    // (y luego otro punto o el fin) son miles; si no, es un decimal a la inglesa.
    const n = parseFloat(
      cleaned.includes(",")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/\.(?=\d{3}(?:\.|$))/g, ""),
    )
    return isNaN(n) ? 0 : n
  }
  return 0
}

/** Como parseChileanNumber pero preserva null para valores vacíos. */
export function nullableChileanNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = parseChileanNumber(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Canon de normalización de patente — antes duplicada de forma idéntica en
 * `operations-import.ts` y `consumption-import.ts`, y de forma más débil (sin
 * `.trim()`) en `fleet-xlsx-import.ts`: el alta manual de un vehículo y el
 * import masivo normalizaban distinto, así que " BPDH-41 " (tipeado a mano) y
 * "BPDH-41" (del Excel) no calzaban contra el mismo `UNIQUE` de `fuel_vehicles.plate`.
 *  Conserva guiones — el formato de patente no es uniforme en los datos reales. */
/**
 * Si el "Tipo de Tarjeta" de una fila Copec pertenece al canal. Copec nombra las
 * variantes de una tarjeta con el canal como primera palabra: "TCT PREMIUM" es
 * una TCT. Comparar contra el texto exacto rechazaba dos tercios de las filas
 * del informe TCT real de 2026-09 (167 "TCT PREMIUM" contra 84 "TCT"), y un
 * archivo con filas rechazadas no se importa.
 */
export function isCopecCardOfChannel(value: unknown, channel: "TCT" | "TAE"): boolean {
  return new RegExp(`^${channel}(?:\\s|$)`, "i").test(String(value ?? "").trim())
}

export function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "")
}

/** Clave de comparación para matchear contra `fuel_vehicles.plate`: además de
 *  normalizar, quita todo separador — la data operacional y el catálogo usan
 *  formatos de patente distintos (con/sin guion) para el mismo vehículo. */
export function plateMatchKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}
