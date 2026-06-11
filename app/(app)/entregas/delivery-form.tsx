"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import { Warning } from "@phosphor-icons/react"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { formatQty } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { registerWorkerDeliveryAction } from "./actions"

export interface DeliveryWorksiteOption {
  id: string
  name: string
}

export interface DeliveryWorkerOption {
  id: string
  worksiteId: string
  name: string
  rut: string | null
  position: string | null
}

export interface DeliverableEppOption {
  requestItemId: string
  requestCode: string
  worksiteId: string
  productName: string
  productSku: string | null
  quantity: number
  deliveredQuantity: number
  remainingQuantity: number
  stockQuantity: number
  unitOfMeasure: string
}

export function DeliveryForm({
  worksites,
  workers,
  deliverableItems,
  initialWorksiteId,
  initialRequestItemId,
}: {
  worksites: DeliveryWorksiteOption[]
  workers: DeliveryWorkerOption[]
  deliverableItems: DeliverableEppOption[]
  initialWorksiteId?: string
  initialRequestItemId?: string
}) {
  const [state, action] = useActionState<ActionState, FormData>(registerWorkerDeliveryAction, INITIAL_STATE)
  const defaultWorksiteId = initialWorksiteId ?? worksites[0]?.id ?? ""
  const [worksiteId, setWorksiteId] = React.useState(defaultWorksiteId)
  const [workerId, setWorkerId] = React.useState("")
  const [requestItemId, setRequestItemId] = React.useState(initialRequestItemId ?? "")
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  const availableWorkers = workers.filter((worker) => worker.worksiteId === worksiteId)
  const availableItems = deliverableItems.filter((item) => item.worksiteId === worksiteId)
  const selectedItem = availableItems.find((item) => item.requestItemId === requestItemId)
  const quantityMax = selectedItem
    ? Math.min(selectedItem.remainingQuantity, selectedItem.stockQuantity)
    : undefined

  function handleWorksiteChange(nextWorksiteId: string) {
    setWorksiteId(nextWorksiteId)
    setWorkerId("")
    setRequestItemId("")
  }

  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Registrar entrega de EPP</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Asigna EPP recibido a un trabajador y descuenta el stock de la faena.
        </p>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="worksiteId" value={worksiteId} />
        <input type="hidden" name="workerId" value={workerId} />
        <input type="hidden" name="requestItemId" value={requestItemId} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="deliveryWorksiteId" required error={state.fieldErrors?.worksiteId?.[0]}>
            <Select value={worksiteId} onValueChange={handleWorksiteChange}>
              <SelectTrigger id="deliveryWorksiteId" error={!!state.fieldErrors?.worksiteId}>
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((worksite) => (
                  <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Trabajador" htmlFor="deliveryWorkerId" required error={state.fieldErrors?.workerId?.[0]}>
            <Select value={workerId} onValueChange={setWorkerId} disabled={!worksiteId}>
              <SelectTrigger id="deliveryWorkerId" error={!!state.fieldErrors?.workerId}>
                <SelectValue placeholder={worksiteId ? "Selecciona trabajador" : "Elige faena primero"} />
              </SelectTrigger>
              <SelectContent>
                {availableWorkers.map((worker) => (
                  <SelectItem key={worker.id} value={worker.id}>
                    {worker.name}{worker.position ? ` · ${worker.position}` : ""}
                  </SelectItem>
                ))}
                {availableWorkers.length === 0 && (
                  <SelectItem value="__none_worker__" disabled>Sin trabajadores activos</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="EPP recibido pendiente" htmlFor="deliveryRequestItemId" required error={state.fieldErrors?.requestItemId?.[0]}>
          <Select value={requestItemId} onValueChange={setRequestItemId} disabled={!worksiteId}>
            <SelectTrigger id="deliveryRequestItemId" error={!!state.fieldErrors?.requestItemId}>
              <SelectValue placeholder={worksiteId ? "Selecciona EPP pendiente" : "Elige faena primero"} />
            </SelectTrigger>
            <SelectContent>
              {availableItems.map((item) => (
                <SelectItem key={item.requestItemId} value={item.requestItemId}>
                  {item.requestCode} · {item.productName} · pendiente {formatQty(item.remainingQuantity, item.unitOfMeasure)}
                </SelectItem>
              ))}
              {availableItems.length === 0 && (
                <SelectItem value="__none_item__" disabled>Sin EPP pendiente con stock</SelectItem>
              )}
            </SelectContent>
          </Select>
          {selectedItem && (
            <p className="mt-1.5 text-xs text-[var(--color-text-subtle)]">
              Stock disponible: {formatQty(selectedItem.stockQuantity, selectedItem.unitOfMeasure)}. Saldo pendiente: {formatQty(selectedItem.remainingQuantity, selectedItem.unitOfMeasure)}.
            </p>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label={quantityMax ? `Cantidad (máx. ${formatQty(quantityMax, selectedItem?.unitOfMeasure ?? "unidad")})` : "Cantidad"}
            htmlFor="deliveryQuantity"
            required
            error={state.fieldErrors?.quantity?.[0]}
          >
            <Input
              id="deliveryQuantity"
              name="quantity"
              type="number"
              min="0.01"
              step="0.01"
              max={quantityMax}
              disabled={!selectedItem}
              required
              className="tabular-nums"
              error={!!state.fieldErrors?.quantity}
            />
          </Field>

          <Field label="Recibido por" htmlFor="deliveryReceiverName" error={state.fieldErrors?.receiverName?.[0]}>
            <Input
              id="deliveryReceiverName"
              name="receiverName"
              placeholder="Opcional, si recibe otra persona"
              disabled={!workerId}
              error={!!state.fieldErrors?.receiverName}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Comprobante" htmlFor="deliveryProofFile" helper="PDF, JPG o PNG. Opcional.">
            <Input
              id="deliveryProofFile"
              name="proofFile"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              disabled={!selectedItem}
            />
          </Field>

          <Field label="Notas" htmlFor="deliveryNotes" error={state.fieldErrors?.notes?.[0]}>
            <Textarea
              id="deliveryNotes"
              name="notes"
              rows={2}
              placeholder="Condición del EPP, observaciones..."
              disabled={!selectedItem}
              error={!!state.fieldErrors?.notes}
            />
          </Field>
        </div>

        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="flex items-center gap-1.5 text-sm text-[var(--color-danger)]">
            <Warning size={14} /> {state.message}
          </p>
        )}

        <div className="flex items-center justify-end">
          <SubmitButton
            label="Registrar entrega"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!worksiteId || !workerId || !requestItemId}
          />
        </div>
      </form>
    </section>
  )
}
