export function computeOrderTotals(items: { quantity: number; unitPrice: number; discount?: number }[]) {
  // El neto es, por definición, la suma de los subtotales que se persisten e
  // imprimen por línea (purchase-orders-create.ts y -edit.ts los redondean).
  // Redondear acá la suma continua dejaba la columna de la OC impresa sin
  // cuadrar contra su propio Neto.
  const net = items.reduce((sum, i) => {
    const line = Math.round(i.quantity * i.unitPrice * (1 - (i.discount ?? 0) / 100))
    return sum + line
  }, 0)
  const TAX_RATE = Number(process.env.TAX_RATE ?? 0.19)
  const tax = Math.round(net * TAX_RATE)
  return { netAmount: net, taxAmount: tax, totalAmount: Math.round(net + tax) }
}
