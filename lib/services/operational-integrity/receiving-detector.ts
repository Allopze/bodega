import { integrityFinding, type OperationalIntegrityFinding } from "./types"

interface OrderLine { id: string; purchaseOrderId: string; worksiteId: string; quantity: number; deliveryMode: string }
interface DispositionRow {
  id: string
  receiptId: string
  purchaseOrderItemId: string
  locationType: string
  quantityReceived: number
  quantityRejected: number
  quantityDamaged: number
}

export function detectReceivingIntegrity(input: { orderItems: OrderLine[]; receipts: DispositionRow[] }): OperationalIntegrityFinding[] {
  const findings: OperationalIntegrityFinding[] = []
  for (const line of [...input.orderItems].sort((a, b) => a.id.localeCompare(b.id))) {
    const rows = input.receipts.filter(row => row.purchaseOrderItemId === line.id).sort((a, b) => a.id.localeCompare(b.id))
    const officeAccepted = rows.filter(row => row.locationType === "office").reduce((sum, row) => sum + row.quantityReceived, 0)
    for (const stage of ["office", "faena"]) {
      const stageRows = rows.filter(row => row.locationType === stage)
      const limit = stage === "faena" && line.deliveryMode === "via_oficina" ? officeAccepted : line.quantity
      const disposed = stageRows.reduce((sum, row) => sum + row.quantityReceived + row.quantityRejected + row.quantityDamaged, 0)
      if (disposed - limit <= 0.000001) continue
      const receiptId = stageRows.at(-1)!.receiptId
      findings.push(integrityFinding({ domain: "receiving", code: "RECEIPT_DISPOSITION_EXCEEDS_LIMIT", worksiteId: line.worksiteId, entityType: "receipt", entityId: receiptId,
        identity: JSON.stringify([line.id, stage]), href: `/recepcion/${encodeURIComponent(receiptId)}?faena=${encodeURIComponent(line.worksiteId)}`,
        snapshot: { purchaseOrderId: line.purchaseOrderId, purchaseOrderItemId: line.id, stage, limit, disposed, receipts: stageRows.map(row => ({ id: row.id, receiptId: row.receiptId, accepted: row.quantityReceived, rejected: row.quantityRejected, damaged: row.quantityDamaged })) },
      }))
    }
  }
  return findings
}
