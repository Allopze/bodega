/**
 * Abrir la paleta de comandos desde fuera de ella (el botón «Ir a…» de la barra superior).
 *
 * La paleta se carga con `React.lazy` desde `AppShell` y su escucha del evento sólo existe cuando el
 * fragmento llegó. Un toque en el botón antes de eso se perdía sin ningún aviso (en el teléfono, con red
 * lenta, pasa), así que la petición queda anotada y la paleta la recoge al montarse. Este módulo no importa
 * la paleta: el botón no arrastra su fragmento.
 */

export const OPEN_COMMAND_PALETTE_EVENT = "open-command-palette"

/** Hay una petición que ninguna paleta montada ha atendido todavía. */
let pendingOpen = false

/** Pide abrir la paleta. Si ya está montada la abre de inmediato; si no, la abrirá al montarse. */
export function requestOpenCommandPalette(): void {
  if (typeof window === "undefined") return
  pendingOpen = true
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
}

/** La paleta atiende la petición pendiente (al recibir el evento o al montarse). `true` si había una. */
export function consumePendingOpen(): boolean {
  const wasPending = pendingOpen
  pendingOpen = false
  return wasPending
}
