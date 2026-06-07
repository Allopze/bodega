"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import { Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
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

export interface WarehouseOption {
  id:   string
  name: string
}

/* ── Receipt form ─────────────────────────────────────────────────────────────── */

export function ReceiptForm({
  purchaseOrderId,
  orderCode,
  orderWorksiteName,
  items,
  warehouses,
}: {
  purchaseOrderId: string
  orderCode:       string
  orderWorksiteName: string
  items:           ReceiptOcItem[]
  warehouses:      WarehouseOption[]
}) {
  const [locationType,  setLocationType]  = React.useState<"warehouse" | "faena">(
    warehouses.length > 0 ? "warehouse" : "faena",
  )
  const [warehouseId,   setWarehouseId]   = React.useState<string>(warehouses[0]?.id ?? "")
  const [guideNo,       setGuideNo]       = React.useState<string>("")
  const [notes,         setNotes]         = React.useState<string>("")
  const [qtys,          setQtys]          = React.useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, Math.max(0, i.quantity - i.quantityReceived)]))
  )
  const [rejected,      setRejected]      = React.useState<Record<string, number>>({})
  const [damaged,       setDamaged]       = React.useState<Record<string, number>>({})

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
      quantityRejected:    rejected[i.id] ?? 0,
      quantityDamaged:     damaged[i.id]  ?? 0,
      notes:               null,
    }))
  )

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <input type="hidden" name="itemsJson"        value={itemsJson} />
      <input type="hidden" name="locationType"     value={locationType} />
      {locationType === "warehouse" && warehouseId && <input type="hidden" name="warehouseId" value={warehouseId} />}

      {/* Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="N° guía de despacho">
          <Input
            name="dispatchGuideNo"
            value={guideNo}
            onChange={(e) => setGuideNo(e.target.value)}
            placeholder="Ej: GD-000123"
          />
        </Field>

        <Field label="Destino" required className="md:col-span-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant={locationType === "warehouse" ? "primary" : "secondary"}
              className="justify-start"
              disabled={warehouses.length === 0}
              onClick={() => setLocationType("warehouse")}
            >
              Ingresar a bodega
            </Button>
            <Button
              type="button"
              variant={locationType === "faena" ? "primary" : "secondary"}
              className="justify-start"
              onClick={() => setLocationType("faena")}
            >
              Recepción directa en faena
            </Button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            {locationType === "warehouse"
              ? "Las cantidades recibidas entrarán al stock de la bodega seleccionada."
              : `La recepción quedará registrada contra ${orderWorksiteName}, sin aumentar stock.`}
          </p>
        </Field>

        {locationType === "warehouse" && (
          <Field label="Bodega de destino" required className="md:col-span-3">
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Selecciona bodega" /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {/* Items table */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          Ítems de la OC {orderCode}
        </h2>

        <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] divide-y divide-[var(--color-border)] overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_80px_80px_80px] gap-4 px-4 py-2 bg-[var(--color-surface-2)] text-xs font-medium text-[var(--color-text-muted)]">
            <span>Producto</span>
            <span className="text-right">Recibido</span>
            <span className="text-right">Rechazado</span>
            <span className="text-right">Dañado</span>
          </div>

          {items.map((item) => {
            const remaining = Math.max(0, item.quantity - item.quantityReceived)
            const pending   = remaining > 0

            return (
              <div key={item.id} className={`grid grid-cols-[1fr_80px_80px_80px] gap-4 px-4 py-3 ${!pending ? "opacity-50" : ""}`}>
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
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rejected[item.id] ?? 0}
                  onChange={(e) => setRejected((p) => ({ ...p, [item.id]: parseFloat(e.target.value) || 0 }))}
                  className="h-7 text-sm tabular-nums text-right"
                  disabled={!pending}
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={damaged[item.id] ?? 0}
                  onChange={(e) => setDamaged((p) => ({ ...p, [item.id]: parseFloat(e.target.value) || 0 }))}
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
          label="Registrar recepción"
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
