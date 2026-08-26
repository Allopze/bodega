"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react"
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
import { parseOptionsText, generateVariantCombos, canAdvanceWizard, shouldShowConfirmClose, getStepAnimationClass } from "./product-form.helpers"
import type { ProductFormProps, WizardStep, WizardGeneralState, WizardSupplierState, AttributeMultiValues, VariantCombo } from "./product-form.types"

/** Máximo de variantes que se pueden generar de una sola vez. */
const VARIANT_LIMIT = 500
/** Cantidad a partir de la cual se muestra una advertencia visual. */
const VARIANT_WARN_AT = 400

export function ProductForm({ open, onClose, categories, allSuppliers, units, templates, editProduct, variant = "sheet" }: ProductFormProps) {
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
  const [variants, setVariants] = React.useState<VariantCombo[]>(() => {
    if (!editProduct) return []
    // On edit, reconstruct a single variant from the product's attributes
    const attrs = editProduct.attributes.map((a) => ({ name: a.name, value: parseOptionsText(a.options).join(", ") }))
    return [{ sku: editProduct.sku, name: editProduct.name, attributes: attrs }]
  })
  const [supplier, setSupplier] = React.useState<WizardSupplierState>({
    supplierId: editProduct?.suppliers[0]?.supplierId ?? "",
    unitPrice: editProduct?.suppliers[0]?.unitPrice ?? "",
    notes: editProduct?.suppliers[0]?.notes ?? "",
    hasSupplier: (editProduct?.suppliers.length ?? 0) > 0,
  })

  // ── Derived: unit options ─────────────────────────────────────────────────
  const unitOptions = React.useMemo(() => {
    if (!general.unitOfMeasure || units.some((unit) => unit.code === general.unitOfMeasure)) return units
    return [{ code: general.unitOfMeasure, label: `${general.unitOfMeasure} (heredada)`, isActive: false }, ...units]
  }, [units, general.unitOfMeasure])

  // ── Category change auto-detects EPP flags (only for new products) ────────
  function handleCategoryChange(id: string) {
    setGeneral((prev) => ({ ...prev, categoryId: id }))
    if (isEdit) return
    const category = categories.find((c) => c.id === id)
    if (!category) return
    setGeneral((prev) => ({ ...prev, isEpp: category.isEpp ?? false, requiresPrevencion: category.requiresPrevencion ?? false }))
    // Load attribute templates for this category
    const categoryTemplates = templates.filter((t) => !t.categoryId || t.categoryId === id)
    if (categoryTemplates.length > 0) {
      const loaded: AttributeMultiValues[] = categoryTemplates
        .filter((t) => t.type === "select")
        .map((t) => ({ name: t.name, type: "select", values: parseOptionsText(t.options), sizeFamily: t.sizeFamily }))
      setWizAttrs((prev) => {
        const existing = new Set(prev.map((a) => a.name))
        return [...prev, ...loaded.filter((a) => !existing.has(a.name))]
      })
    }
  }

  // ── Attribute management ──────────────────────────────────────────────────
  function toggleAttrPreset(preset: { name: string; options: string[]; sizeFamily?: string }) {
    setGeneral((prev) => ({ ...prev, isEpp: true }))
    setWizAttrs((prev) => {
      if (prev.some((a) => a.name === preset.name)) {
        return prev.filter((a) => a.name !== preset.name)
      }
      return [...prev, { name: preset.name, type: "select", values: [], sizeFamily: preset.sizeFamily }]
    })
  }

  function updateAttrValues(name: string, values: string[]) {
    setWizAttrs((prev) => prev.map((a) => (a.name === name ? { ...a, values } : a)))
    // Clear generated variants if all values for this attribute were deselected
    if (values.length === 0) {
      setVariants([])
    }
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index))
  }

  function generateVariants(): boolean {
    setStepError(null)
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
    if (step === 2 && wizAttrs.length > 0) {
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
        referencePrice: general.referencePrice ? parseFloat(general.referencePrice) : null,
        notes: general.notes || undefined,
        isActive: general.isActive,
        attributes: wizAttrs.map((a, i) => ({
          name: a.name, type: "select", options: JSON.stringify(a.values), sizeFamily: a.sizeFamily, sortOrder: i,
        })),
        variants: variants.map((v) => ({
          name: v.name, attributes: v.attributes,
        })),
        supplier: supplier.hasSupplier && supplier.supplierId
          ? { supplierId: supplier.supplierId, unitPrice: supplier.unitPrice ? parseFloat(supplier.unitPrice) : null, notes: supplier.notes || undefined }
          : undefined,
      }
      const result = await createProductVariantBatch(input)
      setBatchPending(false)
      if (result.ok) {
        toast.success(result.message ?? "Productos creados")
        onClose()
      } else if (result.message) {
        toast.error(result.message)
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
                onChange={(e) => { markDirty(); setGeneral((p) => ({ ...p, name: e.target.value })) }}
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
          </FieldGroup>
        )

      case 2:
        return (
          <div className="space-y-4">
            <VariantGenerator
              wizAttrs={wizAttrs}
              isEpp={general.isEpp}
              onToggleAttr={toggleAttrPreset}
              onUpdateAttrValues={updateAttrValues}
              onGenerate={generateVariants}
              generating={generatingVariants}
              variantLimit={VARIANT_LIMIT}
              variantWarnAt={VARIANT_WARN_AT}
              onMarkDirty={markDirty}
            />
            <VariantPreview
              variants={variants}
              onRemove={removeVariant}
              onMarkDirty={markDirty}
            />
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
      {variant === "embedded" ? (
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 md:flex-row md:items-start md:justify-between md:px-6">
          <div>
            <h2 className="text-h2 text-[var(--color-text)]">{title}</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{description}</p>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver al catálogo
          </Button>
        </div>
      ) : (
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
        <input type="hidden" name="attributesJson" value={JSON.stringify(
          variants.length > 0
            ? variants[0]!.attributes.map((a, i) => ({
              name: a.name, type: "select" as const, isRequired: true, options: a.value, sortOrder: i,
            }))
            : wizAttrs.map((a, i) => ({
              name: a.name, type: "select" as const, isRequired: true, options: a.values.join(", "), sortOrder: i,
            }))
        )} />
        <input type="hidden" name="suppliersJson" value={JSON.stringify(
          supplier.hasSupplier && supplier.supplierId
            ? [{ supplierId: supplier.supplierId, unitPrice: supplier.unitPrice ? parseFloat(supplier.unitPrice) : null, isPreferred: true, notes: supplier.notes || null }]
            : []
        )} />

        {/* Step indicator (hidden on edit, since it's not a step flow) */}
        {!isEdit && <StepIndicator currentStep={step} />}

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
            <Button type="button" onClick={nextStep}>
              Siguiente <ArrowRight size={14} className="ml-1" />
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={prevStep}>
              <ArrowLeft size={14} className="mr-1" /> Anterior
            </Button>
            {variants.length > 1 ? (
              <Button type="submit" disabled={batchPending}>
                {batchPending ? "Creando productos..." : `Crear ${variants.length} productos`}
              </Button>
            ) : (
              <SubmitButton label="Crear producto" loadingLabel="Creando..." />
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
