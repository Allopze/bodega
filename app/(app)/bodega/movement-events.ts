/**
 * Canal entre quien pide registrar un movimiento (el botón del encabezado, el
 * menú de una fila de Stock) y la única hoja que lo hace.
 *
 * Un evento de ventana y no un contexto de React: el botón del encabezado se
 * renderiza dentro del `TopBar` del shell, fuera del árbol de la página, así que
 * un proveedor de página no lo alcanzaría. Y la hoja tiene que ser una sola:
 * `PageHeader` monta `actions` dos veces (TopBar y móvil), y dos hojas
 * escuchando abrirían dos paneles a la vez.
 */
export type BodegaMovementMode = "count" | "adjust" | "discard"

export interface BodegaMovementRequest {
  /** Sin modo, la hoja abre en la lista de trabajos. */
  mode?: BodegaMovementMode
  /** Sin faena, la que tiene la página a la vista. */
  worksiteId?: string
  /** Producto preseleccionado (ajuste y baja). */
  productId?: string
}

export const BODEGA_MOVEMENT_EVENT = "bodega:movement"

export function requestBodegaMovement(request: BodegaMovementRequest = {}): void {
  window.dispatchEvent(new CustomEvent<BodegaMovementRequest>(BODEGA_MOVEMENT_EVENT, { detail: request }))
}

const MODES: BodegaMovementMode[] = ["count", "adjust", "discard"]

/** Modo pedido por la URL (`?nuevo=conteo`); lo desconocido se ignora. */
export function parseMovementParam(raw: string | undefined): BodegaMovementMode | undefined {
  const mode = ({ conteo: "count", ajuste: "adjust", baja: "discard" } as Record<string, BodegaMovementMode>)[raw ?? ""]
  return mode && MODES.includes(mode) ? mode : undefined
}
