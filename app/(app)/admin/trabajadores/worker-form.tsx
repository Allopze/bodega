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

interface WorksiteOption { id: string; name: string }

interface WorkerForEdit {
  id:         string
  rut:        string | null
  firstName:  string
  lastName:   string
  position:   string | null
  worksiteId: string
  isActive:   boolean
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
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" htmlFor="wrk-first" required error={state.fieldErrors?.firstName?.[0]}>
              <Input
                id="wrk-first" name="firstName"
                defaultValue={editWorker?.firstName ?? ""}
                placeholder="Juan"
                error={!!state.fieldErrors?.firstName}
              />
            </Field>
            <Field label="Apellido" htmlFor="wrk-last" required error={state.fieldErrors?.lastName?.[0]}>
              <Input
                id="wrk-last" name="lastName"
                defaultValue={editWorker?.lastName ?? ""}
                placeholder="Pérez"
                error={!!state.fieldErrors?.lastName}
              />
            </Field>
          </div>

          <Field label="RUT" htmlFor="wrk-rut" helper="Formato: 12345678-9" error={state.fieldErrors?.rut?.[0]}>
            <Input
              id="wrk-rut" name="rut"
              defaultValue={editWorker?.rut ?? ""}
              placeholder="12345678-9"
              error={!!state.fieldErrors?.rut}
              className="font-mono"
            />
          </Field>

          <Field label="Cargo" htmlFor="wrk-pos">
            <Input
              id="wrk-pos" name="position"
              defaultValue={editWorker?.position ?? ""}
              placeholder="Operario, Supervisor, Técnico..."
            />
          </Field>

          <Field label="Faena" htmlFor="wrk-ws" required error={state.fieldErrors?.worksiteId?.[0]}>
            {/* Hidden input carries value to FormData / server action */}
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
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
