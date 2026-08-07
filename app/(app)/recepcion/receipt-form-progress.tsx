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

  // Sumar cantidades de líneas con unidades distintas da un número sin
  // significado ("12 par + 5 rollo = 17 un."). Sólo se muestran totales cuando
  // toda la OC comparte unidad; si no, se cuentan líneas, que sí es comparable
  // (auditoría UI/UX 2026-07-29, A-09).
  const units = new Set(items.map((i) => i.unitOfMeasure))
  const unit  = units.size === 1 ? [...units][0]! : null
  const qty   = (total: number, lines: number) =>
    unit ? `${total} ${unit}` : `${lines} línea${lines === 1 ? "" : "s"}`

  const linesOrdered  = items.length
  const linesInOffice = items.filter((i) => i.quantityOfficeReceived > 0).length

  const officeComplete   = totalOfficeReceived >= totalOrdered && totalOrdered > 0
  const officeInProgress = totalOfficeReceived > 0 && !officeComplete
  const pendingDispatch  = Math.max(0, totalOfficeReceived - totalFaenaReceived)
  // `pendingDispatch === 0` sólo dice "no queda nada por despachar **de lo que
  // llegó**". Sin exigir que la oficina esté completa, una OC con 6 de 12
  // unidades recibidas y esas 6 despachadas se anunciaba como "Completo",
  // contradiciendo a la tarjeta "Recepción en faena" que seguía deshabilitada
  // justo debajo (A-08).
  const faenaComplete    = officeComplete && pendingDispatch === 0

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
              ? `${qty(totalOfficeReceived, linesInOffice)} completo`
              : officeInProgress
              ? unit
                ? `${totalOfficeReceived} / ${totalOrdered} ${unit}`
                : `${linesInOffice} / ${linesOrdered} líneas`
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
              ? `${unit ? `${pendingDispatch} ${unit}` : "Hay líneas"} por despachar`
              : "Disponible tras Paso 1"}
          </p>
        </div>
      </div>
    </div>
  )
}
