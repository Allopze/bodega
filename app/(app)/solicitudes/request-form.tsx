"use client"

import * as React from "react"
import { useActionState, useEffect, useRef, useState, useCallback, startTransition, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { ArrowLeft, Plus, Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { saveDraft, submitRequest, cancelRequest, deleteRequestAction } from "./actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DELETABLE_REQUEST_STATUSES } from "@/lib/services/requests-delete.constants"
import { Trash } from "@phosphor-icons/react"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { ItemEditor, URGENCY_OPTS } from "./item-editor"
import type { ActionState } from "@/lib/validation/operations"
import { formatDate } from "@/lib/utils"
import type { ItemRow, AttrRow, ProductOption, WorksiteOption, SupplierOption, EditRequest } from "./request-form.types"
import { QUOTATION_TYPES, visibleRequestTypeOptions } from "@/lib/request-types"

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTOSAVE_INTERVAL_MS = 60_000

interface AutosaveSnapshot {
  savedId:      string | undefined
  itemsJson:    string
  worksiteId:   string
  requestType:  string
  urgency:      string
  requiredDate: string
  notes:        string
  canSave:      boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function blankItem(key = "new-0"): ItemRow {
  return {
    _key:                key,
    productId:           null,
    productNameFree:     "",
    quantity:            "1",
    unitOfMeasure:       "unidad",
    urgency:             "normal",
    suggestedSupplierId: "",
    supplierHint:        "",
    notes:               "",
    attributes:          [],
    isEpp:               false,
    productName:         "",
    showAttrs:           false,
    cotizaciones:        [],
  }
}

function blankItemForType(key: string, requestType: string): ItemRow {
  if (requestType === "servicios") {
    return { ...blankItem(key), unitOfMeasure: "servicio" }
  }
  return blankItem(key)
}

function buildAttrsFromProduct(prod: ProductOption): AttrRow[] {
  return prod.attributes.map((a) => ({
    attributeId:   a.id,
    attributeName: a.name,
    value:         "",
    isRequired:    a.isRequired,
    type:          a.type,
    options:       a.options ? (JSON.parse(a.options) as string[]) : [],
  }))
}

function requestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Borrador",
    submitted: "Enviada",
    approved: "Aprobada",
    partially_approved: "Aprobada parcial",
    rejected: "Rechazada",
    in_purchase: "En OC",
    closed: "Cerrada",
    cancelled: "Cancelada",
    returned: "Devuelta",
  }
  return labels[status] ?? status
}

function SummaryLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className={muted ? "text-right text-xs text-[var(--color-text-subtle)]" : "text-right text-xs font-medium text-[var(--color-text)]"}>
        {value}
      </dd>
    </div>
  )
}

function buildRequestSummaryIssues({
  worksiteId,
  requiredDate,
  items,
}: {
  worksiteId: string
  requiredDate: string
  items: ItemRow[]
}): string[] {
  const issues: string[] = []
  if (!worksiteId) issues.push("Selecciona una faena.")
  if (!requiredDate) issues.push("Indica la fecha requerida.")

  items.forEach((item, index) => {
    const label = `Ítem ${index + 1}`
    if (!item.productId && !item.productNameFree.trim()) {
      issues.push(`${label}: selecciona o describe un producto.`)
    }
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
      issues.push(`${label}: ingresa una cantidad válida.`)
    }
    const missingAttrs = item.attributes.filter((attr) => attr.isRequired && !attr.value.trim())
    if (missingAttrs.length > 0) {
      issues.push(`${label}: completa ${missingAttrs.map((attr) => attr.attributeName).join(", ")}.`)
    }
  })

  return issues
}

// ── Main component ────────────────────────────────────────────────────────────

interface RequestFormProps {
  worksites:    WorksiteOption[]
  products:     ProductOption[]
  suppliers:    SupplierOption[]
  editRequest?: EditRequest
  maxFileSizeMb: number
  userRoles?:   string[]
  userPermissions?: string[]
}

export function RequestForm({ worksites, products, suppliers, editRequest, maxFileSizeMb, userPermissions = [] }: RequestFormProps) {
  const router = useRouter()
  const isEdit  = !!editRequest
  const isDraft = !isEdit || ["draft", "returned"].includes(editRequest.status)
  const requestTypeOpts = visibleRequestTypeOptions(userPermissions)
  const canDeleteRequest = isEdit
    && (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(editRequest.status)
    && (userPermissions.includes("requests:delete") || userPermissions.includes("requests:view_own"))

  // ── Form action state
  const [draftState,  draftAction, draftPending] =
    useActionState<ActionState & { requestId?: string }, FormData>(saveDraft, INITIAL_STATE)
  const [submitState, submitAction] = useActionState<ActionState, FormData>(submitRequest, INITIAL_STATE)
  const [cancelState, cancelAction] = useActionState<ActionState, FormData>(cancelRequest, INITIAL_STATE)
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteRequestAction, INITIAL_STATE)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [isSaving, startSaveTransition] = useTransition()
  const [isSubmitting, startSubmitTransition] = useTransition()

  // Id del borrador persistido. Para solicitudes nuevas se adopta el id que
  // devuelve saveDraft, de modo que cada guardado posterior actualice el mismo
  // borrador en lugar de crear duplicados.
  const [savedId, setSavedId] = useState(editRequest?.id)

  // ── Header fields
  const [worksiteId,  setWorksiteId]  = useState(editRequest?.worksiteId  ?? (worksites[0]?.id ?? ""))
  const [requestType, setRequestType] = useState(editRequest?.requestType ?? requestTypeOpts[0]?.value ?? "epp")
  const [urgency,     setUrgency]     = useState(editRequest?.urgency     ?? "normal")
  const [requiredDate, setRequiredDate] = useState(editRequest?.requiredDate ?? "")
  const [notes,       setNotes]       = useState(editRequest?.notes       ?? "")

  // ── Items
  const [items, setItems] = useState<ItemRow[]>(() => {
    if (editRequest && editRequest.items.length > 0) {
      return editRequest.items.map((item) => {
        const prod = item.productId ? products.find((p) => p.id === item.productId) : null
        return {
          _key:                item.id ?? `edit-${item.productId ?? item.productNameFree ?? "item"}`,
          id:                  item.id,
          productId:           item.productId,
          productNameFree:     item.productNameFree ?? "",
          quantity:            String(item.quantity),
          unitOfMeasure:       item.unitOfMeasure,
          urgency:             item.urgency,
          suggestedSupplierId: item.suggestedSupplierId ?? "",
          supplierHint:        item.supplierHint ?? "",
          notes:               item.notes ?? "",
          isEpp:               prod?.isEpp ?? false,
          productName:         prod?.name ?? item.productNameFree ?? "",
          showAttrs:           item.attributes.length > 0,
          cotizaciones:        [],
          attributes:          item.attributes.map((a) => {
            const prodAttr = prod?.attributes.find((pa) => pa.id === a.attributeId)
            return {
              attributeId:   a.attributeId,
              attributeName: a.attributeName,
              value:         a.value,
              isRequired:    prodAttr?.isRequired ?? false,
              type:          prodAttr?.type ?? "text",
              options:       prodAttr?.options ? (JSON.parse(prodAttr.options) as string[]) : [],
            }
          }),
        }
      })
    }
    return [blankItem()]
  })

  // ── Draft save feedback — el guardado manual muestra toast; el automático
  //    solo actualiza el indicador del footer.
  const autoSaveRef = useRef(false)
  const [dirty, setDirty]             = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (draftState.ok) {
      setDirty(false)
      setLastSavedAt(new Date())
      if (draftState.requestId) setSavedId(draftState.requestId)
      if (autoSaveRef.current) autoSaveRef.current = false
      else toast.success(draftState.message ?? "Borrador guardado")
      // Clear cotizaciones from items after successful save — files are
      // already persisted on the server; keeping them would cause duplicates
      // on the next save.
      if (QUOTATION_TYPES.has(requestType)) {
        setItems((prev) => prev.map((item) =>
          item.cotizaciones.length > 0 ? { ...item, cotizaciones: [] } : item,
        ))
      }
    } else if (draftState.message && !draftState.ok && draftState.message !== "Sin permisos para crear solicitudes") {
      // Un autosave fallido no interrumpe: el usuario sigue editando y el
      // guardado manual reporta el error con detalle.
      if (autoSaveRef.current) autoSaveRef.current = false
      else toast.error(draftState.message)
    }
    }, [draftState, requestType])

  useEffect(() => {
    if (submitState.message && !submitState.ok) toast.error(submitState.message)
  }, [submitState])

  useEffect(() => {
    if (cancelState.message && !cancelState.ok) toast.error(cancelState.message)
  }, [cancelState])

  useEffect(() => {
    if (!deleteState.message) return
    if (deleteState.ok) {
      toast.success(deleteState.message)
      router.push("/solicitudes")
    } else {
      toast.error(deleteState.message)
    }
  }, [deleteState, router])

  // ── Reset items when requestType changes to/from a quotation type
  //    (only when creating a new request, not when editing an existing one)
  const prevRequestTypeRef = useRef(requestType)
  useEffect(() => {
    const prev = prevRequestTypeRef.current
    prevRequestTypeRef.current = requestType
    if (prev === requestType) return
    if (isEdit) return
    if (QUOTATION_TYPES.has(requestType) || QUOTATION_TYPES.has(prev)) {
      setItems([blankItemForType(crypto.randomUUID(), requestType)])
    }
  }, [requestType, isEdit])

  // ── Item mutations
  const addItem = useCallback(() => setItems((prev) => [...prev, blankItemForType(crypto.randomUUID(), requestType)]), [requestType])

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.length > 1 ? prev.filter((i) => i._key !== key) : prev)
  }, [])

  const updateItem = useCallback((key: string, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i))
  }, [])

  const selectProduct = useCallback((key: string, prodId: string) => {
    const prod = products.find((p) => p.id === prodId)
    if (!prod) return
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i
      const attrs = buildAttrsFromProduct(prod)
      return {
        ...i,
        productId:       prod.id,
        productNameFree: "",
        productName:     prod.name,
        unitOfMeasure:   prod.unitOfMeasure,
        isEpp:           prod.isEpp,
        suggestedSupplierId: prod.isEpp ? (prod.preferredSupplierId ?? "") : "",
        supplierHint:        "",
        attributes:      attrs,
        showAttrs:       attrs.length > 0,
      }
    }))
  }, [products])

  const selectFreeProduct = useCallback((key: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : {
        ...i,
        productId:       null,
        productNameFree: trimmed,
        productName:     trimmed,
        isEpp:           false,
        unitOfMeasure:   i.unitOfMeasure || "unidad",
        suggestedSupplierId: "",
        supplierHint:    "",
        attributes:      [],
        showAttrs:       false,
      },
    ))
  }, [])

  const clearProduct = useCallback((key: string) => {
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : { ...i, productId: null, productNameFree: "", productName: "", isEpp: false, suggestedSupplierId: "", supplierHint: "", attributes: [], showAttrs: false }
    ))
  }, [])

  const updateAttr = useCallback((itemKey: string, attrIdx: number, value: string) => {
    setItems((prev) => prev.map((i) => {
      if (i._key !== itemKey) return i
      const attrs = i.attributes.map((a, idx) => idx === attrIdx ? { ...a, value } : a)
      return { ...i, attributes: attrs }
    }))
  }, [])

  // Serialised payload for hidden inputs
  const itemsJson = JSON.stringify(items.map((item) => ({
    id:                  item.id,
    productId:           item.productId,
    productNameFree:     item.productNameFree || null,
    quantity:            Number(item.quantity) || 1,
    unitOfMeasure:       item.unitOfMeasure,
    urgency:             item.urgency,
    requiredDate:        requiredDate || null,
    suggestedSupplierId: item.suggestedSupplierId || null,
    supplierHint:        item.supplierHint || null,
    notes:               item.notes || null,
    attributes:          item.attributes.map((a) => ({
      attributeId:   a.attributeId,
      attributeName: a.attributeName,
      value:         a.value,
    })),
  })))

  const hasRealContent = items.some((item) => item.productId || item.productNameFree.trim() !== "")

  // Ref that always holds the latest items for buildDraftFormData.
  // Avoids making buildDraftFormData depend on `items` (reference changes
  // on every edit, which would reset the autosave timer constantly).
  const itemsDataRef = useRef(items)
  useEffect(() => { itemsDataRef.current = items })

  // ── Helper: build draft FormData including pending cotizaciones files
  const buildDraftFormData = useCallback((overrides?: { id?: string }) => {
    const fd = new FormData()
    const id = overrides?.id ?? savedId
    if (id) fd.set("id", id)
    fd.set("itemsJson",    itemsJson)
    fd.set("worksiteId",   worksiteId)
    fd.set("requestType",  requestType)
    fd.set("urgency",      urgency)
    fd.set("requiredDate", requiredDate)
    fd.set("notes",        notes)
    // Append pending cotizaciones files from item state
    if (QUOTATION_TYPES.has(requestType)) {
      for (const item of itemsDataRef.current) {
        const cots = item.cotizaciones
        if (cots?.length) {
          for (const cot of cots) {
            fd.append(`cotizacion_${item._key}`, cot.file)
          }
        }
      }
    }
    return fd
  }, [savedId, itemsJson, worksiteId, requestType, urgency, requiredDate, notes])

  // ── Cambios sin guardar: cualquier edición posterior al snapshot inicial marca dirty
  const prevSnapshotRef = useRef<string | null>(null)
  useEffect(() => {
    const snapshot = JSON.stringify([itemsJson, worksiteId, requestType, urgency, requiredDate, notes])
    if (prevSnapshotRef.current === null) {
      prevSnapshotRef.current = snapshot
      return
    }
    if (prevSnapshotRef.current !== snapshot) {
      prevSnapshotRef.current = snapshot
      setDirty(true)
    }
  }, [itemsJson, worksiteId, requestType, urgency, requiredDate, notes])

  // ── Advertir antes de abandonar la página con trabajo sin guardar (H5)
  useEffect(() => {
    if (!isDraft || !dirty || !hasRealContent) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDraft, dirty, hasRealContent])

  // ── Auto-guardado: a lo sumo AUTOSAVE_INTERVAL_MS de trabajo sin persistir (H15).
  //    Solo se dispara cuando el borrador pasa la validación mínima del schema.
  const snapshotRef = useRef<AutosaveSnapshot>({
    savedId, itemsJson, worksiteId, requestType, urgency, requiredDate, notes, canSave: false,
  })
  // Sin deps: mantiene el snapshot al día tras cada render sin reiniciar el timer.
  useEffect(() => {
    snapshotRef.current = {
      savedId, itemsJson, worksiteId, requestType, urgency, requiredDate, notes,
      canSave: Boolean(worksiteId && requiredDate && hasRealContent),
    }
  })

  useEffect(() => {
    if (!isDraft || !dirty || draftPending) return
    const timer = window.setTimeout(() => {
      const snap = snapshotRef.current
      if (!snap.canSave) return
      autoSaveRef.current = true
      startTransition(() => draftAction(buildDraftFormData()))
    }, AUTOSAVE_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [isDraft, dirty, draftPending, draftAction, buildDraftFormData])

  const readOnly = !isDraft
  const itemsError = draftState.fieldErrors?.items?.[0] ?? submitState.fieldErrors?.items?.[0]
  const requestTypeLabel = requestTypeOpts.find((option) => option.value === requestType)?.label ?? requestType
  const urgencyLabel = URGENCY_OPTS.find((option) => option.value === urgency)?.label ?? urgency
  const worksiteLabel = worksites.find((worksite) => worksite.id === worksiteId)?.name ?? "Sin faena"
  const missingItems = buildRequestSummaryIssues({ worksiteId, requiredDate, items })
  const statusLabel = editRequest ? requestStatusLabel(editRequest.status) : "Borrador"

  return (
    <div className="grid gap-6 pb-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0 space-y-8">
      {/* ── Draft/Submit form ─────────────────────────────────────────────── */}
      <form onSubmit={(e) => { e.preventDefault(); startSaveTransition(() => draftAction(buildDraftFormData())); }} className="space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 space-y-4">
          <h2 className="text-h2 text-[var(--color-text)]">
            Datos de la solicitud
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Faena" required htmlFor="worksiteId">
              <Select
                value={worksiteId}
                onValueChange={setWorksiteId}
                disabled={readOnly}
              >
                <SelectTrigger id="worksiteId">
                  <SelectValue placeholder="Selecciona una faena" />
                </SelectTrigger>
                <SelectContent>
                  {worksites.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Tipo de solicitud"
              htmlFor="requestType"
              helper="EPP: elementos de protección personal. El tipo clasifica la solicitud para su revisión y compra."
            >
              <Select value={requestType} onValueChange={setRequestType} disabled={readOnly}>
                <SelectTrigger id="requestType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {requestTypeOpts.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Urgencia"
              htmlFor="urgency"
              helper="Alta y Crítica destacan los ítems en la cola de aprobación."
            >
              <Select value={urgency} onValueChange={setUrgency} disabled={readOnly}>
                <SelectTrigger id="urgency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {URGENCY_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Fecha requerida"
              required
              htmlFor="requiredDate"
              error={draftState.fieldErrors?.requiredDate?.[0] ?? submitState.fieldErrors?.requiredDate?.[0]}
            >
              <Input
                id="requiredDate"
                type="date"
                name="requiredDate"
                value={requiredDate}
                onChange={(event) => setRequiredDate(event.target.value)}
                required
                disabled={readOnly}
              />
            </Field>
          </div>

          <Field label="Notas generales" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              placeholder="Observaciones, contexto de la solicitud..."
              rows={2}
              disabled={readOnly}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </section>

        {/* ── Items ──────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-h2 text-[var(--color-text)]">
              Ítems solicitados
              <span className="ml-2 text-xs font-normal text-[var(--color-text-subtle)]">
                {items.length} {items.length === 1 ? "ítem" : "ítems"}
              </span>
            </h2>
            {!readOnly && (
              <Button type="button" variant="ghost" size="sm" onClick={addItem}>
                <Plus weight="bold" size={13} />
                Agregar ítem
              </Button>
            )}
          </div>

          {itemsError && (
            <p className="text-xs text-[var(--color-danger)]">
              {itemsError}
            </p>
          )}

          {QUOTATION_TYPES.has(requestType) && !savedId && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-subtle)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
              <Warning size={13} className="shrink-0" />
              Guarda el borrador primero para poder adjuntar cotizaciones.
            </p>
          )}

          <div className="space-y-2">
            {items.map((item, idx) => (
              <ItemEditor
                key={item._key}
                item={item}
                idx={idx}
                products={products}
                suppliers={suppliers}
                readOnly={readOnly}
                requestType={requestType}
                maxFileSizeMb={maxFileSizeMb}
                onUpdate={(patch) => updateItem(item._key, patch)}
                onSelectProduct={(pid) => selectProduct(item._key, pid)}
                onSelectFreeProduct={(name) => selectFreeProduct(item._key, name)}
                onClearProduct={() => clearProduct(item._key)}
                onUpdateAttr={(i, v) => updateAttr(item._key, i, v)}
                onRemove={() => removeItem(item._key)}
                canRemove={items.length > 1}
              />
            ))}
          </div>
        </section>

        {/* ── Save draft button ───────────────────────────────────────────── */}
        {isDraft && (
          <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
            >
              <ArrowLeft size={14} />
              Volver
            </Button>
            <div className="flex items-center gap-3">
              <span aria-live="polite" className="text-[11px] text-[var(--color-text-subtle)]">
                {(isSaving || isSubmitting || draftPending)
                  ? "Guardando..."
                  : dirty
                  ? "Cambios sin guardar"
                  : lastSavedAt
                  ? `Guardado ${lastSavedAt.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`
                  : null}
              </span>
              <SubmitButton label="Guardar borrador" loadingLabel="Guardando..." variant="secondary" size="sm" />
            </div>
          </div>
        )}
      </form>

      {/* ── Submit form (separate to distinguish the action) ─────────────── */}
      {isDraft && (
        <form onSubmit={(e) => {
          e.preventDefault()
          const fd = buildDraftFormData()
          fd.set("requestId", savedId ?? "")
          startSubmitTransition(() => submitAction(fd))
        }} className="pt-0">
          {submitState.message && !submitState.ok && (
            <p className="mb-3 text-xs text-[var(--color-danger)] flex items-center gap-1.5">
              <Warning size={14} />
              {submitState.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {isEdit && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
                  >
                    Cancelar solicitud
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>¿Cancelar esta solicitud?</DialogTitle>
                    <DialogDescription>
                      La solicitud {editRequest.code} saldrá del flujo de aprobación y
                      tendrás que crearla de nuevo si la necesitas. Esta acción no se
                      puede deshacer.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" variant="ghost" size="sm">
                        Volver
                      </Button>
                    </DialogClose>
                    <form action={cancelAction}>
                      <input type="hidden" name="requestId" value={editRequest.id} />
                      <SubmitButton
                        label="Cancelar solicitud"
                        loadingLabel="Cancelando..."
                        variant="destructive"
                        size="sm"
                      />
                    </form>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {isDraft && canDeleteRequest && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={isDeleting}
              >
                <Trash size={14} className="mr-1" />
                Eliminar
              </Button>
            )}
            <SubmitButton label="Enviar a aprobación" loadingLabel="Enviando..." variant="primary" />
          </div>
        </form>
      )}

      {/* ── Read-only notice + eliminar (estados no-draft eliminables) ────────── */}
      {readOnly && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-text-subtle">
            Esta solicitud está en estado <strong>{statusLabel}</strong> y no puede modificarse.
          </p>
          {canDeleteRequest && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger shrink-0"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={isDeleting}
            >
              <Trash size={14} className="mr-1" />
              Eliminar solicitud
            </Button>
          )}
        </div>
      )}

      {isEdit && canDeleteRequest && (
        <>
          <ConfirmDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            title="¿Eliminar solicitud?"
            description={`La solicitud ${editRequest.code} será eliminada permanentemente junto con todos sus ítems y archivos adjuntos. Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            variant="destructive"
            loading={isDeleting}
            onConfirm={() => {
              const fd = new FormData()
              fd.set("requestId", editRequest.id)
              startDeleteTransition(() => deleteAction(fd))
              setDeleteConfirmOpen(false)
            }}
          />
        </>
      )}
      </div>

      <aside className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 lg:sticky lg:top-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Resumen</h2>
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              {isDraft
                ? "Revisa la solicitud antes de enviarla."
                : "Consulta el estado y los datos registrados."}
            </p>
          </div>
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-2 py-1 text-xs font-medium text-[var(--color-text-muted)]">
            {items.length} {items.length === 1 ? "ítem" : "ítems"}
          </span>
        </div>

        <dl className="mt-4 divide-y divide-[var(--color-border)] text-sm">
          <SummaryLine label="Faena" value={worksiteLabel} />
          <SummaryLine label="Tipo" value={requestTypeLabel} />
          <SummaryLine label="Urgencia" value={urgencyLabel} />
          <SummaryLine label="Fecha requerida" value={requiredDate ? formatDate(requiredDate) : "Pendiente"} muted={!requiredDate} />
          {!isDraft && <SummaryLine label="Estado" value={statusLabel} />}
        </dl>

        <div className="mt-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <p className="text-xs font-medium text-[var(--color-text)]">
            {isDraft
              ? (missingItems.length === 0 ? "Listo para enviar" : "Pendientes")
              : statusLabel}
          </p>
          {!isDraft ? (
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Esta solicitud ya fue enviada y se muestra en modo consulta.
            </p>
          ) : missingItems.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Los campos requeridos y los ítems tienen la información mínima.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
              {missingItems.map((issue) => (
                <li key={issue} className="flex gap-2">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-warning)]" />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}
