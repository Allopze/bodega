"use client"

import * as React from "react"
import { useActionState } from "react"
import { Trash, FilePdf, Warning, Plus, X } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { FileInput } from "@/components/ui/file-input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatCLP, formatDate } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { matchInvoiceItemsToPurchaseOrderItems } from "@/lib/services/purchasing-module/invoice-item-matching"
import { addInvoiceAction, deleteInvoiceAction } from "../invoice-actions"

export interface OcItem {
  id: string
  productName: string
  productCode: string | null
  unitOfMeasure: string
  quantity: number
  unitPrice: number
  subtotal: number
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
  defaultInvoiceNumber,
}: {
  purchaseOrderId: string
  invoices: InvoiceRow[]
  ocItems: OcItem[]
  totalAmount: number
  canManage: boolean
  /** N° de guía/factura traído desde una recepción (`?nro=`) para no retipearlo. */
  defaultInvoiceNumber?: string
}) {
  const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0)
  const exceeds = totalInvoiced > totalAmount

  // Calculate per-item invoiced quantities
  const invoicedQtyMap = new Map<string, number>()
  for (const inv of invoices) {
    for (const item of inv.items ?? []) {
      if (item.purchaseOrderItemId) {
        const current = invoicedQtyMap.get(item.purchaseOrderItemId) ?? 0
        invoicedQtyMap.set(item.purchaseOrderItemId, current + item.quantity)
      }
    }
  }

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
          exceeds
            ? "bg-[var(--color-danger-50)] border border-[var(--color-danger-200)] text-[var(--color-danger-700)]"
            : "bg-surface-2 text-(--color-text-muted)"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span>Total facturado</span>
            <span className="font-mono font-semibold tabular-nums">{formatCLP(totalInvoiced)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-current/10">
            <span>Total OC</span>
            <span className="font-mono tabular-nums">{formatCLP(totalAmount)}</span>
          </div>
          {exceeds && (
            <p className="mt-1.5 flex items-center gap-1 font-medium">
              <Warning size={12} weight="bold" />
              Lo facturado supera el total de la OC
            </p>
          )}
        </div>
      )}

      {/* Per-item reconciliation */}
      {invoices.length > 0 && ocItems.length > 0 && (
        <div className="mb-3 rounded-(--radius-lg) bg-surface-2 px-3 py-2 text-xs">
          <p className="font-medium text-(--color-text-muted) mb-1.5">Conciliación por ítem</p>
          <ul className="space-y-1">
            {ocItems.map((ocItem) => {
              const invoicedQty = invoicedQtyMap.get(ocItem.id) ?? 0
              const diff = ocItem.quantity - invoicedQty
              const isMatched = Math.abs(diff) < 0.01
              return (
                <li key={ocItem.id} className="flex items-center justify-between gap-2">
                  <span title={ocItem.productName} className="truncate min-w-0 text-text-subtle">{ocItem.productName}</span>
                  <span className={`font-mono tabular-nums shrink-0 ${isMatched ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"}`}>
                    {invoicedQty}/{ocItem.quantity}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Invoice list */}
      {invoices.length === 0 ? (
        // A4: sin facturas, la sección *es* el formulario de adjuntar — el texto
        // plano no ofrecía ninguna acción donde justamente falta hacerla. A quien
        // no puede adjuntar sí le queda el texto, que es lo único que aplica.
        !canManage && <p className="text-xs text-text-subtle py-2">Sin facturas adjuntadas.</p>
      ) : (
        <ul className="divide-y divide-(--color-border) mb-3">
          {invoices.map((inv) => (
            <InvoiceItem
              key={inv.id}
              invoice={inv}
              purchaseOrderId={purchaseOrderId}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      {/* Add invoice form */}
      {canManage && (
        <AddInvoiceForm
          purchaseOrderId={purchaseOrderId}
          ocItems={ocItems}
          defaultInvoiceNumber={defaultInvoiceNumber}
          separated={invoices.length > 0}
        />
      )}
    </section>
  )
}

/* ── Invoice list item ──────────────────────────────────────────────────────── */

function InvoiceItem({
  invoice,
  purchaseOrderId,
  canManage,
}: {
  invoice: InvoiceRow
  purchaseOrderId: string
  canManage: boolean
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
          <button
            type="button"
            disabled={pending}
            aria-label={`Eliminar factura ${invoice.invoiceNumber}`}
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 p-1 rounded text-text-subtle hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-50)] transition-colors disabled:opacity-40"
          >
            <Trash size={14} />
          </button>
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
}: {
  purchaseOrderId: string
  ocItems: OcItem[]
  defaultInvoiceNumber?: string
  /** Con facturas arriba el formulario se separa con una línea; sin ellas la línea quedaba colgando. */
  separated?: boolean
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
  // Estado controlado en vez de ref imperativo: DatePicker guarda el valor en
  // React, así que form.reset() del navegador no lo limpiaría solo.
  const [issueDate, setIssueDate] = React.useState("")

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setIssueDate("")
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
          unitPrice: String(nextItem.unitPrice),
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
      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter((warning: unknown): warning is string => typeof warning === "string")
        : []
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

      const methodLabel = method === "dte_xml" ? "DTE XML" : method === "pdf_text" ? "PDF" : method === "pdf_text_ocr" ? "PDF + OCR" : method === "ocr" ? "OCR" : ""
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
    } catch {
      toast.error("Error al procesar el archivo")
    } finally {
      setExtracting(false)
    }
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
      <h3 className="text-sm font-semibold text-(--color-text)">Adjuntar factura</h3>
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      {!state.ok && state.message && !("fieldErrors" in state) && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
          <Warning size={12} weight="bold" />
          {state.message}
        </p>
      )}

      {/* El archivo va primero porque es lo que rellena todo lo de abajo (DTE/OCR):
          pidiéndolo al final, el operador tipeaba a mano datos que el documento
          traía, y tenía que encontrarlo tras cuatro campos ya llenos. */}
      <Field
        label="Archivo"
        htmlFor="invoice-file"
        helper="PDF, JPG, PNG o XML (DTE) — se auto-extraen los datos"
      >
        <FileInput
          id="invoice-file"
          name="file"
          accept="application/pdf,image/jpeg,image/png,application/xml,text/xml"
          required
          onChange={handleFileChange}
          disabled={extracting}
        />
      </Field>

      {extracting && (
        <p className="text-[11px] text-(--color-text-muted) flex items-center gap-1">
          <span className="inline-block animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
          Procesando archivo...
        </p>
      )}

      {dteParsed && !extracting && (
        <p className="text-[11px] text-[var(--color-success)] flex items-center gap-1">
          ✓ Datos extraídos del archivo — campos auto-completados
        </p>
      )}

      {extractionWarnings.length > 0 && !extracting && (
        <div role="alert" className="rounded border border-[var(--color-warning)] bg-[var(--color-warning-50)] px-2 py-1.5 text-[11px] text-(--color-text)">
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
            value={lineItems.length > 0 ? String(Math.round(totalItems)) : extractedTotal != null ? String(extractedTotal) : undefined}
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
              <button
                type="button"
                onClick={addLineItem}
                className="text-[11px] text-(--color-primary) hover:underline flex items-center gap-0.5"
              >
                <Plus size={11} /> Agregar ítem
              </button>
            )}
          </div>

          {lineItems.map((li, index) => {
            const ocItem = ocItems.find((oci) => oci.id === li.ocItemId)
            const unitMismatch = Boolean(li.unitOfMeasure && ocItem && li.unitOfMeasure.trim().toLowerCase() !== ocItem.unitOfMeasure.trim().toLowerCase())
            return (
              <div key={li.id} className="flex items-end gap-1.5 rounded border border-(--color-border) p-2 bg-surface-2">
                <div className="flex-1 min-w-0">
                  <p title={li.productName || "Ítem"} className="text-[10px] text-text-subtle truncate mb-1">Documento: {li.productName || "Ítem sin descripción"}</p>
                  <select
                    aria-label={`Asociar línea ${index + 1} a un ítem de la orden de compra`}
                    value={li.ocItemId || (li.resolution === "unlinked" ? "__unlinked" : "")}
                    onChange={(event) => updateLineItemAssociation(index, event.target.value)}
                    className={`mb-1 h-7 w-full rounded border bg-(--color-surface) px-1.5 text-[11px] ${li.resolution === "needs_review" ? "border-[var(--color-warning)]" : "border-(--color-border)"}`}
                  >
                    <option value="" disabled>Selecciona ítem de OC</option>
                    {ocItems.map((item) => <option key={item.id} value={item.id}>{item.productName}</option>)}
                    <option value="__unlinked">Mantener sin asociar a la OC</option>
                  </select>
                  {li.resolution === "needs_review" && (
                    <p className="mb-1 text-[10px] text-[var(--color-warning)]">Esta línea no se asociará hasta que selecciones un ítem de la OC o confirmes que queda sin asociar.</p>
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
                      className="text-xs h-7"
                    />
                    <Input
                      name={`item_price_${index}`}
                      type="number"
                      min="0"
                      step="1"
                      value={li.unitPrice}
                      onChange={(e) => updateLineItem(index, "unitPrice", e.target.value)}
                      placeholder="Precio"
                      className="text-xs h-7"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-text-subtle">
                    Unidad documento: <span className="font-medium text-(--color-text)">{li.unitOfMeasure || "no declarada"}</span>
                    {ocItem && <> · OC: {ocItem.unitOfMeasure}</>}
                  </p>
                  {unitMismatch && <p className="mt-1 text-[10px] text-[var(--color-warning)]">La unidad del documento difiere de la unidad de la OC; confirma cantidad y precio.</p>}
                  <input type="hidden" name={`item_ocItemId_${index}`} value={li.ocItemId} />
                  <input type="hidden" name={`item_resolution_${index}`} value={li.resolution} />
                  <input type="hidden" name={`item_productName_${index}`} value={li.productName} />
                  <input type="hidden" name={`item_productCode_${index}`} value={li.productCode} />
                  <input type="hidden" name={`item_unitOfMeasure_${index}`} value={li.unitOfMeasure} />
                  <input type="hidden" name={`item_subtotal_${index}`} value={String(Math.round((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)))} />
                </div>
                <button
                  type="button"
                  aria-label={`Quitar ítem ${ocItem?.productName ?? index + 1}`}
                  onClick={() => removeLineItem(index)}
                  className="shrink-0 p-1 rounded text-text-subtle hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-50)] transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}

          <input type="hidden" name="itemCount" value={String(lineItems.length)} />
        </div>
      )}

      {unresolvedLineCount > 0 && (
        <p className="text-[11px] text-[var(--color-warning)]">Resuelve {unresolvedLineCount} línea(s) antes de adjuntar la factura.</p>
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
