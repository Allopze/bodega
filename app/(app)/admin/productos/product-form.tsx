"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Plus, Trash } from "@phosphor-icons/react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { createProduct, updateProduct } from "./actions"
import type { AttributeRow, SupplierRow, ProductFormProps } from "./product-form.types"
import { mergeProductAttribute, setPreferredSupplier } from "./product-form.helpers"

const EPP_ATTRIBUTE_PRESETS: AttributeRow[] = [
  {
    name: "Talla",
    type: "select",
    isRequired: true,
    options: "XS, S, M, L, XL, 2XL, 3XL",
    sortOrder: 0,
    sizeFamily: "ropa",
  },
  {
    name: "Talla calzado",
    type: "select",
    isRequired: true,
    options: "36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46",
    sortOrder: 0,
    sizeFamily: "calzado",
  },
  {
    name: "Talla guantes",
    type: "select",
    isRequired: true,
    options: "XS, S, M, L, XL, 2XL",
    sortOrder: 0,
    sizeFamily: "guantes",
  },
  {
    name: "Color",
    type: "select",
    isRequired: true,
    options: "Amarillo, Azul, Blanco, Gris, Negro, Naranja, Rojo, Verde",
    sortOrder: 0,
  },
]

function optionsAsText(options: string) {
  if (!options) return ""
  try {
    const parsed: unknown = JSON.parse(options)
    if (Array.isArray(parsed)) return parsed.map((value) => String(value)).join(", ")
  } catch {
    // Legacy templates may still contain comma/newline-separated text.
  }
  return options
}

export function ProductForm({ open, onClose, categories, allSuppliers, units, templates, editProduct, variant = "sheet" }: ProductFormProps) {
  const isEdit = !!editProduct
  const action = isEdit ? updateProduct : createProduct
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? (isEdit ? "Producto actualizado" : "Producto creado"))
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  const [categoryId, setCategoryId] = React.useState(editProduct?.categoryId ?? "")
  const [uom,        setUom]        = React.useState(editProduct?.unitOfMeasure ?? "unidad")
  const [attrs,      setAttrs]      = React.useState<AttributeRow[]>(editProduct?.attributes ?? [])
  const [suppRows,   setSuppRows]   = React.useState<SupplierRow[]>(editProduct?.suppliers ?? [])
  const [isEpp,      setIsEpp]      = React.useState(editProduct?.isEpp ?? false)
  const [requiresPrevencion, setRequiresPrevencion] = React.useState(editProduct?.requiresPrevencion ?? false)

  // New products inherit EPP/Prevención from the chosen category as a default;
  // existing products keep their own explicit flags (divergence is surfaced as
  // a list warning instead of being silently overwritten on edit).
  function handleCategoryChange(id: string) {
    setCategoryId(id)
    if (isEdit) return
    const category = categories.find((c) => c.id === id)
    if (!category) return
    setIsEpp(category.isEpp ?? false)
    setRequiresPrevencion(category.requiresPrevencion ?? false)
  }

  function updateSuppPreferred(i: number, checked: boolean) {
    setSuppRows((prev) => setPreferredSupplier(prev, i, checked))
  }

  const unitOptions = React.useMemo(() => {
    if (!uom || units.some((unit) => unit.code === uom)) return units
    return [{ code: uom, label: `${uom} (heredada)`, isActive: false }, ...units]
  }, [units, uom])

  const categoryTemplates = React.useMemo(
    () => templates.filter((template) => !template.categoryId || template.categoryId === categoryId),
    [categoryId, templates],
  )

  function addAttr() {
    setAttrs((prev) => [...prev, { id: crypto.randomUUID(), name: "", type: "text", isRequired: false, options: "", sortOrder: prev.length }])
  }
  function removeAttr(i: number) { setAttrs((prev) => prev.filter((_, idx) => idx !== i)) }
  function updateAttr(i: number, patch: Partial<AttributeRow>) {
    setAttrs((prev) => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }
  function upsertAttr(preset: AttributeRow) {
    setAttrs((prev) => mergeProductAttribute(prev, preset))
  }

  function addPresetAttr(preset: AttributeRow) {
    upsertAttr(preset)
    setIsEpp(true)
  }

  function applyCategoryTemplates() {
    categoryTemplates.forEach((template) => {
      upsertAttr({
        id: template.id,
        name: template.name,
        type: template.type,
        isRequired: template.isRequired,
        options: optionsAsText(template.options),
        sortOrder: template.sortOrder,
      })
    })
  }

  function addSupp(supplierId: string) {
    const sup = allSuppliers.find((s) => s.id === supplierId)
    if (!sup || suppRows.find((r) => r.supplierId === supplierId)) return
    setSuppRows((prev) => [...prev, { id: crypto.randomUUID(), supplierId: sup.id, supplierName: sup.name, unitPrice: "", isPreferred: false, notes: "" }])
  }
  function removeSupp(i: number) { setSuppRows((prev) => prev.filter((_, idx) => idx !== i)) }
  function updateSupp(i: number, patch: Partial<SupplierRow>) {
    setSuppRows((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  const availableSuppliers = allSuppliers.filter((s) => !suppRows.find((r) => r.supplierId === s.id))
  const formNode = (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editProduct?.id}
      title={isEdit ? "Editar producto" : "Nuevo producto"}
      description={isEdit ? `Modificar ${editProduct.name}` : "Registra un nuevo producto en el catálogo"}
      create={createProduct}
      update={updateProduct}
      submitLabel={isEdit ? "Guardar cambios" : "Crear producto"}
      submittingLabel={isEdit ? "Guardando..." : "Creando..."}
      successMessage={isEdit ? "Producto actualizado" : "Producto creado"}
      variant={variant}
      bodyClassName={variant === "embedded" ? "overflow-visible px-5 py-5 md:px-6" : undefined}
      footerClassName={variant === "embedded" ? "bg-[var(--color-surface-2)]" : undefined}
      embeddedCloseLabel="Volver al catálogo"
      externalActionState={{ state, formAction }}
      hiddenFields={(
        <>
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="unitOfMeasure" value={uom} />
          <input type="hidden" name="attributesJson" value={JSON.stringify(attrs)} />
          <input type="hidden" name="suppliersJson" value={JSON.stringify(suppRows.map((s) => ({
            supplierId: s.supplierId,
            unitPrice: s.unitPrice ? parseFloat(s.unitPrice) : null,
            isPreferred: s.isPreferred,
            notes: s.notes || null,
          })))} />
        </>
      )}
    >
      {() => (
        <Tabs defaultValue="general">
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="atributos">
              Atributos
              {attrs.length > 0 && <Badge size="sm" className="ml-1.5">{attrs.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="proveedores">
              Proveedores
              {suppRows.length > 0 && <Badge size="sm" className="ml-1.5">{suppRows.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── General tab ── */}
          <TabsContent value="general">
            <FieldGroup className="gap-4">
              {isEdit && (
                <div className="rounded-(--radius) bg-(--color-surface-2) px-3 py-2 text-sm">
                  <span className="text-(--color-text-subtle)">SKU asignado: </span>
                  <span className="font-mono font-medium text-(--color-text)">{editProduct.sku}</span>
                </div>
              )}

              <Field label="Categoría" htmlFor="p-cat" required error={state.fieldErrors?.categoryId?.[0]}>
                  <Select value={categoryId} onValueChange={handleCategoryChange}>
                    <SelectTrigger id="p-cat" error={!!state.fieldErrors?.categoryId}>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
              </Field>

              <Field label="Nombre" htmlFor="p-name" required error={state.fieldErrors?.name?.[0]}>
                <Input id="p-name" name="name" defaultValue={editProduct?.name ?? ""} placeholder="Casco de seguridad blanco clase A" error={!!state.fieldErrors?.name} />
              </Field>

              <Field label="Descripción" htmlFor="p-desc">
                <Textarea id="p-desc" name="description" defaultValue={editProduct?.description ?? ""} placeholder="Descripción del producto..." rows={2} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Unidad de medida" htmlFor="p-uom" required>
                  <Select value={uom} onValueChange={setUom}>
                    <SelectTrigger id="p-uom"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {unitOptions.map((unit) => <SelectItem key={unit.code} value={unit.code}>{unit.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Precio ref. (CLP)" htmlFor="p-price" error={state.fieldErrors?.referencePrice?.[0]}>
                  <Input id="p-price" name="referencePrice" type="number" min="0" step="1" defaultValue={editProduct?.referencePrice ?? ""} placeholder="0" error={!!state.fieldErrors?.referencePrice} className="font-mono" />
                </Field>
              </div>

              <Field label="Notas" htmlFor="p-notes">
                <Textarea id="p-notes" name="notes" defaultValue={editProduct?.notes ?? ""} placeholder="Observaciones, variantes aceptadas..." rows={2} />
              </Field>

              <div className="flex flex-col gap-2">
                <Checkbox id="p-epp" name="isEpp" value="on" checked={isEpp} onChange={(event) => setIsEpp(event.target.checked)} label="Es EPP" />
                <Checkbox id="p-prev" name="requiresPrevencion" value="on" checked={requiresPrevencion} onChange={(event) => setRequiresPrevencion(event.target.checked)} label="Requiere aprobación de Prevención" />
                <Checkbox id="p-active" name="isActive" value="on" defaultChecked={editProduct?.isActive ?? true} label="Producto activo" />
              </div>
            </FieldGroup>
          </TabsContent>

          {/* ── Attributes tab ── */}
          <TabsContent value="atributos">
            <p className="text-sm text-text-muted mb-4">
              Los atributos definen los campos adicionales que se solicitan al incluir este producto en una solicitud (talla, color, modelo, medida, etc.).
            </p>
            <div className="mb-4 rounded-(--radius) border border-border bg-surface-2 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-subtle">Atajos para EPP</p>
              <div className="flex flex-wrap gap-2">
                {EPP_ATTRIBUTE_PRESETS.map((preset) => (
                  <Button key={preset.name} type="button" variant="secondary" size="sm" onClick={() => addPresetAttr(preset)}>
                    <Plus size={13} />{preset.name}
                  </Button>
                ))}
                {categoryTemplates.length > 0 && (
                  <Button type="button" variant="secondary" size="sm" onClick={applyCategoryTemplates}>
                    <Plus size={13} />Aplicar plantillas ({categoryTemplates.length})
                  </Button>
                )}
              </div>
              {categoryId && categoryTemplates.length === 0 && (
                <p className="mt-2 text-xs text-text-subtle">Esta categoría no tiene plantillas activas.</p>
              )}
            </div>
            {attrs.length === 0 && (
              <p className="text-sm text-text-subtle mb-4">Sin atributos definidos.</p>
            )}
            <div className="flex flex-col gap-3 mb-4">
              {attrs.map((attr, i) => (
                <div key={attr.id} className="flex gap-2 items-start p-3 rounded-(--radius) border border-border bg-surface-2">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <Field label="Nombre" htmlFor={`attr-name-${i}`} required>
                      <Input id={`attr-name-${i}`} value={attr.name} onChange={(e) => updateAttr(i, { name: e.target.value })} placeholder="Talla" />
                    </Field>
                    <Field label="Tipo" htmlFor={`attr-type-${i}`} required>
                      <Select value={attr.type} onValueChange={(v) => updateAttr(i, { type: v as AttributeRow["type"] })}>
                        <SelectTrigger id={`attr-type-${i}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Texto</SelectItem>
                          <SelectItem value="select">Lista</SelectItem>
                          <SelectItem value="number">Número</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {attr.type === "select" && (
                      <Field label="Opciones" htmlFor={`attr-opts-${i}`} helper='Separadas por coma: "S, M, L, XL"' className="col-span-2">
                        <Input id={`attr-opts-${i}`} value={attr.options} onChange={(e) => updateAttr(i, { options: e.target.value })} placeholder="S, M, L, XL" />
                      </Field>
                    )}
                    <div className="col-span-2">
                      <Checkbox id={`attr-req-${i}`} checked={attr.isRequired} onChange={(e) => updateAttr(i, { isRequired: e.target.checked })} label="Obligatorio" />
                    </div>
                  </div>
                  <button type="button" onClick={() => removeAttr(i)} className="mt-6 p-1.5 rounded-sm text-text-subtle hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-50)] transition-colors duration-(--duration-fast)" aria-label={`Eliminar atributo ${attr.name}`}>
                    <Trash size={14} />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addAttr}>
              <Plus size={13} />Agregar atributo
            </Button>
          </TabsContent>

          {/* ── Suppliers tab ── */}
          <TabsContent value="proveedores">
            <p className="text-sm text-text-muted mb-4">
              Asocia proveedores con su precio unitario referencial. El proveedor preferido se usará por defecto al crear órdenes de compra.
            </p>
            {state.fieldErrors?.suppliers && (
              <p className="mb-4 text-sm text-danger">{state.fieldErrors.suppliers[0]}</p>
            )}
            {suppRows.length === 0 && (
              <p className="text-sm text-text-subtle mb-4">Sin proveedores asociados.</p>
            )}
            <div className="flex flex-col gap-3 mb-4">
              {suppRows.map((sr, i) => (
                <div key={sr.id} className="flex gap-2 items-start p-3 rounded-(--radius) border border-border bg-surface-2">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <p className="text-sm font-medium text-text">{sr.supplierName}</p>
                    </div>
                    <Field label="Precio unitario (CLP)" htmlFor={`sup-price-${i}`}>
                      <Input id={`sup-price-${i}`} type="number" min="0" step="1" value={sr.unitPrice} onChange={(e) => updateSupp(i, { unitPrice: e.target.value })} placeholder="0" className="font-mono" />
                    </Field>
                    <Field label="Notas" htmlFor={`sup-notes-${i}`}>
                      <Input id={`sup-notes-${i}`} value={sr.notes} onChange={(e) => updateSupp(i, { notes: e.target.value })} placeholder="Tiempo de entrega..." />
                    </Field>
                    <div className="col-span-2">
                      <Checkbox id={`sup-pref-${i}`} checked={sr.isPreferred} onChange={(e) => updateSuppPreferred(i, e.target.checked)} label="Proveedor preferido" />
                    </div>
                  </div>
                  <button type="button" onClick={() => removeSupp(i)} className="mt-6 p-1.5 rounded-sm text-text-subtle hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-50)] transition-colors duration-(--duration-fast)" aria-label={`Eliminar proveedor ${sr.supplierName}`}>
                    <Trash size={14} />
                  </button>
                </div>
              ))}
            </div>
            {availableSuppliers.length > 0 && (
              <Select onValueChange={addSupp}>
                <SelectTrigger className="max-w-xs h-8 text-xs">
                  <SelectValue placeholder="Agregar proveedor..." />
                </SelectTrigger>
                <SelectContent>
                  {availableSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </TabsContent>
        </Tabs>
      )}
    </CatalogFormSheet>
  )

  return formNode
}
