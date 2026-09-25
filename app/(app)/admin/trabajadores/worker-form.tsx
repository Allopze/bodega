"use client"

import { useState } from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { createWorker, updateWorker } from "./actions"
import { sizeFamilyForWorkerField } from "@/lib/products/size-catalog"
import type { WorkerSizeField } from "@/lib/products/product-size"
import type { SizeFamilyOption } from "@/app/(app)/admin/productos/product-form.types"
import type { WorkerPositionOption } from "@/app/(app)/admin/cargos/types"

// Qué campo del padrón alimenta cada familia del catálogo ya no vive acá: el
// cruce se deriva de `attributeName` con `sizeFamilyForWorkerField` y las
// tallas salen de `size_catalog`. Era la cuarta copia del mismo mapa y la que
// más se había separado del resto. El tipo del campo lo declara
// `product-size.ts`, que es el dueño del cruce.

interface WorksiteOption { id: string; name: string }

interface WorkerForEdit {
  id:         string
  rut:        string | null
  firstName:  string
  lastName:   string
  position:   string | null
  positionId: string | null
  positionNeedsReview: boolean
  worksiteId: string
  isActive:   boolean
  sizeTop:    string | null
  sizeBottom: string | null
  sizeShoe:   string | null
  sizeGloves: string | null
  sizeHelmet: string | null
}

interface WorkerFormProps {
  open:        boolean
  onClose:     () => void
  editWorker?: WorkerForEdit | null
  worksites:   WorksiteOption[]
  /** Familias de `size_catalog`, resueltas en el servidor. */
  sizeFamilies: SizeFamilyOption[]
  positions: WorkerPositionOption[]
}

export function WorkerForm({ open, onClose, editWorker, worksites, sizeFamilies, positions }: WorkerFormProps) {
  const codesByFamily = new Map(sizeFamilies.map((family) => [family.family, family.codes]))
  const presetsFor = (field: WorkerSizeField) => {
    const family = sizeFamilyForWorkerField(field)
    return (family ? codesByFamily.get(family) : undefined) ?? []
  }
  const isEdit = !!editWorker
  const defaultPositionId = editWorker?.positionId
    ?? positions.find((position) => position.code === "SIN-CLASIFICAR")?.id
    ?? ""
  const [selectedPositionId, setSelectedPositionId] = useState(defaultPositionId)
  const [selectedWorksiteId, setSelectedWorksiteId] = useState(editWorker?.worksiteId ?? "")
  const [sizes, setSizes] = useState({
    sizeTop: editWorker?.sizeTop ?? "",
    sizeBottom: editWorker?.sizeBottom ?? "",
    sizeShoe: editWorker?.sizeShoe ?? "",
    sizeGloves: editWorker?.sizeGloves ?? "",
    sizeHelmet: editWorker?.sizeHelmet ?? "",
  })

  function setSize(key: keyof typeof sizes, value: string) {
    setSizes((prev) => ({ ...prev, [key]: value }))
  }

  const selectedPosition = positions.find((position) => position.id === selectedPositionId)
  const selectablePositions = positions.filter((position) => position.isActive || position.id === selectedPositionId)

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editWorker?.id}
      title={isEdit ? "Editar trabajador" : "Nuevo trabajador"}
      description={
        isEdit
          ? `Modificar ${editWorker.firstName} ${editWorker.lastName}`
          : "Registra un trabajador para asignación de EPP y entregas"
      }
      create={createWorker}
      update={updateWorker}
      submitLabel={isEdit ? "Guardar cambios" : "Crear trabajador"}
      successMessage={isEdit ? "Trabajador actualizado" : "Trabajador creado"}
      hiddenFields={(
        <>
          {Object.entries(sizes).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value || ""} />
          ))}
        </>
      )}
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" htmlFor="wrk-first" required error={state.fieldErrors?.firstName?.[0]}>
              <Input id="wrk-first" name="firstName" defaultValue={editWorker?.firstName ?? ""} placeholder="Juan" error={!!state.fieldErrors?.firstName} />
            </Field>
            <Field label="Apellido" htmlFor="wrk-last" required error={state.fieldErrors?.lastName?.[0]}>
              <Input id="wrk-last" name="lastName" defaultValue={editWorker?.lastName ?? ""} placeholder="Pérez" error={!!state.fieldErrors?.lastName} />
            </Field>
          </div>

          <Field label="RUT" htmlFor="wrk-rut" helper="Con o sin puntos y guion: 12.345.678-9, 12345678-9 o 123456789" error={state.fieldErrors?.rut?.[0]}>
            <Input id="wrk-rut" name="rut" defaultValue={editWorker?.rut ?? ""} placeholder="12345678-9" error={!!state.fieldErrors?.rut} className="font-mono" />
          </Field>

          <Field label="Cargo" htmlFor="wrk-pos" required error={state.fieldErrors?.positionId?.[0]}>
            <input type="hidden" name="positionId" value={selectedPositionId} />
            <Select value={selectedPositionId} onValueChange={setSelectedPositionId} searchable>
              <SelectTrigger id="wrk-pos" error={Boolean(state.fieldErrors?.positionId)}>
                <SelectValue placeholder="Selecciona un cargo" />
              </SelectTrigger>
              <SelectContent>
                {selectablePositions.map((position) => (
                  <SelectItem key={position.id} value={position.id}>
                    {position.name} ({position.code}){position.isActive ? "" : " · Inactivo"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {selectedPosition?.needsReview && (
            <div role="status" className="flex items-start gap-2 rounded-[var(--radius-lg)] bg-[var(--color-warning-tint)] p-3">
              <Badge variant="warning" size="sm">Revisar cargo</Badge>
              <p className="text-xs leading-relaxed text-[var(--color-warning-ink)]">
                Este cargo está pendiente de revisión. Aún no aporta capacidades automáticas al padrón preventivo.
              </p>
            </div>
          )}

          <Field label="Faena" htmlFor="wrk-ws" required error={state.fieldErrors?.worksiteId?.[0]}>
            <input type="hidden" name="worksiteId" value={selectedWorksiteId} />
            <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}>
              <SelectTrigger id="wrk-ws" error={!!state.fieldErrors?.worksiteId?.[0]}>
                <SelectValue placeholder="Selecciona una faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Checkbox id="wrk-isActive" name="isActive" value="on" defaultChecked={editWorker?.isActive ?? true} label="Trabajador activo" />

          <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Tallas EPP</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <SizeSelect label="Camisa/Polera" value={sizes.sizeTop} onChange={(v) => setSize("sizeTop", v)} presets={presetsFor("sizeTop")} id="wrk-sizeTop" />
              <SizeSelect label="Pantalón" value={sizes.sizeBottom} onChange={(v) => setSize("sizeBottom", v)} presets={presetsFor("sizeBottom")} id="wrk-sizeBottom" />
              <SizeSelect label="Calzado" value={sizes.sizeShoe} onChange={(v) => setSize("sizeShoe", v)} presets={presetsFor("sizeShoe")} id="wrk-sizeShoe" />
              <SizeSelect label="Guantes" value={sizes.sizeGloves} onChange={(v) => setSize("sizeGloves", v)} presets={presetsFor("sizeGloves")} id="wrk-sizeGloves" />
              <SizeSelect label="Casco" value={sizes.sizeHelmet} onChange={(v) => setSize("sizeHelmet", v)} presets={presetsFor("sizeHelmet")} id="wrk-sizeHelmet" />
            </div>
          </div>
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}

// Radix Select prohíbe `value=""` en un SelectItem (la cadena vacía está
// reservada para limpiar la selección). Usarla lanza en cliente y tumba la
// pantalla. El centinela es sólo para Radix: el valor enviado sigue siendo "".
const NONE = "_none"

function SizeSelect({ label, value, onChange, presets, id }: { label: string; value: string; onChange: (v: string) => void; presets: string[]; id: string }) {
  // Una talla guardada que el catálogo ya no ofrece sigue siendo elegible: si
  // desapareciera de la lista, abrir la ficha y guardar la borraría en silencio.
  const options = value && !presets.includes(value) ? [...presets, value] : presets

  return (
    <Field label={label} htmlFor={id}>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {options.map((size) => (
            <SelectItem key={size} value={size}>{size}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
