"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import { Warning, ArrowSquareOut } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { dispatchAction } from "./actions"
import { formatQty } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"

export interface StockOption {
  warehouseId:   string
  warehouseName: string
  productId:     string
  productName:   string
  productSku:    string | null
  quantity:      number
  unitOfMeasure: string
}

export interface WorksiteOption {
  id: string
  name: string
}

export function DispatchPanel({
  stockItems,
  worksites,
}: {
  stockItems: StockOption[]
  worksites: WorksiteOption[]
}) {
  const [warehouseId, setWarehouseId] = React.useState<string>("")
  const [worksiteId,  setWorksiteId]  = React.useState<string>(worksites[0]?.id ?? "")
  const [productId,   setProductId]   = React.useState<string>("")
  const formRef = React.useRef<HTMLFormElement>(null)

  const [state, action] = useActionState<ActionState, FormData>(dispatchAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  // Unique warehouses
  const warehouses = Array.from(
    new Map(stockItems.map((s) => [s.warehouseId, { id: s.warehouseId, name: s.warehouseName }])).values()
  )

  // Products available in selected warehouse
  const availableProducts = warehouseId
    ? stockItems.filter((s) => s.warehouseId === warehouseId && s.quantity > 0)
    : []

  const selectedStock = availableProducts.find((s) => s.productId === productId)

  function handleWarehouseChange(nextWarehouseId: string) {
    setWarehouseId(nextWarehouseId)
    setProductId("")
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <ArrowSquareOut size={16} className="text-[var(--color-text-muted)]" />
        Registrar entrega a faena
      </h2>

      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="warehouseId" value={warehouseId} />
        <input type="hidden" name="worksiteId"  value={worksiteId} />
        <input type="hidden" name="productId"   value={productId} />
        <input type="hidden" name="unitOfMeasure" value={selectedStock?.unitOfMeasure ?? "unidad"} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Bodega" required>
            <Select value={warehouseId} onValueChange={handleWarehouseChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona bodega" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Faena destino" required>
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Producto" required>
            <Select value={productId} onValueChange={setProductId} disabled={!warehouseId}>
              <SelectTrigger>
                <SelectValue placeholder={warehouseId ? "Selecciona producto" : "Elige bodega primero"} />
              </SelectTrigger>
              <SelectContent>
                {availableProducts.map((s) => (
                  <SelectItem key={s.productId} value={s.productId}>
                    {s.productSku ? `[${s.productSku}] ` : ""}{s.productName}
                    {" "}({formatQty(s.quantity, s.unitOfMeasure)} disponible)
                  </SelectItem>
                ))}
                {availableProducts.length === 0 && warehouseId && (
                  <SelectItem value="__none__" disabled>Sin stock disponible</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={`Cantidad${selectedStock ? ` (máx. ${formatQty(selectedStock.quantity, selectedStock.unitOfMeasure)})` : ""}`} required>
            <Input
              type="number"
              name="quantity"
              step="0.01"
              min="0.01"
              max={selectedStock?.quantity}
              placeholder="0"
              disabled={!productId}
              required
              className="tabular-nums"
            />
          </Field>

          <Field label="Recibido por" required>
            <Input
              name="receiverName"
              placeholder="Nombre de quien recibió"
              disabled={!productId}
              required
            />
          </Field>
        </div>

        <Field label="Notas adicionales">
          <Textarea
            name="notes"
            rows={2}
            placeholder="Información adicional sobre esta entrega..."
            disabled={!productId}
          />
        </Field>

        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {state.message}
          </p>
        )}

        <div className="pt-1">
          <SubmitButton
            label="Registrar entrega"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!warehouseId || !worksiteId || !productId}
          />
        </div>
      </form>
    </div>
  )
}
