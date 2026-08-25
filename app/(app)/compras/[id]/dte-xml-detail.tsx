"use client"

import { formatCLP } from "@/lib/utils"
import type { DteXmlDetail } from "@/lib/services/dte-portal/purchase-document-xml"

/**
 * Neto, IVA, total y líneas de un DTE tal como vienen en su XML.
 *
 * Lo miran dos lugares por la misma razón: el DTE ya vinculado a la OC
 * (dte-received-card) y el candidato que todavía no se registra
 * (invoices-section). En los dos casos la persona está comparando el documento
 * del proveedor contra la orden antes de firmar, así que el bloque es uno solo.
 */
export function DteXmlDetailPanel({ detail }: { detail: DteXmlDetail }) {
  return (
    <div className="mt-3 rounded-(--radius-lg) bg-(--color-surface-2) p-3 text-xs">
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono tabular-nums text-(--color-text-muted)">
        <span>Neto: {formatCLP(detail.netAmount)}</span>
        <span>IVA: {formatCLP(detail.taxAmount)}</span>
        <span>Total: {formatCLP(detail.totalAmount)}</span>
      </div>
      {detail.items.length > 0 && (
        <ul className="mt-2 space-y-1 text-(--color-text-subtle)">
          {detail.items.map((item) => (
            <li key={item.lineNumber} className="flex justify-between gap-3">
              <span className="truncate">{item.productName}</span>
              <span className="shrink-0 font-mono tabular-nums">{item.quantity} × {formatCLP(item.unitPrice)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
