/**
 * Utilidades de fecha para el dominio SST — sin desfase por zona horaria.
 *
 * Problema: `new Date().toISOString()` devuelve la fecha en UTC.
 * En Chile (UTC-3/-4) a las 23:00 local, la fecha UTC ya es el día siguiente.
 * Esto provoca que las fechas capturadas, los seguimientos día 0/7/15/30 y
 * las fechas del PDF "se corran" un día.
 *
 * Solución: siempre construir fechas a partir de los componentes locales
 * (getFullYear, getMonth, getDate) o parsear 'YYYY-MM-DD' con hora local
 * en vez de UTC.
 */

/**
 * Devuelve la fecha local de hoy en formato ISO 'YYYY-MM-DD'.
 * Equivalente seguro a new Date().toISOString().split('T')[0] pero sin UTC.
 */
export function todayLocalISO(): string {
  const d = new Date()
  return localDateToISO(d)
}

/**
 * Convierte un objeto Date al formato 'YYYY-MM-DD' usando la hora local.
 */
export function localDateToISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Parsea una cadena 'YYYY-MM-DD' como fecha local (medianoche local),
 * evitando que Date('YYYY-MM-DD') la interprete como UTC y cause desfase.
 */
export function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/**
 * Añade `days` días a una fecha ISO 'YYYY-MM-DD' y devuelve el resultado
 * como 'YYYY-MM-DD', todo en hora local (sin desfase UTC).
 */
export function addDays(isoDate: string, days: number): string {
  const date = parseLocalDate(isoDate)
  date.setDate(date.getDate() + days)
  return localDateToISO(date)
}

/**
 * Formatea una cadena 'YYYY-MM-DD' al formato de visualización 'dd/mm/aaaa'.
 * Parsea como fecha local para evitar desfase.
 */
export function formatDateDisplay(isoDate: string): string {
  const date = parseLocalDate(isoDate)
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}
