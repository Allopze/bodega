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
  worksiteId:    string
  worksiteName:  string
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

export interface DeliverableOption {
  requestItemId: string
  requestCode:   string
  worksiteId:    string
  productId:     string
  productName:   string
  quantity:      number
  deliveredQuantity: number
  remainingQuantity: number
  unitOfMeasure: string
}

export function DispatchPanel({
  stockItems,
  worksites,
  deliverableItems,
  initialWorksiteId,
  initialProductId,
  initialRequestItemId,
}: {
  stockItems: StockOption[]
  worksites: WorksiteOption[]
  deliverableItems: DeliverableOption[]
  initialWorksiteId?: string
  initialProductId?: string
  initialRequestItemId?: string
}) {
  const defaultWorksiteId = initialWorksiteId ?? worksites[0]?.id ?? ""
  const [worksiteId,  setWorksiteId]  = React.useState<string>(defaultWorksiteId)
  const [productId,   setProductId]   = React.useState<string>(initialProductId ?? "")
  const [requestItemId, setRequestItemId] = React.useState<string>(initialRequestItemId ?? "")
  const formRef = React.useRef<HTMLFormElement>(null)

  const [state, action] = useActionState<ActionState, FormData>(dispatchAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setWorksiteId(defaultWorksiteId)
      setProductId("")
      setRequestItemId("")
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state, defaultWorksiteId])

  const availableProducts = worksiteId
    ? stockItems.filter((s) => s.worksiteId === worksiteId && s.quantity > 0)
    : []

  const selectedStock = availableProducts.find((s) => s.productId === productId)
  const matchingDeliverables = productId && worksiteId
    ? deliverableItems.filter((item) => item.productId === productId && item.worksiteId === worksiteId)
    : []
  const selectedDeliverable = matchingDeliverables.find((item) => item.requestItemId === requestItemId)
  const quantityMax = Math.min(
    selectedStock?.quantity ?? Number.POSITIVE_INFINITY,
    selectedDeliverable?.remainingQuantity ?? Number.POSITIVE_INFINITY,
  )

  function handleWorksiteChange(nextWorksiteId: string) {
    setWorksiteId(nextWorksiteId)
    setProductId("")
    setRequestItemId("")
  }

  function handleProductChange(nextProductId: string) {
    setProductId(nextProductId)
    setRequestItemId("")
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <h2 className="text-h2 mb-4 flex items-center gap-2">
        <ArrowSquareOut size={16} className="text-[var(--color-text-muted)]" />
        Registrar entrega a trabajador
      </h2>

      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="worksiteId"  value={worksiteId} />
        <input type="hidden" name="productId"   value={productId} />
        {requestItemId && <input type="hidden" name="requestItemId" value={requestItemId} />}
        <input type="hidden" name="unitOfMeasure" value={selectedStock?.unitOfMeasure ?? "unidad"} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Faena" htmlFor="dispatchWorksiteId" required error={state.fieldErrors?.worksiteId?.[0]}>
            <Select value={worksiteId} onValueChange={handleWorksiteChange}>
              <SelectTrigger id="dispatchWorksiteId" error={!!state.fieldErrors?.worksiteId}>
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Producto" htmlFor="dispatchProductId" required error={state.fieldErrors?.productId?.[0]}>
            <Select value={productId} onValueChange={handleProductChange} disabled={!worksiteId}>
              <SelectTrigger id="dispatchProductId" error={!!state.fieldErrors?.productId}>
                <SelectValue placeholder={worksiteId ? "Selecciona producto" : "Elige faena primero"} />
              </SelectTrigger>
              <SelectContent>
                {availableProducts.map((s) => (
                  <SelectItem key={s.productId} value={s.productId}>
                    {s.productSku ? `[${s.productSku}] ` : ""}{s.productName}
                    {" "}({formatQty(s.quantity, s.unitOfMeasure)} en stock)
                  </SelectItem>
                ))}
                {availableProducts.length === 0 && worksiteId && (
                  <SelectItem value="__none__" disabled>Sin stock disponible</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {matchingDeliverables.length > 0 && (
          <Field label="Asociar a solicitud" htmlFor="dispatchRequestItemId">
            <Select
              value={requestItemId || "__none__"}
              onValueChange={(value) => setRequestItemId(value === "__none__" ? "" : value)}
            >
              <SelectTrigger id="dispatchRequestItemId">
                <SelectValue placeholder="Entrega de stock sin solicitud específica" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin asociación</SelectItem>
                {matchingDeliverables.map((item) => (
                  <SelectItem key={item.requestItemId} value={item.requestItemId}>
                    {item.requestCode} · pendiente {formatQty(item.remainingQuantity, item.unitOfMeasure)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Al asociar una solicitud, la entrega actualizará su avance trazable.
            </p>
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label={`Cantidad${selectedStock ? ` (máx. ${formatQty(selectedStock.quantity, selectedStock.unitOfMeasure)})` : ""}`}
            htmlFor="dispatchQuantity"
            required
            error={state.fieldErrors?.quantity?.[0]}
          >
            <Input
              id="dispatchQuantity"
              type="number"
              name="quantity"
              step="0.01"
              min="0.01"
              max={Number.isFinite(quantityMax) ? quantityMax : selectedStock?.quantity}
              placeholder="0"
              disabled={!productId}
              required
              error={!!state.fieldErrors?.quantity}
              className="tabular-nums"
            />
          </Field>

          <Field label="Recibido por" htmlFor="dispatchReceiverName" required error={state.fieldErrors?.receiverName?.[0]}>
            <Input
              id="dispatchReceiverName"
              name="receiverName"
              placeholder="Nombre de quien recibió"
              disabled={!productId}
              required
              error={!!state.fieldErrors?.receiverName}
            />
          </Field>
        </div>

        <Field label="Notas adicionales" htmlFor="dispatchNotes" error={state.fieldErrors?.notes?.[0]}>
          <Textarea
            id="dispatchNotes"
            name="notes"
            rows={2}
            placeholder="Información adicional sobre esta entrega..."
            disabled={!productId}
            error={!!state.fieldErrors?.notes}
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
            disabled={!worksiteId || !productId}
          />
        </div>
      </form>
    </div>
  )
}
