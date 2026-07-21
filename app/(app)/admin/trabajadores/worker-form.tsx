"use client"

import { useState } from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { createWorker, updateWorker } from "./actions"

const SIZE_PRESETS = {
  top:    ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  bottom: ["28","30","32","34","36","38","40","42","44","46","48"],
  shoe:   ["36","37","38","39","40","41","42","43","44","45","46"],
  gloves: ["XS","S","M","L","XL","2XL"],
  helmet: ["Única"],
}

interface WorksiteOption { id: string; name: string }

interface WorkerForEdit {
  id:         string
  rut:        string | null
  firstName:  string
  lastName:   string
  position:   string | null
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
}

export function WorkerForm({ open, onClose, editWorker, worksites }: WorkerFormProps) {
  const isEdit = !!editWorker
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

          <Field label="RUT" htmlFor="wrk-rut" helper="Formato: 12345678-9" error={state.fieldErrors?.rut?.[0]}>
            <Input id="wrk-rut" name="rut" defaultValue={editWorker?.rut ?? ""} placeholder="12345678-9" error={!!state.fieldErrors?.rut} className="font-mono" />
          </Field>

          <Field label="Cargo" htmlFor="wrk-pos">
            <Input id="wrk-pos" name="position" defaultValue={editWorker?.position ?? ""} placeholder="Operario, Supervisor, Técnico..." />
          </Field>

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
              <SizeSelect label="Camisa/Polera" value={sizes.sizeTop} onChange={(v) => setSize("sizeTop", v)} presets={SIZE_PRESETS.top} id="wrk-sizeTop" />
              <SizeSelect label="Pantalón" value={sizes.sizeBottom} onChange={(v) => setSize("sizeBottom", v)} presets={SIZE_PRESETS.bottom} id="wrk-sizeBottom" />
              <SizeSelect label="Calzado" value={sizes.sizeShoe} onChange={(v) => setSize("sizeShoe", v)} presets={SIZE_PRESETS.shoe} id="wrk-sizeShoe" />
              <SizeSelect label="Guantes" value={sizes.sizeGloves} onChange={(v) => setSize("sizeGloves", v)} presets={SIZE_PRESETS.gloves} id="wrk-sizeGloves" />
              <SizeSelect label="Casco" value={sizes.sizeHelmet} onChange={(v) => setSize("sizeHelmet", v)} presets={SIZE_PRESETS.helmet} id="wrk-sizeHelmet" />
            </div>
          </div>
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}

function SizeSelect({ label, value, onChange, presets, id }: { label: string; value: string; onChange: (v: string) => void; presets: string[]; id: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">—</SelectItem>
          {presets.map((size) => (
            <SelectItem key={size} value={size}>{size}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
