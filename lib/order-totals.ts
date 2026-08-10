/**
 * Totales de una orden de compra.
 *
 * `unitPrice: null` es **costo pendiente** (un servicio cuyo precio aún no se
 * conoce), no un precio de $0. Esas líneas no entran en la suma —tratarlas como
 * cero daría un total matemáticamente falso— y se reportan aparte con
 * `pendingCostLines` para que la interfaz pueda decir "Total conocido: $X ·
 * 2 servicios con costo pendiente".
 */
export function computeOrderTotals(
  items: { quantity: number; unitPrice: number | null; discount?: number }[],
) {
  // El neto es, por definición, la suma de los subtotales que se persisten e
  // imprimen por línea (purchase-orders-create.ts y -edit.ts los redondean).
  // Redondear acá la suma continua dejaba la columna de la OC impresa sin
  // cuadrar contra su propio Neto.
  const net = items.reduce((sum, i) => {
    if (i.unitPrice === null || i.unitPrice === undefined) return sum
    const line = Math.round(i.quantity * i.unitPrice * (1 - (i.discount ?? 0) / 100))
    return sum + line
  }, 0)
  const TAX_RATE = Number(process.env.TAX_RATE ?? 0.19)
  const tax = Math.round(net * TAX_RATE)
  const pendingCostLines = items.filter((i) => i.unitPrice === null || i.unitPrice === undefined).length
  return { netAmount: net, taxAmount: tax, totalAmount: Math.round(net + tax), pendingCostLines }
}

/** Subtotal de una línea; `null` mientras el costo siga pendiente. */
export function computeLineSubtotal(
  quantity: number,
  unitPrice: number | null,
  discount = 0,
): number | null {
  if (unitPrice === null || unitPrice === undefined) return null
  return Math.round(quantity * unitPrice * (1 - discount / 100))
}
