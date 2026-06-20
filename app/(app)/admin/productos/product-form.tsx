"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { Plus, Trash } from "@phosphor-icons/react"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
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
import { cn } from "@/lib/utils"

interface Category  { id: string; name: string; slug: string }
interface Supplier  { id: string; name: string }
interface AttributeRow { id?: string; name: string; type: "text" | "select" | "number"; isRequired: boolean; options: string; sortOrder: number }
interface SupplierRow  { id?: string; supplierId: string; supplierName: string; unitPrice: string; isPreferred: boolean; notes: string }

interface ProductForEdit {
  id:                 string
  sku:                string
  name:               string
  description:        string | null
  categoryId:         string
  unitOfMeasure:      string
  isEpp:              boolean
  requiresPrevencion: boolean
  referencePrice:     number | null
  notes:              string | null
  isActive:           boolean
  attributes:         AttributeRow[]
  suppliers:          SupplierRow[]
}

interface ProductFormProps {
  open:          boolean
  onClose:       () => void
  categories:    Category[]
  allSuppliers:  Supplier[]
  editProduct?:  ProductForEdit | null
  variant?:      "sheet" | "embedded"
}

const UOM_OPTIONS = ["unidad", "par", "caja", "paquete", "rollo", "metro", "kg", "litro", "juego", "set"]

export function ProductForm({ open, onClose, categories, allSuppliers, editProduct, variant = "sheet" }: ProductFormProps) {
  const isEdit = !!editProduct
  const action = isEdit ? updateProduct : createProduct
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)

  const [categoryId, setCategoryId] = React.useState(editProduct?.categoryId ?? "")
  const [uom,        setUom]        = React.useState(editProduct?.unitOfMeasure ?? "unidad")
  const [attrs,      setAttrs]      = React.useState<AttributeRow[]>(editProduct?.attributes ?? [])
  const [suppRows,   setSuppRows]   = React.useState<SupplierRow[]>(editProduct?.suppliers ?? [])

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Producto actualizado" : "Producto creado"))
      onClose()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  function addAttr() {
    setAttrs((prev) => [...prev, { name: "", type: "text", isRequired: false, options: "", sortOrder: prev.length }])
  }
  function removeAttr(i: number) { setAttrs((prev) => prev.filter((_, idx) => idx !== i)) }
  function updateAttr(i: number, patch: Partial<AttributeRow>) {
    setAttrs((prev) => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }

  function addSupp(supplierId: string) {
    const sup = allSuppliers.find((s) => s.id === supplierId)
    if (!sup || suppRows.find((r) => r.supplierId === supplierId)) return
    setSuppRows((prev) => [...prev, { supplierId: sup.id, supplierName: sup.name, unitPrice: "", isPreferred: false, notes: "" }])
  }
  function removeSupp(i: number) { setSuppRows((prev) => prev.filter((_, idx) => idx !== i)) }
  function updateSupp(i: number, patch: Partial<SupplierRow>) {
    setSuppRows((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  const availableSuppliers = allSuppliers.filter((s) => !suppRows.find((r) => r.supplierId === s.id))
  const formNode = (
    <form
      action={formAction}
      className={cn(
        variant === "embedded" &&
          "overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]",
      )}
    >
      {isEdit && <input type="hidden" name="id" value={editProduct.id} />}
      <input type="hidden" name="categoryId"    value={categoryId} />
      <input type="hidden" name="unitOfMeasure" value={uom} />
      <input type="hidden" name="attributesJson" value={JSON.stringify(attrs)} />
      <input type="hidden" name="suppliersJson"  value={JSON.stringify(suppRows.map((s) => ({
        supplierId:  s.supplierId,
        unitPrice:   s.unitPrice ? parseFloat(s.unitPrice) : null,
        isPreferred: s.isPreferred,
        notes:       s.notes || null,
      })))} />

      {variant === "embedded" ? (
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 md:flex-row md:items-start md:justify-between md:px-6">
          <div>
            <h2 className="text-h2 text-[var(--color-text)]">{isEdit ? "Editar producto" : "Nuevo producto"}</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {isEdit ? `Modificar ${editProduct.name}` : "Registra un producto del catálogo sin perder el contexto de administración."}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver al catálogo
          </Button>
        </div>
      ) : (
        <SheetHeader>
          <div>
            <SheetTitle>{isEdit ? "Editar producto" : "Nuevo producto"}</SheetTitle>
            <SheetDescription>
              {isEdit ? `Modificar ${editProduct.name}` : "Registra un nuevo producto en el catálogo"}
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
      )}

      <SheetBody className={variant === "embedded" ? "overflow-visible px-5 py-5 md:px-6" : undefined}>
        {state.message && !state.ok && !state.fieldErrors && (
          <p className="mb-4 text-sm text-danger">{state.message}</p>
        )}

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
              <div className="grid grid-cols-2 gap-4">
                <Field label="SKU" htmlFor="p-sku" required error={state.fieldErrors?.sku?.[0]}>
                  <Input id="p-sku" name="sku" defaultValue={editProduct?.sku ?? ""} placeholder="EPP-CASCO-001" error={!!state.fieldErrors?.sku} className="font-mono" />
                </Field>
                <Field label="Categoría" htmlFor="p-cat" required error={state.fieldErrors?.categoryId?.[0]}>
                  <Select value={categoryId} onValueChange={setCategoryId}>
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
              </div>

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
                      {UOM_OPTIONS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
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
                <Checkbox id="p-epp" name="isEpp" value="on" defaultChecked={editProduct?.isEpp ?? false} label="Es EPP" />
                <Checkbox id="p-prev" name="requiresPrevencion" value="on" defaultChecked={editProduct?.requiresPrevencion ?? false} label="Requiere aprobación de Prevención" />
                <Checkbox id="p-active" name="isActive" value="on" defaultChecked={editProduct?.isActive ?? true} label="Producto activo" />
              </div>
            </FieldGroup>
          </TabsContent>

          {/* ── Attributes tab ── */}
          <TabsContent value="atributos">
            <p className="text-sm text-text-muted mb-4">
              Los atributos definen los campos adicionales que se solicitan al incluir este producto en una solicitud (talla, color, modelo, medida, etc.).
            </p>
            {attrs.length === 0 && (
              <p className="text-sm text-text-subtle mb-4">Sin atributos definidos.</p>
            )}
            <div className="flex flex-col gap-3 mb-4">
              {attrs.map((attr, i) => (
                <div key={i} className="flex gap-2 items-start p-3 rounded-(--radius) border border-border bg-surface-2">
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
            {suppRows.length === 0 && (
              <p className="text-sm text-text-subtle mb-4">Sin proveedores asociados.</p>
            )}
            <div className="flex flex-col gap-3 mb-4">
              {suppRows.map((sr, i) => (
                <div key={i} className="flex gap-2 items-start p-3 rounded-(--radius) border border-border bg-surface-2">
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
                      <Checkbox id={`sup-pref-${i}`} checked={sr.isPreferred} onChange={(e) => updateSupp(i, { isPreferred: e.target.checked })} label="Proveedor preferido" />
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
      </SheetBody>

      <SheetFooter className={variant === "embedded" ? "bg-[var(--color-surface-2)]" : undefined}>
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <SubmitButton
          label={isEdit ? "Guardar cambios" : "Crear producto"}
          loadingLabel={isEdit ? "Guardando..." : "Creando..."}
        />
      </SheetFooter>
    </form>
  )

  if (variant === "embedded") return formNode

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        {formNode}
      </SheetContent>
    </Sheet>
  )
}
