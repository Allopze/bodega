"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { registerReceiptAction } from "./actions"
import { formatQty } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import Link from "next/link"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface ReceiptOcItem {
  id:               string   // purchaseOrderItemId
  requestItemId:    string | null
  productName:      string
  productSku:       string | null
  quantity:         number
  quantityOfficeReceived: number
  quantityReceived: number   // already received in previous receipts
  unitOfMeasure:    string
  notes:            string | null
}

type ReceiptStage = "office" | "faena"

/* ── Receipt form ─────────────────────────────────────────────────────────────── */

export function ReceiptForm({
  purchaseOrderId,
  orderCode,
  orderWorksiteName,
  items,
  canOffice,
  canFaena,
}: {
  purchaseOrderId: string
  orderCode:       string
  orderWorksiteName: string
  items:           ReceiptOcItem[]
  canOffice:       boolean
  canFaena:        boolean
}) {
  const getRemaining = React.useCallback((item: ReceiptOcItem, stage: ReceiptStage) => {
    // Office caps at the ordered quantity; faena caps STRICTLY at what already arrived at
    // office (no fallback to full quantity → goods must pass through office first).
    if (stage === "office") return Math.max(0, item.quantity - item.quantityOfficeReceived)
    return Math.max(0, item.quantityOfficeReceived - item.quantityReceived)
  }, [])

  // A stage is offered only when the user can perform it AND there is something left to receive.
  const officeAvailable = canOffice && items.some((i) => getRemaining(i, "office") > 0)
  const faenaAvailable  = canFaena  && items.some((i) => getRemaining(i, "faena")  > 0)

  const [guideNo, setGuideNo] = React.useState<string>("")
  const [notes,   setNotes]   = React.useState<string>("")
  const [stage,   setStage]   = React.useState<ReceiptStage>(officeAvailable ? "office" : "faena")
  const [qtys,    setQtys]    = React.useState<Record<string, number>>({})

  const [state, action] = useActionState<ActionState, FormData>(registerReceiptAction, INITIAL_STATE)

  React.useEffect(() => {
    setQtys(Object.fromEntries(items.map((i) => [i.id, getRemaining(i, stage)])))
  }, [items, stage, getRemaining])

  React.useEffect(() => {
    if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  const itemsJson = JSON.stringify(
    items.map((i) => ({
      purchaseOrderItemId: i.id,
      quantityReceived:    qtys[i.id]     ?? 0,
      quantityRejected:    0,
      quantityDamaged:     0,
      notes:               null,
    }))
  )
  const stageLabel = stage === "office" ? "Oficina" : "Faena"
  const pendingLineCount = items.filter((item) => getRemaining(item, stage) > 0).length
  const receivingLineCount = items.filter((item) => (qtys[item.id] ?? getRemaining(item, stage)) > 0).length

  return (
    <form action={action} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <input type="hidden" name="itemsJson"        value={itemsJson} />
      <input type="hidden" name="stage"            value={stage} />

      <div className="space-y-6">
        {/* Header */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="N° guía de despacho" htmlFor="receiptDispatchGuideNo" error={state.fieldErrors?.dispatchGuideNo?.[0]}>
            <Input
              id="receiptDispatchGuideNo"
              name="dispatchGuideNo"
              value={guideNo}
              onChange={(e) => setGuideNo(e.target.value)}
              placeholder="Ej: GD-000123"
              error={!!state.fieldErrors?.dispatchGuideNo}
            />
          </Field>

        <Field label="Tipo de recepción" className="md:col-span-2" error={state.fieldErrors?.stage?.[0]}>
          <div className="grid gap-2 sm:grid-cols-2">
            {canOffice && (
              <button
                type="button"
                onClick={() => setStage("office")}
                disabled={!officeAvailable}
                className={`rounded-[var(--radius)] border px-3 py-2 text-left transition-colors disabled:opacity-50 ${stage === "office" ? "border-[var(--color-primary-line)] bg-[var(--color-primary-tint)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]"}`}
              >
                <p className="text-sm font-medium text-[var(--color-text)]">Recepción en oficina</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                  Proveedor entrega en oficina Chome. No suma stock ni cierra ítems.
                </p>
              </button>
            )}
            {canFaena && (
              <button
                type="button"
                onClick={() => setStage("faena")}
                disabled={!faenaAvailable}
                className={`rounded-[var(--radius)] border px-3 py-2 text-left transition-colors disabled:opacity-50 ${stage === "faena" ? "border-[var(--color-primary-line)] bg-[var(--color-primary-tint)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]"}`}
              >
                <p className="text-sm font-medium text-[var(--color-text)]">Recepción en faena</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                  {faenaAvailable
                    ? `Oficina distribuye a ${orderWorksiteName}. Actualiza stock y trazabilidad.`
                    : "Disponible una vez registrada la llegada a oficina."}
                </p>
              </button>
            )}
          </div>
        </Field>
        </div>

        {/* Items table */}
        <div className="flex flex-col gap-2">
          <h2 className="text-h2 text-[var(--color-text)]">
            Ítems de la OC {orderCode}
          </h2>

        <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] divide-y divide-[var(--color-border)] overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_120px] gap-4 px-4 py-2 bg-[var(--color-surface-2)] text-xs font-medium text-[var(--color-text-muted)]">
            <span>Producto</span>
            <span className="text-right">Recibido</span>
          </div>

          {items.map((item) => {
            const remaining = getRemaining(item, stage)
            const pending   = remaining > 0

            return (
              <div key={item.id} className={`grid grid-cols-[1fr_120px] gap-4 px-4 py-3 ${!pending ? "opacity-50" : ""}`}>
                <div>
                  <div className="flex items-center gap-2">
                    {item.productSku && (
                      <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                        {item.productSku}
                      </span>
                    )}
                    <span className="text-sm text-[var(--color-text)]">{item.productName}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-subtle)] mt-0.5">
                    Pedido: {formatQty(item.quantity, item.unitOfMeasure)}
                    {item.quantityOfficeReceived > 0 && ` · En oficina: ${formatQty(item.quantityOfficeReceived, item.unitOfMeasure)}`}
                    {item.quantityReceived > 0 && ` · Ya recibido: ${formatQty(item.quantityReceived, item.unitOfMeasure)}`}
                    {!pending && " · Completamente recibido"}
                  </div>
                </div>

                <Input
                  id={`receiptQty-${item.id}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max={remaining}
                  value={qtys[item.id] ?? remaining}
                  onChange={(e) => setQtys((p) => ({ ...p, [item.id]: parseFloat(e.target.value) || 0 }))}
                  className="h-7 text-sm tabular-nums text-right"
                  disabled={!pending}
                />
              </div>
            )
          })}
        </div>
        </div>

        {/* Notes */}
        <Field label="Observaciones de recepción" htmlFor="receiptNotes" error={state.fieldErrors?.notes?.[0]}>
          <Textarea
            id="receiptNotes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Estado del embalaje, condiciones de entrega..."
            error={!!state.fieldErrors?.notes}
          />
        </Field>

        {/* Error */}
        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {state.message}
          </p>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
          <SubmitButton
            label="Marcar como recibido"
            loadingLabel="Guardando..."
            variant="primary"
          />
          <Link
            href="/recepcion"
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Cancelar
          </Link>
        </div>
      </div>

      <aside className="h-fit rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)] xl:sticky xl:top-6">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Resumen recepción</p>
        <div className="mt-3 rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-xs text-[var(--color-text-muted)]">Orden</p>
          <p className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{orderCode}</p>
        </div>
        <div className="mt-4 space-y-2 border-b border-[var(--color-border)] pb-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-text-muted)]">Etapa</span>
            <span className="font-medium text-[var(--color-text)]">{stageLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-text-muted)]">Líneas pendientes</span>
            <span className="tabular-nums text-[var(--color-text)]">{pendingLineCount}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-text-muted)]">Con cantidad</span>
            <span className="tabular-nums text-[var(--color-text)]">{receivingLineCount}</span>
          </div>
        </div>
        <p className="mt-4 rounded-[var(--radius)] bg-[var(--color-primary-tint)] px-3 py-2 text-xs leading-relaxed text-[var(--color-primary-ink)]">
          {guideNo.trim() ? "La guía queda asociada a esta recepción." : "Puedes registrar la recepción sin guía si la operación aún no la entrega."}
        </p>
      </aside>
    </form>
  )
}
