"use client"

import * as React from "react"
import { useActionState } from "react"
import { Trash, FilePdf, Warning, Plus, X, Eye, ArrowsClockwise } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import { SubmitButton } from "@/components/ui/submit-button"
import { Field } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { FileInput } from "@/components/ui/file-input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { formatCLP, formatDate, formatDateTime } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { areEquivalentUnits, matchInvoiceItemsToPurchaseOrderItems } from "@/lib/services/purchasing-module/invoice-item-matching"
import { useOperation } from "@/lib/hooks/use-operation"
import type { InvoiceEvidenceStatus, InvoiceReconciliationEvidence } from "@/lib/services/purchasing-module/invoice-reconciliation"
import { InvoiceReconciliationCard } from "./invoice-reconciliation-card"
import { addInvoiceAction, deleteInvoiceAction } from "../invoice-actions"
import { ORDER_REFERENCE_META, type DteCandidateOrderReference } from "@/lib/services/purchasing-module/order-reference"
import { attachDteAsInvoice } from "../actions/dte-use-invoice"
import { analyzeDteCandidateLines } from "../actions/dte-analyze-lines"
import { dteTipoLabel } from "@/lib/services/dte-portal/labels"
import type { DteCandidateConfidence, DteCandidateMatchType } from "@/lib/services/purchasing-module/dte-candidates"
import {
  InvoiceReceiptAssociationDialog,
  type InvoiceReceiptOption,
  type InvoiceReceiptSuggestionView,
} from "./invoice-receipt-association-dialog"

/**
 * DTE del proveedor de esta OC que aún no cuelga de ninguna factura.
 * Son documentos que la plataforma puede registrar y adjuntar de una vez.
 */
export interface DteCandidate {
  id: string
  tipoDte: string
  folio: number
  razonSocialEmisor: string
  montoTotal: number
  fechaEmision: string
  /**
   * El monto del documento calza con lo que la OC espera facturar. La operación
   * factura una OC por DTE, así que esto identifica al candidato correcto casi
   * siempre — pero es una señal, no un filtro: la lista igual muestra los demás.
   */
  amountMatches: boolean
  /**
   * El XML del proveedor cita el código de esta OC en `<Referencia>`. Es la
   * evidencia más fuerte que puede traer un candidato: la escribió el proveedor
   * mirando nuestra orden, no la infirió la plataforma.
   */
  referencesOrder: boolean
  orderReference: DteCandidateOrderReference
  confidence: DteCandidateConfidence
  enrichmentStatus: "pending" | "ready" | "failed"
  lineEnrichedAt: string | null
  lines: Array<{
    id: string
    lineNumber: number
    productCode: string | null
    productName: string
    unitOfMeasure: string | null
    quantity: number
    unitPrice: number
    amount: number
  }>
  proposedLinks: Array<{
    dteItemId: string
    purchaseOrderItemId: string | null
    matchType: DteCandidateMatchType
    quantityStatus: "exact" | "under" | "over" | "not_evaluable"
  }>
  explanation: {
    totalLines: number
    matchedLines: number
    ambiguousLines: number
    unitMismatches: number
    quantityExactLines: number
    quantityUnderLines: number
    quantityOverLines: number
  }
}

const EMPTY_DTE_CANDIDATES: DteCandidate[] = []

export interface OcItem {
  id: string
  catalogProductId: string | null
  productName: string
  productCode: string | null
  attributes?: Array<{ name: string; value: string }>
  unitOfMeasure: string
  quantity: number
  /** `null` is a service whose purchase cost is still pending, never $0. */
  unitPrice: number | null
  subtotal: number | null
}

function dteOcItemLabel(item: OcItem) {
  const parts = [item.productName]
  for (const attribute of item.attributes ?? []) {
    if (attribute.name.trim() && attribute.value.trim()) {
      parts.push(`${attribute.name}: ${attribute.value}`)
    }
  }
  parts.push(`${item.quantity} ${item.unitOfMeasure}`)
  return parts.join(" · ")
}

export interface InvoiceRow {
  id: string
  invoiceNumber: string
  amount: number | null
  issueDate: string | null
  fileName: string
  mimeType: string | null
  uploadedAt: string
  receiptIds?: string[]
  receiptSuggestion?: InvoiceReceiptSuggestionView
  items?: Array<{
    id: string
    purchaseOrderItemId: string | null
    productName: string
    productCode: string | null
    unitOfMeasure: string | null
    quantity: number
    unitPrice: number
    subtotal: number
  }>
}

export function InvoicesSection({
  purchaseOrderId,
  invoices,
  ocItems,
  reconciliation,
  canManage,
  canUpdateCatalog,
  canAttach = canManage,
  receipts = [],
  defaultReceiptId,
  dteCandidates = EMPTY_DTE_CANDIDATES,
}: {
  purchaseOrderId: string
  invoices: InvoiceRow[]
  ocItems: OcItem[]
  reconciliation: InvoiceReconciliationEvidence
  /** Puede intervenir las facturas ya adjuntadas (eliminarlas). */
  canManage: boolean
  canUpdateCatalog: boolean
  /**
   * Puede adjuntar facturas nuevas. Son dos permisos distintos porque una OC
   * anulada conserva la sección sólo para soltar el DTE que quedó colgado: el
   * servicio rechaza el alta en `cancelled` y ofrecer el formulario sería una
   * carga que falla siempre. Por defecto sigue a `canManage`.
   */
  canAttach?: boolean
  /** Recepciones del proveedor disponibles para el vínculo documental opcional. */
  receipts?: InvoiceReceiptOption[]
  /** Recepción desde la que se abrió la OC; queda preseleccionada, nunca usada como folio. */
  defaultReceiptId?: string
  /** DTE del proveedor sin vincular, ofrecidos para registro directo. */
  dteCandidates?: DteCandidate[]
}) {
  const invoiceReconciliation = new Map(reconciliation.invoices.map((invoice) => [invoice.invoiceId, invoice]))

  return (
    <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-(--color-text)">
          Facturas
          {invoices.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-surface-2 text-(--color-text-muted) text-xs font-medium px-2 py-0.5">
              {invoices.length}
            </span>
          )}
        </h2>
      </div>

      <InvoiceReconciliationCard
        purchaseOrderId={purchaseOrderId}
        reconciliation={reconciliation}
        invoices={invoices}
        canAccept={canManage}
        canUpdateCatalog={canUpdateCatalog}
      />

      {/* Invoice list */}
      {invoices.length === 0 ? (
        // A4: sin facturas, la sección *es* el formulario de adjuntar — el texto
        // plano no ofrecía ninguna acción donde justamente falta hacerla. A quien
        // no puede adjuntar sí le queda el texto, que es lo único que aplica.
        !canAttach && <p className="text-xs text-text-subtle py-2">Sin facturas adjuntadas.</p>
      ) : (
        <ul className="divide-y divide-(--color-border) mb-3">
          {invoices.map((inv) => (
            <InvoiceItem
              key={inv.id}
              invoice={inv}
              purchaseOrderId={purchaseOrderId}
              canManage={canManage}
              lineEvidence={invoiceReconciliation.get(inv.id)}
              receipts={receipts}
            />
          ))}
        </ul>
      )}

      {/* Add invoice form */}
      {canAttach && (
        invoices.length === 0
          ? (
            <AddInvoiceForm
              purchaseOrderId={purchaseOrderId}
              ocItems={ocItems}
              receipts={receipts}
              defaultReceiptId={defaultReceiptId}
              separated={false}
              dteCandidates={dteCandidates}
            />
          )
          : (
            // A3: con facturas arriba, la sección es la lista y el alta se pliega
            // —excepción de "estación de captura repetitiva"— con la preferencia
            // recordada. Sin facturas no hay lista que tapar: el formulario *es*
            // el contenido y queda abierto.
            <CollapsedInvoiceForm defaultOpen={Boolean(defaultReceiptId)}>
              <AddInvoiceForm
                purchaseOrderId={purchaseOrderId}
                ocItems={ocItems}
                receipts={receipts}
                defaultReceiptId={defaultReceiptId}
                separated={false}
                heading={false}
                dteCandidates={dteCandidates}
              />
            </CollapsedInvoiceForm>
          )
      )}
    </section>
  )
}

/* ── Collapsed add-invoice form ─────────────────────────────────────────────── */

const FORM_OPEN_KEY = "oc_invoice_form_open"

/**
 * `<details>` nativo en vez de un colapsable propio: el navegador ya resuelve
 * teclado, foco y semántica. La preferencia se recuerda porque quien carga
 * varias facturas seguidas no debería reabrirlo en cada OC, y se lee después de
 * montar para no romper la hidratación.
 */
function CollapsedInvoiceForm({ children, defaultOpen }: { children: React.ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen)

  React.useEffect(() => {
    if (defaultOpen) return
    try { setOpen(localStorage.getItem(FORM_OPEN_KEY) === "1") } catch { /* almacenamiento bloqueado */ }
  }, [defaultOpen])

  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open
        setOpen(next)
        try { localStorage.setItem(FORM_OPEN_KEY, next ? "1" : "0") } catch { /* almacenamiento bloqueado */ }
      }}
      className="mt-1 border-t border-(--color-border) pt-3"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-(--color-text)">
        <Plus size={14} weight="bold" aria-hidden />
        Adjuntar factura
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

/* ── Invoice list item ──────────────────────────────────────────────────────── */

function InvoiceItem({
  invoice,
  purchaseOrderId,
  canManage,
  lineEvidence,
  receipts,
}: {
  invoice: InvoiceRow
  purchaseOrderId: string
  canManage: boolean
  lineEvidence?: InvoiceEvidenceStatus
  receipts: InvoiceReceiptOption[]
}) {
  const [state, action] = useActionState<ActionState, FormData>(deleteInvoiceAction, INITIAL_STATE)
  const [pending, startTransition] = React.useTransition()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state])

  function handleConfirmDelete() {
    const formData = new FormData()
    formData.set("invoiceId", invoice.id)
    formData.set("purchaseOrderId", purchaseOrderId)
    startTransition(() => {
      action(formData)
    })
    setConfirmOpen(false)
  }

  const lineEvidenceLabel = lineEvidence && {
    without_lines: "Líneas no evaluables",
    unlinked_lines: "Líneas sin vínculo a la OC",
    partial: "Líneas parcialmente vinculadas",
    linked_lines: "Líneas vinculadas a la OC",
  }[lineEvidence.status]
  const invoiceReceiptIds = invoice.receiptIds ?? []
  const invoiceReceiptIdSet = new Set(invoiceReceiptIds)
  const linkedReceipts = receipts.filter((receipt) => invoiceReceiptIdSet.has(receipt.id))

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex items-start gap-2 min-w-0">
        <FilePdf size={16} className="mt-0.5 shrink-0 text-text-subtle" />
        <div className="min-w-0">
          <a
            href={`/api/purchase-orders/invoices/${invoice.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-(--color-text) hover:underline truncate block"
          >
            {invoice.invoiceNumber}
          </a>
          <p className="text-[11px] text-text-subtle mt-0.5">
            {invoice.amount != null ? formatCLP(invoice.amount) : "—"}
            {invoice.issueDate ? ` · ${formatDate(invoice.issueDate)}` : ""}
          </p>
          {lineEvidenceLabel && (
            <p className={`mt-1 text-[11px] ${
              lineEvidence?.status === "linked_lines"
                ? "text-[var(--color-success-ink)]"
                : lineEvidence?.status === "without_lines"
                  ? "text-(--color-text-subtle)"
                  : "text-[var(--color-warning-ink)]"
            }`}>
              {lineEvidenceLabel}
            </p>
          )}
          <p className="mt-1 text-[11px] text-(--color-text-muted)">
            {linkedReceipts.length > 0
              ? `Recepciones: ${linkedReceipts.map((receipt) => receipt.code).join(", ")}`
              : "Sin recepción asociada"}
          </p>
          {invoice.items && invoice.items.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {invoice.items.map((item) => (
                <li key={item.id} className="text-[10px] text-text-subtle flex justify-between gap-2">
                  <span title={item.productName} className="truncate">{item.productName}</span>
                  <span className="font-mono tabular-nums shrink-0">{item.quantity} {item.unitOfMeasure ?? "sin unidad"} × {formatCLP(item.unitPrice)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {canManage && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <InvoiceReceiptAssociationDialog
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            purchaseOrderId={purchaseOrderId}
            receipts={receipts}
            currentReceiptIds={invoiceReceiptIds}
            suggestion={invoice.receiptSuggestion ?? {
              receiptIds: [], confidence: "low", ambiguous: false,
              reasons: ["No hay evidencia suficiente para sugerir una recepción."],
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Eliminar factura ${invoice.invoiceNumber}`}
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
          >
            <Trash size={14} aria-hidden />
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Eliminar factura"
            description={`La factura ${invoice.invoiceNumber} será eliminada permanentemente. Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            variant="destructive"
            loading={pending}
            onConfirm={handleConfirmDelete}
          />
        </div>
      )}
    </li>
  )
}

/* ── Add invoice form ───────────────────────────────────────────────────────── */

interface InvoiceLineItem {
  id: string
  ocItemId: string
  productName: string
  productCode: string
  unitOfMeasure: string
  quantity: string
  unitPrice: string
  resolution: "matched" | "needs_review" | "unlinked"
}

function createInvoiceLineId() {
  return globalThis.crypto?.randomUUID?.() ?? `invoice-line-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function AddInvoiceForm({
  purchaseOrderId,
  ocItems,
  receipts,
  defaultReceiptId,
  separated = true,
  heading = true,
  dteCandidates = [],
}: {
  purchaseOrderId: string
  ocItems: OcItem[]
  receipts: InvoiceReceiptOption[]
  defaultReceiptId?: string
  /** Con facturas arriba el formulario se separa con una línea; sin ellas la línea quedaba colgando. */
  separated?: boolean
  /** Plegado, el rótulo lo pone el `<summary>`: repetirlo dejaba dos títulos. */
  heading?: boolean
  dteCandidates?: DteCandidate[]
}) {
  const [state, action] = useActionState<ActionState, FormData>(addInvoiceAction, INITIAL_STATE)
  const formRef = React.useRef<HTMLFormElement>(null)
  const [lineItems, setLineItems] = React.useState<InvoiceLineItem[]>([])
  const [dteParsed, setDteParsed] = React.useState(false)
  const [hasExtractedDocumentTotal, setHasExtractedDocumentTotal] = React.useState(false)
  const [extractionWarnings, setExtractionWarnings] = React.useState<string[]>([])
  const [supplierRutMissing, setSupplierRutMissing] = React.useState(false)
  const invoiceNumberRef = React.useRef<HTMLInputElement>(null)
  // El total documental extraído puede ser bruto mientras las líneas son netas.
  // Cuando no existe cabecera usable, el formulario conserva el guard de suma
  // de líneas; en ambos casos el servidor vuelve a validar la fuente elegida.
  // El monto necesita estado propio: cuando la extracción trae total pero no
  // líneas, el campo llevaba `value` sin `onChange` y React lo volvía inmutable,
  // justo en el caso en que el propio flujo pide "corrige los montos".
  const [amount, setAmount] = React.useState("")
  // Estado controlado en vez de ref imperativo: DatePicker guarda el valor en
  // React, así que form.reset() del navegador no lo limpiaría solo.
  const [issueDate, setIssueDate] = React.useState("")
  const dteOperation = useOperation()
  const router = useRouter()
  const [refreshPending, startRefresh] = React.useTransition()
  const [refreshMessage, setRefreshMessage] = React.useState("")
  const lastRefreshAt = React.useRef<number | null>(null)
  const [selectedDte, setSelectedDte] = React.useState<DteCandidate | null>(null)
  const [dteResolutions, setDteResolutions] = React.useState<Record<string, { purchaseOrderItemId: string | null; rememberAlias: boolean }>>({})
  const [selectedReceiptIds, setSelectedReceiptIds] = React.useState<string[]>(() => (
    defaultReceiptId && receipts.some((receipt) => receipt.id === defaultReceiptId) ? [defaultReceiptId] : []
  ))

  const refreshCandidates = React.useCallback((source: "button" | "focus") => {
    lastRefreshAt.current = Date.now()
    setRefreshMessage(source === "button" ? "Analizando DTE pendientes…" : "Revisando nuevos DTE…")
    startRefresh(async () => {
      // Sólo el clic sale al portal. Hacerlo también al volver a la pestaña
      // convertiría un gesto pasivo en descargas con las credenciales de la
      // empresa cada vez que alguien cambia de ventana.
      if (source === "button") {
        const analysis = await analyzeDteCandidateLines(purchaseOrderId)
        setRefreshMessage(analysis.message)
        if (!analysis.ok) {
          toast.error(analysis.message)
          return
        }
      } else {
        setRefreshMessage("")
      }
      router.refresh()
    })
  }, [router, purchaseOrderId])

  React.useEffect(() => {
    lastRefreshAt.current = Date.now()
    function handleFocus() {
      if (lastRefreshAt.current !== null && Date.now() - lastRefreshAt.current >= 60_000) refreshCandidates("focus")
    }
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [refreshCandidates])

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setIssueDate("")
      setAmount("")
      setHasExtractedDocumentTotal(false)
      setLineItems([])
      setDteParsed(false)
      setExtractionWarnings([])
      setSupplierRutMissing(false)
    } else if (!state.ok && state.message && "fieldErrors" in state) {
      toast.error(state.message)
    }
  }, [state])

  function addLineItem() {
    // Add next unadded OC item
    const usedIds = new Set(lineItems.map((li) => li.ocItemId))
    const nextItem = ocItems.find((oci) => !usedIds.has(oci.id))
    if (nextItem) {
      setLineItems((prev) => [
        ...prev,
        {
          id: createInvoiceLineId(),
          ocItemId: nextItem.id,
          productName: nextItem.productName,
          productCode: nextItem.productCode ?? "",
          unitOfMeasure: nextItem.unitOfMeasure,
          quantity: String(nextItem.quantity),
          unitPrice: nextItem.unitPrice === null ? "" : String(nextItem.unitPrice),
          resolution: "matched",
        },
      ])
    }
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index))
  }

  function updateLineItem(index: number, field: keyof InvoiceLineItem, value: string) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } as InvoiceLineItem : item)))
  }

  function updateLineItemAssociation(index: number, value: string) {
    const selected = ocItems.find((item) => item.id === value)
    setLineItems((prev) => prev.map((item, i) => {
      if (i !== index) return item
      if (value === "__unlinked") return { ...item, ocItemId: "", resolution: "unlinked" }
      if (!selected) return { ...item, ocItemId: "", resolution: "needs_review" }
      return { ...item, ocItemId: selected.id, resolution: "matched" }
    }))
  }

  // ── File auto-detection (XML, PDF, images) ─────────────────────────────────
  const [extracting, setExtracting] = React.useState(false)

  async function handleFileChange(file: File | null) {
    if (!file) {
      setDteParsed(false)
      setAmount("")
      setHasExtractedDocumentTotal(false)
      setExtractionWarnings([])
      setSupplierRutMissing(false)
      return
    }

    // Only auto-extract for supported types
    const supportedTypes = ["application/xml", "text/xml", "application/pdf", "image/jpeg", "image/png"]
    const isSupported = supportedTypes.includes(file.type) || file.name.endsWith(".xml")
    if (!isSupported) {
      setDteParsed(false)
      return
    }

    setExtracting(true)
    try {
      const formData = new FormData()
      formData.set("file", file)

      const response = await fetch("/api/purchase-orders/invoices/extract", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        toast.error("No se pudo extraer datos del archivo")
        return
      }

      const result = await response.json()

      if (!result.ok || !result.data) {
        toast.error(result.error || "No se pudo extraer datos del archivo")
        return
      }

      const { data, method, quality } = result
      const warnings: string[] = Array.isArray(result.warnings)
        ? result.warnings.filter((warning: unknown): warning is string => typeof warning === "string")
        : []

      applyExtraction({ data, method, quality, warnings })
    } catch {
      toast.error("Error al procesar el archivo")
    } finally {
      setExtracting(false)
    }
  }

  /**
   * Vuelca en el formulario los datos leídos de un documento, vengan del
   * archivo que subió el operador o del DTE que la plataforma ya tenía.
   *
   * Es una sola función y no dos porque el resultado debe ser idéntico por
   * ambos caminos: mismo cruce de ítems, mismo aviso, misma exigencia de
   * revisión. Duplicarla era garantizar que con el tiempo divergieran.
   */
  function applyExtraction({
    data,
    method,
    quality,
    warnings,
  }: {
    data: {
      invoiceNumber?: string | null
      issueDate?: string | null
      totalAmount?: number | null
      supplierRut?: string | null
      items?: Array<{
        productName: string
        productCode: string | null
        unitOfMeasure: string | null
        quantity: number
        unitPrice: number
      }>
    }
    method: string
    quality?: { totalsConsistent?: boolean }
    warnings: string[]
  }) {
    setExtractionWarnings(warnings)
    setSupplierRutMissing(!data.supplierRut?.trim())

    // Auto-fill form fields
    if (data.invoiceNumber && invoiceNumberRef.current) {
      invoiceNumberRef.current.value = data.invoiceNumber
    }
    const hasDocumentTotal = typeof data.totalAmount === "number" && Number.isFinite(data.totalAmount) && data.totalAmount >= 0
    setHasExtractedDocumentTotal(hasDocumentTotal)
    setAmount(hasDocumentTotal ? String(data.totalAmount) : "")
    if (data.issueDate) {
      setIssueDate(data.issueDate)
    }

    // Auto-match items to OC items
    if (data.items && data.items.length > 0) {
      const matched = matchInvoiceItemsToPurchaseOrderItems(data.items, ocItems)
      setLineItems(matched.map((m) => ({
        id: createInvoiceLineId(),
        ocItemId: m.ocItemId ?? "",
        productName: m.item.productName,
        productCode: m.item.productCode ?? "",
        unitOfMeasure: m.item.unitOfMeasure ?? "",
        quantity: String(m.item.quantity),
        unitPrice: String(m.item.unitPrice),
        resolution: m.ocItemId ? "matched" : "needs_review",
      })))
    } else {
      setLineItems([])
    }

    setDteParsed(true)

    const methodLabel = method === "dte_xml" ? "DTE XML"
      : method === "dte_portal" ? "DTE del portal"
      : method === "pdf_text" ? "PDF"
      : method === "pdf_text_ocr" ? "PDF + OCR"
      : method === "ocr" ? "OCR" : ""
    // Antes decía "95% confianza" sobre un puntaje que sólo contaba campos
    // presentes: un folio mal leído puntuaba igual que uno correcto y el
    // número invitaba a firmar sin mirar. Ahora se nombra lo que se midió y se
    // pide revisión explícita cuando el documento no cuadra consigo mismo.
    const itemCount = data.items?.length ?? 0
    toast.success(
      `Datos leídos del documento (${methodLabel}): ${itemCount} ítem(s). Revisa montos y líneas antes de adjuntar.`,
    )
    if (quality?.totalsConsistent === false) {
      toast.error("Neto + IVA no cuadra con el total leído: corrige los montos antes de adjuntar.")
    }
  }

  function openDteResolution(doc: DteCandidate) {
    setSelectedDte(doc)
    setDteResolutions(Object.fromEntries(doc.lines.map((line) => {
      const proposed = doc.proposedLinks.find((link) => link.dteItemId === line.id)
      return [line.id, {
        purchaseOrderItemId: proposed?.purchaseOrderItemId ?? null,
        rememberAlias: false,
      }]
    })))
  }

  function handleUseDte(doc: DteCandidate) {
    const lineResolutions = doc.lines.length > 0
      ? doc.lines.map((line) => ({
          dteDocumentItemId: line.id,
          purchaseOrderItemId: dteResolutions[line.id]?.purchaseOrderItemId ?? null,
          rememberAlias: dteResolutions[line.id]?.rememberAlias ?? false,
        }))
      : undefined
    dteOperation.run(async () => {
      const result = await attachDteAsInvoice({
        purchaseOrderId,
        dteDocumentId: doc.id,
        lineResolutions,
        receiptIds: selectedReceiptIds,
      })
      if (!result.ok) toast.error(result.message)
      return result
    }, () => {
      setSelectedDte(null)
      toast.success(`Factura ${doc.folio} adjuntada correctamente`)
    })
  }

  const totalItems = lineItems.reduce((sum, li) => {
    const qty = parseFloat(li.quantity) || 0
    const price = parseFloat(li.unitPrice) || 0
    return sum + qty * price
  }, 0)
  const unresolvedLineCount = lineItems.filter((item) => item.resolution === "needs_review").length
  const lastCandidateAnalysis = dteCandidates
    .flatMap((candidate) => candidate.lineEnrichedAt ? [candidate.lineEnrichedAt] : [])
    .sort((left, right) => right.localeCompare(left))[0]

  return (
    <form
      ref={formRef}
      action={action}
      className={separated ? "mt-1 border-t border-(--color-border) pt-3 space-y-2" : "space-y-2"}
    >
      {heading && <h3 className="text-sm font-semibold text-(--color-text)">Adjuntar factura</h3>}
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      <ReceiptSelection
        receipts={receipts}
        selectedIds={selectedReceiptIds}
        onChange={setSelectedReceiptIds}
      />

      {!state.ok && state.message && !("fieldErrors" in state) && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
          <Warning size={12} weight="bold" />
          {state.message}
        </p>
      )}

      {/* Va antes del campo de archivo porque es el atajo: si el documento ya
          está en la plataforma, bajarlo del portal para volver a subirlo es
          trabajo que la máquina ya hizo. Subir el archivo sigue disponible
          abajo para lo que no llega por el portal. */}
      <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-(--color-text)">
              DTE de este proveedor sin registrar ({dteCandidates.length})
            </p>
            <Button type="button" variant="ghost" size="sm" loading={refreshPending} onClick={() => refreshCandidates("button")}>
              <ArrowsClockwise size={14} aria-hidden />
              Actualizar sugerencias
            </Button>
          </div>
          {/* El resultado del análisis manda sobre el estado de reposo: decir
              "sugerencias actualizadas" después de pedirlo tapaba justo lo que
              hay que saber (cuántos quedaron sin XML, cuántos faltan). */}
          <p aria-live="polite" className="mt-0.5 min-h-4 text-[11px] text-(--color-text-subtle)">
            {(refreshMessage
              || (lastCandidateAnalysis
                ? `Último análisis de líneas: ${formatDateTime(lastCandidateAnalysis)}.`
                : "Sin análisis de líneas todavía: pulsa «Actualizar sugerencias» para pedírselo al portal."))}
          </p>
          <p className="mt-0.5 text-xs text-(--color-text-subtle)">
            Llegaron por el portal tributario desde que se creó esta orden. Usa uno para registrar la
            factura y adjuntar su PDF sin volver a subir el archivo.
          </p>
          {dteCandidates.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {dteCandidates.map((doc) => (
              <DteCandidateRow
                key={doc.id}
                doc={doc}
                // `pending` es del formulario entero: sin acotarlo, adjuntar uno
                // ponía "Adjuntando…" en las quince filas a la vez.
                usePending={dteOperation.pending && selectedDte?.id === doc.id}
                disabled={dteOperation.pending}
                onUse={() => openDteResolution(doc)}
              />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-(--color-text-subtle)">No hay DTE elegibles sin registrar para esta orden.</p>
          )}
        </div>

      <DteResolutionDialog
        doc={selectedDte}
        ocItems={ocItems}
        resolutions={dteResolutions}
        onResolutionChange={(lineId, purchaseOrderItemId) => setDteResolutions((current) => ({
          ...current,
          [lineId]: { purchaseOrderItemId, rememberAlias: false },
        }))}
        onRememberChange={(lineId, rememberAlias) => setDteResolutions((current) => ({
          ...current,
          [lineId]: { purchaseOrderItemId: current[lineId]?.purchaseOrderItemId ?? null, rememberAlias },
        }))}
        onOpenChange={(open) => { if (!open && !dteOperation.pending) setSelectedDte(null) }}
        onConfirm={() => { if (selectedDte) handleUseDte(selectedDte) }}
        pending={dteOperation.pending}
      />

      {/* El archivo va primero porque es lo que rellena todo lo de abajo (DTE/OCR):
          pidiéndolo al final, el operador tipeaba a mano datos que el documento
          traía, y tenía que encontrarlo tras cuatro campos ya llenos. */}
      <Field
        label="Archivo"
        htmlFor="invoice-file"
        helper="PDF, JPG, PNG o XML (DTE): se auto-extraen los datos"
      >
        <FileInput
          id="invoice-file"
          name="file"
          accept="application/pdf,image/jpeg,image/png,application/xml,text/xml"
          required
          onChange={handleFileChange}
          disabled={extracting || dteOperation.pending}
        />
      </Field>

      {extracting && (
        <p className="text-[11px] text-(--color-text-muted) flex items-center gap-1">
          <span className="inline-block animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
          Procesando archivo...
        </p>
      )}

      {dteParsed && !extracting && (
        <p className="flex items-center gap-1 text-[11px] text-[var(--color-success-ink)]">
          ✓ Datos extraídos del archivo: campos auto-completados
        </p>
      )}

      {extractionWarnings.length > 0 && !extracting && (
        <div role="alert" className="rounded border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-2 py-1.5 text-[11px] text-[var(--color-warning-ink)]">
          <p className="font-medium">Revisión requerida</p>
          <ul className="mt-0.5 list-disc pl-4">
            {extractionWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}

      {supplierRutMissing && !extracting && (
        <div role="alert" className="rounded border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-2 py-2 text-[11px] text-[var(--color-warning-ink)]">
          <p className="font-medium">No se pudo verificar el RUT del proveedor desde el archivo.</p>
          <Checkbox
            id="confirm-unverified-supplier"
            name="confirmUnverifiedSupplier"
            label="Adjuntar de todas formas y mantener la conciliación en revisión"
          />
        </div>
      )}

      <Field
        label="N° de factura"
        htmlFor="invoice-number"
        error={state.fieldErrors?.invoiceNumber?.[0]}
      >
        <Input
          ref={invoiceNumberRef}
          id="invoice-number"
          name="invoiceNumber"
          placeholder="Ej: 000123"
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Monto total"
          htmlFor="invoice-amount"
          error={state.fieldErrors?.amount?.[0]}
        >
          <Input
            id="invoice-amount"
            name="amount"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            value={lineItems.length > 0 && !hasExtractedDocumentTotal ? String(Math.round(totalItems)) : amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={lineItems.length > 0}
            className={lineItems.length > 0 ? "bg-surface-2" : ""}
          />
        </Field>

        <Field
          label="Fecha de emisión"
          htmlFor="invoice-issue-date"
          error={state.fieldErrors?.issueDate?.[0]}
        >
          <DatePicker
            id="invoice-issue-date"
            name="issueDate"
            value={issueDate}
            onChange={setIssueDate}
            error={Boolean(state.fieldErrors?.issueDate?.[0])}
          />
        </Field>
      </div>

      {/* Line items */}
      {(ocItems.length > 0 || lineItems.length > 0) && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-(--color-text-muted)">Ítems de factura</p>
            {lineItems.length < ocItems.length && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addLineItem}
                className="shrink-0"
              >
                <Plus size={12} aria-hidden /> Agregar ítem
              </Button>
            )}
          </div>

          {lineItems.map((li, index) => {
            const ocItem = ocItems.find((oci) => oci.id === li.ocItemId)
            const unitMismatch = Boolean(
              li.unitOfMeasure
              && ocItem
              && !areEquivalentUnits(li.unitOfMeasure, ocItem.unitOfMeasure),
            )
            return (
              <div key={li.id} className="flex items-end gap-1.5 rounded border border-(--color-border) p-2 bg-surface-2">
                <div className="flex-1 min-w-0">
                  <p title={li.productName || "Ítem"} className="text-[10px] text-text-subtle truncate mb-1">Documento: {li.productName || "Ítem sin descripción"}</p>
                  <OptionSelect
                    aria-label={`Asociar línea ${index + 1} a un ítem de la orden de compra`}
                    value={li.ocItemId || (li.resolution === "unlinked" ? "__unlinked" : "")}
                    onValueChange={(value) => updateLineItemAssociation(index, value)}
                    placeholder="Selecciona ítem de OC"
                    options={[
                      ...ocItems.map((item) => ({ value: item.id, label: item.productName })),
                      { value: "__unlinked", label: "Mantener sin asociar a la OC" },
                    ]}
                    className={`mb-1 h-11 min-w-0 px-1.5 text-[11px] sm:h-8 ${li.resolution === "needs_review" ? "border-[var(--color-warning)]" : ""}`}
                  />
                  {li.resolution === "needs_review" && (
                    <p className="mb-1 text-[10px] text-[var(--color-warning-ink)]">Esta línea no se asociará hasta que selecciones un ítem de la OC o confirmes que queda sin asociar.</p>
                  )}
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input
                      name={`item_qty_${index}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={li.quantity}
                      onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                      placeholder="Cant."
                      className="h-11 text-xs sm:h-7"
                    />
                    <Input
                      name={`item_price_${index}`}
                      type="number"
                      min="0"
                      step="1"
                      value={li.unitPrice}
                      onChange={(e) => updateLineItem(index, "unitPrice", e.target.value)}
                      placeholder={ocItem?.unitPrice === null ? "Precio documento" : "Precio"}
                      className="h-11 text-xs sm:h-7"
                    />
                  </div>
                  {ocItem?.unitPrice === null && (
                    <p className="mt-1 text-[10px] text-[var(--color-warning-ink)]">
                      Costo de OC pendiente: ingresa el precio indicado por la factura.
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-text-subtle">
                    Unidad documento: <span className="font-medium text-(--color-text)">{li.unitOfMeasure || "no declarada"}</span>
                    {ocItem && <> · OC: {ocItem.unitOfMeasure}</>}
                  </p>
                  {unitMismatch && <p className="mt-1 text-[10px] text-[var(--color-warning-ink)]">La unidad del documento difiere de la unidad de la OC; confirma cantidad y precio.</p>}
                  <input type="hidden" name={`item_ocItemId_${index}`} value={li.ocItemId} />
                  <input type="hidden" name={`item_resolution_${index}`} value={li.resolution} />
                  <input type="hidden" name={`item_productName_${index}`} value={li.productName} />
                  <input type="hidden" name={`item_productCode_${index}`} value={li.productCode} />
                  <input type="hidden" name={`item_unitOfMeasure_${index}`} value={li.unitOfMeasure} />
                  <input type="hidden" name={`item_subtotal_${index}`} value={String(Math.round((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)))} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar ítem ${ocItem?.productName ?? index + 1}`}
                  onClick={() => removeLineItem(index)}
                  className="shrink-0 text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
                >
                  <X size={14} aria-hidden />
                </Button>
              </div>
            )
          })}

          <input type="hidden" name="itemCount" value={String(lineItems.length)} />
        </div>
      )}

      {unresolvedLineCount > 0 && (
        <p className="text-[11px] text-[var(--color-warning-ink)]">Resuelve {unresolvedLineCount} línea(s) antes de adjuntar la factura.</p>
      )}

      <SubmitButton
        label="Adjuntar factura"
        loadingLabel="Adjuntando..."
        size="sm"
        className="w-full"
        disabled={unresolvedLineCount > 0}
      />
    </form>
  )
}

function ReceiptSelection({
  receipts,
  selectedIds,
  onChange,
}: {
  receipts: InvoiceReceiptOption[]
  selectedIds: string[]
  onChange: (receiptIds: string[]) => void
}) {
  if (receipts.length === 0) {
    return (
      <p className="rounded-(--radius-lg) bg-(--color-surface-2) px-3 py-2 text-xs text-(--color-text-muted)">
        Recepción pendiente: puedes guardar la factura ahora y asociar recepciones cuando lleguen.
      </p>
    )
  }
  const selectedIdSet = new Set(selectedIds)

  return (
    <fieldset className="rounded-(--radius-lg) border border-(--color-border) p-3">
      <legend className="px-1 text-xs font-medium text-(--color-text)">Recepciones relacionadas (opcional)</legend>
      <p className="mb-2 text-[11px] text-(--color-text-subtle)">
        Selecciona una o varias. El número de guía no se reutiliza como folio de factura.
      </p>
      <div className="max-h-40 space-y-1.5 overflow-y-auto">
        {receipts.map((receipt) => (
          <Checkbox
            key={receipt.id}
            id={`new-invoice-receipt-${receipt.id}`}
            name="receiptId"
            value={receipt.id}
            checked={selectedIdSet.has(receipt.id)}
            onChange={(event) => onChange(event.target.checked
              ? [...new Set([...selectedIds, receipt.id])]
              : selectedIds.filter((id) => id !== receipt.id))}
            label={`${receipt.code} · ${formatDateTime(receipt.receivedAt)}${receipt.dispatchGuideNo ? ` · documento ${receipt.dispatchGuideNo}` : ""}`}
          />
        ))}
      </div>
    </fieldset>
  )
}

/* ── DTE candidate row ──────────────────────────────────────────────────────── */

function DteResolutionDialog({
  doc,
  ocItems,
  resolutions,
  onResolutionChange,
  onRememberChange,
  onOpenChange,
  onConfirm,
  pending,
}: {
  doc: DteCandidate | null
  ocItems: OcItem[]
  resolutions: Record<string, { purchaseOrderItemId: string | null; rememberAlias: boolean }>
  onResolutionChange: (lineId: string, purchaseOrderItemId: string | null) => void
  onRememberChange: (lineId: string, rememberAlias: boolean) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <Dialog open={Boolean(doc)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisar asociaciones del DTE</DialogTitle>
          <DialogDescription>
            {doc
              ? `${dteTipoLabel(doc.tipoDte)} N° ${doc.folio}. Confirma cada vínculo; puedes dejar líneas explícitamente sin asociar.`
              : "Revisa las líneas del documento."}
          </DialogDescription>
        </DialogHeader>

        {doc?.lines.length ? (
          <>
            {doc.enrichmentStatus !== "ready" && (
              <div role="alert" className="rounded-(--radius-lg) border border-(--color-warning-line) bg-(--color-warning-tint) p-3 text-xs text-(--color-warning-ink)">
                {/* Con el análisis fallido las filas persistidas siguen ahí pero
                    sin sugerencias: el diálogo se veía idéntico a "se analizó y
                    no coincidió nada" y confirmarlo dejaba la factura sin un solo
                    vínculo de línea, descuadrando la conciliación en silencio. */}
                El análisis de líneas de este DTE {doc.enrichmentStatus === "failed" ? "falló" : "no ha terminado"}.
                Lo de abajo puede estar incompleto o desactualizado: revisa cada asociación antes de confirmar.
              </div>
            )}
            <ul className="space-y-3">
            {doc.lines.map((line) => {
              const proposed = doc.proposedLinks.find((link) => link.dteItemId === line.id)
              const resolution = resolutions[line.id]
              const selectedOc = ocItems.find((item) => item.id === resolution?.purchaseOrderItemId)
              // El servicio rechaza dos líneas DTE sobre el mismo ítem de OC.
              // Ofrecerlo igual convertía un error evitable de la pantalla en un
              // viaje al servidor que bota todo el adjunto.
              const takenByOtherLine = new Set(
                Object.entries(resolutions)
                  .filter(([lineId, value]) => lineId !== line.id && value.purchaseOrderItemId)
                  .map(([, value]) => value.purchaseOrderItemId as string),
              )
              return (
                <li key={line.id} className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-(--color-text)">{line.productName}</p>
                      <p className="mt-0.5 text-[11px] text-(--color-text-subtle)">
                        Línea {line.lineNumber} · {line.quantity} {line.unitOfMeasure ?? "sin unidad"} · {formatCLP(line.amount)}
                        {line.productCode ? ` · Código ${line.productCode}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <MetaBadge meta={{ label: `${dteMatchLabel(proposed?.matchType ?? "none")}`, variant: proposed?.matchType === "supplier_alias" ? "success" : proposed?.matchType === "unit_mismatch" || proposed?.matchType === "ambiguous" ? "warning" : "default" }} />
                      {/* La cifra existía en `proposedLinks` y sólo se resumía
                          en la fila ("N cantidad(es) excedida(s)"), lejos del
                          select donde se decide. Facturar más de lo que queda
                          por facturar es el error caro de esta pantalla. */}
                      {proposed?.quantityStatus === "over" && (
                        <MetaBadge meta={{ label: "Excede lo pendiente", variant: "warning" }} />
                      )}
                      {proposed?.quantityStatus === "under" && (
                        <MetaBadge meta={{ label: "Cubre parte de la línea", variant: "info" }} />
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <OptionSelect
                      aria-label={`Asociar línea DTE ${line.lineNumber}`}
                      value={resolution?.purchaseOrderItemId ?? "__unlinked"}
                      onValueChange={(value) => onResolutionChange(line.id, value === "__unlinked" ? null : value)}
                      options={[
                        ...ocItems.map((item) => ({
                          value: item.id,
                          label: takenByOtherLine.has(item.id)
                            ? `${dteOcItemLabel(item)} · ya asociado a otra línea`
                            : dteOcItemLabel(item),
                          disabled: takenByOtherLine.has(item.id),
                        })),
                        { value: "__unlinked", label: "Dejar explícitamente sin vínculo" },
                      ]}
                    />
                  </div>
                  <div className="mt-2">
                    <Checkbox
                      id={`remember-alias-${line.id}`}
                      checked={resolution?.rememberAlias ?? false}
                      disabled={!selectedOc?.catalogProductId}
                      onChange={(event) => onRememberChange(line.id, event.target.checked)}
                      label={selectedOc?.catalogProductId
                        ? "Recordar esta correspondencia para este proveedor"
                        : "Recordar correspondencia (requiere un producto de catálogo)"}
                    />
                  </div>
                </li>
              )
            })}
            </ul>
          </>
        ) : (
          <div role="alert" className="rounded-(--radius-lg) border border-(--color-warning-line) bg-(--color-warning-tint) p-3 text-xs text-(--color-warning-ink)">
            {/* Decía sólo "el servidor volverá a verificar el XML" y callaba la
                mitad que importa: sin líneas que revisar, éste es el único
                camino del flujo donde nadie confirma las asociaciones. */}
            Este DTE aún no tiene análisis de líneas. Al confirmar, el servidor descargará el XML
            y <strong>vinculará las líneas automáticamente</strong> por código y nombre, sin esta revisión.
            Podrás corregirlo después quitando la factura y volviéndola a adjuntar.
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" variant="primary" loading={pending} disabled={pending} onClick={onConfirm}>
            {pending ? "Adjuntando…" : "Confirmar y usar DTE"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function dteMatchLabel(matchType: DteCandidateMatchType) {
  return {
    supplier_alias: "Alias confirmado",
    sku: "SKU exacto",
    name: "Nombre coincidente",
    ambiguous: "Coincidencia ambigua",
    unit_mismatch: "Unidad incompatible",
    none: "Sin coincidencia",
  }[matchType]
}

/**
 * Un DTE del proveedor todavía sin registrar. "Ver factura" abre el PDF real
 * desde una ruta autenticada; no reemplaza el documento con el detalle XML.
 */
function DteCandidateRow({
  doc,
  onUse,
  usePending,
  disabled,
}: {
  doc: DteCandidate
  onUse: () => void
  /** Esta fila es la que se está adjuntando. */
  usePending: boolean
  /** Hay otro adjunto en curso: ninguna fila acepta abrir su diálogo. */
  disabled: boolean
}) {
  return (
    <li className="rounded-(--radius-md) bg-(--color-surface) px-2.5 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-(--color-text)">
          <span className="font-medium">{dteTipoLabel(doc.tipoDte)} N° {doc.folio}</span>
          <span className="text-(--color-text-subtle)">
            {" · "}{formatDate(doc.fechaEmision)}{" · "}{formatCLP(doc.montoTotal)}
          </span>
          {/* Va antes que el monto: nombrar lo que el documento DICE pesa más
              que lo que dedujimos comparando cifras. */}
          {doc.referencesOrder && (
            <MetaBadge meta={{ label: "Cita esta OC", variant: "success" }} className="ml-2" />
          )}
          {/* Se nombra lo que el proveedor escribió, no un juicio sobre ello:
              "Sólo el año" le dice al operador exactamente qué reclamar. Las
              etiquetas y qué clase merece badge viven en `ORDER_REFERENCE_META`,
              compartido con el reporte de conciliación para que ambas
              superficies no bauticen distinto la misma cosa. */}
          {(() => {
            const meta = ORDER_REFERENCE_META[doc.orderReference]
            return meta.badge && doc.orderReference !== "exact"
              ? <MetaBadge meta={{ label: meta.label, variant: meta.badge }} className="ml-2" />
              : null
          })()}
          {/* La marca va sobre el monto, que es lo que la distingue.
              Se nombra lo que se comparó en vez de decir "sugerido":
              el operador tiene que poder discutirla. */}
          {doc.amountMatches && (
            <MetaBadge meta={{ label: "Calza con el saldo", variant: "success" }} className="ml-2" />
          )}
          <MetaBadge meta={{ label: `${doc.confidence === "high" ? "Confianza alta" : doc.confidence === "medium" ? "Confianza media" : doc.confidence === "low" ? "Confianza baja" : "Pendiente de análisis"}`, variant: doc.confidence === "high" ? "success" : doc.confidence === "medium" ? "info" : doc.confidence === "low" ? "warning" : "default" }} className="ml-2" />
        </span>
        <div className="flex items-center gap-1.5">
          <Button asChild variant="ghost" size="sm">
            <a
              href={`/api/purchase-orders/dtes/${doc.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Eye size={14} aria-hidden />
              Ver factura
            </a>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={usePending}
            disabled={usePending || disabled}
            onClick={onUse}
          >
            {usePending ? "Adjuntando…" : "Usar este DTE"}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-(--color-text-subtle)">
        Proveedor verificado · {doc.explanation.matchedLines}/{doc.explanation.totalLines} líneas vinculadas
        {doc.explanation.unitMismatches > 0 ? ` · ${doc.explanation.unitMismatches} unidad(es) incompatible(s)` : ""}
        {doc.explanation.quantityOverLines > 0 ? ` · ${doc.explanation.quantityOverLines} cantidad(es) excedida(s)` : ""}
        {doc.explanation.quantityUnderLines > 0 ? ` · ${doc.explanation.quantityUnderLines} línea(s) parcial(es)` : ""}
      </p>
    </li>
  )
}
