import { expect, type Page } from "@playwright/test"

/**
 * Apoyo de los specs de captura de una inspección (`/prevencion/inspecciones/<runId>`).
 *
 * Vive aparte de `helpers.ts` a propósito: ese archivo es del helper de ítems
 * (`responderItemInspeccion`, `campoInspeccion`), y lo que hay acá sólo habla del estado de
 * guardado, que es independiente de cómo se pinte cada ítem.
 */

/**
 * El estado de guardado que está realmente pintado.
 *
 * `RunSaveStatus` aparece DOS veces en el DOM —junto al avance de la cabecera de trabajo
 * (`hidden md:inline`) y en la barra fija del teléfono (`md:hidden`)— y una de las dos queda
 * oculta por CSS según el ancho. Un
 * `getByRole("status")` o un `.first()` devolvería, según el viewport, justo la copia que no
 * se ve; filtrar por visibilidad deja siempre la que importa. El nodo trae
 * `data-save-state` (`saved`, `dirty`, `saving`, `offline`, `conflict`, `queued_close`…),
 * que es el contrato estable: el texto puede cambiar de redacción.
 */
export function estadoDeGuardado(page: Page) {
  return page.locator("[data-save-state]").filter({ visible: true })
}

/**
 * Espera a que lo que hay en pantalla esté en el servidor.
 *
 * Tras editar, el estado pasa a `dirty` en el mismo instante (se deriva de lo que se
 * enviaría frente a lo que el servidor tiene), así que leer `saved` después de la última
 * edición sólo ocurre cuando el guardado terminó de verdad. Sirve para dejar la pantalla
 * quieta antes de cortar la conexión o de abrir otra sesión.
 */
export async function esperarGuardado(page: Page) {
  await expect(estadoDeGuardado(page)).toHaveAttribute("data-save-state", "saved", { timeout: 30_000 })
}
