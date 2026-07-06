"use client"

import { CheckCircle } from "@phosphor-icons/react"
import type { ReceiptOcItem } from "./receipt-form.types"

export function TwoStageProgress({
  items,
  canOffice,
  canFaena,
}: {
  items:     ReceiptOcItem[]
  canOffice: boolean
  canFaena:  boolean
}) {
  if (!canOffice && !canFaena) return null
  if (!canOffice || !canFaena) return null  // single-role user: redundant with button label

  const totalOrdered        = items.reduce((n, i) => n + i.quantity, 0)
  const totalOfficeReceived = items.reduce((n, i) => n + i.quantityOfficeReceived, 0)
  const totalFaenaReceived  = items.reduce((n, i) => n + i.quantityReceived, 0)

  const officeComplete   = totalOfficeReceived >= totalOrdered && totalOrdered > 0
  const officeInProgress = totalOfficeReceived > 0 && !officeComplete
  const pendingDispatch  = Math.max(0, totalOfficeReceived - totalFaenaReceived)
  const faenaComplete    = totalOfficeReceived > 0 && pendingDispatch === 0

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-xs">
      {/* Step 1 */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            officeComplete || officeInProgress
              ? "bg-[var(--color-success)] text-white"
              : "border-2 border-[var(--color-border)] text-[var(--color-text-muted)]"
          }`}
        >
          {officeComplete || officeInProgress ? <CheckCircle size={14} weight="fill" /> : "1"}
        </span>
        <div>
          <p className="font-medium text-[var(--color-text)]">Llegada a oficina</p>
          <p className="text-[var(--color-text-subtle)]">
            {officeComplete
              ? `${totalOfficeReceived} un. — completo`
              : officeInProgress
              ? `${totalOfficeReceived} / ${totalOrdered} un.`
              : "Pendiente"}
          </p>
        </div>
      </div>

      {/* Connector */}
      <span className="shrink-0 text-[var(--color-text-subtle)]">→</span>

      {/* Step 2 */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            faenaComplete
              ? "bg-[var(--color-success)] text-white"
              : pendingDispatch > 0
              ? "border-2 border-[var(--color-primary-line)] text-[var(--color-primary)]"
              : "border-2 border-[var(--color-border)] text-[var(--color-text-muted)]"
          }`}
        >
          {faenaComplete ? <CheckCircle size={14} weight="fill" /> : "2"}
        </span>
        <div>
          <p className={`font-medium ${totalOfficeReceived === 0 ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"}`}>
            Despacho a faena
          </p>
          <p className="text-[var(--color-text-subtle)]">
            {faenaComplete
              ? "Completo"
              : pendingDispatch > 0
              ? `${pendingDispatch} un. por despachar`
              : "Disponible tras Paso 1"}
          </p>
        </div>
      </div>
    </div>
  )
}
