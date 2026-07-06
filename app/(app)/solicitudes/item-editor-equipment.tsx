"use client"

import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import type { ItemRow } from "./request-form.types"

interface Props {
  item: ItemRow
  requestType: string
  readOnly: boolean
  onUpdate: (patch: Partial<ItemRow>) => void
}

export function ItemEditorEquipment({ item, requestType, readOnly, onUpdate }: Props) {
  return (
    <div className="ml-8 space-y-3">
      <p className="text-xs font-medium text-(--color-text-subtle)">
        {requestType === "repuestos" ? "Equipo asociado" : "Detalle del servicio"}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {requestType === "repuestos" && (
          <Field label="N° de Parte" htmlFor={`part-${item._key}`}>
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
        <Field label="Equipo / Máquina" className="sm:col-span-2" htmlFor={`equip-${item._key}`}>
          <Input
            id={`equip-${item._key}`}
            className="h-8 text-sm"
            placeholder={requestType === "repuestos" ? "Ej: Retroexcavadora, Camión grúa..." : "Ej: Retroexcavadora, Generador..."}
            value={item.equipmentName}
            onChange={(e) => onUpdate({ equipmentName: e.target.value })}
            disabled={readOnly}
          />
        </Field>
        <Field label="Patente / Código interno" htmlFor={`pat-${item._key}`}>
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
      </div>
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
