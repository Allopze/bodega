/**
 * Días hábiles chilenos (§9.1 del rediseño MIPER).
 *
 * Hasta ahora el repo sólo sabía restar `subtractBusinessDays`
 * (`lib/utils.ts`), que salta fines de semana y **cuenta un feriado como
 * hábil** — su propio docblock lo dice. Los plazos de firma del flujo MIPER se
 * miden en días hábiles de verdad (un feriado no es un día en que alguien
 * pueda firmar), así que acá vive el calendario.
 *
 * Todo se calcula sobre fechas civiles "YYYY-MM-DD" chilenas (las mismas que
 * guardan las columnas sin hora) y se ancla en UTC, igual que
 * `addDaysToPlainDate`: leer el día de la semana con `getDay()` lo mediría en
 * la zona del proceso, que en producción es UTC.
 *
 * ## Los feriados se derivan, no se transcriben
 *
 * La lista se calcula por regla para cualquier año en vez de copiarse a mano:
 * una tabla fija se queda vieja en silencio (y una fecha mal transcrita mueve
 * un aviso un día). Las reglas son las del feriado legal chileno:
 *
 * - Fecha fija: 01-01, 05-01, 05-21, 06-21 (Día Nacional de los Pueblos
 *   Indígenas), 07-16, 08-15, 09-18, 09-19, 11-01, 12-08, 12-25.
 * - Móviles por Pascua: Viernes Santo y Sábado Santo.
 * - Trasladables a lunes (Ley 19.973): 06-29, 10-12 y 10-31 — al lunes de esa
 *   semana si caen martes, miércoles o jueves; al lunes siguiente si caen
 *   viernes. Si caen sábado o domingo no se mueven: ya son fin de semana.
 *
 * Cuando se publique el calendario oficial de un año, revisar esta lista: un
 * día de más o de menos sólo adelanta o atrasa un recordatorio, nunca mueve un
 * dato.
 */
import { addDaysToPlainDate } from "@/lib/utils"

const MONTH_DAY: readonly string[] = [
  "01-01", // Año Nuevo
  "05-01", // Día Nacional del Trabajo
  "05-21", // Día de las Glorias Navales
  "06-21", // Día Nacional de los Pueblos Indígenas
  "07-16", // Virgen del Carmen
  "08-15", // Asunción de la Virgen
  "09-18", // Independencia Nacional
  "09-19", // Glorias del Ejército
  "11-01", // Todos los Santos
  "12-08", // Inmaculada Concepción
  "12-25", // Navidad
]

/** Feriados que la ley traslada al lunes más cercano (Ley 19.973). */
const MOVABLE_TO_MONDAY: readonly string[] = ["06-29", "10-12", "10-31"]

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** Domingo de Pascua (algoritmo gregoriano anónimo), como fecha civil. */
function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${pad(month)}-${pad(day)}`
}

/** 0 = domingo … 6 = sábado, medido en UTC sobre una fecha civil. */
export function weekdayOf(plainDate: string): number {
  return new Date(`${plainDate}T00:00:00Z`).getUTCDay()
}

/** Lunes de la semana en que cae `plainDate` (la semana chilena parte el lunes). */
function mondayOfWeek(plainDate: string): string {
  const weekday = weekdayOf(plainDate)
  // `weekday` es 1 para lunes; el domingo (0) pertenece a la semana que cierra.
  return addDaysToPlainDate(plainDate, weekday === 0 ? -6 : 1 - weekday)
}

/* Los feriados de un año son inmutables, y `isBusinessDay` los pide una vez por
 * día recorrido: sin esta caché, contar un trimestre reconstruye y ordena la
 * lista cien veces. */
const holidayCache = new Map<number, readonly string[]>()

/** Feriados legales de Chile del año, como fechas civiles ordenadas. */
export function chileHolidays(year: number): readonly string[] {
  const cached = holidayCache.get(year)
  if (cached) return cached

  const holidays = new Set<string>()
  for (const monthDay of MONTH_DAY) holidays.add(`${year}-${monthDay}`)

  const easter = easterSunday(year)
  holidays.add(addDaysToPlainDate(easter, -2)) // Viernes Santo
  holidays.add(addDaysToPlainDate(easter, -1)) // Sábado Santo

  for (const monthDay of MOVABLE_TO_MONDAY) {
    const date = `${year}-${monthDay}`
    const weekday = weekdayOf(date)
    if (weekday === 2 || weekday === 3 || weekday === 4) holidays.add(mondayOfWeek(date))
    else if (weekday === 5) holidays.add(addDaysToPlainDate(mondayOfWeek(date), 7))
    else holidays.add(date)
  }

  const list = [...holidays].sort()
  holidayCache.set(year, list)
  return list
}

/** ¿Es un día hábil en Chile? Lunes a viernes, sin feriados. */
export function isBusinessDay(plainDate: string): boolean {
  const weekday = weekdayOf(plainDate)
  if (weekday === 0 || weekday === 6) return false
  return !chileHolidays(Number(plainDate.slice(0, 4))).includes(plainDate)
}

/**
 * Avanza `days` días hábiles desde `plainDate`.
 *
 * El resultado siempre es un día hábil **estrictamente posterior**: un viernes
 * más un día hábil es el lunes siguiente (o el martes, si el lunes es feriado).
 */
export function addBusinessDays(plainDate: string, days: number): string {
  if (!Number.isInteger(days) || days < 0) throw new Error("Los días hábiles a sumar deben ser un entero no negativo.")
  let date = plainDate
  for (let remaining = days; remaining > 0;) {
    date = addDaysToPlainDate(date, 1)
    if (isBusinessDay(date)) remaining -= 1
  }
  return date
}

/**
 * Días hábiles del intervalo **cerrado** `[from, to]`: ambos extremos cuentan
 * cuando son hábiles.
 *
 * Incluir el extremo inicial es lo que hace legible una espera («desde el
 * lunes hasta el lunes siguiente son seis días hábiles contables»), y es la
 * unidad con que se decidió el escalón de cinco días hábiles de la firma
 * pendiente (`lib/services/pdtp/reminders.ts`). Si `to` es anterior a `from`,
 * devuelve el conteo con signo negativo, para que la resta sea simétrica.
 */
export function businessDaysBetween(from: string, to: string): number {
  if (to < from) return -businessDaysBetween(to, from)
  if (to === from) return isBusinessDay(from) ? 1 : 0

  let count = 0
  for (let date = from; date <= to; date = addDaysToPlainDate(date, 1)) {
    if (isBusinessDay(date)) count += 1
  }
  return count
}
