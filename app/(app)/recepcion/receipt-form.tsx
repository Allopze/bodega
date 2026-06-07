"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
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
  quantityReceived: number   // already received in previous receipts
  unitOfMeasure:    string
  notes:            string | null
}

/* ── Receipt form ─────────────────────────────────────────────────────────────── */

export function ReceiptForm({
  purchaseOrderId,
  orderCode,
  orderWorksiteName,
  items,
}: {
  purchaseOrderId: string
  orderCode:       string
  orderWorksiteName: string
  items:           ReceiptOcItem[]
}) {
  const [guideNo,       setGuideNo]       = React.useState<string>("")
  const [notes,         setNotes]         = React.useState<string>("")
  const [qtys,          setQtys]          = React.useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, Math.max(0, i.quantity - i.quantityReceived)]))
  )

  const [state, action] = useActionState<ActionState, FormData>(registerReceiptAction, INITIAL_STATE)

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

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <input type="hidden" name="itemsJson"        value={itemsJson} />
      <input type="hidden" name="locationType"     value="faena" />

      {/* Header */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="N° guía de despacho">
          <Input
            name="dispatchGuideNo"
            value={guideNo}
            onChange={(e) => setGuideNo(e.target.value)}
            placeholder="Ej: GD-000123"
          />
        </Field>

        <Field label="Destino" className="md:col-span-2">
          <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-sm font-medium text-[var(--color-text)]">Recepción directa en faena</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
              La recepción quedará registrada contra {orderWorksiteName}, sin bodega ni entrega posterior.
            </p>
          </div>
        </Field>
      </div>

      {/* Items table */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          Ítems de la OC {orderCode}
        </h2>

        <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] divide-y divide-[var(--color-border)] overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_120px] gap-4 px-4 py-2 bg-[var(--color-surface-2)] text-xs font-medium text-[var(--color-text-muted)]">
            <span>Producto</span>
            <span className="text-right">Recibido</span>
          </div>

          {items.map((item) => {
            const remaining = Math.max(0, item.quantity - item.quantityReceived)
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
                    {item.quantityReceived > 0 && ` · Ya recibido: ${formatQty(item.quantityReceived, item.unitOfMeasure)}`}
                    {!pending && " · Completamente recibido"}
                  </div>
                </div>

                <Input
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
      <Field label="Observaciones de recepción">
        <Textarea
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Estado del embalaje, condiciones de entrega..."
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
    </form>
  )
}
