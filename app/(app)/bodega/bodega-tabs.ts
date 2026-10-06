import type { BodegaViewTab } from "./bodega-view-tabs"

/** Pestañas de Bodega, iguales en `/bodega` y en `/bodega/documentos`. */
export function buildBodegaTabs(counts: { movements?: number } = {}): BodegaViewTab[] {
  return [
    // Sin contador en Stock: repetía "Productos con stock" del encabezado, y
    // desde que la tabla muestra también lo que sólo está por recibir ya no
    // coincide con sus filas.
    { value: "stock", label: "Stock" },
    // El valor interno sigue siendo `kardex` (URL `?vista=kardex`); la etiqueta
    // es la palabra que usa la bodega.
    { value: "kardex", label: "Movimientos", count: counts.movements },
    { value: "documentos", label: "Documentos", href: "/bodega/documentos" },
  ]
}
