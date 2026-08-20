"use client"

import * as React from "react"
import { useActionState } from "react"
import { Trash, FilePdf, Warning, Plus, X, Eye } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { FileInput } from "@/components/ui/file-input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCLP, formatDate } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { areEquivalentUnits, matchInvoiceItemsToPurchaseOrderItems } from "@/lib/services/purchasing-module/invoice-item-matching"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  reconcileInvoiceEvidence,
  type InvoiceEvidenceStatus,
} from "@/lib/services/purchasing-module/invoice-reconciliation"
import { addInvoiceAction, deleteInvoiceAction } from "../invoice-actions"
import { attachDteAsInvoice } from "../actions/dte-use-invoice"
import { dteTipoLabel } from "@/lib/services/dte-portal/labels"

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
}

export interface OcItem {
  id: string
  productName: string
  productCode: string | null
  unitOfMeasure: string
  quantity: number
  /** `null` is a service whose purchase cost is still pending, never $0. */
  unitPrice: number | null
  subtotal: number | null
}

export interface InvoiceRow {
  id: string
  invoiceNumber: string
  amount: number | null
  issueDate: string | null
  fileName: string
  mimeType: string | null
  uploadedAt: string
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
  totalAmount,
  canManage,
  canAttach = canManage,
  defaultInvoiceNumber,
  dteCandidates = [],
}: {
  purchaseOrderId: string
  invoices: InvoiceRow[]
  ocItems: OcItem[]
  totalAmount: number
  /** Puede intervenir las facturas ya adjuntadas (eliminarlas). */
  canManage: boolean
  /**
   * Puede adjuntar facturas nuevas. Son dos permisos distintos porque una OC
   * anulada conserva la sección sólo para soltar el DTE que quedó colgado: el
   * servicio rechaza el alta en `cancelled` y ofrecer el formulario sería una
   * carga que falla siempre. Por defecto sigue a `canManage`.
   */
  canAttach?: boolean
  /** N° de guía/factura traído desde una recepción (`?nro=`) para no retipearlo. */
  defaultInvoiceNumber?: string
  /** DTE del proveedor sin vincular, ofrecidos para registro directo. */
  dteCandidates?: DteCandidate[]
}) {
  const reconciliation = reconcileInvoiceEvidence({
    totalOC: totalAmount,
    orderItems: ocItems.map((item) => ({ id: item.id, productName: item.productName, quantity: item.quantity })),
    invoices,
  })
  const itemReconciliation = new Map(reconciliation.items.map((item) => [item.ocItemId, item]))
  const invoiceReconciliation = new Map(reconciliation.invoices.map((invoice) => [invoice.invoiceId, invoice]))
  const moneyMismatch = reconciliation.money.status === "mismatch"
  const lineStatusLabel = {
    not_evaluable: "Líneas no evaluables: faltan líneas en las facturas",
    unlinked: "Líneas sin vínculo a la OC",
    partial: "Cobertura parcial de líneas",
    covered: "Líneas conciliadas",
  }[reconciliation.lines.status]

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

      {/* Reconciliation summary */}
      {invoices.length > 0 && (
        <div className={`mb-3 rounded-(--radius-lg) px-3 py-2 text-xs ${
          moneyMismatch
            ? "border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]"
            : "bg-surface-2 text-(--color-text-muted)"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span>Total facturado (CLP)</span>
            <span className="font-mono font-semibold tabular-nums">{formatCLP(reconciliation.totalInvoiced)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-current/10">
            <span>Total OC</span>
            <span className="font-mono tabular-nums">{formatCLP(totalAmount)}</span>
          </div>
          {moneyMismatch && (
            <p className="mt-1.5 flex items-center gap-1 font-medium">
              <Warning size={12} weight="bold" />
              El total difiere de la OC (tolerancia: $1)
            </p>
          )}
          {!moneyMismatch && (
            <p className="mt-1.5 font-medium text-[var(--color-success-ink)]">
              Monetariamente conciliada (tolerancia: $1)
            </p>
          )}
        </div>
      )}

      {/* Per-item reconciliation */}
      {invoices.length > 0 && ocItems.length > 0 && (
        <div className="mb-3 rounded-(--radius-lg) bg-surface-2 px-3 py-2 text-xs">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
            <p className="font-medium text-(--color-text-muted)">Conciliación por línea</p>
            <span className="text-[11px] text-(--color-text-subtle)">{lineStatusLabel}</span>
          </div>
          <ul className="space-y-1">
            {ocItems.map((ocItem) => {
              const item = itemReconciliation.get(ocItem.id)
              const isEvaluable = item?.status !== "not_evaluable"
              const isMatched = item?.status === "covered"
              return (
                <li key={ocItem.id} className="flex items-center justify-between gap-2">
                  <span title={ocItem.productName} className="truncate min-w-0 text-text-subtle">{ocItem.productName}</span>
                  <span className={`font-mono tabular-nums shrink-0 ${isMatched ? "text-[var(--color-success)]" : isEvaluable ? "text-[var(--color-warning-ink)]" : "text-(--color-text-subtle)"}`}>
                    {isEvaluable ? `${item?.invoicedQty ?? 0}/${ocItem.quantity}` : "No evaluable"}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[11px] text-(--color-text-subtle)">
            {reconciliation.lines.invoicesWithoutLines > 0 && `${reconciliation.lines.invoicesWithoutLines} factura(s) sin líneas. `}
            {reconciliation.lines.unlinkedLineCount > 0 && `${reconciliation.lines.unlinkedLineCount} línea(s) sin vínculo. `}
            El total monetario no sustituye la evidencia por línea.
          </p>
        </div>
      )}

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
              defaultInvoiceNumber={defaultInvoiceNumber}
              separated={false}
              dteCandidates={dteCandidates}
            />
          )
          : (
            // A3: con facturas arriba, la sección es la lista y el alta se pliega
            // —excepción de "estación de captura repetitiva"— con la preferencia
            // recordada. Sin facturas no hay lista que tapar: el formulario *es*
            // el contenido y queda abierto.
            <CollapsedInvoiceForm defaultOpen={Boolean(defaultInvoiceNumber)}>
              <AddInvoiceForm
                purchaseOrderId={purchaseOrderId}
                ocItems={ocItems}
                defaultInvoiceNumber={defaultInvoiceNumber}
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
}: {
  invoice: InvoiceRow
  purchaseOrderId: string
  canManage: boolean
  lineEvidence?: InvoiceEvidenceStatus
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
        <>
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
        </>
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
  defaultInvoiceNumber,
  separated = true,
  heading = true,
  dteCandidates = [],
}: {
  purchaseOrderId: string
  ocItems: OcItem[]
  defaultInvoiceNumber?: string
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
  const [extractionWarnings, setExtractionWarnings] = React.useState<string[]>([])
  const invoiceNumberRef = React.useRef<HTMLInputElement>(null)
  // `createPurchaseOrderInvoice` recalcula el monto como la suma de las líneas
  // cuando la factura trae detalle, así que el formulario muestra esa misma
  // suma. El total declarado en el documento sólo se usa si la extracción no
  // produjo líneas; si no, el campo mostraría un número que la base no guarda.
  const [extractedTotal, setExtractedTotal] = React.useState<number | null>(null)
  // El monto necesita estado propio: cuando la extracción trae total pero no
  // líneas, el campo llevaba `value` sin `onChange` y React lo volvía inmutable,
  // justo en el caso en que el propio flujo pide "corrige los montos".
  const [amount, setAmount] = React.useState("")
  React.useEffect(() => {
    setAmount(extractedTotal != null ? String(extractedTotal) : "")
  }, [extractedTotal])
  // Estado controlado en vez de ref imperativo: DatePicker guarda el valor en
  // React, así que form.reset() del navegador no lo limpiaría solo.
  const [issueDate, setIssueDate] = React.useState("")
  const dteOperation = useOperation()

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setIssueDate("")
      setAmount("")
      setLineItems([])
      setExtractedTotal(null)
      setDteParsed(false)
      setExtractionWarnings([])
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
      setExtractedTotal(null)
      setExtractionWarnings([])
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

    // Auto-fill form fields
    if (data.invoiceNumber && invoiceNumberRef.current) {
      invoiceNumberRef.current.value = data.invoiceNumber
    }
    setExtractedTotal(typeof data.totalAmount === "number" ? data.totalAmount : null)
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

  function handleUseDte(dteDocumentId: string, folio: number) {
    dteOperation.run(async () => {
      const result = await attachDteAsInvoice({ purchaseOrderId, dteDocumentId })
      if (!result.ok) toast.error(result.message)
      return result
    }, () => {
      toast.success(`Factura ${folio} adjuntada correctamente`)
    })
  }

  const totalItems = lineItems.reduce((sum, li) => {
    const qty = parseFloat(li.quantity) || 0
    const price = parseFloat(li.unitPrice) || 0
    return sum + qty * price
  }, 0)
  const unresolvedLineCount = lineItems.filter((item) => item.resolution === "needs_review").length

  return (
    <form
      ref={formRef}
      action={action}
      className={separated ? "mt-1 border-t border-(--color-border) pt-3 space-y-2" : "space-y-2"}
    >
      {heading && <h3 className="text-sm font-semibold text-(--color-text)">Adjuntar factura</h3>}
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

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
      {dteCandidates.length > 0 && (
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) p-3">
          <p className="text-xs font-medium text-(--color-text)">
            DTE de este proveedor sin registrar ({dteCandidates.length})
          </p>
          <p className="mt-0.5 text-xs text-(--color-text-subtle)">
            Llegaron por el portal tributario desde que se creó esta orden. Usa uno para registrar la
            factura y adjuntar su PDF sin volver a subir el archivo.
          </p>
          <ul className="mt-2 space-y-1">
            {dteCandidates.map((doc) => (
              <DteCandidateRow
                key={doc.id}
                doc={doc}
                usePending={dteOperation.pending}
                onUse={() => handleUseDte(doc.id, doc.folio)}
              />
            ))}
          </ul>
        </div>
      )}

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
          defaultValue={defaultInvoiceNumber}
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
            value={lineItems.length > 0 ? String(Math.round(totalItems)) : amount}
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

/* ── DTE candidate row ──────────────────────────────────────────────────────── */

/**
 * Un DTE del proveedor todavía sin registrar. "Ver factura" abre el PDF real
 * desde una ruta autenticada; no reemplaza el documento con el detalle XML.
 */
function DteCandidateRow({
  doc,
  onUse,
  usePending,
}: {
  doc: DteCandidate
  onUse: () => void
  usePending: boolean
}) {
  return (
    <li className="rounded-(--radius-md) bg-(--color-surface) px-2.5 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-(--color-text)">
          <span className="font-medium">{dteTipoLabel(doc.tipoDte)} N° {doc.folio}</span>
          <span className="text-(--color-text-subtle)">
            {" · "}{formatDate(doc.fechaEmision)}{" · "}{formatCLP(doc.montoTotal)}
          </span>
          {/* La marca va sobre el monto, que es lo que la distingue.
              Se nombra lo que se comparó en vez de decir "sugerido":
              el operador tiene que poder discutirla. */}
          {doc.amountMatches && (
            <Badge variant="success" className="ml-2">Calza con el saldo</Badge>
          )}
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
            disabled={usePending}
            onClick={onUse}
          >
            {usePending ? "Adjuntando…" : "Usar este DTE"}
          </Button>
        </div>
      </div>
    </li>
  )
}
