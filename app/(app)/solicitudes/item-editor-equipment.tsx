"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Combobox } from "@/components/ui/combobox"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { OT_STATUS_LABELS, type OtStatus } from "@/lib/mantencion/work-order-states"
import { formatCLP } from "@/lib/utils"
import type { ItemRow, VehicleOption } from "./request-form.types"

interface Props {
  item: ItemRow
  requestType: string
  readOnly: boolean
  /** Equipos de flota del alcance de la persona; se filtran por `worksiteId`. */
  vehicles: VehicleOption[]
  /** Faena elegida en el formulario: sólo se ofrecen los equipos de esa faena. */
  worksiteId: string
  /** Último precio conocido del repuesto de catálogo elegido, si lo hay. */
  catalogPrice?: number | null
  onUpdate: (patch: Partial<ItemRow>) => void
  onSelectVehicle: (vehicleId: string) => void
  onSelectWorkOrder: (workOrderId: string) => void
}

const NO_WORK_ORDER = "__none__"

export function ItemEditorEquipment({
  item, requestType, readOnly, vehicles, worksiteId, catalogPrice = null, onUpdate, onSelectVehicle, onSelectWorkOrder,
}: Props) {
  const isRepuestos = requestType === "repuestos"
  // Con un repuesto de catálogo el N° de parte lo dice el producto: pedirlo otra
  // vez dejaría dos fuentes para el mismo dato.
  const hasCatalogPart = isRepuestos && !!item.productId
  const vehicle = item.vehicleId ? vehicles.find((option) => option.id === item.vehicleId) : undefined

  const vehicleOptions = React.useMemo(() => {
    const options = vehicles
      .filter((option) => option.worksiteId === worksiteId || option.id === item.vehicleId)
      .map((option) => ({ value: option.id, label: option.label, hint: option.hint }))
    // Un equipo ya vinculado que el catálogo no trae (otro alcance, borrador
    // viejo) sigue visible con la etiqueta que se guardó, en vez de dejar el
    // selector en blanco con un vínculo que nadie ve.
    if (item.vehicleId && !options.some((option) => option.value === item.vehicleId) && item.vehicleLabel) {
      options.unshift({ value: item.vehicleId, label: item.vehicleLabel, hint: "" })
    }
    return options
  }, [vehicles, worksiteId, item.vehicleId, item.vehicleLabel])

  // La OT vinculada puede haberse cerrado desde que se eligió: sigue apareciendo
  // para que se vea a qué estaba ligado el borrador (el servidor lo rechazará al
  // guardar con un mensaje claro).
  const workOrderOptions = vehicle?.openWorkOrders ?? []
  const linkedWorkOrderMissing = !!item.workOrderId && !workOrderOptions.some((order) => order.id === item.workOrderId)

  return (
    <div className="ml-8 space-y-3">
      <p className="text-xs font-medium text-(--color-text-subtle)">
        {isRepuestos ? "Equipo asociado" : "Detalle del servicio"}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Equipo de flota"
          htmlFor={`veh-${item._key}`}
          helper={vehicle ? undefined : "Elige el equipo para que el gasto quede en su ficha. Si no está en flota, escribe sus datos abajo."}
        >
          <Combobox
            id={`veh-${item._key}`}
            options={vehicleOptions}
            value={item.vehicleId}
            onChange={onSelectVehicle}
            placeholder="Busca por código o patente"
            clearLabel="Otro equipo (no está en flota)"
            disabled={readOnly}
          />
        </Field>

        {item.vehicleId && (
          <Field
            label="Orden de trabajo"
            htmlFor={`ot-${item._key}`}
            helper={workOrderOptions.length === 0 ? "Este equipo no tiene OT abiertas." : "Opcional. Vincula el pedido a la OT que lo originó."}
          >
            <Select
              value={item.workOrderId || NO_WORK_ORDER}
              onValueChange={(value) => onSelectWorkOrder(value === NO_WORK_ORDER ? "" : value)}
              disabled={readOnly}
            >
              <SelectTrigger id={`ot-${item._key}`} className="h-8 text-sm">
                <SelectValue placeholder="Sin OT" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_WORK_ORDER}>Sin OT</SelectItem>
                {linkedWorkOrderMissing && (
                  <SelectItem value={item.workOrderId}>{item.workOrderFolio || "OT vinculada"}</SelectItem>
                )}
                {workOrderOptions.map((order) => (
                  <SelectItem key={order.id} value={order.id}>
                    {order.folio} · {OT_STATUS_LABELS[order.status as OtStatus] ?? order.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {isRepuestos && !hasCatalogPart && (
          <Field label="N° de parte" htmlFor={`part-${item._key}`}>
            <Input
              id={`part-${item._key}`}
              className="h-8 text-sm"
              placeholder="OEM o fabricante"
              value={item.partNumber}
              onChange={(e) => onUpdate({ partNumber: e.target.value })}
              disabled={readOnly}
            />
          </Field>
        )}
        {requestType === "servicios" && (
          <Field label="Ubicación" htmlFor={`loc-${item._key}`}>
            <Input
              id={`loc-${item._key}`}
              className="h-8 text-sm"
              placeholder="Ej: Sector norte, sala de máquinas..."
              value={item.location}
              onChange={(e) => onUpdate({ location: e.target.value })}
              disabled={readOnly}
            />
          </Field>
        )}
        {/* Con un equipo de flota los datos los dice su registro: los campos
            libres sólo existen para «otro equipo». */}
        {!item.vehicleId && (
          <>
            <Field label="Equipo / máquina" className="sm:col-span-2" htmlFor={`equip-${item._key}`}>
              <Input
                id={`equip-${item._key}`}
                className="h-8 text-sm"
                placeholder={isRepuestos ? "Ej: Retroexcavadora, Camión grúa..." : "Ej: Retroexcavadora, Generador..."}
                value={item.equipmentName}
                onChange={(e) => onUpdate({ equipmentName: e.target.value })}
                disabled={readOnly}
              />
            </Field>
            <Field label="Patente / código interno" htmlFor={`pat-${item._key}`}>
              <Input
                id={`pat-${item._key}`}
                className="h-8 text-sm"
                placeholder="Ej: ABCD-12"
                value={item.patent}
                onChange={(e) => onUpdate({ patent: e.target.value })}
                disabled={readOnly}
              />
            </Field>
            <Field label="Marca" htmlFor={`brand-${item._key}`}>
              <Input
                id={`brand-${item._key}`}
                className="h-8 text-sm"
                placeholder="Ej: Caterpillar, Volvo..."
                value={item.brand}
                onChange={(e) => onUpdate({ brand: e.target.value })}
                disabled={readOnly}
              />
            </Field>
            <Field label="Modelo" htmlFor={`model-${item._key}`}>
              <Input
                id={`model-${item._key}`}
                className="h-8 text-sm"
                placeholder="Ej: 320D, FH16..."
                value={item.model}
                onChange={(e) => onUpdate({ model: e.target.value })}
                disabled={readOnly}
              />
            </Field>
          </>
        )}
      </div>

      {/* El precio estimado sólo lo usa la regla de repuestos (bajo el umbral basta
          con él); en servicios el costo se conoce al facturar. */}
      {isRepuestos && (
        <Field
          label="Precio unitario estimado (CLP)"
          htmlFor={`price-${item._key}`}
          helper={hasCatalogPart && catalogPrice != null && catalogPrice > 0
            ? `Último precio conocido en el catálogo: ${formatCLP(catalogPrice)}. Puedes cambiarlo. Bajo el umbral permite enviar sin cotización.`
            : "Opcional. Bajo el umbral permite enviar sin cotización."}
        >
          <Input
            id={`price-${item._key}`}
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            className="h-8 text-sm tabular-nums"
            placeholder="Ej: 35000"
            value={item.estimatedUnitPrice}
            onChange={(e) => onUpdate({ estimatedUnitPrice: e.target.value })}
            disabled={readOnly}
          />
        </Field>
      )}

      <Field label="Observaciones" htmlFor={`qnotes-${item._key}`}>
        <Input
          id={`qnotes-${item._key}`}
          className="h-8 text-sm"
          placeholder="Detalle adicional..."
          value={item.notes}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          disabled={readOnly}
        />
      </Field>
    </div>
  )
}
