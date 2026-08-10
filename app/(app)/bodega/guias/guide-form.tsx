"use client"

import * as React from "react"
import { useActionState } from "react"
import Link from "next/link"
import { Buildings, Plus, Trash, Truck } from "@phosphor-icons/react"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/admin/submit-button"
import { EmptyState } from "@/components/ui/empty-state"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { formatQty } from "@/lib/utils"
import type {
  GuideFormInitialValues,
  GuideProductOption,
  GuideVehicleOption,
  GuideWorkerOption,
  GuideWorksiteOption,
} from "./guide-form.types"

interface GuideFormProps {
  /** Nombre de la bodega de origen (la faena que representa la oficina). */
  originLabel: string
  originWorksiteName: string
  /** Nombre del usuario autenticado: responsable por defecto del despacho. */
  currentUserName: string
  worksites: GuideWorksiteOption[]
  workers: GuideWorkerOption[]
  vehicles: GuideVehicleOption[]
  products: GuideProductOption[]
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  initial?: GuideFormInitialValues
}

/**
 * Una guía no admite el mismo producto en dos líneas (índice único en la tabla
 * y `refine` en el schema), así que `productId` es una clave de fila estable.
 * La primera versión usaba un contador de módulo: el servidor y el cliente
 * arrancaban en números distintos y los `id` de los campos no coincidían —
 * error de hidratación con el formulario ya en pantalla.
 */
interface ItemRow {
  productId: string
  quantity: string
  notes: string
}

/**
 * Formulario de la Guía de Despacho Interna.
 *
 * **No hay selector de origen** y no es un olvido: el origen es siempre la
 * bodega de la oficina, se muestra como dato fijo y el backend lo resuelve por
 * su cuenta. Tampoco viaja en el `FormData`, así que no hay forma de invertir
 * ni desviar el traslado desde la interfaz.
 */
export function GuideForm({
  originLabel,
  originWorksiteName,
  currentUserName,
  worksites,
  workers,
  vehicles,
  products,
  action,
  initial,
}: GuideFormProps) {
  const [state, formAction] = useActionState(action, INITIAL_STATE as ActionState)

  const [destinationWorksiteId, setDestinationWorksiteId] = React.useState(initial?.destinationWorksiteId ?? "")
  const [dispatcherWorkerId, setDispatcherWorkerId] = React.useState(initial?.dispatcherWorkerId ?? "")
  const [receiverWorkerId, setReceiverWorkerId] = React.useState(initial?.receiverWorkerId ?? "")
  const [vehicleId, setVehicleId] = React.useState(initial?.vehicleId ?? "")
  const [driverWorkerId, setDriverWorkerId] = React.useState(initial?.driverWorkerId ?? "")
  const [items, setItems] = React.useState<ItemRow[]>(() =>
    (initial?.items ?? []).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes,
    })),
  )
  const [pickerValue, setPickerValue] = React.useState("")

  const productById = React.useMemo(
    () => new Map(products.map((product) => [product.productId, product])),
    [products],
  )
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId)

  const worksiteOptions: ComboboxOption[] = worksites.map((worksite) => ({
    value: worksite.id,
    label: worksite.name,
  }))
  const workerOptions: ComboboxOption[] = workers.map((worker) => ({
    value: worker.id,
    label: worker.name,
    hint: [worker.rut, worker.worksiteName].filter(Boolean).join(" · "),
  }))
  const vehicleOptions: ComboboxOption[] = vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: [vehicle.plate, vehicle.code].filter(Boolean).join(" · "),
    hint: [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || undefined,
  }))
  const productOptions: ComboboxOption[] = products
    .filter((product) => !items.some((item) => item.productId === product.productId))
    .map((product) => ({
      value: product.productId,
      label: product.name,
      hint: `${product.sku} · ${formatQty(product.available)} disp.`,
    }))

  function addItem(productId: string) {
    if (!productId || items.some((item) => item.productId === productId)) return
    setItems((current) => [...current, { productId, quantity: "1", notes: "" }])
    setPickerValue("")
  }

  function updateItem(productId: string, patch: Partial<ItemRow>) {
    setItems((current) => current.map((item) => (item.productId === productId ? { ...item, ...patch } : item)))
  }

  function removeItem(productId: string) {
    setItems((current) => current.filter((item) => item.productId !== productId))
  }

  const itemsPayload = items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitOfMeasure: productById.get(item.productId)?.unitOfMeasure ?? "unidad",
    notes: item.notes,
  }))

  const overStock = items.filter((item) => {
    const available = productById.get(item.productId)?.available ?? 0
    return Number(item.quantity) > available
  })
  const invalidQuantity = items.some((item) => !(Number(item.quantity) > 0))
  const canSubmit = !!destinationWorksiteId && items.length > 0 && !invalidQuantity

  if (products.length === 0) {
    return (
      <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <EmptyState
          icon={<Truck size={24} />}
          title="La bodega de la oficina no tiene stock disponible"
          description={`Una guía traslada bienes que ya están en ${originLabel}. Recepciona mercadería o ajusta el inventario en Bodega para poder despachar.`}
          action={<Button asChild variant="secondary"><Link href="/bodega">Ir a Bodega</Link></Button>}
        />
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {initial?.guideId && <input type="hidden" name="guideId" value={initial.guideId} />}
      <input type="hidden" name="destinationWorksiteId" value={destinationWorksiteId} />
      <input type="hidden" name="dispatcherWorkerId" value={dispatcherWorkerId} />
      <input type="hidden" name="receiverWorkerId" value={receiverWorkerId} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="driverWorkerId" value={driverWorkerId} />
      <input type="hidden" name="itemsJson" value={JSON.stringify(itemsPayload)} />

      {/* ── Traslado ── */}
      <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] md:p-5">
        <h2 className="text-h2">Traslado</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5"
            data-testid="guide-origin"
          >
            <Buildings size={16} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" aria-hidden />
            <div>
              <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-subtle)]">Origen</p>
              <p className="text-sm font-semibold text-[var(--color-text)]">{originLabel}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Bodega {originWorksiteName} · fijo para toda guía de despacho interna
              </p>
            </div>
          </div>

          <Field
            label="Faena de destino"
            htmlFor="gdi-destino"
            required
            error={state.fieldErrors?.destinationWorksiteId?.[0]}
            hint="Obligatorio. Busca por nombre de faena."
          >
            <Combobox
              id="gdi-destino"
              options={worksiteOptions}
              value={destinationWorksiteId}
              onChange={setDestinationWorksiteId}
              placeholder="Buscar faena…"
            />
          </Field>
        </div>
      </section>

      {/* ── Elementos ── */}
      <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-h2">Elementos</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Materiales, EPP, herramientas o equipos del catálogo con stock en la oficina.
            </p>
          </div>
          <div className="w-full sm:w-72">
            <Combobox
              options={productOptions}
              value={pickerValue}
              onChange={addItem}
              placeholder="Agregar producto por nombre o SKU…"
            />
          </div>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
            <Plus size={14} aria-hidden />
            Agrega al menos un elemento con el buscador de arriba.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {items.map((item, index) => {
              const product = productById.get(item.productId)
              const available = product?.available ?? 0
              const quantity = Number(item.quantity)
              const exceeds = quantity > available
              return (
                <li
                  key={item.productId}
                  className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_auto] md:items-start"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{product?.name ?? "Producto"}</p>
                    <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
                      {product?.sku} · {formatQty(available, product?.unitOfMeasure)} en oficina
                    </p>
                  </div>
                  <Field label="Cantidad" htmlFor={`gdi-qty-${item.productId}`} required error={exceeds ? "Sobre el stock" : undefined}>
                    <Input
                      id={`gdi-qty-${item.productId}`}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={item.quantity}
                      error={exceeds || !(quantity > 0)}
                      onChange={(event) => updateItem(item.productId, { quantity: event.target.value })}
                    />
                  </Field>
                  <Field label="Observación" htmlFor={`gdi-note-${item.productId}`}>
                    <Input
                      id={`gdi-note-${item.productId}`}
                      value={item.notes}
                      maxLength={300}
                      placeholder="Opcional"
                      onChange={(event) => updateItem(item.productId, { notes: event.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="md:mt-5"
                    onClick={() => removeItem(item.productId)}
                    aria-label={`Quitar ${product?.name ?? `línea ${index + 1}`}`}
                  >
                    <Trash size={14} aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {overStock.length > 0 && (
          <p className="mt-3 text-xs text-[var(--color-warning-ink)]" role="status">
            Hay líneas por sobre el stock de la oficina. Puedes guardar el borrador, pero no podrás despacharlo
            hasta que haya saldo suficiente.
          </p>
        )}
        {state.fieldErrors?.items?.[0] && (
          <p className="mt-3 text-xs text-[var(--color-danger)]">{state.fieldErrors.items[0]}</p>
        )}
      </section>

      {/* ── Responsables y transporte ── */}
      <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] md:p-5">
        <h2 className="text-h2">Responsables y transporte</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <Field
            label="Responsable del despacho"
            htmlFor="gdi-despachador"
            hint={`Si lo dejas vacío, queda ${currentUserName} (quien emite).`}
          >
            <Combobox
              id="gdi-despachador"
              options={workerOptions}
              value={dispatcherWorkerId}
              onChange={setDispatcherWorkerId}
              clearLabel="Sin colaborador (queda el emisor)"
              placeholder="Buscar colaborador…"
            />
          </Field>

          <Field
            label="Responsable de recepción en faena"
            htmlFor="gdi-receptor"
            hint="Quién se espera que reciba. Al confirmar la recepción se registra quién recibió de verdad."
          >
            <Combobox
              id="gdi-receptor"
              options={workerOptions}
              value={receiverWorkerId}
              onChange={setReceiverWorkerId}
              clearLabel="Sin indicar"
              placeholder="Buscar colaborador…"
            />
          </Field>

          {/* La ficha del vehículo va fuera del `Field`: éste asocia su
              etiqueta al único hijo que envuelve, y con un `<div>` de por medio
              terminaba rotulando el contenedor en vez del campo. */}
          <div className="flex flex-col gap-1.5">
            <Field
              label="Vehículo"
              htmlFor="gdi-vehiculo"
              hint="Solo si el traslado usa un vehículo de la flota."
            >
              <Combobox
                id="gdi-vehiculo"
                options={vehicleOptions}
                value={vehicleId}
                onChange={setVehicleId}
                clearLabel="Sin vehículo"
                placeholder="Buscar patente o código…"
              />
            </Field>
            {selectedVehicle && (
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
                <div className="flex gap-1">
                  <dt className="text-[var(--color-text-subtle)]">Patente:</dt>
                  <dd className="font-mono">{selectedVehicle.plate}</dd>
                </div>
                {selectedVehicle.code && (
                  <div className="flex gap-1">
                    <dt className="text-[var(--color-text-subtle)]">Código:</dt>
                    <dd className="font-mono">{selectedVehicle.code}</dd>
                  </div>
                )}
                {(selectedVehicle.brand || selectedVehicle.model) && (
                  <div className="flex gap-1">
                    <dt className="text-[var(--color-text-subtle)]">Marca/Modelo:</dt>
                    <dd>{[selectedVehicle.brand, selectedVehicle.model].filter(Boolean).join(" ")}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          <Field
            label="Conductor"
            htmlFor="gdi-conductor"
            hint={selectedVehicle?.responsibleName
              ? `Responsable habitual del vehículo: ${selectedVehicle.responsibleName}.`
              : "Colaborador a cargo del traslado."}
          >
            <Combobox
              id="gdi-conductor"
              options={workerOptions}
              value={driverWorkerId}
              onChange={setDriverWorkerId}
              clearLabel="Sin conductor"
              placeholder="Buscar colaborador…"
            />
          </Field>

          <Field label="Observaciones" htmlFor="gdi-notas" className="md:col-span-2">
            <Textarea
              id="gdi-notas"
              name="notes"
              rows={3}
              maxLength={1000}
              defaultValue={initial?.notes ?? ""}
              placeholder="Indicaciones del despacho, condiciones de entrega, etc. (opcional)"
            />
          </Field>
        </div>
      </section>

      {state.message && !state.ok && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          label={initial?.guideId ? "Guardar cambios" : "Guardar borrador"}
          loadingLabel="Guardando…"
          disabled={!canSubmit}
        />
        <Button asChild variant="secondary">
          <Link href={initial?.guideId ? `/bodega/guias/${initial.guideId}` : "/bodega/guias"}>Cancelar</Link>
        </Button>
        <p className="text-xs text-[var(--color-text-subtle)]">
          El borrador no mueve stock. El descuento ocurre al despachar.
        </p>
      </div>
    </form>
  )
}
