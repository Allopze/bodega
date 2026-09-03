import { useActionState, useEffect, useRef, useState, useCallback, useMemo, startTransition, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { DELETABLE_REQUEST_STATUSES } from "@/lib/services/requests-delete.constants"
import { isRequestCancellable } from "@/lib/services/requests-cancel.constants"
import { INITIAL_STATE } from "@/lib/form-state"
import { useActionWatchers } from "@/lib/hooks/use-action-watchers"
import { URGENCY_OPTS } from "./request-form.constants"
import type { ActionState } from "@/lib/validation/operations"
import type { ItemRow, ProductOption, WorksiteOption, SupplierOption, WorkerOption, EditRequest, PrefillItem } from "./request-form.types"
import { nanoid } from "@/lib/id"
import { QUOTATION_TYPES, visibleRequestTypeOptions } from "@/lib/request-types"
import type { RequestType } from "@/lib/request-types"
import { saveDraft, submitRequest, cancelRequest, deleteRequestAction } from "./actions"
import {
  applyPrefillAttributeValues, blankItemForType, buildAttrsFromProduct, buildRequestSummaryIssues,
  equipmentFromAttributes, parseAttributeOptions, requestStatusLabel,
} from "./request-form.helpers"
import { groupProductVariants } from "@/lib/products/variant-grouping"
import { normalizeSizeLabel, suggestedWorkerSize } from "@/lib/products/product-size"

const AUTOSAVE_INTERVAL_MS = 60_000

type EppStockWarningItem = {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
  locationName: string
  coverage: "total" | "partial"
}

type EppStockWarning = {
  kind: "epp-stock-warning"
  confirmationToken: string
  worksiteName: string
  items: EppStockWarningItem[]
}

/**
 * ActionState.data crosses the server/client boundary as untrusted data. Keep
 * this guard here instead of letting a malformed response control the dialog or
 * carry a confirmation token into a later request.
 */
function isEppStockWarning(value: ActionState["data"]): value is EppStockWarning {
  if (!value
    || value.kind !== "epp-stock-warning"
    || typeof value.confirmationToken !== "string"
    || value.confirmationToken.length === 0
    || typeof value.worksiteName !== "string"
    || !Array.isArray(value.items)
    || value.items.length === 0) return false

  return value.items.every((item) => {
    if (!item || typeof item !== "object") return false
    const line = item as Partial<EppStockWarningItem>
    return typeof line.productId === "string"
      && typeof line.productName === "string"
      && typeof line.locationName === "string"
      && typeof line.requestedQuantity === "number"
      && Number.isFinite(line.requestedQuantity)
      && typeof line.availableQuantity === "number"
      && Number.isFinite(line.availableQuantity)
      && line.requestedQuantity > 0
      && line.availableQuantity >= 0
      && (line.coverage === "total" || line.coverage === "partial")
  })
}

/**
 * Talla habitual del trabajador para un atributo. El mapa atributo → campo del
 * padrón vive en `lib/products/product-size`: la copia local exigía el nombre
 * exacto («Talla calzado» y no «talla calzado») y no cruzaba `T42` con `42`.
 */
function suggestSize(attributeName: string, worker: WorkerOption | undefined): string | null {
  return suggestedWorkerSize(attributeName, worker)
}

interface AutosaveSnapshot {
  savedId: string | undefined; itemsJson: string; worksiteId: string
  requestType: string; urgency: string; deliveryMode: string; requiredDate: string; notes: string; canSave: boolean
}

function useDraftPersistence({
  enabled, isDraft, dirty, hasRealContent,
  savedId, setSavedId, setDirty, setLastSavedAt,
  itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes,
  items, setItems,
  draftState, draftAction, draftPending,
}: {
  enabled: boolean; isDraft: boolean; dirty: boolean; hasRealContent: boolean
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
      // Archivos que el servidor rechazó: se conservan en el formulario para
      // que el usuario pueda corregirlos, y el aviso va como error persistente
      // aunque el borrador se haya guardado. El autosave silencia el toast de
      // éxito, pero nunca este: perder cotizaciones en silencio era el peor caso.
      const wasAutoSave = autoSaveRef.current
      autoSaveRef.current = false
      const failedFiles = (draftState.data?.failedFiles as string[] | undefined) ?? []
      if (failedFiles.length > 0) toast.error(draftState.message ?? "Algunas cotizaciones no se subieron")
      else if (!wasAutoSave) toast.success(draftState.message ?? "Borrador guardado")
      if (QUOTATION_TYPES.has(requestType)) {
        const failed = new Set(failedFiles)
        setItems((prev: ItemRow[]) => prev.map((item) => {
          if (item.cotizaciones.length === 0) return item
          const kept = item.cotizaciones.filter((c) => failed.has(c.fileName))
          return kept.length === item.cotizaciones.length ? item : { ...item, cotizaciones: kept }
        }))
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
        for (const cot of item.cotizaciones ?? []) {
          // Clave por el id propio de la cotización (no por _key del ítem):
          // el backend adjunta cotizaciones a la SOLICITUD, no al ítem, así
          // que lo único que hace falta es un id único por archivo para
          // llevar su metadata (proveedor, monto) junto a él (LOG-9/UX-3).
          fd.append(`cotizacion_${cot._id}`, cot.file)
          fd.set(`cotizacion_meta_${cot._id}`, JSON.stringify({
            totalAmount: cot.totalAmount, supplierId: cot.supplierId, supplierNameFree: cot.supplierNameFree,
          }))
        }
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
  // Sólo para los tipos con cotización, que sí tienen borrador: EPP/otro se
  // crean y envían en un acto, así que no hay nada que autoguardar.
  useEffect(() => {
    if (!enabled || !isDraft || !dirty || draftPending) return
    const timer = window.setTimeout(() => {
      const snap = snapshotRef.current
      if (!snap.canSave) return
      autoSaveRef.current = true
      startTransition(() => draftAction(buildDraftRef.current()))
    }, AUTOSAVE_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, isDraft, dirty, draftPending, draftAction])

  return { buildDraftFormData }
}

export function useRequestForm({
  worksites, products, workers, editRequest,
  userPermissions = [], initialRequestType, prefillItems, initialWorksiteId,
}: {
  worksites: WorksiteOption[]; products: ProductOption[]; suppliers: SupplierOption[]; workers?: WorkerOption[]
  editRequest?: EditRequest; maxFileSizeMb: number; userRoles?: string[]; userPermissions?: string[]
  initialRequestType?: RequestType; prefillItems?: PrefillItem[]
  /** Faena sugerida por el enlace de entrada (ya validada contra el alcance en
   *  el servidor). Sin esto, "Reponer" desde Bodega abría la solicitud en la
   *  primera faena de la lista, que casi nunca es la que tiene el quiebre. */
  initialWorksiteId?: string
}) {
  const router = useRouter()
  const isEdit = !!editRequest
  const isDraft = !isEdit || editRequest.status === "draft"
  const requestTypeOpts = visibleRequestTypeOptions(userPermissions)
  const allowedInitialRequestType = initialRequestType && requestTypeOpts.some((option) => option.value === initialRequestType)
    ? initialRequestType
    : undefined
  const canDeleteRequest = isEdit
    && (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(editRequest.status)
    && (userPermissions.includes("requests:delete") || userPermissions.includes("requests:view_own"))
  const canCancelRequest = isEdit
    && isRequestCancellable(editRequest.status)
    && (userPermissions.includes("requests:create") || userPermissions.includes("requests:view_all"))

  const [draftState, draftAction, draftPending] = useActionState<ActionState & { requestId?: string }, FormData>(saveDraft, INITIAL_STATE)
  const [submitState, submitAction] = useActionState<ActionState, FormData>(submitRequest, INITIAL_STATE)
  const [cancelState, cancelAction] = useActionState<ActionState, FormData>(cancelRequest, INITIAL_STATE)
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteRequestAction, INITIAL_STATE)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [isSaving, startSaveTransition] = useTransition()
  const [isSubmitting, startSubmitTransition] = useTransition()
  // La misma clave acompaña el primer preflight y la decisión posterior. Así el
  // servidor puede hacer idempotente un doble clic o un reintento de red.
  const [submissionKey] = useState(() => nanoid())
  const [stockWarning, setStockWarning] = useState<EppStockWarning | null>(null)
  const submittedSnapshotRef = useRef<string | null>(null)
  const invalidateStockWarning = useCallback(() => {
    // También invalida una respuesta que siga en vuelo: si llega después de
    // editar el formulario, no puede abrir un diálogo para el payload anterior.
    submittedSnapshotRef.current = null
    setStockWarning(null)
  }, [])

  const [savedId, setSavedId] = useState(editRequest?.id)
  const [worksiteId, setWorksiteIdState] = useState(editRequest?.worksiteId ?? initialWorksiteId ?? (worksites[0]?.id ?? ""))
  const [requestType, setRequestTypeState] = useState(editRequest?.requestType ?? allowedInitialRequestType ?? requestTypeOpts[0]?.value ?? "epp")
  const [urgency, setUrgencyState] = useState(editRequest?.urgency ?? "normal")
  const [deliveryMode, setDeliveryModeState] = useState<string>(editRequest?.deliveryMode ?? "via_oficina")
  const [requiredDate, setRequiredDateState] = useState(editRequest?.requiredDate ?? "")
  const [notes, setNotesState] = useState(editRequest?.notes ?? "")
  const setWorksiteId = useCallback((value: string) => { invalidateStockWarning(); setWorksiteIdState(value) }, [invalidateStockWarning])
  const setRequestType = useCallback((value: string) => { invalidateStockWarning(); setRequestTypeState(value) }, [invalidateStockWarning])
  const setUrgency = useCallback((value: string) => { invalidateStockWarning(); setUrgencyState(value) }, [invalidateStockWarning])
  const setDeliveryMode = useCallback((value: string) => { invalidateStockWarning(); setDeliveryModeState(value) }, [invalidateStockWarning])
  const setRequiredDate = useCallback((value: string) => { invalidateStockWarning(); setRequiredDateState(value) }, [invalidateStockWarning])
  const setNotes = useCallback((value: string) => { invalidateStockWarning(); setNotesState(value) }, [invalidateStockWarning])

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
          // Sin esto la ficha de una solicitud ya enviada mostraba el selector de
          // colaborador vacío aunque el ítem sí tuviera uno asignado.
          variantQuantities: {}, workerId: item.workerId ?? "", workerName: item.workerName ?? "",
          equipmentCode: item.equipmentCode ?? "", equipmentLabel: item.equipmentLabel ?? "",
          emergencyResourceId: item.emergencyResourceId ?? "", emergencyResourceLabel: item.emergencyResourceLabel ?? "",
          showAttrs: !isQuotation && item.attributes.length > 0, cotizaciones: [],
          ...equipmentFromAttributes(editRequest.requestType, item.attributes),
          attributes: isQuotation ? [] : item.attributes.map((a) => {
            const prodAttr = prod?.attributes.find((pa) => pa.id === a.attributeId)
            return {
              attributeId: a.attributeId, attributeName: a.attributeName, value: a.value,
              isRequired: prodAttr?.isRequired ?? false, type: prodAttr?.type ?? "text",
              drivesQuantity: prodAttr?.drivesQuantity ?? false,
              options: parseAttributeOptions(prodAttr?.options),
            }
          }),
        }
      })
    }
    if (prefillItems && prefillItems.length > 0) {
      return prefillItems.map((prefill, index) => {
        const prod = prefill.productId ? products.find((p) => p.id === prefill.productId) : null
        const attrs = applyPrefillAttributeValues(prod ? buildAttrsFromProduct(prod) : [], prefill.attributes)
        return {
          // Esta llave llega a los id/htmlFor de los controles. Debe ser idéntica
          // durante SSR e hidratación; los UUID quedan reservados para ítems que
          // el usuario agrega después de montar el formulario.
          ...blankItemForType(`prefill-${index}`, requestType),
          productId:           prefill.productId,
          productNameFree:     prefill.productNameFree,
          productName:         prod?.name ?? prefill.productNameFree,
          quantity:            String(prefill.quantity),
          unitOfMeasure:       prefill.unitOfMeasure,
          urgency:             prefill.urgency,
          notes:               prefill.notes,
          workerId:            prefill.workerId ?? "",
          workerName:          prefill.workerName ?? "",
          equipmentCode:       prefill.equipmentCode ?? "",
          equipmentLabel:      prefill.equipmentLabel ?? "",
          emergencyResourceId: prefill.emergencyResourceId ?? "",
          emergencyResourceLabel: prefill.emergencyResourceLabel ?? "",
          suggestedSupplierId: prefill.suggestedSupplierId ?? "",
          supplierHint:        prefill.supplierHint ?? "",
          isEpp:               prod?.isEpp ?? false,
          attributes:          attrs,
          showAttrs:           attrs.length > 0,
          replenishmentGapKey: prefill.replenishmentGapKey,
        }
      })
    }
    // La primera fila se renderiza también en el servidor. Una clave estable
    // evita IDs distintos entre el HTML inicial y el primer render del cliente.
    return [blankItemForType("new-0", requestType)]
  })

  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  /**
   * Los tipos con cotización conservan el borrador (hay que adjuntar PDFs antes
   * de enviar). EPP/otro se crean y envían en un solo paso: sin borrador, sin
   * autoguardado y con una sola acción primaria.
   */
  const isQuotation = QUOTATION_TYPES.has(requestType)

  // ── Action-state watchers (toast on error / success) ──
  useActionWatchers({ submitState, cancelState, deleteState, router })

  const prevRequestTypeRef = useRef(requestType)
  useEffect(() => {
    const prev = prevRequestTypeRef.current
    prevRequestTypeRef.current = requestType
    if (prev === requestType || isEdit) return
    if (QUOTATION_TYPES.has(requestType) || QUOTATION_TYPES.has(prev)) {
      setItems([blankItemForType(nanoid(), requestType)])
    }
  }, [requestType, isEdit])

  /**
   * `nanoid` y no `crypto.randomUUID`: esta llave se genera dentro del updater
   * de `setItems`, que React ejecuta en fase de render. `randomUUID` sólo existe
   * en contextos seguros (https o localhost), así que abriendo la plataforma por
   * `http://<ip-del-servidor>` la llamada reventaba en pleno render, el error
   * boundary desmontaba el formulario y agregar un ítem se veía como si se
   * borraran los datos del anterior. `crypto.getRandomValues` —lo que usa
   * `nanoid`— está disponible en cualquier contexto.
   */
  const addItem = useCallback(() => {
    invalidateStockWarning()
    setItems((prev) => [...prev, blankItemForType(nanoid(), requestType)])
  }, [invalidateStockWarning, requestType])
  const removeItem = useCallback((key: string) => {
    invalidateStockWarning()
    setItems((prev) => prev.length > 1 ? prev.filter((i) => i._key !== key) : prev)
  }, [invalidateStockWarning])
  const updateItem = useCallback((key: string, patch: Partial<ItemRow>) => {
    invalidateStockWarning()
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i))
  }, [invalidateStockWarning])

  const selectProduct = useCallback((key: string, prodId: string) => {
    const prod = products.find((p) => p.id === prodId)
    if (!prod) return
    invalidateStockWarning()
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i
      const previousKind = i.productId ? products.find((p) => p.id === i.productId)?.equipmentKind ?? null : null
      const attrs = buildAttrsFromProduct(prod)
      // Cambiar de concepto no puede arrastrar datos del anterior: los atributos
      // se reconstruyen desde el producto nuevo (así el "Número de dosis" de una
      // vacuna desaparece) y el colaborador se descarta salvo que el nuevo
      // producto también lo pida (o sea EPP, donde es opcional).
      const keepsWorker = prod.requiresWorker || prod.isEpp
      // El equipo sólo sobrevive si el servicio nuevo atiende la misma familia;
      // si no, arrastrarlo dejaría un alcotest colgando de una mantención de
      // monogás (el servidor lo rechaza igual, pero acá no llega a pasar).
      const keepsEquipment = !!prod.equipmentKind && prod.equipmentKind === previousKind
      const keepsEmergencyResource = prod.serviceSubjectKind === "emergency_resource"
      return {
        ...i,
        productId: prod.id, productNameFree: "", productName: prod.name,
        unitOfMeasure: prod.unitOfMeasure, isEpp: prod.isEpp,
        suggestedSupplierId: prod.preferredSupplierId ?? "", supplierHint: "",
        attributes: attrs, variantQuantities: {}, showAttrs: attrs.length > 0,
        workerId: keepsWorker ? i.workerId : "",
        workerName: keepsWorker ? i.workerName : "",
        equipmentCode: keepsEquipment ? i.equipmentCode : "",
        equipmentLabel: keepsEquipment ? i.equipmentLabel : "",
        emergencyResourceId: keepsEmergencyResource ? i.emergencyResourceId : "",
        emergencyResourceLabel: keepsEmergencyResource ? i.emergencyResourceLabel : "",
      }
    }))
  }, [invalidateStockWarning, products])

  const selectFreeProduct = useCallback((key: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    invalidateStockWarning()
    setItems((prev) => prev.map((i) =>
      // Un ítem fuera de catálogo no tiene reglas de producto: pierde también el
      // colaborador que hubiera quedado de la selección anterior.
      i._key !== key ? i : { ...i, productId: null, productNameFree: trimmed, productName: trimmed, isEpp: false, unitOfMeasure: i.unitOfMeasure || "unidad", suggestedSupplierId: "", supplierHint: "", attributes: [], showAttrs: false, workerId: "", workerName: "", equipmentCode: "", equipmentLabel: "", emergencyResourceId: "", emergencyResourceLabel: "" }
    ))
  }, [invalidateStockWarning])

  const clearProduct = useCallback((key: string) => {
    invalidateStockWarning()
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : { ...i, productId: null, productNameFree: "", productName: "", isEpp: false, suggestedSupplierId: "", supplierHint: "", attributes: [], showAttrs: false, workerId: "", workerName: "", equipmentCode: "", equipmentLabel: "", emergencyResourceId: "", emergencyResourceLabel: "" }
    ))
  }, [invalidateStockWarning])

  const updateItemWorker = useCallback((key: string, workerId: string) => {
    // Limpiar la selección es un caso legítimo (el combobox manda ""), y antes
    // el early-return por "no encontré el trabajador" lo hacía imposible.
    if (!workerId) {
      invalidateStockWarning()
      setItems((prev) => prev.map((i) => i._key === key ? { ...i, workerId: "", workerName: "" } : i))
      return
    }
    if (!workers) return
    const worker = workers.find((w) => w.id === workerId)
    if (!worker) return
    invalidateStockWarning()
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i
      const selectedProduct = i.productId ? products.find((product) => product.id === i.productId) : null
      const variants = selectedProduct
        ? groupProductVariants(products).find((group) => group.variants.some((variant) => variant.id === selectedProduct.id))?.variants ?? []
        : []
      const matchingVariant = variants.find((variant) => variant.attributes.some((attribute) => {
        const suggestedSize = suggestSize(attribute.name, worker)
        const options = new Set(parseAttributeOptions(attribute.options).map(normalizeSizeLabel))
        return suggestedSize != null && options.has(suggestedSize)
      }))
      const product = matchingVariant ?? selectedProduct
      const attrs = (product ? buildAttrsFromProduct(product) : i.attributes).map((a) => {
        const size = suggestSize(a.attributeName, worker)
        // Se guarda la etiqueta del catálogo, no la normalizada: el valor de la
        // solicitud tiene que ser una de las opciones declaradas.
        const match = size ? a.options.find((option) => normalizeSizeLabel(option) === size) : undefined
        return match ? { ...a, value: match } : a
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
  }, [invalidateStockWarning, products, workers])

  const updateAttr = useCallback((itemKey: string, attrIdx: number, value: string) => {
    invalidateStockWarning()
    setItems((prev) => prev.map((i) => {
      if (i._key !== itemKey) return i
      const attrs = i.attributes.map((a, idx) => idx === attrIdx ? { ...a, value } : a)
      // Un atributo que gobierna la cantidad (nº de dosis) la escribe él: el
      // servidor la deriva igual, así que el formulario tiene que mostrar el
      // mismo número en vez de dejar dos campos que se contradicen.
      const driver = attrs.find((a) => a.drivesQuantity)
      const drivenQuantity = driver && /^\d+$/.test(driver.value.trim()) && Number(driver.value) >= 1
        ? driver.value.trim()
        : undefined
      return { ...i, attributes: attrs, ...(drivenQuantity ? { quantity: drivenQuantity } : {}) }
    }))
  }, [invalidateStockWarning])

  const itemsJson = useMemo(
    () => JSON.stringify(items.flatMap((item) => {
      const base = {
        id: item.id, productId: item.productId, productNameFree: item.productNameFree || null,
        unitOfMeasure: item.unitOfMeasure, urgency: item.urgency,
        requiredDate: requiredDate || null, suggestedSupplierId: item.suggestedSupplierId || null,
        supplierHint: item.supplierHint || null, notes: item.notes || null,
        workerId: item.workerId || null,
        equipmentCode: item.equipmentCode || null,
        emergencyResourceId: item.emergencyResourceId || null,
        partNumber: item.partNumber || null, location: item.location || null,
        equipmentName: item.equipmentName || null, patent: item.patent || null,
        brand: item.brand || null, model: item.model || null,
        // Sólo los atributos con valor: un opcional en blanco no es un dato, y
        // enviarlo hacía que el esquema del servidor rechazara la solicitud
        // entera con "Valor requerido" mientras el panel decía "Listo para
        // crear". Lo destapó el primer producto del catálogo con atributos
        // realmente opcionales (Marca/Modelo de un monogás).
        attributes: item.attributes.flatMap((a) => a.value.trim()
          ? [{ attributeId: a.attributeId, attributeName: a.attributeName, value: a.value.trim() }]
          : []),
        replenishmentGapKey: item.replenishmentGapKey ?? null,
      }
      return [{
        ...base,
        // Sin fallback: un campo vacío daba NaN y el `|| 1` lo convertía en una
        // cantidad de 1 que nadie escribió. NaN se serializa como null y el
        // esquema lo rechaza con "Cantidad debe ser mayor a 0".
        quantity: Number(item.quantity),
      }]
    })),
    [items, requiredDate],
  )

  const hasRealContent = items.some((item) => item.productId || item.productNameFree.trim() !== "")

  const { buildDraftFormData } = useDraftPersistence({
    enabled: isQuotation, isDraft, dirty, hasRealContent,
    savedId, setSavedId, setDirty, setLastSavedAt,
    itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes,
    items, setItems,
    draftState, draftAction, draftPending,
  })

  // All fields below form part of the server-side payload hash. Each editing
  // handler above invalidates the opaque confirmation before changing one of
  // these values, even if a later edit restores an earlier visible value.
  const directSubmissionSnapshot = useMemo(
    () => JSON.stringify([itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes]),
    [itemsJson, worksiteId, requestType, urgency, deliveryMode, requiredDate, notes],
  )

  useEffect(() => {
    const warning = isEppStockWarning(submitState.data) ? submitState.data : null
    if (!warning || submittedSnapshotRef.current !== directSubmissionSnapshot) return
    setStockWarning(warning)
  }, [submitState, directSubmissionSnapshot])

  const buildDirectSubmitFormData = useCallback((confirmationToken?: string) => {
    const formData = buildDraftFormData()
    formData.set("submissionKey", submissionKey)
    if (confirmationToken) formData.set("eppStockConfirmation", confirmationToken)
    return formData
  }, [buildDraftFormData, submissionKey])

  const submitDirectRequest = useCallback((confirmationToken?: string) => {
    submittedSnapshotRef.current = directSubmissionSnapshot
    startSubmitTransition(() => submitAction(buildDirectSubmitFormData(confirmationToken)))
  }, [buildDirectSubmitFormData, directSubmissionSnapshot, submitAction, startSubmitTransition])

  const dismissStockWarning = invalidateStockWarning

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

  /**
   * Guard de navegación interna.
   *
   * `beforeunload` sólo cubre cerrar o recargar la pestaña, y el botón "Volver"
   * tiene su propio diálogo: un clic en el rail, el breadcrumb o el TopBar
   * descartaba una solicitud a medio llenar sin preguntar nada. El App Router no
   * expone un hook de "antes de cambiar de ruta", así que se intercepta el clic
   * en el enlace en fase de captura — que es por donde pasa toda la navegación
   * interna— y se difiere hasta que la persona confirme.
   */
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  useEffect(() => {
    if (!isDraft || !dirty || !hasRealContent) return
    const onClick = (event: MouseEvent) => {
      // Respeta abrir en pestaña nueva, descargas y clics ya manejados.
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Un enlace a la misma ruta (anclas, filtros de la propia pantalla) no
      // desmonta el formulario, así que no hay nada que perder.
      if (url.pathname === window.location.pathname) return
      event.preventDefault()
      setPendingHref(url.pathname + url.search)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [isDraft, dirty, hasRealContent])

  function confirmLeave() {
    const href = pendingHref
    setPendingHref(null)
    if (!href) return
    if (beforeUnloadRef.current) {
      window.removeEventListener("beforeunload", beforeUnloadRef.current)
      beforeUnloadRef.current = null
    }
    router.push(href)
  }

  const readOnly = !isDraft
  const itemsError = draftState.fieldErrors?.items?.[0] ?? submitState.fieldErrors?.items?.[0]
  const requiredDateError = draftState.fieldErrors?.requiredDate?.[0] ?? submitState.fieldErrors?.requiredDate?.[0]
  const requestTypeLabel = requestTypeOpts.find((o) => o.value === requestType)?.label ?? requestType
  const urgencyLabel = URGENCY_OPTS.find((o) => o.value === urgency)?.label ?? urgency
  const worksiteLabel = worksites.find((w) => w.id === worksiteId)?.name ?? "Sin faena"
  const missingItems = buildRequestSummaryIssues({ worksiteId, requiredDate, items, requestType, notes, products })
  const statusLabel = editRequest ? requestStatusLabel(editRequest.status) : "Borrador"
  const submitMessage = submitState.message
  const submitOk = submitState.ok

  return {
    worksiteId, setWorksiteId, requestType, setRequestType, urgency, setUrgency, deliveryMode, setDeliveryMode,
    requiredDate, setRequiredDate, notes, setNotes, items, requestTypeOpts,
    isEdit, isDraft, isQuotation, readOnly, savedId, dirty, lastSavedAt, hasRealContent,
    requestTypeLabel, urgencyLabel, worksiteLabel, missingItems, statusLabel,
    itemsError, requiredDateError, submitMessage, submitOk,
    stockWarning, dismissStockWarning, submitDirectRequest,
    canDeleteRequest, canCancelRequest, deleteConfirmOpen, setDeleteConfirmOpen,
    isSaving, isSubmitting, isDeleting, draftPending,
    addItem, removeItem, updateItem, selectProduct, selectFreeProduct, clearProduct,
    updateItemWorker, updateAttr,
    buildDraftFormData, draftAction, submitAction, cancelAction, deleteAction,
    startSaveTransition, startSubmitTransition, startDeleteTransition, silentNavBack,
    pendingHref, setPendingHref, confirmLeave,
  }
}
