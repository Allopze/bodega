import { useActionState, useEffect, useRef, useState, useCallback, useMemo, startTransition, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { DELETABLE_REQUEST_STATUSES } from "@/lib/services/requests-delete.constants"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { useActionWatchers } from "@/lib/hooks/use-action-watchers"
import { URGENCY_OPTS } from "./request-form.constants"
import type { ActionState } from "@/lib/validation/operations"
import type { ItemRow, ProductOption, WorksiteOption, SupplierOption, WorkerOption, EditRequest } from "./request-form.types"
import { QUOTATION_TYPES, visibleRequestTypeOptions } from "@/lib/request-types"
import type { RequestType } from "@/lib/request-types"
import { saveDraft, submitRequest, cancelRequest, deleteRequestAction, resubmitReturnedItemAction } from "./actions"
import {
  blankItemForType, buildAttrsFromProduct, buildRequestSummaryIssues,
  equipmentFromAttributes, parseAttributeOptions, requestStatusLabel,
} from "./request-form.helpers"
import { groupProductVariants } from "@/lib/products/variant-grouping"

const AUTOSAVE_INTERVAL_MS = 60_000

const SIZE_FIELD_MAP: Record<string, keyof Pick<WorkerOption, "sizeTop" | "sizeBottom" | "sizeShoe" | "sizeGloves" | "sizeHelmet">> = {
  Talla:              "sizeTop",
  "Talla superior":   "sizeTop",
  "Talla inferior":   "sizeBottom",
  "Talla calzado":    "sizeShoe",
  "Talla guantes":    "sizeGloves",
  "Talla casco":      "sizeHelmet",
}

function suggestSize(attributeName: string, worker: WorkerOption | undefined): string | null {
  if (!worker) return null
  const field = SIZE_FIELD_MAP[attributeName]
  if (!field) return null
  return (worker[field] as string | null | undefined) ?? null
}

interface AutosaveSnapshot {
  savedId: string | undefined; itemsJson: string; worksiteId: string
  requestType: string; urgency: string; deliveryMode: string; requiredDate: string; notes: string; canSave: boolean
}

function useDraftPersistence({
  isDraft, dirty, hasRealContent,
  savedId, setSavedId, setDirty, setLastSavedAt,
  itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes,
  items, setItems,
  draftState, draftAction, draftPending,
}: {
  isDraft: boolean; dirty: boolean; hasRealContent: boolean
  savedId: string | undefined; setSavedId: React.Dispatch<React.SetStateAction<string | undefined>>
  setDirty: React.Dispatch<React.SetStateAction<boolean>>
  setLastSavedAt: React.Dispatch<React.SetStateAction<Date | null>>
  itemsJson: string; worksiteId: string; requestType: string; urgency: string; deliveryMode: string; requiredDate: string; notes: string
  items: ItemRow[]; setItems: React.Dispatch<React.SetStateAction<ItemRow[]>>
  draftState: ActionState & { requestId?: string }; draftAction: (fd: FormData) => void; draftPending: boolean
}): { buildDraftFormData: (overrides?: { id?: string }) => FormData } {
  const autoSaveRef = useRef(false)

  // ── DraftState watcher (success/error toasts + state reset) ──
  useEffect(() => {
    if (draftState.ok) {
      setDirty(false)
      setLastSavedAt(new Date())
      if (draftState.requestId) setSavedId(draftState.requestId)
      if (autoSaveRef.current) autoSaveRef.current = false
      else toast.success(draftState.message ?? "Borrador guardado")
      if (QUOTATION_TYPES.has(requestType)) {
        setItems((prev: ItemRow[]) => prev.map((item) => item.cotizaciones.length > 0 ? { ...item, cotizaciones: [] } : item))
      }
    } else if (draftState.message && !draftState.ok && draftState.message !== "Sin permisos para crear solicitudes") {
      if (autoSaveRef.current) autoSaveRef.current = false
      else toast.error(draftState.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setState functions are referentially stable
  }, [draftState, requestType])

  // ── Ref sync — keeps refs in sync with latest state ──
  const itemsDataRef = useRef(items)
  useEffect(() => { itemsDataRef.current = items })

  // ── buildDraftFormData (stable with explicit deps) ──
  const buildDraftFormData = useCallback((overrides?: { id?: string }) => {
    const fd = new FormData()
    const id = overrides?.id ?? savedId
    if (id) fd.set("id", id)
    fd.set("itemsJson", itemsJson)
    fd.set("worksiteId", worksiteId); fd.set("requestType", requestType)
    fd.set("urgency", urgency); fd.set("deliveryMode", deliveryMode); fd.set("requiredDate", requiredDate); fd.set("notes", notes)
    if (QUOTATION_TYPES.has(requestType)) {
      for (const item of itemsDataRef.current) {
        const cots = item.cotizaciones
        if (cots?.length) { for (const cot of cots) fd.append(`cotizacion_${item._key}`, cot.file) }
      }
    }
    return fd
  }, [savedId, itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes])

  // ── Dirty tracking — compare snapshot with previous to detect changes ──
  const prevSnapshotRef = useRef<string | null>(null)
  useEffect(() => {
    const snapshot = JSON.stringify([itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes])
    if (prevSnapshotRef.current === null) { prevSnapshotRef.current = snapshot; return }
    if (prevSnapshotRef.current !== snapshot) { prevSnapshotRef.current = snapshot; setDirty(true) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setDirty is a stable setState function
  }, [itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes])

  // ── Ref for stable timer callback (avoids resetting autosave timer) ──
  const buildDraftRef = useRef(buildDraftFormData)
  useEffect(() => { buildDraftRef.current = buildDraftFormData })

  // ── Snapshot ref for autosave — captures latest form values ──
  const snapshotRef = useRef<AutosaveSnapshot>({ savedId, itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes, canSave: false })
  useEffect(() => { snapshotRef.current = { savedId, itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes, canSave: Boolean(worksiteId && requiredDate && hasRealContent) } })

  // ── Autosave timer (60s) ──
  useEffect(() => {
    if (!isDraft || !dirty || draftPending) return
    const timer = window.setTimeout(() => {
      const snap = snapshotRef.current
      if (!snap.canSave) return
      autoSaveRef.current = true
      startTransition(() => draftAction(buildDraftRef.current()))
    }, AUTOSAVE_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [isDraft, dirty, draftPending, draftAction])

  return { buildDraftFormData }
}

export function useRequestForm({
  worksites, products, workers, editRequest, userPermissions = [], initialRequestType,
}: {
  worksites: WorksiteOption[]; products: ProductOption[]; suppliers: SupplierOption[]; workers?: WorkerOption[]
  editRequest?: EditRequest; maxFileSizeMb: number; userRoles?: string[]; userPermissions?: string[]; initialRequestType?: RequestType
}) {
  const router = useRouter()
  const isEdit = !!editRequest
  const isDraft = !isEdit || ["draft", "returned"].includes(editRequest.status)
  const requestTypeOpts = visibleRequestTypeOptions(userPermissions)
  const allowedInitialRequestType = initialRequestType && requestTypeOpts.some((option) => option.value === initialRequestType)
    ? initialRequestType
    : undefined
  const canDeleteRequest = isEdit
    && (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(editRequest.status)
    && (userPermissions.includes("requests:delete") || userPermissions.includes("requests:view_own"))
  const canCancelRequest = isEdit
    && ["draft", "returned", "submitted", "in_review", "partially_approved"].includes(editRequest.status)
    && (userPermissions.includes("requests:create") || userPermissions.includes("requests:view_all"))

  const [draftState, draftAction, draftPending] = useActionState<ActionState & { requestId?: string }, FormData>(saveDraft, INITIAL_STATE)
  const [submitState, submitAction] = useActionState<ActionState, FormData>(submitRequest, INITIAL_STATE)
  const [cancelState, cancelAction] = useActionState<ActionState, FormData>(cancelRequest, INITIAL_STATE)
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteRequestAction, INITIAL_STATE)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [isSaving, startSaveTransition] = useTransition()
  const [isSubmitting, startSubmitTransition] = useTransition()
  const [resubmitState, resubmitAction, resubmitPending] = useActionState<ActionState, FormData>(resubmitReturnedItemAction, INITIAL_STATE)

  const [savedId, setSavedId] = useState(editRequest?.id)
  const [worksiteId, setWorksiteId] = useState(editRequest?.worksiteId ?? (worksites[0]?.id ?? ""))
  const [requestType, setRequestType] = useState(editRequest?.requestType ?? allowedInitialRequestType ?? requestTypeOpts[0]?.value ?? "epp")
  const [urgency, setUrgency] = useState(editRequest?.urgency ?? "normal")
  const [deliveryMode, setDeliveryMode] = useState<string>(editRequest?.deliveryMode ?? "via_oficina")
  const [requiredDate, setRequiredDate] = useState(editRequest?.requiredDate ?? "")
  const [notes, setNotes] = useState(editRequest?.notes ?? "")

  const [items, setItems] = useState<ItemRow[]>(() => {
    if (editRequest && editRequest.items.length > 0) {
      const isQuotation = QUOTATION_TYPES.has(editRequest.requestType)
      return editRequest.items.map((item) => {
        const prod = item.productId ? products.find((p) => p.id === item.productId) : null
        return {
          _key: item.id ?? `edit-${item.productId ?? item.productNameFree ?? "item"}`,
          id: item.id, productId: item.productId, productNameFree: item.productNameFree ?? "",
          quantity: String(item.quantity), unitOfMeasure: item.unitOfMeasure,
          urgency: item.urgency, suggestedSupplierId: item.suggestedSupplierId ?? "",
          supplierHint: item.supplierHint ?? "", notes: item.notes ?? "", status: item.status,
          isEpp: prod?.isEpp ?? false, productName: prod?.name ?? item.productNameFree ?? "",
          variantQuantities: {}, workerId: "", workerName: "",
          showAttrs: !isQuotation && item.attributes.length > 0, cotizaciones: [],
          ...equipmentFromAttributes(editRequest.requestType, item.attributes),
          attributes: isQuotation ? [] : item.attributes.map((a) => {
            const prodAttr = prod?.attributes.find((pa) => pa.id === a.attributeId)
            return {
              attributeId: a.attributeId, attributeName: a.attributeName, value: a.value,
              isRequired: prodAttr?.isRequired ?? false, type: prodAttr?.type ?? "text",
              options: parseAttributeOptions(prodAttr?.options),
            }
          }),
        }
      })
    }
    return [blankItemForType(crypto.randomUUID(), requestType)]
  })

  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  // ── Action-state watchers (toast on error / success) ──
  useActionWatchers({ submitState, cancelState, deleteState, resubmitState, router })

  const prevRequestTypeRef = useRef(requestType)
  useEffect(() => {
    const prev = prevRequestTypeRef.current
    prevRequestTypeRef.current = requestType
    if (prev === requestType || isEdit) return
    if (QUOTATION_TYPES.has(requestType) || QUOTATION_TYPES.has(prev)) {
      setItems([blankItemForType(crypto.randomUUID(), requestType)])
    }
  }, [requestType, isEdit])

  const addItem = useCallback(() => setItems((prev) => [...prev, blankItemForType(crypto.randomUUID(), requestType)]), [requestType])
  const removeItem = useCallback((key: string) => setItems((prev) => prev.length > 1 ? prev.filter((i) => i._key !== key) : prev), [])
  const updateItem = useCallback((key: string, patch: Partial<ItemRow>) => setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i)), [])

  const selectProduct = useCallback((key: string, prodId: string) => {
    const prod = products.find((p) => p.id === prodId)
    if (!prod) return
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i
      const attrs = buildAttrsFromProduct(prod)
      return { ...i, productId: prod.id, productNameFree: "", productName: prod.name, unitOfMeasure: prod.unitOfMeasure, isEpp: prod.isEpp, suggestedSupplierId: prod.preferredSupplierId ?? "", supplierHint: "", attributes: attrs, variantQuantities: {}, showAttrs: attrs.length > 0 }
    }))
  }, [products])

  const selectFreeProduct = useCallback((key: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : { ...i, productId: null, productNameFree: trimmed, productName: trimmed, isEpp: false, unitOfMeasure: i.unitOfMeasure || "unidad", suggestedSupplierId: "", supplierHint: "", attributes: [], showAttrs: false }
    ))
  }, [])

  const clearProduct = useCallback((key: string) => {
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : { ...i, productId: null, productNameFree: "", productName: "", isEpp: false, suggestedSupplierId: "", supplierHint: "", attributes: [], showAttrs: false, workerId: "", workerName: "" }
    ))
  }, [])

  const updateItemWorker = useCallback((key: string, workerId: string) => {
    if (!workers) return
    const worker = workers.find((w) => w.id === workerId)
    if (!worker) return
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i
      const selectedProduct = i.productId ? products.find((product) => product.id === i.productId) : null
      const variants = selectedProduct
        ? groupProductVariants(products).find((group) => group.variants.some((variant) => variant.id === selectedProduct.id))?.variants ?? []
        : []
      const matchingVariant = variants.find((variant) => variant.attributes.some((attribute) => {
        const suggestedSize = suggestSize(attribute.name, worker)
        const options = new Set(parseAttributeOptions(attribute.options))
        return suggestedSize != null && options.has(suggestedSize)
      }))
      const product = matchingVariant ?? selectedProduct
      const attrs = (product ? buildAttrsFromProduct(product) : i.attributes).map((a) => {
        const size = suggestSize(a.attributeName, worker)
        return size && a.options.includes(size) ? { ...a, value: size } : a
      })
      return {
        ...i,
        ...(product ? {
          productId: product.id,
          productName: product.name,
          unitOfMeasure: product.unitOfMeasure,
          isEpp: product.isEpp,
          suggestedSupplierId: product.preferredSupplierId ?? "",
        } : {}),
        workerId: worker.id,
        workerName: `${worker.firstName} ${worker.lastName}`,
        attributes: attrs,
      }
    }))
  }, [products, workers])

  const updateAttr = useCallback((itemKey: string, attrIdx: number, value: string) => {
    setItems((prev) => prev.map((i) => {
      if (i._key !== itemKey) return i
      const attrs = i.attributes.map((a, idx) => idx === attrIdx ? { ...a, value } : a)
      return { ...i, attributes: attrs }
    }))
  }, [])

  const itemsJson = useMemo(
    () => JSON.stringify(items.flatMap((item) => {
      const base = {
        id: item.id, productId: item.productId, productNameFree: item.productNameFree || null,
        unitOfMeasure: item.unitOfMeasure, urgency: item.urgency,
        requiredDate: requiredDate || null, suggestedSupplierId: item.suggestedSupplierId || null,
        supplierHint: item.supplierHint || null, notes: item.notes || null,
        workerId: item.workerId || null,
        partNumber: item.partNumber || null, location: item.location || null,
        equipmentName: item.equipmentName || null, patent: item.patent || null,
        brand: item.brand || null, model: item.model || null,
        attributes: item.attributes.map((a) => ({ attributeId: a.attributeId, attributeName: a.attributeName, value: a.value })),
      }
      return [{
        ...base,
        quantity: Number(item.quantity) || 1,
      }]
    })),
    [items, requiredDate],
  )

  const hasRealContent = items.some((item) => item.productId || item.productNameFree.trim() !== "")

  const { buildDraftFormData } = useDraftPersistence({
    isDraft, dirty, hasRealContent,
    savedId, setSavedId, setDirty, setLastSavedAt,
    itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes,
    items, setItems,
    draftState, draftAction, draftPending,
  })

  // ── Beforeunload guard (tab close / reload only) ──
  const beforeUnloadRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null)
  useEffect(() => {
    if (!isDraft || !dirty || !hasRealContent) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    beforeUnloadRef.current = warn
    window.addEventListener("beforeunload", warn)
    return () => {
      window.removeEventListener("beforeunload", warn)
      beforeUnloadRef.current = null
    }
  }, [isDraft, dirty, hasRealContent])

  /**
   * Navigates back without triggering beforeunload (used after the user confirms
   * the leave-confirmation dialog). Removes the listener first, then navigates,
   * so the native browser dialog doesn't appear twice.
   */
  const silentNavBack = useCallback(() => {
    if (beforeUnloadRef.current) {
      window.removeEventListener("beforeunload", beforeUnloadRef.current)
      beforeUnloadRef.current = null
    }
    window.history.back()
  }, [])

  const readOnly = !isDraft
  const itemsError = draftState.fieldErrors?.items?.[0] ?? submitState.fieldErrors?.items?.[0]
  const requiredDateError = draftState.fieldErrors?.requiredDate?.[0] ?? submitState.fieldErrors?.requiredDate?.[0]
  const requestTypeLabel = requestTypeOpts.find((o) => o.value === requestType)?.label ?? requestType
  const urgencyLabel = URGENCY_OPTS.find((o) => o.value === urgency)?.label ?? urgency
  const worksiteLabel = worksites.find((w) => w.id === worksiteId)?.name ?? "Sin faena"
  const missingItems = buildRequestSummaryIssues({ worksiteId, requiredDate, items })
  const statusLabel = editRequest ? requestStatusLabel(editRequest.status) : "Borrador"
  const submitMessage = submitState.message
  const submitOk = submitState.ok

  return {
    worksiteId, setWorksiteId, requestType, setRequestType, urgency, setUrgency, deliveryMode, setDeliveryMode,
    requiredDate, setRequiredDate, notes, setNotes, items, requestTypeOpts,
    isEdit, isDraft, readOnly, savedId, dirty, lastSavedAt, hasRealContent,
    requestTypeLabel, urgencyLabel, worksiteLabel, missingItems, statusLabel,
    itemsError, requiredDateError, submitMessage, submitOk,
    canDeleteRequest, canCancelRequest, deleteConfirmOpen, setDeleteConfirmOpen,
    isSaving, isSubmitting, isDeleting, draftPending, resubmitPending,
    addItem, removeItem, updateItem, selectProduct, selectFreeProduct, clearProduct, updateItemWorker, updateAttr,
    buildDraftFormData, draftAction, submitAction, cancelAction, deleteAction, resubmitAction,
    startSaveTransition, startSubmitTransition, startDeleteTransition, silentNavBack,
  }
}
