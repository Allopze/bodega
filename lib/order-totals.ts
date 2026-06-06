export function computeOrderTotals(items: { quantity: number; unitPrice: number; discount?: number }[]) {
  const net = items.reduce((sum, i) => {
    const line = i.quantity * i.unitPrice * (1 - (i.discount ?? 0) / 100)
    return sum + line
  }, 0)
  const TAX_RATE = 0.19
  const tax = Math.round(net * TAX_RATE)
  const total = Math.round(net + tax)
  return { netAmount: Math.round(net), taxAmount: tax, totalAmount: total }
}
