/**
 * El período elegido se recuerda en una cookie del navegador para que también
 * viaje cuando la persona cambia de pantalla por el menú lateral, cuyos enlaces
 * no llevan parámetros. Dura 12 horas: lo suficiente para una jornada, sin que
 * al día siguiente el módulo abra en un período viejo.
 */
export const FUEL_PERIOD_COOKIE = "chome_fuel_periodo"
export const FUEL_PERIOD_COOKIE_PATH = "/combustibles"
export const FUEL_PERIOD_COOKIE_MAX_AGE = 12 * 60 * 60

/** Sólo en el navegador. */
export function writeFuelPeriodCookie(value: string): void {
  if (typeof document === "undefined") return
  document.cookie = `${FUEL_PERIOD_COOKIE}=${encodeURIComponent(value)}; Path=${FUEL_PERIOD_COOKIE_PATH}; Max-Age=${FUEL_PERIOD_COOKIE_MAX_AGE}; SameSite=Lax`
}
