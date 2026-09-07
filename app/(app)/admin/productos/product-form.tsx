"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { ArrowLeft, ArrowRight, X } from "@phosphor-icons/react"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { SubmitButton } from "@/components/ui/submit-button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { createProduct, updateProduct, createProductVariantBatch, type ProductVariantBatchInput } from "./actions"
import { StepIndicator } from "./epp-wizard-steps"
import { VariantGenerator } from "./epp-variant-generator"
import { VariantPreview } from "./epp-variant-preview"
import {
  parseOptionsText, buildSingleVariantAttributes, generateVariantCombos, canAdvanceWizard, shouldShowConfirmClose, getStepAnimationClass,
  pickPrimarySupplier, otherSuppliers, buildSuppliersForSubmit, mergeEditAttributes,
  ADVANCED_ATTRIBUTE_TYPES, blankAdvancedAttribute, setQuantityDriver, duplicateAttributeNames,
  normalizeProductAttributeName, type AdvancedAttributeType,
} from "./product-form.helpers"
import type { ProductFormProps, WizardStep, WizardGeneralState, WizardSupplierState, AttributeMultiValues, VariantCombo, SupplierRow, AttributeRow } from "./product-form.types"

const ADVANCED_TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  number: "Número",
  integer: "Conteo",
}

/** Máximo de variantes que se pueden generar de una sola vez. */
const VARIANT_LIMIT = 500
/** Cantidad a partir de la cual se muestra una advertencia visual. */
const VARIANT_WARN_AT = 400

export function ProductForm({ open, onClose, categories, allSuppliers, units, templates, sizeFamilies, editProduct, variant = "sheet" }: ProductFormProps) {
  const isEdit = !!editProduct
  const action = isEdit ? updateProduct : createProduct

  // ── Common form action state (for edit / single create) ────────────────────
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

  // ─── Dirty state tracking ────────────────────────────────────────────────
  const [isDirty, setIsDirty] = React.useState(false)
  const [confirmClose, setConfirmClose] = React.useState(false)

  /** Ref to prevent infinite loop when ConfirmDialog's 'Descartar' calls onClose().
   *  In React 18+, state updates are batched, so setIsDirty(false) hasn't taken
   *  effect when Radix fires onOpenChange(false) → handleClose() synchronously.
   *  A ref is synchronous and prevents the re-trigger immediately. */
  const closingRef = React.useRef(false)

  /** Mark the form as dirty on first interaction. */
  function markDirty() {
    if (!isDirty) setIsDirty(true)
  }

  function handleClose() {
    const action = shouldShowConfirmClose(isDirty, isEdit, closingRef.current)
    if (action === "already-closing") {
      closingRef.current = false
      onClose()
      return
    }
    if (action === "show-confirm") {
      setConfirmClose(true)
    } else {
      onClose()
    }
  }

  // ─── Batch creation state ─────────────────────────────────────────────────
  const [batchPending, setBatchPending] = React.useState(false)
  const [generatingVariants, setGeneratingVariants] = React.useState(false)

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [stepDirection, setStepDirection] = React.useState<"forward" | "backward">("forward")
  const [step, setStep] = React.useState<WizardStep>(1)
  const [general, setGeneral] = React.useState<WizardGeneralState>({
    categoryId: editProduct?.categoryId ?? "",
    name: editProduct?.name ?? "",
    description: editProduct?.description ?? "",
    unitOfMeasure: editProduct?.unitOfMeasure ?? "unidad",
    referencePrice: editProduct?.referencePrice != null ? String(editProduct.referencePrice) : "",
    notes: editProduct?.notes ?? "",
    isEpp: editProduct?.isEpp ?? false,
    requiresPrevencion: editProduct?.requiresPrevencion ?? false,
    isService: editProduct?.isService ?? false,
    requiresWorker: editProduct?.requiresWorker ?? false,
    equipmentKind: editProduct?.equipmentKind ?? "",
    isActive: editProduct?.isActive ?? true,
  })
  const [wizAttrs, setWizAttrs] = React.useState<AttributeMultiValues[]>(() => {
    if (!editProduct) return []
    return editProduct.attributes
      .filter((a) => a.type === "select")
      .map((a) => ({ name: a.name, type: "select" as const, values: parseOptionsText(a.options), sizeFamily: a.sizeFamily }))
  })
  // Atributos que NO son ejes de variante: `text`/`number`/`integer`, incluido
  // el que gobierna la cantidad. El paso 2 es dueño de los `select`; este
  // estado es dueño del resto, así que los dos editores nunca tocan la misma
  // fila (ver `mergeEditAttributes`).
  const [advAttrs, setAdvAttrs] = React.useState<AttributeRow[]>(() =>
    editProduct?.attributes.filter((a) => a.type !== "select") ?? [],
  )
  const [variants, setVariants] = React.useState<VariantCombo[]>(() => {
    if (!editProduct) return []
    // On edit, reconstruct a single variant from the product's attributes
    const attrs = editProduct.attributes.map((a) => ({ name: a.name, value: parseOptionsText(a.options).join(", ") }))
    return [{ sku: editProduct.sku, name: editProduct.name, attributes: attrs }]
  })
  // The wizard's "Proveedor" step edits a single slot — the preferred
  // supplier if there is one, else the first. Every other supplier the
  // product already has is preserved untouched in `otherSuppliersState` and
  // merged back in on submit (see `buildSuppliersForSubmit`), so saving an
  // edit doesn't silently drop suppliers this UI can't show.
  const [otherSuppliersState] = React.useState<SupplierRow[]>(() => {
    const initial = editProduct?.suppliers ?? []
    return otherSuppliers(initial, pickPrimarySupplier(initial))
  })
  const [supplier, setSupplier] = React.useState<WizardSupplierState>(() => {
    const primary = pickPrimarySupplier(editProduct?.suppliers ?? [])
    return {
      supplierId: primary?.supplierId ?? "",
      unitPrice: primary?.unitPrice ?? "",
      notes: primary?.notes ?? "",
      hasSupplier: !!primary,
    }
  })

  // ── Derived: unit options ─────────────────────────────────────────────────
  const unitOptions = React.useMemo(() => {
    if (!general.unitOfMeasure || units.some((unit) => unit.code === general.unitOfMeasure)) return units
    return [{ code: general.unitOfMeasure, label: `${general.unitOfMeasure} (heredada)`, isActive: false }, ...units]
  }, [units, general.unitOfMeasure])

  // ── Category change auto-detects EPP flags (only for new products) ────────
  function handleCategoryChange(id: string) {
    setVariants([])
    setGeneral((prev) => ({ ...prev, categoryId: id }))
    if (isEdit) return
    const category = categories.find((c) => c.id === id)
    if (!category) return
    setGeneral((prev) => ({ ...prev, isEpp: category.isEpp ?? false, requiresPrevencion: category.requiresPrevencion ?? false }))
    // Plantillas de atributos de la categoría. Se reparten igual que los dos
    // editores: las `select` son ejes de variante (paso 2) y el resto va al
    // editor avanzado. Antes las no-`select` se filtraban y se perdían, así que
    // una plantilla de tipo texto o número no servía para nada.
    const categoryTemplates = templates.filter((t) => !t.categoryId || t.categoryId === id)
    if (categoryTemplates.length > 0) {
      const loadedSelect: AttributeMultiValues[] = categoryTemplates
        .filter((t) => t.type === "select")
        .map((t) => ({ name: t.name, type: "select", values: parseOptionsText(t.options), sizeFamily: t.sizeFamily }))
      setWizAttrs((prev) => {
        const existing = new Set(prev.map((a) => normalizeProductAttributeName(a.name)))
        return [...prev, ...loadedSelect.filter((a) => !existing.has(normalizeProductAttributeName(a.name)))]
      })

      const loadedAdvanced: AttributeRow[] = categoryTemplates
        .filter((t) => t.type !== "select")
        .map((t, i) => ({
          name: t.name, type: t.type, isRequired: t.isRequired,
          options: "", sortOrder: t.sortOrder ?? i, drivesQuantity: false,
        }))
      setAdvAttrs((prev) => {
        const existing = new Set(prev.map((a) => normalizeProductAttributeName(a.name)))
        return [...prev, ...loadedAdvanced.filter((a) => !existing.has(normalizeProductAttributeName(a.name)))]
      })
    }
  }

  // ── Attribute management ──────────────────────────────────────────────────
  // No fuerza `isEpp`: la categoría ya gobierna ese flag en
  // `handleCategoryChange`, y agregar un atributo de talla a un producto que no
  // es EPP no debería convertirlo en uno.
  function toggleAttrPreset(preset: { name: string; options: string[]; sizeFamily?: string }) {
    setVariants([])
    setWizAttrs((prev) => {
      if (prev.some((a) => normalizeProductAttributeName(a.name) === normalizeProductAttributeName(preset.name))) {
        return prev.filter((a) => normalizeProductAttributeName(a.name) !== normalizeProductAttributeName(preset.name))
      }
      return [...prev, { name: preset.name, type: "select", values: [], sizeFamily: preset.sizeFamily }]
    })
  }

  function updateAttrValues(name: string, values: string[]) {
    setWizAttrs((prev) => prev.map((a) => (a.name === name ? { ...a, values } : a)))
    setVariants([])
  }

  // Quitar un atributo cualquiera, sea preset o venido de una plantilla de
  // categoría. No pasa por `toggleAttrPreset` porque ese además fuerza
  // `isEpp = true`, y borrar una fila no debería convertir el producto en EPP.
  function removeAttr(name: string) {
    setWizAttrs((prev) => prev.filter((a) => a.name !== name))
    setVariants([])
  }

  // ── Advanced (non-select) attribute management ────────────────────────────
  const duplicateNames = React.useMemo(
    () => duplicateAttributeNames(wizAttrs, advAttrs),
    [wizAttrs, advAttrs],
  )
  // Una fila recién agregada y nunca completada no debe convertirse en atributo:
  // `name` vacío haría fallar la validación del servidor sin que el usuario
  // entienda por qué.
  // El `type !== "select"` es a la vez estrechamiento de tipo y red de
  // seguridad: los `select` son del paso 2, y si alguno se colara acá los dos
  // editores serían dueños de la misma fila.
  const submittableAdvAttrs = React.useMemo(
    () => advAttrs.filter(
      (a): a is AttributeRow & { type: AdvancedAttributeType } =>
        a.name.trim().length > 0 && a.type !== "select",
    ),
    [advAttrs],
  )

  function updateAdvAttr(index: number, patch: Partial<AttributeRow>) {
    markDirty()
    setAdvAttrs((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function toggleAdvDriver(index: number, checked: boolean) {
    markDirty()
    setAdvAttrs((prev) => setQuantityDriver(prev, index, checked))
  }

  function addAdvAttr() {
    markDirty()
    setAdvAttrs((prev) => [...prev, blankAdvancedAttribute(prev.length)])
  }

  function removeAdvAttr(index: number) {
    markDirty()
    setAdvAttrs((prev) => prev.filter((_, i) => i !== index))
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index))
  }

  function generateVariants(): boolean {
    setStepError(null)
    if (wizAttrs.some((a) => a.values.length === 0)) {
      setStepError("Selecciona al menos un valor en cada atributo o quita el atributo.")
      return false
    }
    const comboCount = wizAttrs.reduce((acc, a) => acc * Math.max(a.values.length, 1), 1)
    if (comboCount > VARIANT_LIMIT) {
      setStepError(`Demasiadas combinaciones (${comboCount}). El máximo permitido es ${VARIANT_LIMIT}.`)
      return false
    }
    setGeneratingVariants(true)
    // Use setTimeout to yield to React so the loading state renders before computation
    setTimeout(() => {
      const combos = generateVariantCombos(general.name, wizAttrs)
      setVariants(combos)
      setGeneratingVariants(false)
    }, 0)
    return true
  }

  // ── Step navigation ──────────────────────────────────────────────────────
  const [stepError, setStepError] = React.useState<string | null>(null)

  function nextStep() {
    setStepError(null)
    if (!canAdvanceWizard(step, general)) {
      setStepError("Completa los campos requeridos antes de continuar.")
      return
    }
    setStepDirection("forward")
    // Regenerate variants when advancing from step 2, but block if limit exceeded
    if (step === 2 && wizAttrs.length > 0 && variants.length === 0) {
      if (!generateVariants()) return
    }
    setStep((s) => Math.min(3, s + 1) as WizardStep)
  }

  function prevStep() {
    setStepError(null)
    setStepDirection("backward")
    setStep((s) => Math.max(1, s - 1) as WizardStep)
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    setStepError(null)
    if (!isEdit && step !== 3) { event.preventDefault(); nextStep(); return }
    if (duplicateNames.size > 0 || wizAttrs.some((a) => a.values.length === 0)) {
      event.preventDefault()
      setStepError("Revisa los atributos: sus nombres deben ser únicos y cada variante debe tener un valor.")
      return
    }
    if (generatingVariants || batchPending) { event.preventDefault(); return }

    // ── Batch path: intercept and call createProductVariantBatch directly ──
    if (!isEdit && variants.length > 1) {
      event.preventDefault()
      setBatchPending(true)
      const input: ProductVariantBatchInput = {
        categoryId: general.categoryId,
        familyName: general.name,
        description: general.description || undefined,
        unitOfMeasure: general.unitOfMeasure,
        isEpp: general.isEpp,
        requiresPrevencion: general.requiresPrevencion,
        isService: general.isService,
        requiresWorker: general.requiresWorker,
        equipmentKind: general.isService ? general.equipmentKind : "",
        referencePrice: general.referencePrice ? parseFloat(general.referencePrice) : null,
        notes: general.notes || undefined,
        isActive: general.isActive,
        attributes: wizAttrs.map((a, i) => ({
          name: a.name, type: "select", options: JSON.stringify(a.values), sizeFamily: a.sizeFamily, sortOrder: i,
        })),
        // Único camino por el que un driver de cantidad llega a un producto
        // creado por lote. El índice único es por producto, así que un driver
        // por variante es legal.
        advancedAttributes: submittableAdvAttrs.map((a, i) => ({
          name: a.name, type: a.type, isRequired: a.isRequired,
          drivesQuantity: a.drivesQuantity ?? false,
          sortOrder: wizAttrs.length + i,
        })),
        variants: variants.map((v) => ({
          name: v.name, attributes: v.attributes,
        })),
        supplier: supplier.hasSupplier && supplier.supplierId
          ? { supplierId: supplier.supplierId, unitPrice: supplier.unitPrice ? parseFloat(supplier.unitPrice) : null, notes: supplier.notes || undefined }
          : undefined,
      }
      try {
        const result = await createProductVariantBatch(input)
        if (result.ok) {
          toast.success(result.message ?? "Productos creados")
          onClose()
        } else if (result.message) {
          toast.error(result.message)
        }
      } catch {
        toast.error("No se pudo crear el lote. Revisa la conexión e inténtalo nuevamente.")
      } finally {
        // Si la acción rechaza (red caída, excepción del servidor) el reset no
        // se ejecutaba y el formulario quedaba bloqueado hasta recargar.
        setBatchPending(false)
      }
      return
    }

    // ── Single / Edit path: let native formAction handle it via hidden fields ──
  }

  // ── Form content by step ──────────────────────────────────────────────────
  function renderStepContent() {
    switch (step) {
      case 1:
        return (
          <FieldGroup className="gap-4">
            {isEdit && (
              <div className="rounded-(--radius) bg-(--color-surface-2) px-3 py-2 text-sm">
                <span className="text-(--color-text-subtle)">SKU asignado: </span>
                <span className="font-mono font-medium text-(--color-text)">{editProduct!.sku}</span>
              </div>
            )}

            <Field label="Categoría" htmlFor="p-cat" required error={state.fieldErrors?.categoryId?.[0]}>
              <Select value={general.categoryId} onValueChange={(id) => { markDirty(); handleCategoryChange(id) }}>
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
              <Input
                id="p-name"
                value={general.name}
                onChange={(e) => { markDirty(); setVariants([]); setGeneral((p) => ({ ...p, name: e.target.value })) }}
                placeholder="Casco de seguridad blanco clase A"
                error={!!state.fieldErrors?.name}
              />
            </Field>

            <Field label="Descripción" htmlFor="p-desc">
              <Textarea
                id="p-desc"
                value={general.description}
                onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, description: e.target.value })) }}
                placeholder="Descripción del producto..."
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Unidad de medida" htmlFor="p-uom" required>
                <Select value={general.unitOfMeasure} onValueChange={(v) => { markDirty(); setGeneral((p) => ({ ...p, unitOfMeasure: v })) }}>
                  <SelectTrigger id="p-uom"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((unit) => <SelectItem key={unit.code} value={unit.code}>{unit.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Precio ref. (CLP)" htmlFor="p-price">
                <Input
                  id="p-price"
                  type="number" min="0" step="1"
                  value={general.referencePrice}
                  onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, referencePrice: e.target.value })) }}
                  placeholder="0"
                  className="font-mono"
                />
              </Field>
            </div>

            <Field label="Notas" htmlFor="p-notes">
              <Textarea
                id="p-notes"
                value={general.notes}
                onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, notes: e.target.value })) }}
                placeholder="Observaciones, variantes aceptadas..."
                rows={2}
              />
            </Field>

            <div className="flex flex-col gap-2">
              <Checkbox
                id="p-epp"
                checked={general.isEpp}
                onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, isEpp: e.target.checked })) }}
                label="Es EPP"
              />
              <Checkbox
                id="p-prev"
                checked={general.requiresPrevencion}
                onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, requiresPrevencion: e.target.checked })) }}
                label="Requiere aprobación de Prevención"
              />
              {/* Un servicio se solicita sin precio: su costo se conoce al
                  ejecutarlo y se registra sobre la línea de la OC. */}
              <Checkbox
                id="p-service"
                checked={general.isService}
                onChange={(e) => {
                  markDirty()
                  setGeneral((p) => ({
                    ...p,
                    isService: e.target.checked,
                    // Un servicio no puede exigir colaborador si deja de serlo.
                    requiresWorker: e.target.checked ? p.requiresWorker : false,
                  }))
                }}
                label="Es un servicio (costo pendiente al solicitar)"
              />
              {general.isService && (
                <Field
                  label="Familia de equipos que atiende"
                  htmlFor="p-equipment-kind"
                  helper="Sin espacios ni tildes (monogas, alcotest). Vacío = el servicio no es sobre un equipo."
                  error={state.fieldErrors?.equipmentKind?.[0]}
                  className="mt-1 ml-6 max-w-xs"
                >
                  <Input
                    id="p-equipment-kind"
                    value={general.equipmentKind}
                    onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, equipmentKind: e.target.value })) }}
                    placeholder="monogas"
                  />
                </Field>
              )}
              {general.isService && (
                <Checkbox
                  id="p-worker"
                  checked={general.requiresWorker}
                  onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, requiresWorker: e.target.checked })) }}
                  label="Se solicita para un colaborador concreto"
                  className="ml-6"
                />
              )}
              <Checkbox
                id="p-active"
                checked={general.isActive}
                onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, isActive: e.target.checked })) }}
                label="Producto activo"
              />
            </div>

            {/* Editor avanzado: inline y no un Sheet anidado — es estado del
                producto que debe enviarse atómicamente con él, y un Sheet
                dentro de otro pelearía con `isDirty`/`closingRef`. */}
            <details className="rounded-(--radius) border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">
                Atributos avanzados
                {submittableAdvAttrs.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-[var(--color-text-muted)]">
                    ({submittableAdvAttrs.length})
                  </span>
                )}
              </summary>

              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Datos que no generan variantes: un texto libre, una medida, o un conteo
                como el número de dosis. Las tallas y colores se definen en el paso siguiente.
              </p>

              <div className="mt-3 space-y-2">
                {advAttrs.map((attr, index) => {
                  const isDuplicate = attr.name.trim().length > 0
                    && duplicateNames.has(normalizeProductAttributeName(attr.name))
                  return (
                    <div key={index} className="rounded-(--radius-sm) border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-40 flex-1">
                          <Input
                            value={attr.name}
                            onChange={(e) => updateAdvAttr(index, { name: e.target.value })}
                            placeholder="Nombre (ej. Dosis)"
                            aria-label={`Nombre del atributo avanzado ${index + 1}`}
                            error={isDuplicate}
                            className="h-8 text-sm"
                          />
                        </div>
                        <Select
                          value={attr.type}
                          onValueChange={(value) => updateAdvAttr(index, { type: value as AttributeRow["type"] })}
                          disabled={attr.drivesQuantity}
                        >
                          <SelectTrigger className="h-8 w-32 text-sm" aria-label={`Tipo del atributo ${attr.name || index + 1}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ADVANCED_ATTRIBUTE_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>{ADVANCED_TYPE_LABELS[type]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          onClick={() => removeAdvAttr(index)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-(--radius-sm) text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
                          aria-label={`Quitar atributo ${attr.name || index + 1}`}
                        >
                          <X size={12} />
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-4">
                        <Checkbox
                          id={`adv-req-${index}`}
                          checked={attr.isRequired}
                          onChange={(e) => updateAdvAttr(index, { isRequired: e.target.checked })}
                          disabled={attr.drivesQuantity}
                          label="Obligatorio"
                        />
                        <Checkbox
                          id={`adv-drv-${index}`}
                          checked={attr.drivesQuantity ?? false}
                          onChange={(e) => toggleAdvDriver(index, e.target.checked)}
                          label="Su valor es la cantidad"
                        />
                      </div>

                      {isDuplicate && (
                        <p className="mt-1.5 text-xs text-[var(--color-danger)]">
                          Ya hay otro atributo con este nombre.
                        </p>
                      )}
                      {attr.drivesQuantity && (
                        <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                          La cantidad del ítem se toma de este atributo, así que debe ser un conteo entero y obligatorio.
                        </p>
                      )}
                    </div>
                  )
                })}

                <Button type="button" variant="ghost" size="sm" onClick={addAdvAttr}>
                  + Agregar atributo
                </Button>
              </div>
            </details>
          </FieldGroup>
        )

      case 2:
        return (
          <div className="space-y-4">
            <VariantGenerator
              singleVariant={isEdit}
              sizeFamilies={sizeFamilies}
              wizAttrs={wizAttrs}
              isEpp={general.isEpp}
              onToggleAttr={toggleAttrPreset}
              onUpdateAttrValues={updateAttrValues}
              onRemoveAttr={removeAttr}
              onGenerate={generateVariants}
              generating={generatingVariants}
              variantLimit={VARIANT_LIMIT}
              variantWarnAt={VARIANT_WARN_AT}
              onMarkDirty={markDirty}
            />
            {!isEdit && <VariantPreview
              variants={variants}
              onRemove={removeVariant}
              onMarkDirty={markDirty}
            />}
          </div>
        )

      case 3:
        return (
          <FieldGroup className="gap-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              Asocia un proveedor preferido al producto{isEdit ? "" : `. ${variants.length > 1 ? `El proveedor se asignará a las ${variants.length} variantes.` : ""}`}
            </p>

            <div className="flex items-center gap-3">
              <Checkbox
                id="p-has-supplier"
                checked={supplier.hasSupplier}
                onChange={(e) => { markDirty(); setSupplier((p) => ({ ...p, hasSupplier: e.target.checked })) }}
                label="Asignar proveedor"
              />
            </div>

            {supplier.hasSupplier && (
              <>
                <Field label="Proveedor" htmlFor="p-supplier" required>
                  <Select
                    value={supplier.supplierId}
                    onValueChange={(v) => { markDirty(); setSupplier((p) => ({ ...p, supplierId: v })) }}
                  >
                    <SelectTrigger id="p-supplier"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {allSuppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Precio unitario (CLP)" htmlFor="p-unit-price">
                  <Input
                    id="p-unit-price"
                    type="number" min="0" step="1"
                    value={supplier.unitPrice}
                    onChange={(e) => { markDirty(); setSupplier((p) => ({ ...p, unitPrice: e.target.value })) }}
                    placeholder="0"
                    className="font-mono"
                  />
                </Field>

                <Field label="Notas" htmlFor="p-sup-notes">
                  <Input
                    id="p-sup-notes"
                    value={supplier.notes}
                    onChange={(e) => { markDirty(); setSupplier((p) => ({ ...p, notes: e.target.value })) }}
                    placeholder="Tiempo de entrega..."
                  />
                </Field>
              </>
            )}

            {/* Summary */}
            <div className="rounded-(--radius) border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm space-y-1">
              <p><span className="text-[var(--color-text-subtle)]">Producto:</span> <span className="font-medium">{general.name}</span></p>
              {variants.length > 1 && (
                <p><span className="text-[var(--color-text-subtle)]">Variantes a crear:</span> <span className="font-medium">{variants.length}</span></p>
              )}
              {supplier.hasSupplier && supplier.supplierId && (
                <p><span className="text-[var(--color-text-subtle)]">Proveedor:</span> <span className="font-medium">{allSuppliers.find((s) => s.id === supplier.supplierId)?.name ?? supplier.supplierId}</span></p>
              )}
            </div>
          </FieldGroup>
        )
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const title = isEdit ? `Editar: ${editProduct!.name}` : "Nuevo producto"
  const description = isEdit
    ? `Modificar SKU ${editProduct!.sku}`
    : "Registra un nuevo producto en el catálogo"

  const formContent = (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
      {/* Header: variant-dependent */}
      {variant !== "embedded" && (
        <SheetHeader>
          <div>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
      )}

      <SheetBody className={variant === "embedded" ? "overflow-visible px-5 py-5 md:px-6" : undefined}>
          {/* Hidden fields for formAction-based submit (edit + single create) */}
        {isEdit && <input type="hidden" name="id" value={editProduct!.id} />}
        <input type="hidden" name="name" value={general.name} />
        <input type="hidden" name="description" value={general.description} />
        <input type="hidden" name="categoryId" value={general.categoryId} />
        <input type="hidden" name="unitOfMeasure" value={general.unitOfMeasure} />
        <input type="hidden" name="referencePrice" value={general.referencePrice} />
        <input type="hidden" name="notes" value={general.notes} />
        {general.isEpp && <input type="hidden" name="isEpp" value="on" />}
        {general.requiresPrevencion && <input type="hidden" name="requiresPrevencion" value="on" />}
        {general.isService && <input type="hidden" name="isService" value="on" />}
        {general.isService && general.requiresWorker && <input type="hidden" name="requiresWorker" value="on" />}
        {general.isService && <input type="hidden" name="equipmentKind" value={general.equipmentKind} />}
        {general.isActive && <input type="hidden" name="isActive" value="on" />}
        {/* Edit mode merges the wizard's `select`-only editor back into the
            product's full attribute set (mergeEditAttributes) so a non-select
            attribute — e.g. an `integer` quantity driver — survives a save
            instead of being silently converted to `select`. */}
        {/* Los `select` salen del paso 2 y todo lo demás del editor avanzado;
            en alta se concatenan, en edición los une `mergeEditAttributes`
            conservando id y sortOrder de los que ya existían. */}
        <input type="hidden" name="attributesJson" value={JSON.stringify(
          isEdit
            ? mergeEditAttributes(editProduct!.attributes, wizAttrs, advAttrs)
            : [
              ...buildSingleVariantAttributes(wizAttrs, variants[0]),
              ...submittableAdvAttrs.map((a, i) => ({ ...a, sortOrder: wizAttrs.length + i })),
            ]
        )} />
        <input type="hidden" name="suppliersJson" value={JSON.stringify(
          buildSuppliersForSubmit(supplier, otherSuppliersState)
        )} />

        {/* Step indicator (hidden on edit, since it's not a step flow) */}
        {!isEdit && <StepIndicator currentStep={step} />}
        {isEdit && (
          <nav aria-label="Secciones del producto" className="mb-4 flex gap-2">
            {(["General", "Talla y otros atributos", "Proveedor"] as const).map((label, index) => (
              <Button key={label} type="button" variant={step === index + 1 ? "primary" : "secondary"}
                aria-current={step === index + 1 ? "step" : undefined}
                onClick={() => setStep((index + 1) as WizardStep)}>{label}</Button>
            ))}
          </nav>
        )}
        {!state.ok && state.fieldErrors && (
          <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">
            {Object.values(state.fieldErrors).flat().join(". ")}
          </p>
        )}

        {stepError && (
          <p className="mb-4 text-sm text-[var(--color-danger)]">{stepError}</p>
        )}

        {state.message && !state.ok && !state.fieldErrors && (
          <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
        )}

        {/* Step content with direction-aware animation */}
        <div
          key={step}
          className={getStepAnimationClass(stepDirection)}
        >
          {renderStepContent()}
        </div>
      </SheetBody>

      {/* Footer */}
      <SheetFooter className={variant === "embedded" ? "bg-[var(--color-surface-2)]" : undefined}>
        {isEdit ? (
          <>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label="Guardar cambios" loadingLabel="Guardando..." />
          </>
        ) : step === 1 ? (
          <>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={nextStep} disabled={!canAdvanceWizard(step, general)}>
              Siguiente <ArrowRight size={14} className="ml-1" />
            </Button>
          </>
        ) : step < 3 ? (
          <>
            <Button type="button" variant="ghost" onClick={prevStep}>
              <ArrowLeft size={14} className="mr-1" /> Anterior
            </Button>
            {/* `key` distinto del botón de envío del paso 3: sin él React
                reconcilia los dos en el MISMO nodo del DOM y sólo le cambia el
                `type`. Como eso ocurre dentro del propio click de «Siguiente»,
                el botón ya era `type="submit"` cuando llegaba el `mouseup` y el
                navegador enviaba el formulario: al entrar al paso 3 se creaban
                los productos solos y el paso de proveedor no se podía usar. */}
            <Button key="wizard-next" type="button" onClick={nextStep}>
              Siguiente <ArrowRight size={14} className="ml-1" />
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={prevStep}>
              <ArrowLeft size={14} className="mr-1" /> Anterior
            </Button>
            {variants.length > 1 ? (
              <Button key="wizard-submit-batch" type="submit" disabled={batchPending}>
                {batchPending ? "Creando productos..." : `Crear ${variants.length} productos`}
              </Button>
            ) : (
              <SubmitButton key="wizard-submit-single" label="Crear producto" loadingLabel="Creando..." />
            )}
          </>
        )}
      </SheetFooter>
    </form>
  )

  if (variant === "embedded") return formContent

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
        <SheetContent className="sm:max-w-xl">{formContent}</SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="¿Descartar producto sin guardar?"
        description="Los datos que has ingresado se perderán si cierras este formulario."
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        variant="warning"
        onConfirm={() => {
          closingRef.current = true
          setConfirmClose(false)
          onClose()
        }}
      />
    </>
  )
}
