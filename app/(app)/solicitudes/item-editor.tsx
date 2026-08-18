"use client"

import * as React from "react"
import { Package, Trash } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { Combobox } from "@/components/ui/combobox"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { COST_PENDING_LABEL, normalizeEquipmentCode } from "@/lib/products/service-items"
import { ProductPicker } from "./product-picker"
import type { ItemRow, ProductOption, SupplierOption, WorkerOption, EquipmentOption } from "./request-form.types"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { ItemEditorEquipment } from "./item-editor-equipment"
import { ItemEditorSupplier } from "./item-editor-supplier"
import { ItemEditorCotizaciones } from "./item-editor-cotizaciones"
import { VariantSelector } from "./variant-selector"
import { getSizeVariantPicker } from "./variant-selector.helpers"
import { ItemEditorAttributes } from "./item-editor-attributes"
import { groupProductVariants } from "@/lib/products/variant-grouping"
import { URGENCY_OPTS } from "./request-form.constants"
import { getWorkerEppStatusAction, type WorkerEppStatusResult } from "./actions"
import { formatDate } from "@/lib/utils"

// ── Props ─────────────────────────────────────────────────────────────────────

interface ItemEditorProps {
  item:            ItemRow
  idx:             number
  products:        ProductOption[]
  suppliers:       SupplierOption[]
  workers?:        WorkerOption[]
  equipment?:      EquipmentOption[]
  readOnly:        boolean
  requestType?:    string
  maxFileSizeMb:   number
  onUpdate:        (patch: Partial<ItemRow>) => void
  onSelectProduct: (pid: string) => void
  onSelectFreeProduct: (name: string) => void
  onClearProduct:  () => void
  onUpdateAttr:    (i: number, v: string) => void
  onUpdateWorker:  (workerId: string) => void
  onRemove:        () => void
  canRemove:       boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ItemEditor({
  item, idx, products, suppliers, workers, equipment, readOnly, requestType, maxFileSizeMb,
  onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onUpdateWorker,
  onRemove, canRemove,
}: ItemEditorProps) {
  const isQuotationType    = QUOTATION_TYPES.has(requestType ?? "")
  const selectedProduct = item.productId ? products.find((product) => product.id === item.productId) : null
  const variants = selectedProduct
    ? groupProductVariants(products).find((group) => group.variants.some((variant) => variant.id === selectedProduct.id))?.variants ?? []
    : []
  const sizeVariantPicker = getSizeVariantPicker(variants)

  const workerRequired = selectedProduct?.requiresWorker ?? false
  const quantityDriver = item.attributes.find((attribute) => attribute.drivesQuantity)

  // El servicio declara qué familia de equipos atiende. El equipo se identifica
  // por su código interno y no eligiéndolo de una lista: el registro de
  // instrumentos se forma con estas solicitudes, y exigir que el aparato ya
  // estuviera dado de alta dejaba el servicio imposible de pedir. Los códigos ya
  // conocidos se ofrecen como sugerencias, no como opciones cerradas.
  const equipmentKind = selectedProduct?.equipmentKind ?? null
  const showEquipmentPicker = !isQuotationType && (!!equipmentKind || (readOnly && !!item.equipmentCode))
  const knownEquipment = React.useMemo(
    () => (equipment ?? []).filter((option) => !equipmentKind || option.kind === equipmentKind),
    [equipment, equipmentKind],
  )
  const matchedEquipment = React.useMemo(() => {
    const code = normalizeEquipmentCode(item.equipmentCode)
    return code ? knownEquipment.find((option) => option.code === code) : undefined
  }, [knownEquipment, item.equipmentCode])
  // En consulta el bloque se muestra si el ítem tiene colaborador, aunque la
  // pantalla no cargue el padrón de trabajadores (la ficha de detalle no lo pasa).
  const showWorkerPicker = !isQuotationType && (
    workerRequired
    || (requestType === "epp" && !!workers?.length)
    || (readOnly && !!item.workerId)
  )
  const workerOptions = React.useMemo(
    () => (workers ?? []).map((worker) => ({
      value: worker.id,
      label: `${worker.firstName} ${worker.lastName}`,
      hint:  worker.rut ?? undefined,
    })),
    [workers],
  )

  const [statusInfo, setStatusInfo] = React.useState<WorkerEppStatusResult | null>(null)

  React.useEffect(() => {
    let active = true
    if (requestType === "epp" && item.workerId && item.productId) {
      getWorkerEppStatusAction(item.workerId, item.productId).then((res) => {
        if (active) setStatusInfo(res)
      })
    }
    return () => { active = false }
  }, [requestType, item.workerId, item.productId])

  return (
    <div className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4 space-y-4">
      {/* Row header */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--color-surface-2) text-[10px] font-mono text-(--color-text-muted)">
          {idx + 1}
        </span>

        {/* Product picker / Description */}
        <div className="flex-1 space-y-2">
          {isQuotationType ? (
            <Field label="Descripción" required htmlFor={`desc-${item._key}`}>
              <Input
                id={`desc-${item._key}`}
                className="h-8 text-sm"
                placeholder="Describe el ítem requerido..."
                value={item.productNameFree}
                onChange={(e) => onUpdate({ productNameFree: e.target.value, productId: null })}
                disabled={readOnly}
              />
            </Field>
          ) : item.productId ? (
            <div className="flex items-center gap-2">
              <Package size={14} className="text-(--color-text-subtle) shrink-0" />
              <span className="flex-1 text-sm font-medium text-(--color-text)">
                {item.productName}
                {selectedProduct?.isService && (
                  <Badge
                    variant="outline" size="sm"
                    className="ml-1.5 font-normal align-middle"
                    title="El precio de este servicio se conoce al ejecutarlo o facturarlo; se registra sobre la orden de compra."
                  >
                    {COST_PENDING_LABEL}
                  </Badge>
                )}
                {selectedProduct?.isInactive && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-(--color-warning-tint) border border-(--color-warning-line) px-1.5 py-px text-[10px] font-medium text-(--color-warning-ink)" title="Este producto fue desactivado del catálogo">
                    inactivo
                  </span>
                )}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onClearProduct}
                  className="inline-flex min-h-6 items-center px-1 text-(--color-text-subtle) hover:text-(--color-danger) text-xs transition-colors duration-(--duration-fast)"
                >
                  Cambiar
                </button>
              )}
            </div>
          ) : item.productNameFree ? (
            <div className="flex items-center gap-2 rounded-(--radius) border border-(--color-warning-line) bg-(--color-warning-tint) px-3 py-2">
              <Package size={14} className="text-(--color-text-subtle) shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--color-text)">{item.productNameFree}</p>
                <p className="text-[11px] text-(--color-text-subtle)">Ítem histórico sin catálogo</p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onUpdate({ productNameFree: "" })}
                  className="shrink-0 text-xs text-(--color-primary) transition-colors duration-(--duration-fast) hover:text-(--color-primary-ink)"
                >
                  Elegir catálogo
                </button>
              )}
            </div>
          ) : (
            !readOnly && (
              <ProductPicker
                products={products}
                onSelectProduct={(pid) => onSelectProduct(pid)}
                onSelectFreeText={(name) => onSelectFreeProduct(name)}
              />
            )
          )}
        </div>

        {/* Remove button */}
        {!readOnly && canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="mt-0.5 size-6 flex items-center justify-center shrink-0 rounded text-(--color-text-subtle) hover:text-(--color-danger) hover:bg-(--color-surface-2) transition-colors duration-(--duration-fast)"
            aria-label="Eliminar ítem"
          >
            <Trash size={14} />
          </button>
        )}
      </div>

      {selectedProduct && sizeVariantPicker && (
        <div className="ml-8 max-w-sm">
          <VariantSelector
            variants={variants}
            selectedVariantId={selectedProduct.id}
            readOnly={readOnly}
            onSelect={onSelectProduct}
            id={`size-${item._key}`}
          />
        </div>
      )}

      {/* Colaborador — para EPP (opcional, sugiere tallas) y para cualquier
          producto que lo exija (`requiresWorker`: vacunas y lo que venga).
          Se muestra también en consulta: la ficha de una solicitud enviada tiene
          que decir para quién es. */}
      {showWorkerPicker && (
        <div className="ml-8 max-w-sm">
          <Field
            label="Colaborador"
            required={workerRequired}
            htmlFor={`worker-${item._key}`}
            helper={readOnly ? undefined : workerRequired
              ? `Obligatorio para ${selectedProduct?.name ?? "este ítem"}. Busca por nombre o RUT.`
              : "Opcional. Si se asigna, las tallas se sugerirán automáticamente."}
          >
            {readOnly ? (
              <Input
                id={`worker-${item._key}`}
                className="h-8 text-sm disabled:opacity-100 disabled:cursor-default"
                value={item.workerName || "Sin asignar"}
                disabled
                readOnly
              />
            ) : (
              <Combobox
                id={`worker-${item._key}`}
                options={workerOptions}
                value={item.workerId}
                onChange={onUpdateWorker}
                placeholder="Buscar colaborador..."
                clearLabel={workerRequired ? undefined : "Sin asignar"}
              />
            )}
          </Field>
          {!readOnly && item.workerId && item.workerName && !workerRequired && (
            <p className="mt-1 text-[11px] text-(--color-text-subtle)">
              Usando tallas registradas para {item.workerName}
            </p>
          )}

          {/* F-6: Advertencia de solicitud duplicada */}
          {statusInfo?.activeRequest && (
            <div className="mt-2 rounded border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-2 text-xs text-[var(--color-warning-ink)] font-medium">
              ⚠️ Ya existe la solicitud <strong>{statusInfo.activeRequest.code}</strong> en trámite para este trabajador.
            </div>
          )}

          {/* F-2: Vigencia / Entrega previa */}
          {statusInfo?.lastDelivery && (
            <div className="mt-1 text-xs">
              <span className="text-[var(--color-text-subtle)]">Última entrega: </span>
              <span className="font-medium text-[var(--color-text)]">{formatDate(statusInfo.lastDelivery.deliveredAt)}</span>
            </div>
          )}
        </div>
      )}

      {/* Equipo del registro — servicios sobre instrumentos (monogás, alcotest).
          Apunta a `service_equipment` en vez de re-escribir código y serie. */}
      {showEquipmentPicker && (
        <div className="ml-8 max-w-sm">
          <Field
            label="Código del equipo"
            required={!!equipmentKind}
            htmlFor={`equipment-${item._key}`}
            helper={readOnly ? undefined : "El código interno grabado en el aparato. Se registra el equipo, no una copia de sus datos."}
          >
            {readOnly ? (
              <Input
                id={`equipment-${item._key}`}
                className="h-8 text-sm disabled:opacity-100 disabled:cursor-default"
                value={item.equipmentLabel || item.equipmentCode || "Sin asignar"}
                disabled
                readOnly
              />
            ) : (
              <>
                <Input
                  id={`equipment-${item._key}`}
                  className="h-8 text-sm font-mono"
                  list={`equipment-codes-${item._key}`}
                  autoComplete="off"
                  placeholder="Ej: MG-014 o 000123456789"
                  value={item.equipmentCode}
                  onChange={(e) => onUpdate({ equipmentCode: e.target.value })}
                />
                <datalist id={`equipment-codes-${item._key}`}>
                  {knownEquipment.map((option) => (
                    <option key={option.id} value={option.code}>{option.name}</option>
                  ))}
                </datalist>
              </>
            )}
          </Field>
          {!readOnly && item.equipmentCode.trim() !== "" && (
            <p className="mt-1 text-[11px] text-(--color-text-subtle)">
              {matchedEquipment
                ? `Ya está en el catálogo: ${matchedEquipment.name}.`
                : "No está en el catálogo: se dará de alta con este código en la faena de la solicitud."}
            </p>
          )}
        </div>
      )}

      {/* Quantity + unit + (urgency for catalog types only) */}
      <div className={`ml-8 grid gap-3 ${isQuotationType ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
        {/* Cuando el catálogo declara que un atributo gobierna la cantidad
            (el nº de dosis de una vacuna), este campo pasa a ser de lectura:
            eran dos números para el mismo dato y nada obligaba a que
            coincidieran. El servidor la deriva del atributo igual. */}
        <Field
          label="Cantidad"
          required={!quantityDriver}
          htmlFor={`qty-${item._key}`}
          helper={!readOnly && quantityDriver ? `Se toma de ${quantityDriver.attributeName}.` : undefined}
        >
          <Input
            id={`qty-${item._key}`}
            type="number"
            min="0.01"
            step="any"
            className="h-8 text-sm tabular-nums disabled:opacity-100 disabled:cursor-default"
            value={item.quantity}
            onChange={(e) => onUpdate({ quantity: e.target.value })}
            disabled={readOnly || !!quantityDriver}
            readOnly={!!quantityDriver}
          />
        </Field>

        {/* Texto libre para una unidad de medida produce los mismos datos sucios
            que la condición de pago (A-30): "unidad"/"Unidad"/"un". Mismo remedio
            —`datalist` nativo— porque el catálogo de unidades lo administra el
            usuario y un `Select` rechazaría las que ya existen en productos
            heredados (hallazgo nuevo, auditoría UI/UX 2026-07-29 §5.7). */}
        <Field label="Unidad" htmlFor={`uom-${item._key}`}>
          <Input
            id={`uom-${item._key}`}
            className="h-8 text-sm"
            list="unit-of-measure-options"
            value={item.unitOfMeasure}
            onChange={(e) => onUpdate({ unitOfMeasure: e.target.value })}
            disabled={readOnly}
          />
        </Field>

        {!isQuotationType && (
          <Field label="Urgencia" htmlFor={`urg-${item._key}`}>
            <Select
              value={item.urgency}
              onValueChange={(v) => onUpdate({ urgency: v })}
              disabled={readOnly}
            >
              <SelectTrigger id={`urg-${item._key}`} className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {URGENCY_OPTS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {/* Equipment data — quotation types (repuestos/servicios) */}
      {isQuotationType && (
        <ItemEditorEquipment
          item={item}
          requestType={requestType ?? ""}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      )}

      {/* Supplier hint — hidden for quotation types */}
      {!isQuotationType && (
        <ItemEditorSupplier
          item={item}
          suppliers={suppliers}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      )}

      {/* Notes — hidden for quotation types */}
      {!isQuotationType && (
        <div className="ml-8">
          <Field label="Observación" htmlFor={`notes-${item._key}`}>
            <Input
              id={`notes-${item._key}`}
              className="h-8 text-sm"
              placeholder="Detalle opcional del ítem..."
              value={item.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              disabled={readOnly}
            />
          </Field>
        </div>
      )}

      {/* Cotizaciones upload — for quotation types */}
      {isQuotationType && (
        <ItemEditorCotizaciones
          item={item}
          requestType={requestType ?? ""}
          maxFileSizeMb={maxFileSizeMb}
          readOnly={readOnly}
          suppliers={suppliers}
          onUpdate={onUpdate}
        />
      )}

      {/* Attributes — for non-quotation types only */}
      {!isQuotationType && (
        <ItemEditorAttributes
          item={item}
          readOnly={readOnly}
          onUpdate={onUpdate}
          onUpdateAttr={onUpdateAttr}
          hiddenAttributeNames={sizeVariantPicker ? [sizeVariantPicker.attributeName] : []}
        />
      )}
    </div>
  )
}
