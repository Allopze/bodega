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
    <div className="grid gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      {/* Step 1 */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-label={officeComplete ? "Paso 1 completado" : officeInProgress ? "Paso 1 en curso" : "Paso 1 pendiente"}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            officeComplete
              ? "bg-[var(--color-success)] text-white"
              : officeInProgress
                ? "border-2 border-[var(--color-primary-line)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
              : "border-2 border-[var(--color-border)] text-[var(--color-text-muted)]"
          }`}
        >
          {officeComplete ? <CheckCircle size={14} weight="fill" /> : "1"}
        </span>
        <div>
          <p className="font-medium text-[var(--color-text)]">Llegada a oficina</p>
          <p className="text-[var(--color-text-subtle)]">
            {officeComplete
              ? `${qty(totalOfficeReceived, linesInOffice)} completado`
              : officeInProgress
              ? unit
                ? `${totalOfficeReceived} / ${totalOrdered} ${unit}`
                : `${linesInOffice} / ${linesOrdered} líneas`
              : "Pendiente"}
          </p>
        </div>
      </div>

      {/* Connector */}
      <span className="hidden shrink-0 text-[var(--color-text-subtle)] sm:inline" aria-hidden="true">→</span>

      {/* Step 2 */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-label={faenaComplete ? "Paso 2 completado" : pendingDispatch > 0 ? "Paso 2 en curso" : "Paso 2 pendiente"}
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
