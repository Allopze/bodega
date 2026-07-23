"use client"

import * as React from "react"
import { useActionState } from "react"
import { Trash, FilePdf, Warning, Plus, X } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { FileInput } from "@/components/ui/file-input"
import { DatePicker } from "@/components/ui/date-picker"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatCLP, formatDate } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { addInvoiceAction, deleteInvoiceAction } from "../invoice-actions"

export interface OcItem {
  id: string
  productName: string
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
}: {
  purchaseOrderId: string
  invoices: InvoiceRow[]
  ocItems: OcItem[]
  totalAmount: number
  canManage: boolean
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
                  <span className="truncate min-w-0 text-text-subtle">{ocItem.productName}</span>
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
        <p className="text-xs text-text-subtle py-2">Sin facturas adjuntadas.</p>
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
        <AddInvoiceForm purchaseOrderId={purchaseOrderId} ocItems={ocItems} />
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
                  <span className="truncate">{item.productName}</span>
                  <span className="font-mono tabular-nums shrink-0">{item.quantity} × {formatCLP(item.unitPrice)}</span>
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
  ocItemId: string
  quantity: string
  unitPrice: string
}

function AddInvoiceForm({ purchaseOrderId, ocItems }: { purchaseOrderId: string; ocItems: OcItem[] }) {
  const [state, action] = useActionState<ActionState, FormData>(addInvoiceAction, INITIAL_STATE)
  const formRef = React.useRef<HTMLFormElement>(null)
  const [lineItems, setLineItems] = React.useState<InvoiceLineItem[]>([])
  const [dteParsed, setDteParsed] = React.useState(false)
  const invoiceNumberRef = React.useRef<HTMLInputElement>(null)
  const amountRef = React.useRef<HTMLInputElement>(null)
  const issueDateRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setLineItems([])
      setDteParsed(false)
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
        { ocItemId: nextItem.id, quantity: String(nextItem.quantity), unitPrice: String(nextItem.unitPrice) },
      ])
    }
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index))
  }

  function updateLineItem(index: number, field: keyof InvoiceLineItem, value: string) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  // ── DTE XML auto-detection ────────────────────────────────────────────────
  function handleFileChange(file: File | null) {
    if (!file) {
      setDteParsed(false)
      return
    }

    const isXml = file.type === "application/xml" || file.type === "text/xml" || file.name.endsWith(".xml")
    if (!isXml) {
      setDteParsed(false)
      return
    }

    const reader = new FileReader()
    reader.onload = (evt) => {
      const xmlString = evt.target?.result as string
      const parsed = parseDteXmlClient(xmlString)
      if (!parsed) {
        toast.error("No se pudo parsear el XML como DTE válido")
        return
      }

      // Auto-fill form fields
      if (invoiceNumberRef.current) {
        invoiceNumberRef.current.value = parsed.invoiceNumber
      }
      if (amountRef.current) {
        amountRef.current.value = String(parsed.totalAmount)
      }
      if (issueDateRef.current && parsed.issueDate) {
        issueDateRef.current.value = parsed.issueDate
      }

      // Auto-match DTE items to OC items
      if (parsed.items.length > 0 && ocItems.length > 0) {
        const matched = matchDteItemsToOcItemsClient(parsed.items, ocItems)
        setLineItems(matched.map((m) => ({
          ocItemId: m.ocItemId ?? "",
          quantity: String(m.dteItem.quantity),
          unitPrice: String(m.dteItem.unitPrice),
          productName: m.dteItem.productName,
        })))
      }

      setDteParsed(true)
      toast.success(`DTE parseado: ${parsed.items.length} ítem(s), total ${formatCLP(parsed.totalAmount)}`)
    }
    reader.readAsText(file)
  }

  // ── Client-side DTE parser (browser DOMParser) ─────────────────────────────
  function parseDteXmlClient(xmlString: string) {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlString, "text/xml")
      const parseError = doc.querySelector("parsererror")
      if (parseError) return null

      const documento = doc.querySelector("DTE > Documento") ?? doc.querySelector("Documento")
      if (!documento) return null

      const folio = documento.querySelector("Encabezado > IdDoc > Folio")?.textContent?.trim() ?? ""
      const fechaEmision = documento.querySelector("Encabezado > IdDoc > FechaEmision")?.textContent?.trim() ?? null
      const mntTotal = parseInt(documento.querySelector("Encabezado > Totales > MntTotal")?.textContent?.trim() ?? "0", 10)
      const mntNeto = parseInt(documento.querySelector("Encabezado > Totales > MntNeto")?.textContent?.trim() ?? "0", 10)
      const iva = parseInt(documento.querySelector("Encabezado > Totales > IVA")?.textContent?.trim() ?? "0", 10)

      const detailNodes = documento.querySelectorAll("Detalle > Item")
      const items: Array<{
        lineNumber: number
        productCode: string | null
        productName: string
        quantity: number
        unitPrice: number
        amount: number
      }> = []

      detailNodes.forEach((itemNode) => {
        const nroLinea = parseInt(itemNode.querySelector("NroLinea")?.textContent?.trim() ?? "0", 10)
        const cdgItem = itemNode.querySelector("CdgItem")
        const productCode = cdgItem?.querySelector("VlrCod")?.textContent?.trim() ?? null
        const nmItem = itemNode.querySelector("NmItem")?.textContent?.trim() ?? ""
        const qtyItem = parseInt(itemNode.querySelector("QtyItem")?.textContent?.trim() ?? "0", 10)
        const prcItem = parseInt(itemNode.querySelector("PrcItem")?.textContent?.trim() ?? "0", 10)
        const montoItem = parseInt(itemNode.querySelector("MontoItem")?.textContent?.trim() ?? "0", 10)

        items.push({
          lineNumber: nroLinea || items.length + 1,
          productCode,
          productName: nmItem,
          quantity: qtyItem,
          unitPrice: prcItem,
          amount: montoItem || qtyItem * prcItem,
        })
      })

      return {
        invoiceNumber: folio,
        issueDate: fechaEmision,
        totalAmount: mntTotal || (mntNeto + iva),
        items,
      }
    } catch {
      return null
    }
  }

  // ── Client-side DTE ↔ OC item matching ─────────────────────────────────────
  function matchDteItemsToOcItemsClient(
    dteItems: Array<{ productCode: string | null; productName: string; quantity: number; unitPrice: number }>,
    ocItemsList: OcItem[],
  ) {
    return dteItems.map((dteItem) => {
      // Try match by product code
      if (dteItem.productCode) {
        const byCode = ocItemsList.find((oci) => oci.id === dteItem.productCode)
        if (byCode) return { dteItem, ocItemId: byCode.id, matchType: "code" as const }
      }

      // Try match by name (case-insensitive, substring)
      const normalizedName = dteItem.productName.toLowerCase().trim()
      const byName = ocItemsList.find((oci) => {
        const ocName = oci.productName.toLowerCase().trim()
        return ocName && (normalizedName.includes(ocName) || ocName.includes(normalizedName))
      })
      if (byName) return { dteItem, ocItemId: byName.id, matchType: "name" as const }

      return { dteItem, ocItemId: null, matchType: "none" as const }
    })
  }

  const totalItems = lineItems.reduce((sum, li) => {
    const qty = parseFloat(li.quantity) || 0
    const price = parseFloat(li.unitPrice) || 0
    return sum + qty * price
  }, 0)

  return (
    <form ref={formRef} action={action} className="mt-1 border-t border-(--color-border) pt-3 space-y-2">
      <p className="text-xs font-medium text-(--color-text-muted) mb-2">Agregar factura</p>
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      {!state.ok && state.message && !("fieldErrors" in state) && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
          <Warning size={12} weight="bold" />
          {state.message}
        </p>
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
            ref={amountRef}
            id="invoice-amount"
            name="amount"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            value={totalItems > 0 ? String(Math.round(totalItems)) : undefined}
            readOnly={lineItems.length > 0}
            className={lineItems.length > 0 ? "bg-surface-2" : ""}
          />
        </Field>

        <Field
          label="Fecha de emisión"
          htmlFor="invoice-issue-date"
          error={state.fieldErrors?.issueDate?.[0]}
        >
          <input
            ref={issueDateRef}
            type="date"
            id="invoice-issue-date"
            name="issueDate"
            className="w-full text-xs p-2 rounded border border-(--color-border) bg-(--color-surface)"
          />
        </Field>
      </div>

      {/* Line items */}
      {ocItems.length > 0 && (
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
            return (
              <div key={index} className="flex items-end gap-1.5 rounded border border-(--color-border) p-2 bg-surface-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-text-subtle truncate mb-1">{ocItem?.productName ?? "Ítem"}</p>
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
                  <input type="hidden" name={`item_ocItemId_${index}`} value={li.ocItemId} />
                  <input type="hidden" name={`item_productName_${index}`} value={ocItem?.productName ?? ""} />
                  <input type="hidden" name={`item_subtotal_${index}`} value={String(Math.round((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)))} />
                </div>
                <button
                  type="button"
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

      <Field
        label="Archivo"
        htmlFor="invoice-file"
        helper="PDF, JPG, PNG o XML (DTE) — el XML se auto-detecta"
      >
        <FileInput
          id="invoice-file"
          name="file"
          accept="application/pdf,image/jpeg,image/png,application/xml,text/xml"
          required
          onChange={handleFileChange}
        />
      </Field>

      {dteParsed && (
        <p className="text-[11px] text-[var(--color-success)] flex items-center gap-1">
          ✓ DTE detectado — campos auto-completados
        </p>
      )}

      <SubmitButton
        label="Adjuntar factura"
        loadingLabel="Adjuntando..."
        size="sm"
        className="w-full"
      />
    </form>
  )
}
