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
import { MetaBadge } from "@/components/states/state-badge"
import { formatQty, quantityStep } from "@/lib/utils"
import { buildDeliveryStockGroups, requiresSizeChoice } from "./delivery-size-options"
import type { ActionState } from "@/lib/validation/operations"
import { registerWorkerDeliveryAction } from "./actions"
import type {
  DeliveryStockProductOption,
  DeliveryWorkerOption,
  DeliveryWorksiteOption,
} from "./delivery-form.types"

export type {
  DeliveryStockProductOption,
  DeliveryWorkerOption,
  DeliveryWorksiteOption,
} from "./delivery-form.types"

type DeliveryLine = {
  productId: string
  quantity: number
  notes: string | null
}

export function DeliveryForm({
  worksites,
  workers,
  stockProducts,
  today,
  initialSourceWorksiteId,
  initialProductId,
  onSuccess,
}: {
  worksites: DeliveryWorksiteOption[]
  workers: DeliveryWorkerOption[]
  stockProducts: DeliveryStockProductOption[]
  /** Hoy en hora de Chile, calculado en el servidor: no depende del reloj del navegador. */
  today: string
  initialSourceWorksiteId?: string
  initialProductId?: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [state, action] = useActionState<ActionState, FormData>(registerWorkerDeliveryAction, INITIAL_STATE)
  // Sin intención explícita, se abre en la primera bodega (ordenadas por nombre)
  // que tenga stock **y** dotación activa. Elegir sólo por stock caía en la
  // bodega de oficina, que casi nunca tiene trabajadores de faena, y dejaba el
  // selector de trabajador vacío como si el padrón no existiera.
  const defaultSourceWorksiteId = initialSourceWorksiteId
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
  const [pendingProductId, setPendingProductId] = React.useState(initialProductId ?? "")
  const [pendingQuantity, setPendingQuantity] = React.useState("")
  // La familia del producto que se está agregando. La línea sigue guardando el
  // `productId` de la variante: esto es sólo el primer paso de la elección.
  const [pendingGroupKey, setPendingGroupKey] = React.useState(() => {
    if (!initialProductId) return ""
    const preselected = stockProducts.find((product) => product.productId === initialProductId)
    return preselected
      ? buildDeliveryStockGroups([preselected])[0]?.key ?? ""
      : ""
  })
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
  const selectedWorker = React.useMemo(
    () => availableWorkers.find((worker) => worker.id === workerId),
    [availableWorkers, workerId],
  )
  // Familia → talla: el bodeguero elige primero qué entrega y después cuál de
  // las tallas que hay en la bodega. Sin este paso el selector repetía el mismo
  // nombre una vez por talla y la talla era, en la práctica, inelegible.
  const stockGroups = React.useMemo(
    () => buildDeliveryStockGroups(availableStock, selectedWorker),
    [availableStock, selectedWorker],
  )
  const addedProductIds = React.useMemo(() => new Set(lines.map((line) => line.productId)), [lines])
  const selectedGroup = stockGroups.find((group) => group.key === pendingGroupKey)
  const needsSize = requiresSizeChoice(selectedGroup)
  const selectedPendingProduct = availableStock.find((product) => product.productId === pendingProductId)
  const pendingStep = quantityStep(selectedPendingProduct?.unitOfMeasure)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      router.refresh()
      formRef.current?.reset()
      setWorkerId("")
      // `reset()` no alcanza al estado controlado del selector de fecha.
      setDeliveredAt(today)
      setLines([])
      setPendingGroupKey("")
      setPendingProductId("")
      setPendingQuantity("")
      onSuccess?.()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [onSuccess, router, state, today])

  function changeSource(nextSourceWorksiteId: string) {
    setSourceWorksiteId(nextSourceWorksiteId)
    setWorkerId("")
    setLines([])
    setPendingGroupKey("")
    setPendingProductId("")
    setPendingQuantity("")
  }

  /**
   * Cambiar de producto nunca conserva la talla anterior: una talla pertenece a
   * una variante concreta, y arrastrar la «M» de un guante a un zapato pondría
   * a descontar stock de otro producto.
   */
  function changeGroup(nextGroupKey: string) {
    setPendingGroupKey(nextGroupKey)
    setPendingQuantity("")
    const group = stockGroups.find((candidate) => candidate.key === nextGroupKey)
    setPendingProductId(
      group && !requiresSizeChoice(group) ? group.choices[0]?.productId ?? "" : "",
    )
  }

  function changeWorker(nextWorkerId: string) {
    setWorkerId(nextWorkerId)
  }

  function addLine() {
    const quantity = Number(pendingQuantity)
    if (!selectedPendingProduct || !Number.isFinite(quantity) || quantity <= 0) return
    if (selectedPendingProduct.isEpp && !Number.isInteger(quantity)) {
      toast.error("Los EPP se entregan en cantidades enteras")
      return
    }
    if (quantity > selectedPendingProduct.stockQuantity) {
      toast.error(`Stock disponible: ${formatQty(selectedPendingProduct.stockQuantity, selectedPendingProduct.unitOfMeasure)}`)
      return
    }
    setLines((current) => [
      ...current,
      {
        productId: selectedPendingProduct.productId,
        quantity,
        notes: null,
      },
    ])
    setPendingGroupKey("")
    setPendingProductId("")
    setPendingQuantity("")
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

        <div className={`mt-4 grid gap-3 ${needsSize ? "sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]" : "sm:grid-cols-[minmax(0,1fr)_9rem_auto]"}`}>
          <Field label="Producto con stock" htmlFor="deliveryProduct">
            <Select searchable value={pendingGroupKey} onValueChange={changeGroup} disabled={!sourceWorksiteId || stockGroups.length === 0}>
              <SelectTrigger id="deliveryProduct">
                <SelectValue placeholder={sourceWorksiteId ? "Busca producto o SKU" : "Elige una bodega"} />
              </SelectTrigger>
              <SelectContent>
                {stockGroups.map((group) => {
                  const searchText = group.choices.map((choice) => `${choice.productName} ${choice.productSku ?? ""}`).join(" ")
                  const remaining = group.choices.filter((choice) => !addedProductIds.has(choice.productId))
                  return (
                    <SelectItem
                      key={group.key}
                      value={group.key}
                      textValue={`${group.label} ${searchText}`}
                      disabled={remaining.length === 0}
                    >
                      {group.label}
                      {group.sizeAttributeName
                        ? ` · ${group.choices.length} ${group.choices.length === 1 ? "talla" : "tallas"}`
                        : group.choices[0]?.productSku ? ` · ${group.choices[0].productSku}` : ""}
                      {" · "}{formatQty(group.totalStock, group.unitOfMeasure)}
                    </SelectItem>
                  )
                })}
                {stockGroups.length === 0 && (
                  <SelectItem value="__no-stock-products" disabled>Sin productos físicos disponibles</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>

          {/* El selector de talla sólo existe para los productos que la usan:
              un casco o unos lentes no deben pedir una talla vacía. */}
          {needsSize && selectedGroup && (
            <Field
              label={selectedGroup.sizeAttributeName ?? "Variante"}
              htmlFor="deliveryProductSize"
              required
              helper={selectedGroup.habitualSizeMissing
                ? `Talla habitual ${selectedGroup.habitualSize}: sin stock en esta bodega.`
                : undefined}
            >
              <Select value={pendingProductId} onValueChange={setPendingProductId}>
                <SelectTrigger id="deliveryProductSize">
                  <SelectValue placeholder="Selecciona la variante" />
                </SelectTrigger>
                <SelectContent>
                  {selectedGroup.choices.map((choice) => (
                    <SelectItem
                      key={choice.productId}
                      value={choice.productId}
                      disabled={addedProductIds.has(choice.productId)}
                      textValue={`${choice.variantLabel ?? choice.sizeLabel ?? choice.productName} ${choice.productSku ?? ""}`}
                    >
                      {choice.variantLabel || choice.sizeLabel || choice.productName}{choice.productSku ? ` · ${choice.productSku}` : ""}
                      {" · "}{formatQty(choice.stockQuantity, choice.unitOfMeasure)}
                      {addedProductIds.has(choice.productId)
                        ? " · ya agregada"
                        : choice.isHabitual ? " · talla habitual" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label={selectedPendingProduct ? `Cantidad (máx. ${formatQty(selectedPendingProduct.stockQuantity, selectedPendingProduct.unitOfMeasure)})` : "Cantidad"} htmlFor="deliveryPendingQuantity">
            <Input
              id="deliveryPendingQuantity"
              type="number"
              // `min`/`step` salen de la unidad: con 0,01 sobre una unidad
              // contable la primera flecha arriba aterriza en 0,01 en vez de 1.
              min={selectedPendingProduct?.isEpp ? 1 : pendingStep}
              step={selectedPendingProduct?.isEpp ? 1 : pendingStep}
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
                    <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                      <span className="truncate">{product?.displayName ?? product?.productName ?? line.productId}</span>
                      {/* La talla queda visible en la línea: es parte de lo
                          que el trabajador acusa recibo de haber recibido. */}
                      {product?.sizeLabel && !product.displayName && (
                        <MetaBadge meta={{ label: `${product.sizeAttributeName ?? "Talla"} ${product.sizeLabel}`, variant: "outline" }} className="shrink-0 font-normal" />
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                      {product?.productSku ? `${product.productSku} · ` : ""}Disponible: {formatQty(product?.stockQuantity ?? 0, product?.unitOfMeasure ?? "unidad")}
                    </p>
                  </div>
                  <Input
                    aria-label={`Cantidad de ${product?.displayName ?? product?.productName ?? line.productId}${product?.sizeLabel ? ` talla ${product.sizeLabel}` : ""}`}
                    type="number"
                    min={product?.isEpp ? 1 : quantityStep(product?.unitOfMeasure)}
                    step={product?.isEpp ? 1 : quantityStep(product?.unitOfMeasure)}
                    max={product?.stockQuantity}
                    value={line.quantity || ""}
                    onChange={(event) => updateLineQuantity(line.productId, event.target.value)}
                    className="w-24 tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-mobile-sm"
                    aria-label={`Quitar ${product?.productName ?? "producto"}${product?.sizeLabel ? ` talla ${product.sizeLabel}` : ""}`}
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
        <SubmitButton
          label="Registrar entrega"
          loadingLabel="Guardando…"
          variant="primary"
          disabled={!sourceWorksiteId || !workerId || lines.length === 0 || lines.some((line) => {
            const product = availableStock.find((candidate) => candidate.productId === line.productId)
            return line.quantity <= 0 || Boolean(product?.isEpp && !Number.isInteger(line.quantity))
          })}
        />
      </div>
    </form>
  )
}
