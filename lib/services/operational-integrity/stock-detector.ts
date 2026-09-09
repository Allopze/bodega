import { integrityFinding, type OperationalIntegrityFinding } from "./types"

interface StockRow { worksiteId: string; productId: string; quantity: number }
interface MovementRow extends StockRow {
  id: string
  type: string
  stockBefore: number
  stockAfter: number
  performedAt: string
}
const differs = (a: number, b: number) => !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.000001

export function detectStockIntegrity(input: { stocks: StockRow[]; movements: MovementRow[] }): OperationalIntegrityFinding[] {
  const groups = new Map<string, MovementRow[]>()
  const key = (row: StockRow) => JSON.stringify([row.worksiteId, row.productId])
  const stocks = new Map(input.stocks.map(row => [key(row), row]))
  for (const row of input.movements) {
    const rows = groups.get(key(row)) ?? []
    rows.push(row)
    groups.set(key(row), rows)
  }
  const findings: OperationalIntegrityFinding[] = []
  for (const [groupKey, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    rows.sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt) || a.id.localeCompare(b.id))
    const last = rows.at(-1)!
    const base = { domain: "stock" as const, worksiteId: last.worksiteId, entityType: "stock_item" as const, entityId: last.productId, href: `/bodega?vista=kardex&faena=${encodeURIComponent(last.worksiteId)}&producto=${encodeURIComponent(last.productId)}` }
    const broken = rows.flatMap((row, index) => {
      const effect = row.type === "retiro_epp_trabajador" ? 0 : row.quantity
      const previous = rows[index - 1]
      if (!differs(row.stockAfter, row.stockBefore + effect) && (!previous || !differs(previous.stockAfter, row.stockBefore))) return []
      return [{ id: row.id, performedAt: row.performedAt, type: row.type, quantity: row.quantity, stockBefore: row.stockBefore, stockAfter: row.stockAfter, previousId: previous?.id ?? null, previousStockAfter: previous?.stockAfter ?? null }]
    })
    if (broken.length) findings.push(integrityFinding({ ...base, code: "STOCK_MOVEMENT_CHAIN_BREAK", snapshot: { movements: broken } }))
    const stock = stocks.get(groupKey)
    // applyMovementTx permits retiring used EPP without creating a stock row.
    const auditOnlyWithoutStock = !stock && rows.every(row => row.type === "retiro_epp_trabajador" && row.stockBefore === 0 && row.stockAfter === 0)
    if (!auditOnlyWithoutStock && (!stock || differs(last.stockAfter, stock.quantity))) findings.push(integrityFinding({ ...base, code: "STOCK_BALANCE_MISMATCH", snapshot: { lastMovementId: last.id, stockAfter: last.stockAfter, materializedQuantity: stock?.quantity ?? null } }))
  }
  return findings
}
