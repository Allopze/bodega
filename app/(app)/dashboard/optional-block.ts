/**
 * Un bloque del tablero que puede faltar sin llevarse la página.
 *
 * `DASH-003` (auditoría 2026-09-14). El Resumen carga sus doce fuentes en un
 * solo `Promise.all`. Una sola de ellas —la tarjeta de cumplimiento PDTP—
 * fallaba, el `Promise.all` rechazaba y el usuario llegaba al límite de error
 * de **toda** la página: sin indicadores operacionales, sin actividad, sin
 * accesos. La misma llamada en la sección de Prevención ya se degradaba a
 * `null`; el Resumen no había adoptado ese manejo.
 *
 * Aquí se degrada igual, pero además **queda registrado**. Un `catch(() => null)`
 * silencioso convierte un esquema desincronizado —que fue la causa real— en una
 * tarjeta que simplemente no aparece, y nadie se entera durante semanas.
 */

import { logger } from "@/lib/logger"

/**
 * Devuelve el valor de `promise`, o `fallback` si falla, dejando el fallo en el
 * registro con el nombre del bloque. Nunca rechaza.
 */
export async function optionalBlock<T>(
  name: string,
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await promise
  } catch (error) {
    logger.error(`[dashboard] el bloque «${name}» no se pudo cargar; se muestra el resto del tablero`, error)
    return fallback
  }
}
