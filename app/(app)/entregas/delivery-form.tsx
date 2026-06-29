"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Warning, CaretDown, CaretUp } from "@phosphor-icons/react"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn, formatQty } from "@/lib/utils"
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

export interface DeliveryReturnProductOption {
  id: string
  name: string
  sku: string | null
  unitOfMeasure: string
}

export function DeliveryForm({
  worksites,
  workers,
  deliverableItems,
  returnProducts,
  initialWorksiteId,
  initialRequestItemId,
}: {
  worksites: DeliveryWorksiteOption[]
  workers: DeliveryWorkerOption[]
  deliverableItems: DeliverableEppOption[]
  returnProducts?: DeliveryReturnProductOption[]
  initialWorksiteId?: string
  initialRequestItemId?: string
}) {
  const [state, action] = useActionState<ActionState, FormData>(registerWorkerDeliveryAction, INITIAL_STATE)
  const defaultWorksiteId = initialWorksiteId ?? worksites[0]?.id ?? ""
  const [worksiteId, setWorksiteId] = React.useState(defaultWorksiteId)
  const [workerId, setWorkerId] = React.useState("")
  const [requestItemId, setRequestItemId] = React.useState(initialRequestItemId ?? "")
  const [showReturn, setShowReturn] = React.useState(false)
  const [returnProductId, setReturnProductId] = React.useState("")
  const formRef = React.useRef<HTMLFormElement>(null)
  const returnSectionRef = React.useRef<HTMLDivElement>(null)
  const notesRef = React.useRef<HTMLTextAreaElement>(null)

  function handleNotesInput(event: React.FormEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      if (notesRef.current) notesRef.current.style.height = ""
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  React.useEffect(() => {
    if (showReturn) {
      returnSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [showReturn])

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
    <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="worksiteId" value={worksiteId} />
        <input type="hidden" name="workerId" value={workerId} />
        <input type="hidden" name="requestItemId" value={requestItemId} />

        <div className="grid gap-6 transition-[grid-template-columns] duration-300 ease-[var(--ease-out)] lg:grid-cols-2" style={!showReturn ? { gridTemplateColumns: "1fr" } : undefined}>
          {/* ── Columna izquierda: datos de entrega ── */}
          <div className="flex flex-col gap-4">
            {showReturn && (
              <div className="hidden lg:block">
                <h2 className="text-base font-semibold text-(--color-text)">Registrar entrega de EPP</h2>
                <p className="mt-1 text-sm text-(--color-text-muted)">
                  Asigna EPP recibido a un trabajador y descuenta el stock de la faena.
                </p>
              </div>
            )}
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="EPP recibido pendiente" htmlFor="deliveryRequestItemId" required error={state.fieldErrors?.requestItemId?.[0]}>
                <Select searchable value={requestItemId} onValueChange={setRequestItemId} disabled={!worksiteId}>
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

              <Field label="Recibido por" htmlFor="deliveryReceiverName" helper="Persona que recibe el EPP. Si se omite, se usa el nombre del trabajador.">
                <Input
                  id="deliveryReceiverName"
                  name="receiverName"
                  placeholder="Ej: Supervisor de terreno"
                  disabled={!selectedItem}
                />
              </Field>
            </div>

            <Field label="Notas" htmlFor="deliveryNotes" error={state.fieldErrors?.notes?.[0]}>
              <Textarea
                id="deliveryNotes"
                name="notes"
                ref={notesRef}
                rows={1}
                onInput={handleNotesInput}
                placeholder="Condición del EPP, observaciones..."
                disabled={!selectedItem}
                error={!!state.fieldErrors?.notes}
                className="h-9 min-h-9 resize-none overflow-hidden py-1.5"
              />
            </Field>

            {/* ── Devolver EPP antiguo ── */}
            <button
              type="button"
              onClick={() => {
                setShowReturn(!showReturn)
                if (showReturn) setReturnProductId("")
              }}
              className="flex items-center gap-2 self-start rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] transition-[color,border-color,background-color] duration-[var(--duration-default)] hover:border-[var(--color-primary-line)] hover:bg-[var(--color-primary-tint)] hover:text-[var(--color-primary-ink)]"
            >
              <span>Devolver EPP antiguo</span>
              {showReturn
                ? <CaretUp size={14} weight="bold" />
                : <CaretDown size={14} weight="bold" />}
            </button>
          </div>

          {/* ── Columna derecha: devolución (con morph) ── */}
          <div
            ref={returnSectionRef}
            className={cn(
              "flex flex-col gap-4 overflow-hidden transition-all duration-300 ease-[var(--ease-out)]",
              showReturn
                ? "max-h-[2000px] opacity-100 lg:animate-in lg:fade-in-0 lg:slide-in-from-right-4"
                : "max-h-0 opacity-0 pointer-events-none",
            )}
          >
            <div className="hidden lg:block">
              <h2 className="text-base font-semibold text-(--color-text)">Devolver EPP antiguo</h2>
              <p className="mt-1 text-sm text-(--color-text-muted)">
                Registra la devolución del EPP antiguo del trabajador.
              </p>
            </div>

            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 flex flex-col gap-4">
              <p className="text-sm font-medium text-[var(--color-text)]">Datos del EPP devuelto</p>

              <Field label="Producto (catálogo)" htmlFor="returnProductId">
                <Select searchable value={returnProductId} onValueChange={setReturnProductId}>
                  <SelectTrigger id="returnProductId">
                    <SelectValue placeholder="Selecciona producto devuelto" />
                  </SelectTrigger>
                  <SelectContent>
                    {(returnProducts ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.sku ? `${p.sku} · ` : ""}{p.name} · {p.unitOfMeasure}
                      </SelectItem>
                    ))}
                    {(!returnProducts || returnProducts.length === 0) && (
                      <SelectItem value="__none__" disabled>Sin productos disponibles</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <input type="hidden" name="returnProductId" value={returnProductId} />
              </Field>

              <Field label="O descríbelo" htmlFor="returnProductNameFree" helper="Si no está en el catálogo">
                <Input
                  id="returnProductNameFree"
                  name="returnProductNameFree"
                  placeholder="Ej: Casco de seguridad marca X"
                  disabled={!!returnProductId}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Cantidad" htmlFor="returnQuantity">
                  <Input
                    id="returnQuantity"
                    name="returnQuantity"
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="tabular-nums"
                  />
                </Field>

                <Field label="Motivo" htmlFor="returnReason">
                  <Select name="returnReason">
                    <SelectTrigger id="returnReason">
                      <SelectValue placeholder="Selecciona motivo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desgastado">Desgastado</SelectItem>
                      <SelectItem value="dañado">Dañado</SelectItem>
                      <SelectItem value="vencido">Vencido</SelectItem>
                      <SelectItem value="otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Notas" htmlFor="returnNotes">
                <Textarea
                  id="returnNotes"
                  name="returnNotes"
                  rows={2}
                  placeholder="Condición del EPP devuelto, observaciones..."
                />
              </Field>
            </div>
          </div>
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
    </div>
  )
}
