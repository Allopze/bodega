"use client"

import * as React from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { useEnterAdvancesFields } from "@/lib/hooks/use-enter-advances-fields"
import { INITIAL_STATE } from "@/lib/form-state"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatQty } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { registerWorkerDeliveryAction } from "./actions"
import type {
  DeliverableEppOption,
  DeliveryStockProductOption,
  DeliveryWorkerOption,
  DeliveryWorksiteOption,
} from "./delivery-form.types"

export type {
  DeliverableEppOption,
  DeliveryStockProductOption,
  DeliveryWorkerOption,
  DeliveryWorksiteOption,
} from "./delivery-form.types"

type DeliveryLine = {
  productId: string
  quantity: number
  requestItemId: string | null
  notes: string | null
}

export function DeliveryForm({
  worksites,
  workers,
  stockProducts,
  traceableItems = [],
  today,
  initialSourceWorksiteId,
  initialRequestItemId,
  onSuccess,
}: {
  worksites: DeliveryWorksiteOption[]
  workers: DeliveryWorkerOption[]
  stockProducts: DeliveryStockProductOption[]
  traceableItems?: DeliverableEppOption[]
  /** Hoy en hora de Chile, calculado en el servidor: no depende del reloj del navegador. */
  today: string
  initialSourceWorksiteId?: string
  initialRequestItemId?: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [state, action] = useActionState<ActionState, FormData>(registerWorkerDeliveryAction, INITIAL_STATE)
  const initialTraceItem = traceableItems.find((item) => item.requestItemId === initialRequestItemId)
  // Sin intención explícita, se abre en la primera bodega (ordenadas por nombre)
  // que tenga stock **y** dotación activa. Elegir sólo por stock caía en la
  // bodega de oficina, que casi nunca tiene trabajadores de faena, y dejaba el
  // selector de trabajador vacío como si el padrón no existiera.
  const defaultSourceWorksiteId = initialSourceWorksiteId
    ?? initialTraceItem?.worksiteId
    ?? worksites.find((worksite) => (
      stockProducts.some((product) => product.sourceWorksiteId === worksite.id)
      && workers.some((worker) => worker.worksiteId === worksite.id)
    ))?.id
    ?? stockProducts[0]?.sourceWorksiteId
    ?? worksites[0]?.id
    ?? ""
  const [sourceWorksiteId, setSourceWorksiteId] = React.useState(defaultSourceWorksiteId)
  const [workerId, setWorkerId] = React.useState("")
  const [deliveredAt, setDeliveredAt] = React.useState(today)
  const [pendingProductId, setPendingProductId] = React.useState(initialTraceItem?.productId ?? "")
  const [pendingQuantity, setPendingQuantity] = React.useState("")
  const [pendingRequestItemId, setPendingRequestItemId] = React.useState(initialTraceItem?.requestItemId ?? "")
  const [lines, setLines] = React.useState<DeliveryLine[]>([])
  const formRef = React.useRef<HTMLFormElement>(null)
  useEnterAdvancesFields(formRef)

  const availableStock = React.useMemo(
    () => stockProducts.filter((product) => product.sourceWorksiteId === sourceWorksiteId && product.stockQuantity > 0),
    [sourceWorksiteId, stockProducts],
  )
  const availableWorkers = React.useMemo(
    () => workers.filter((worker) => worker.worksiteId === sourceWorksiteId),
    [sourceWorksiteId, workers],
  )
  const selectedWorker = availableWorkers.find((worker) => worker.id === workerId)
  const selectableProducts = availableStock.filter((product) => !lines.some((line) => line.productId === product.productId))
  const selectedPendingProduct = availableStock.find((product) => product.productId === pendingProductId)
  const traceOptions = traceableItems.filter((item) => (
    item.worksiteId === sourceWorksiteId
    && item.productId === pendingProductId
    && selectedWorker?.worksiteId === sourceWorksiteId
  ))

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      router.refresh()
      formRef.current?.reset()
      setWorkerId("")
      // `reset()` no alcanza al estado controlado del selector de fecha.
      setDeliveredAt(today)
      setLines([])
      setPendingProductId("")
      setPendingQuantity("")
      setPendingRequestItemId("")
      onSuccess?.()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [onSuccess, router, state, today])

  function changeSource(nextSourceWorksiteId: string) {
    setSourceWorksiteId(nextSourceWorksiteId)
    setWorkerId("")
    setLines([])
    setPendingProductId("")
    setPendingQuantity("")
    setPendingRequestItemId("")
  }

  function changeWorker(nextWorkerId: string) {
    setWorkerId(nextWorkerId)
    // A named request item is traceable only at its worker's faena. Keep the
    // physical product lines but unlink them if the recipient changes.
    setLines((current) => current.map((line) => ({ ...line, requestItemId: null })))
    setPendingRequestItemId("")
  }

  function addLine() {
    const quantity = Number(pendingQuantity)
    if (!selectedPendingProduct || !Number.isFinite(quantity) || quantity <= 0) return
    if (quantity > selectedPendingProduct.stockQuantity) {
      toast.error(`Stock disponible: ${formatQty(selectedPendingProduct.stockQuantity, selectedPendingProduct.unitOfMeasure)}`)
      return
    }
    const selectedTrace = traceOptions.find((item) => item.requestItemId === pendingRequestItemId)
    if (selectedTrace && quantity > selectedTrace.remainingQuantity) {
      toast.error(`Saldo trazable: ${formatQty(selectedTrace.remainingQuantity, selectedTrace.unitOfMeasure)}`)
      return
    }
    setLines((current) => [
      ...current,
      {
        productId: selectedPendingProduct.productId,
        quantity,
        requestItemId: selectedTrace?.requestItemId ?? null,
        notes: null,
      },
    ])
    setPendingProductId("")
    setPendingQuantity("")
    setPendingRequestItemId("")
  }

  function updateLineQuantity(productId: string, value: string) {
    const quantity = Number(value)
    const product = availableStock.find((candidate) => candidate.productId === productId)
    setLines((current) => current.map((line) => {
      if (line.productId !== productId) return line
      const maxQuantity = product?.stockQuantity ?? line.quantity
      const nextQuantity = Number.isFinite(quantity) ? Math.min(Math.max(quantity, 0), maxQuantity) : 0
      return { ...line, quantity: nextQuantity }
    }))
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input type="hidden" name="sourceWorksiteId" value={sourceWorksiteId} />
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="itemsJson" value={JSON.stringify(lines)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Bodega de origen" htmlFor="deliverySourceWorksite" required error={state.fieldErrors?.sourceWorksiteId?.[0]}>
          <Select value={sourceWorksiteId} onValueChange={changeSource}>
            <SelectTrigger id="deliverySourceWorksite" error={!!state.fieldErrors?.sourceWorksiteId}>
              <SelectValue placeholder="Selecciona bodega" />
            </SelectTrigger>
            <SelectContent>
              {worksites.map((worksite) => (
                <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Trabajador" htmlFor="deliveryWorker" required error={state.fieldErrors?.workerId?.[0]}>
          <Select searchable value={workerId} onValueChange={changeWorker}>
            <SelectTrigger id="deliveryWorker" error={!!state.fieldErrors?.workerId}>
              <SelectValue placeholder="Busca por nombre, cargo o faena" />
            </SelectTrigger>
            <SelectContent>
              {availableWorkers.map((worker) => (
                <SelectItem
                  key={worker.id}
                  value={worker.id}
                  textValue={`${worker.name} ${worker.position ?? ""} ${worker.worksiteName}`}
                >
                  {worker.name} · {worker.worksiteName}{worker.position ? ` · ${worker.position}` : ""}
                </SelectItem>
              ))}
              {availableWorkers.length === 0 && (
                <SelectItem value="__no-active-workers" disabled>Esta bodega no tiene trabajadores activos</SelectItem>
              )}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-[var(--color-text-subtle)]">
            {availableWorkers.length === 0
              ? "La bodega de origen elegida no tiene dotación activa. Cámbiala por la faena del trabajador: sólo se entrega desde el stock de su propia faena."
              : "Sólo se muestran trabajadores activos de la bodega de origen seleccionada."}
          </p>
        </Field>

        <Field
          label="Fecha de entrega"
          htmlFor="deliveryDate"
          required
          helper="Por defecto hoy. Puedes registrar cualquier fecha pasada."
          error={state.fieldErrors?.deliveredAt?.[0]}
        >
          <DatePicker
            id="deliveryDate"
            name="deliveredAt"
            // El `<label for>` de `Field` no nombra un `<button>`: sin esto el
            // lector de pantalla sólo anuncia la fecha, no de qué campo es.
            ariaLabel="Fecha de entrega"
            value={deliveredAt}
            onChange={setDeliveredAt}
            max={today}
            error={Boolean(state.fieldErrors?.deliveredAt?.[0])}
          />
        </Field>
      </div>

      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4" aria-labelledby="delivery-products-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="delivery-products-title" className="text-base font-semibold text-[var(--color-text)]">Productos a entregar</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">Cada línea descuenta el stock físico de la bodega seleccionada.</p>
          </div>
          <span className="rounded-[var(--radius-full)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]">
            {lines.length} {lines.length === 1 ? "producto" : "productos"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
          <Field label="Producto con stock" htmlFor="deliveryProduct">
            <Select searchable value={pendingProductId} onValueChange={(value) => {
              setPendingProductId(value)
              setPendingRequestItemId("")
            }} disabled={!sourceWorksiteId || selectableProducts.length === 0}>
              <SelectTrigger id="deliveryProduct">
                <SelectValue placeholder={sourceWorksiteId ? "Busca producto o SKU" : "Elige una bodega"} />
              </SelectTrigger>
              <SelectContent>
                {selectableProducts.map((product) => (
                  <SelectItem key={product.productId} value={product.productId} textValue={`${product.productName} ${product.productSku ?? ""}`}>
                    {product.productName}{product.productSku ? ` · ${product.productSku}` : ""} · {formatQty(product.stockQuantity, product.unitOfMeasure)}
                  </SelectItem>
                ))}
                {selectableProducts.length === 0 && (
                  <SelectItem value="__no-stock-products" disabled>Sin productos físicos disponibles</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label={selectedPendingProduct ? `Cantidad (máx. ${formatQty(selectedPendingProduct.stockQuantity, selectedPendingProduct.unitOfMeasure)})` : "Cantidad"} htmlFor="deliveryPendingQuantity">
            <Input
              id="deliveryPendingQuantity"
              type="number"
              min="0.01"
              step="0.01"
              max={selectedPendingProduct?.stockQuantity}
              value={pendingQuantity}
              onChange={(event) => setPendingQuantity(event.target.value)}
              disabled={!selectedPendingProduct}
              className="tabular-nums"
            />
          </Field>

          <Button type="button" variant="secondary" onClick={addLine} disabled={!selectedPendingProduct || !pendingQuantity} className="self-end">
            <Plus size={16} weight="bold" /> Agregar
          </Button>
        </div>

        {selectedPendingProduct && traceOptions.length > 0 && (
          <Field label="Vincular a solicitud recibida (opcional)" htmlFor="deliveryTraceItem" helper="Sólo aplica cuando el trabajador pertenece a la misma faena de la bodega origen.">
            <Select searchable value={pendingRequestItemId} onValueChange={(value) => setPendingRequestItemId(value === "__none_trace" ? "" : value)}>
              <SelectTrigger id="deliveryTraceItem"><SelectValue placeholder="Sin vínculo de solicitud" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none_trace">Sin vínculo de solicitud</SelectItem>
                {traceOptions.map((item) => (
                  <SelectItem key={item.requestItemId} value={item.requestItemId}>
                    {item.requestCode} · saldo {formatQty(item.remainingQuantity, item.unitOfMeasure)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {lines.length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-text-muted)]">
            Agrega uno o más productos con stock para continuar.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            {lines.map((line) => {
              const product = availableStock.find((candidate) => candidate.productId === line.productId)
              return (
                <li key={line.productId} className="flex items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--color-text)]">{product?.productName ?? line.productId}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                      {product?.productSku ? `${product.productSku} · ` : ""}Disponible: {formatQty(product?.stockQuantity ?? 0, product?.unitOfMeasure ?? "unidad")}
                      {line.requestItemId ? " · Vinculado a solicitud" : ""}
                    </p>
                  </div>
                  <Input
                    aria-label={`Cantidad de ${product?.productName ?? line.productId}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={product?.stockQuantity}
                    value={line.quantity || ""}
                    onChange={(event) => updateLineQuantity(line.productId, event.target.value)}
                    className="w-24 tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-mobile-sm"
                    aria-label={`Quitar ${product?.productName ?? "producto"}`}
                    onClick={() => setLines((current) => current.filter((candidate) => candidate.productId !== line.productId))}
                    className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
                  >
                    <Trash size={16} weight="bold" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Comprobante" htmlFor="deliveryProofFile" helper="PDF, JPG o PNG. Opcional.">
          <FileInput id="deliveryProofFile" name="proofFile" accept="application/pdf,image/jpeg,image/png" disabled={lines.length === 0} />
        </Field>
        <Field label="Recibido por" htmlFor="deliveryReceiverName" helper="Si se omite, se registra el nombre del trabajador.">
          <Input id="deliveryReceiverName" name="receiverName" placeholder="Ej: supervisor de terreno" disabled={lines.length === 0} />
        </Field>
      </div>

      <Field label="Notas" htmlFor="deliveryNotes" error={state.fieldErrors?.notes?.[0]}>
        <Textarea id="deliveryNotes" name="notes" rows={2} placeholder="Observaciones de la entrega…" disabled={lines.length === 0} error={!!state.fieldErrors?.notes} />
      </Field>

      {state.ok === false && state.message && state !== INITIAL_STATE && (
        <p className="flex items-center gap-1.5 text-sm text-[var(--color-danger)]"><Warning size={15} /> {state.message}</p>
      )}

      <div className="flex justify-end border-t border-[var(--color-border)] pt-4">
        <SubmitButton label="Registrar entrega" loadingLabel="Guardando…" variant="primary" disabled={!sourceWorksiteId || !workerId || lines.length === 0 || lines.some((line) => line.quantity <= 0)} />
      </div>
    </form>
  )
}
