"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { IT_ASSET_CATEGORIES } from "@/lib/validation/ti"
import { IT_ASSET_CATEGORY_META } from "@/lib/services/ti/constants"
import { createItAssetTypeAction, updateItAssetTypeAction } from "./actions"

export interface AssetTypeRow {
  id: string
  name: string
  category: string
  hasSpecs: boolean
  assetCount: number
  isActive: boolean
}

interface AssetTypeFormProps {
  open: boolean
  onClose: () => void
  editRow?: AssetTypeRow | null
}

export function AssetTypeForm({ open, onClose, editRow }: AssetTypeFormProps) {
  const isEdit = !!editRow

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editRow?.id}
      title={isEdit ? "Editar tipo de activo" : "Nuevo tipo de activo"}
      description={isEdit ? "Actualiza el nombre, categoría o especificaciones del tipo." : "Completa los datos del nuevo tipo de activo."}
      create={createItAssetTypeAction}
      update={updateItAssetTypeAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear tipo"}
      successMessage={isEdit ? "Tipo actualizado" : "Tipo creado"}
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <Field label="Nombre" htmlFor="iat-name" required error={state.fieldErrors?.name?.[0]}>
            <Input
              id="iat-name"
              name="name"
              defaultValue={editRow?.name ?? ""}
              error={!!state.fieldErrors?.name}
              placeholder="Notebook"
            />
          </Field>
          <Field label="Categoría" htmlFor="iat-category" required error={state.fieldErrors?.category?.[0]}>
            <Select name="category" defaultValue={editRow?.category ?? IT_ASSET_CATEGORIES[0]}>
              <SelectTrigger id="iat-category" className="h-9 w-full">
                <SelectValue placeholder="Selecciona una categoría" />
              </SelectTrigger>
              <SelectContent>
                {IT_ASSET_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>{IT_ASSET_CATEGORY_META[category]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div>
            <Checkbox
              id="iat-has-specs"
              name="hasSpecs"
              value="on"
              defaultChecked={editRow?.hasSpecs ?? false}
              label="Requiere especificaciones técnicas"
            />
            <p className="mt-1 pl-6 text-xs text-[var(--color-text-muted)]">
              Habilita los campos de procesador, RAM, almacenamiento y sistema operativo al
              registrar un activo de este tipo. Para periféricos simples (mouse, teclado)
              déjalo desactivado.
            </p>
          </div>
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
