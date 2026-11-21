import { nameKey } from "@/lib/mantencion/normalize"

/**
 * Campos de la fila original del historial que no se muestran (decisión del usuario, 2026-11-21,
 * opción B): la cuenta de correo con que se envió el formulario. Tres de cada cuatro filas del
 * consolidado se enviaron desde cuentas Gmail personales, y el taller que registró ya dice de dónde
 * vino cada trabajo.
 *
 * El dato sigue guardado: la identidad de cada formulario (`sourceKey`) se calcula con él y la fila
 * original nunca se reescribe. Sólo deja de salir en pantalla. El responsable y el conductor sí se
 * muestran: son la trazabilidad del trabajo.
 *
 * Los encabezados son los dos con que llega hoy el correo («CORREO» del consolidado y «Dirección de
 * correo electrónico» del formulario) y sus variantes de Google Forms. Una lista cerrada, no una
 * expresión: un campo como «Correo del taller» no se oculta por accidente.
 */
const HIDDEN_HEADERS: ReadonlySet<string> = new Set([
  "correo",
  "correo electronico",
  "direccion de correo electronico",
  "email",
  "e-mail",
  "email address",
])

export function isHiddenHistoricalHeader(header: string): boolean {
  return HIDDEN_HEADERS.has(nameKey(header))
}

/** La fila original sin los campos ocultos. Se aplica en el servidor: el correo nunca llega al navegador. */
export function visibleHistoricalFields<T extends { header: string }>(fields: readonly T[]): T[] {
  return fields.filter((field) => !isHiddenHistoricalHeader(field.header))
}
