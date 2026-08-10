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

/**
 * Monto en pesos chilenos.
 *
 * El signo va **delante del símbolo**: `-$4.500`, no `$-4.500`.
 *
 * `Intl` con `es-CL` produce lo segundo, y así estuvo hasta que un snapshot lo
 * dejó a la vista. Es la salida estándar de la localización, no un defecto,
 * pero se lee peor justo donde más aparece —notas de crédito y ajustes— y una
 * cifra que se lee mal en un documento contable es un problema de producto.
 * Decisión de 2026-08-04: se antepone el signo.
 *
 * Se opera sobre el valor absoluto y se prefija, en vez de mover el guion con
 * una expresión regular: así el formato del número —separador de miles, cero
 * decimales— sigue siendo el que decide `Intl` y no una manipulación de texto.
 */
export function formatCLP(amount: number | string): string {
  // Acepta string numérico: el driver de Postgres entrega SUM(NUMERIC)/BIGINT
  // como string aunque el select lo tipee `sql<number>`, y ese string terminaba
  // acá como "—" en el KPI de Inversión del dashboard (I-01, auditoría
  // 2026-08-05). Un string no numérico sigue siendo dato faltante.
  if (typeof amount === "string") amount = amount.trim() === "" ? NaN : Number(amount)
  if (!Number.isFinite(amount)) return VALUE_MISSING
  if (amount < 0) return `-${CLP_FORMAT.format(Math.abs(amount))}`
  // `-0 < 0` es falso, así que el cero negativo llegaba a `Intl` y salía como
  // "$-0": un saldo cuadrado presentado como si tuviera signo. Aparece al
  // restar dos montos iguales, que en conciliación es el caso normal.
  return CLP_FORMAT.format(amount === 0 ? 0 : amount)
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
  // "dosis" es invariable: sin esta entrada el fallback la dejaba igual y
  // acertaba por accidente; explícita, no depende de ese accidente.
  dosis: "dosis",
}

/** Concuerda la unidad con la cantidad: "1 par", "8 rollos", "12 unidades". */
export function pluralizeUnit(n: number, unit: string): string {
  if (n === 1) return unit
  return UNIT_PLURALS[unit.trim().toLowerCase()] ?? unit
}

/**
 * Pluraliza un sustantivo español de forma sistemática (auditoría UI/UX
 * §4.4 — "1 submódulo / 2 submódulos" ya no se resuelve a mano en cada
 * sitio). Reglas: vocal → +s, consonante → +es, -z → -ces, -ión → -iones,
 * más irregulares conocidos. `plural` permite forzar la forma plural de
 * frases compuestas ("ítem seleccionado" / "ítems seleccionados").
 */
const SPANISH_PLURALS: Record<string, string> = {
  mes: "meses",
  ítem: "ítems",
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular
  if (plural) return plural
  const key = singular.trim().toLowerCase()
  const known = SPANISH_PLURALS[key]
  if (known) return known
  if (/ión$/.test(key)) return singular.slice(0, -3) + "iones"
  if (/z$/.test(key)) return singular.slice(0, -1) + "ces"
  if (/[aeiouáéíóú]$/.test(key)) return singular + "s"
  return singular + "es"
}

/**
 * "3 pantallas" — la cifra y su sustantivo concordados, en una sola llamada.
 *
 * `pluralize` devuelve **sólo la palabra**, y eso partió los sitios de uso en
 * dos idiomas: unos escriben `${n} ${pluralize(n, "mes")}` y otros llamaban a
 * `pluralize` esperando que trajera el número. Los segundos perdían la cifra en
 * silencio: "Se ocultarán pantallas", "12 tramos con observaciones". Un texto
 * gramaticalmente correcto al que le falta el dato no lo delata ningún test de
 * tipos.
 *
 * `pluralize` se conserva para cuando la frase no lleva número
 * ("Ver registros del período").
 */
export function countOf(count: number, singular: string, plural?: string): string {
  return `${QTY_FORMAT.format(count)} ${pluralize(count, singular, plural)}`
}

/** Format a number with thousands separators (for quantities) */
export function formatQty(n: number, unit?: string): string {
  if (!Number.isFinite(n)) return VALUE_MISSING
  const formatted = QTY_FORMAT.format(n)
  return unit ? `${formatted} ${pluralizeUnit(n, unit)}` : formatted
}

/**
 * Tamaño de archivo para superficies de producto. Conserva la separación
 * decimal chilena y evita que cada lista implemente sus propios KB/MB.
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return VALUE_MISSING
  if (bytes < 1024) return `${formatQty(bytes)} B`
  if (bytes < 1024 * 1024) return `${QTY_FORMAT.format(bytes / 1024)} KB`
  return `${QTY_FORMAT.format(bytes / (1024 * 1024))} MB`
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

/**
 * Marca única para un valor que no se puede representar (TASK-UI-012).
 *
 * La tarea declaraba cuatro estados de valor —ausente, desconocido, legacy y
 * timezone— y no los había diseñado nadie, así que cada formateador improvisaba
 * el suyo. Sondearlos destapó tres formas distintas de fallar mal:
 *
 *   formatDate("basura")   → **lanzaba** `Invalid time value`, y en un Server
 *                            Component un campo sucio se lleva la página entera
 *                            al `error.tsx`.
 *   formatDate(null)       → **"31-12-1969"**, la época presentada como una
 *                            fecha real. Peor que fallar: es una mentira
 *                            verosímil que nadie va a cuestionar.
 *   formatQty(NaN)         → "NaN", "$NaN", "NaN MB" — jerga de implementación
 *                            en pantalla, que es MICRO-001 otra vez.
 *
 * El contrato es uno: un valor que no se puede representar se dice, no se
 * inventa ni tumba la pantalla. Un dato ausente y uno corrupto se ven igual a
 * propósito — la diferencia le importa a quien depura, no a quien opera, y para
 * eso está el registro.
 */
export const VALUE_MISSING = "—"

/** Format a date in es-CL locale */
export function formatDate(date: Date | string | number): string {
  const plain = plainDateParts(date)
  if (plain) return `${plain[2]}-${plain[1]}-${plain[0]}`
  if (date === null || date === undefined || date === "") return VALUE_MISSING
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return VALUE_MISSING
  const [year, month, day] = CHILE_DATE_FORMAT.format(parsed).split("-")
  return `${day}-${month}-${year}`
}

/** Format datetime in es-CL locale */
export function formatDateTime(date: Date | string | number): string {
  // Una fecha calendario ("2026-06-11") no tiene hora que convertir.
  if (plainDateParts(date)) return `${formatDate(date)} 00:00`
  if (date === null || date === undefined || date === "") return VALUE_MISSING
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return VALUE_MISSING
  return `${formatDate(d)} ${CHILE_TIME_FORMAT.format(d)}`
}

/**
 * Formatea una cadena de calendario 'YYYY-MM-DD' como 'dd-mm-yyyy'.
 *
 * Alias del contrato SST (históricamente en `lib/sst/date.ts`): el render de
 * fechas tiene una sola fuente — `lib/utils.ts` (auditoría UI/UX §4.4). Para
 * una cadena ISO de calendario la salida es idéntica a `formatDate`.
 */
export function formatDateDisplay(isoDate: string): string {
  return formatDate(isoDate)
}

/**
 * Variante tolerante del contrato de fecha: acepta ISO 'YYYY-MM-DD',
 * 'YYYY-MM-DDTHH:mm:ss' o con zona horaria explícita. Trunca al día y
 * formatea 'dd-mm-yyyy' (mismo contrato que `formatDate`). Entrada vacía o
 * no parseable → "—".
 */
export function formatDateSafe(input: string | null | undefined): string {
  if (!input) return VALUE_MISSING
  const isoDay = input.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return VALUE_MISSING
  return formatDate(isoDay)
}

/**
 * Año/mes/día en hora de Chile continental.
 *
 * `getFullYear()`/`getMonth()`/`getDate()` leen la zona del proceso, que en
 * producción es UTC: durante las últimas 3–4 horas de cada día chileno
 * devuelven el día —y el 31 de diciembre, el año— equivocado. Todo lo que
 * decida "qué período es hoy" debe pasar por aquí.
 */
export function chileDateParts(date: Date | string | number = new Date()): { year: number; month: number; day: number } {
  const [year, month, day] = CHILE_DATE_FORMAT.format(new Date(date)).split("-")
  return { year: Number(year), month: Number(month), day: Number(day) }
}

/**
 * "YYYY-MM-DD" del día civil chileno — el formato en que se guardan las columnas
 * de fecha sin hora (`maintenance_date`, `expires_at`, `load_date`).
 *
 * Comparar esas columnas contra `toISOString().slice(0,10)` las mide en UTC y
 * adelanta el corte del día 3–4 horas: entre las 20:00 y la medianoche chilena,
 * lo que vence hoy aparece vencido. Usa esto, no `toISOString()`.
 */
export function todayInChile(date: Date | string | number = new Date()): string {
  const { year, month, day } = chileDateParts(date)
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Desplaza `days` días sobre una fecha civil "YYYY-MM-DD" sin que la mueva el cambio de hora. */
export function addDaysToPlainDate(plainDate: string, days: number): string {
  return new Date(Date.parse(`${plainDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
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

