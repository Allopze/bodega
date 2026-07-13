"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FUEL_PRODUCT_CATEGORIES, FUEL_PRODUCT_CATEGORY_LABELS, FUEL_PRODUCT_UNITS, FUEL_PRODUCT_UNIT_LABELS } from "@/lib/combustibles/validation"
import { createFuelProductAction, updateFuelProductAction } from "./actions"

export interface FuelProductRow { id: string; code: string; name: string; category: string; unit: string; aliases: string[]; description: string | null; isSystem: boolean; isActive: boolean; vehicleCount: number }

export function FuelProductForm({ open, onClose, row }: { open: boolean; onClose: () => void; row: FuelProductRow | null }) {
  return <CatalogFormSheet open={open} onClose={onClose} isEdit={Boolean(row)} entityId={row?.id} title={row ? "Editar producto" : "Nuevo producto combustible"} description="Define el producto, su unidad y los alias usados por integraciones." create={createFuelProductAction} update={updateFuelProductAction} submitLabel={row ? "Guardar cambios" : "Crear producto"} successMessage={row ? "Producto actualizado" : "Producto creado"}>
    {(state) => <FieldGroup className="gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Código" htmlFor="fuel-product-code" required error={state.fieldErrors?.code?.[0]}><Input id="fuel-product-code" name="code" defaultValue={row?.code ?? ""} /></Field><Field label="Nombre" htmlFor="fuel-product-name" required error={state.fieldErrors?.name?.[0]}><Input id="fuel-product-name" name="name" defaultValue={row?.name ?? ""} /></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Categoría" htmlFor="fuel-product-category" required><Select name="category" defaultValue={row?.category ?? "other"}><SelectTrigger id="fuel-product-category"><SelectValue /></SelectTrigger><SelectContent>{FUEL_PRODUCT_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{FUEL_PRODUCT_CATEGORY_LABELS[item]}</SelectItem>)}</SelectContent></Select></Field><Field label="Unidad" htmlFor="fuel-product-unit" required><Select name="unit" defaultValue={row?.unit ?? "liter"}><SelectTrigger id="fuel-product-unit"><SelectValue /></SelectTrigger><SelectContent>{FUEL_PRODUCT_UNITS.map((item) => <SelectItem key={item} value={item}>{FUEL_PRODUCT_UNIT_LABELS[item]}</SelectItem>)}</SelectContent></Select></Field></div>
      <Field label="Alias de importación" htmlFor="fuel-product-aliases" helper="Separados por coma."><Input id="fuel-product-aliases" name="aliases" defaultValue={row?.aliases.join(", ") ?? ""} /></Field>
      <Field label="Descripción" htmlFor="fuel-product-description"><Textarea id="fuel-product-description" name="description" rows={3} defaultValue={row?.description ?? ""} /></Field>
    </FieldGroup>}
  </CatalogFormSheet>
}
