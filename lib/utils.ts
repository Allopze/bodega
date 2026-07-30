import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Merge Tailwind classes safely, resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const CLP_FORMAT = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const QTY_FORMAT = new Intl.NumberFormat("es-CL")

/** Format currency in CLP (Chilean Pesos) */
export function formatCLP(amount: number): string {
  return CLP_FORMAT.format(amount)
}

/**
 * Plural de las unidades de medida del catálogo. Es un mapa explícito y no una
 * regla morfológica porque las unidades las administra el usuario y pueden ser
 * abreviaturas ("kg", "m2") que no se pluralizan: lo que no esté acá pasa tal
 * cual, que es el comportamiento anterior (auditoría UI/UX 2026-07-29, A-25).
 */
const UNIT_PLURALS: Record<string, string> = {
  unidad: "unidades", par: "pares", caja: "cajas", paquete: "paquetes",
  set: "sets", juego: "juegos", rollo: "rollos", servicio: "servicios",
  litro: "litros", metro: "metros", bolsa: "bolsas", tarro: "tarros",
  bidon: "bidones", bidón: "bidones", kit: "kits", pack: "packs",
}

/** Concuerda la unidad con la cantidad: "1 par", "8 rollos", "12 unidades". */
export function pluralizeUnit(n: number, unit: string): string {
  if (n === 1) return unit
  return UNIT_PLURALS[unit.trim().toLowerCase()] ?? unit
}

/** Format a number with thousands separators (for quantities) */
export function formatQty(n: number, unit?: string): string {
  const formatted = QTY_FORMAT.format(n)
  return unit ? `${formatted} ${pluralizeUnit(n, unit)}` : formatted
}

/** Lowercase (es-CL) and strip diacritics, so accented and unaccented text compare equal. */
function foldForSearch(value: string): string {
  return value.toLocaleLowerCase("es-CL").normalize("NFD").replace(/[̀-ͯ]/g, "")
}

/** Case- and accent-insensitive (es-CL) substring match against any of the given values. Empty query matches everything. */
export function matchesQuery(query: string, values: Array<string | null | undefined>): boolean {
  const normalized = foldForSearch(query.trim())
  if (!normalized) return true
  return values.some((value) => value != null && foldForSearch(value).includes(normalized))
}

/** Generate a slug-style code from a string */
export function toCode(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Format a date in es-CL locale */
export function formatDate(date: Date | string | number): string {
  const plain = plainDateParts(date)
  if (plain) return `${plain[2]}-${plain[1]}-${plain[0]}`
  const [year, month, day] = CHILE_DATE_FORMAT.format(new Date(date)).split("-")
  return `${day}-${month}-${year}`
}

/** Format datetime in es-CL locale */
export function formatDateTime(date: Date | string | number): string {
  // Una fecha calendario ("2026-06-11") no tiene hora que convertir.
  if (plainDateParts(date)) return `${formatDate(date)} 00:00`
  const d = new Date(date)
  return `${formatDate(d)} ${CHILE_TIME_FORMAT.format(d)}`
}

// Todo lo que se muestra va en hora de Chile continental, no en la zona del
// proceso: el contenedor de producción corre en UTC, así que leer los
// componentes locales de la fecha (getHours/getDate) hacía que el servidor
// pintara UTC y el navegador la hora del usuario — desajuste de hidratación en
// los componentes cliente, y hora simplemente equivocada en los de servidor.
const CHILE_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

// hourCycle h23 y no hour12:false — con es-CL este último rinde "24:00" a
// medianoche en vez de "00:00".
const CHILE_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Una cadena "YYYY-MM-DD" es una fecha de calendario, no un instante: pasarla
 * por Date y luego convertirla de zona la corre un día. Se reformatea tal cual.
 */
function plainDateParts(date: Date | string | number): [string, string, string] | null {
  if (typeof date !== "string") return null
  const match = PLAIN_DATE_RE.exec(date)
  return match ? [match[1]!, match[2]!, match[3]!] : null
}

/** Convert a string to title-case (each word capitalized). */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Prefix a worksite name with "Faena " for display, without doubling the
 * word when the name already starts with it (e.g. a worksite literally
 * named "Faena Mininco").
 */
export function formatWorksiteLabel(name: string): string {
  return /^faena\s/i.test(name) ? name : `Faena ${name}`
}

/** Generate initials from a full name (for Avatar) */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ""
  const first = parts[0]!
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1]!
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase()
}

/** Escape special HTML characters to prevent XSS in email templates and notifications. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

/**
 * Build a Content-Disposition header value (RFC 6266 + RFC 5987) that is
 * safe across HTTP and renders Unicode filenames correctly in modern
 * browsers. Replaces any control chars and quotes in the ASCII fallback,
 * and percent-encodes the original string for the UTF-8 variant.
 */
export function encodeContentDisposition(filename: string, disposition: "inline" | "attachment" = "inline"): string {
  const ascii = filename
    // strip control characters
    .replace(/[\u0000-\u001F\u007F]/g, "_")
    // collapse to a safe ASCII subset
    .replace(/["\\]/g, "_")
  const utf8 = encodeURIComponent(filename)
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

/** `datetime-local` exige `YYYY-MM-DDTHH:mm` en hora local, no un ISO en UTC. */
export function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

/** Divide un texto multilínea en un array de líneas no vacías. */
export function linesToArray(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean)
}


