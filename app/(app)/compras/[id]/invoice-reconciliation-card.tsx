"use client"

import * as React from "react"
import { useActionState } from "react"
import { CheckCircle, ClockCounterClockwise, Warning } from "@phosphor-icons/react"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { formatCLP, formatDateTime } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import type { InvoiceReconciliationEvidence, InvoiceReconciliationIssueCode } from "@/lib/services/purchasing-module/invoice-reconciliation"
import { acceptInvoiceReconciliationAction } from "../actions/invoice-reconciliation"
import type { InvoiceRow } from "./invoices-section"

const STATUS = {
  no_invoices: { label: "Sin facturas", variant: "neutral" as const },
  matched: { label: "Conciliada", variant: "success" as const },
  needs_review: { label: "Revisión requerida", variant: "warning" as const },
  accepted_exception: { label: "Diferencias aceptadas", variant: "info" as const },
}

const ISSUE_LABELS: Record<InvoiceReconciliationIssueCode, string> = {
  unlinked_line: "Línea de factura sin vínculo con la OC",
  missing_unit: "Unidad documental ausente",
  unit_mismatch: "Unidad documental distinta de la OC",
  price_variance: "Diferencia de precio efectivo",
  pending_oc_cost: "Costo de OC pendiente",
  invoice_without_lines: "Factura sin líneas documentales",
  quantity_under: "Cantidad facturada menor que la OC",
  quantity_over: "Cantidad facturada mayor que la OC",
  quantity_over_received: "Cantidad facturada mayor que la entrega aceptada del proveedor",
  supplier_unverified: "RUT del proveedor no verificado en factura manual",
  total_mismatch: "Total facturado distinto del total OC",
}
type CatalogUpdateSnapshot = {
  invoiceItemId: string
  previousPrice: number | null
  newPrice: number | null
  changed: boolean
}

function catalogUpdatesFromEvidence(evidence: unknown): CatalogUpdateSnapshot[] {
  if (!evidence || typeof evidence !== "object") return []
  const updates = (evidence as { catalogUpdates?: unknown }).catalogUpdates
  if (!Array.isArray(updates)) return []
  return updates.filter((update): update is CatalogUpdateSnapshot => (
    Boolean(update) && typeof update === "object" && typeof update.invoiceItemId === "string"
      && typeof update.changed === "boolean"
  ))
}


export function InvoiceReconciliationCard({
  purchaseOrderId,
  reconciliation,
  invoices,
  canAccept,
  canUpdateCatalog,
}: {
  purchaseOrderId: string
  reconciliation: InvoiceReconciliationEvidence
  invoices: InvoiceRow[]
  canAccept: boolean
  canUpdateCatalog: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useActionState<ActionState, FormData>(acceptInvoiceReconciliationAction, INITIAL_STATE)
  const pendingItems = reconciliation.items.filter((item) =>
    reconciliation.issues.some((issue) => issue.code === "pending_oc_cost" && issue.orderItemId === item.ocItemId),
  )
  const [pendingSelections, setPendingSelections] = React.useState<Record<string, string>>(() => Object.fromEntries(
    pendingItems.flatMap((item) => item.linkedInvoiceItemIds.length === 1 ? [[item.ocItemId, item.linkedInvoiceItemIds[0]!]] : []),
  ))

  React.useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      setOpen(false)
    } else {
      toast.error(state.message)
    }
  }, [state])

  const invoiceLineById = new Map(invoices.flatMap((invoice) =>
    (invoice.items ?? []).map((item) => [item.id, { ...item, invoiceNumber: invoice.invoiceNumber }] as const),
  ))
  const catalogLines = reconciliation.items.flatMap((item) =>
    item.productId
      ? item.linkedInvoiceItemIds.flatMap((id) => {
          const line = invoiceLineById.get(id)
          return line ? [{ ...line, productId: item.productId, productName: item.productName }] : []
        })
      : [],
  )
  const status = STATUS[reconciliation.status]
  const appliedCatalogUpdates = catalogUpdatesFromEvidence(reconciliation.currentReview?.evidence)
    .filter((update) => update.changed)
  const receiptBlocksAcceptance = reconciliation.issues.some((issue) => issue.code === "quantity_over_received")

  return (
    <div className="mb-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface-2) p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">Conciliación de facturación</h3>
          <p className="mt-0.5 text-xs text-(--color-text-subtle)">
            Compara OC, entrega aceptada del proveedor y factura, además de unidades y precios efectivos netos. Tolerancia monetaria: $1.
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {reconciliation.hasInvoices && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-(--color-text-subtle)">
              <tr className="border-b border-(--color-border)">
                <th className="px-2 py-2 font-medium">Producto</th>
                <th className="px-2 py-2 text-right font-medium">Cantidad OC / aceptada / factura</th>
                <th className="px-2 py-2 text-right font-medium">Precio OC</th>
                <th className="px-2 py-2 text-right font-medium">Precio factura</th>
                <th className="px-2 py-2 text-right font-medium">Diferencia</th>
                <th className="px-2 py-2 text-right font-medium">Catálogo vigente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-border)">
              {reconciliation.items.map((item) => (
                <tr key={item.ocItemId}>
                  <td className="px-2 py-2 font-medium text-(--color-text)">{item.productName}</td>
                  <td className={`px-2 py-2 text-right font-mono tabular-nums ${item.receiptStatus === "over_invoiced" ? "text-(--color-warning-ink)" : ""}`}>
                    {item.ocQuantity} / {item.supplierReceivedQty} / {item.invoicedQty}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{item.ocEffectiveUnitPrice === null ? "Pendiente" : formatCLP(item.ocEffectiveUnitPrice)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{item.invoiceEffectiveUnitPrice === null ? "No evaluable" : formatCLP(item.invoiceEffectiveUnitPrice)}</td>
                  <td className={`px-2 py-2 text-right font-mono tabular-nums ${item.priceDifference && Math.abs(item.priceDifference) > 1 ? "text-(--color-warning-ink)" : "text-(--color-text-muted)"}`}>
                    {item.priceDifference === null ? "—" : `${item.priceDifference > 0 ? "+" : ""}${formatCLP(item.priceDifference)}${item.pricePercentage === null ? "" : ` (${item.pricePercentage.toFixed(1)}%)`}`}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{item.currentSupplierPrice === null ? "—" : formatCLP(item.currentSupplierPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reconciliation.issues.length > 0 && reconciliation.status !== "accepted_exception" && (
        <ul className="mt-3 space-y-1 text-xs text-(--color-warning-ink)">
          {[...new Set(reconciliation.issues.map((issue) => ISSUE_LABELS[issue.code]))].map((label) => (
            <li key={label} className="flex items-start gap-1.5"><Warning className="mt-0.5 shrink-0" size={13} weight="bold" aria-hidden />{label}</li>
          ))}
        </ul>
      )}

      {reconciliation.currentReview && (
        <div className="mt-3 rounded-(--radius-lg) bg-(--color-surface) px-3 py-2 text-xs text-(--color-text-muted)">
          <p className="flex items-center gap-1.5 font-medium text-(--color-success-ink)"><CheckCircle size={14} weight="fill" aria-hidden />Aceptada por {reconciliation.currentReview.reviewedByName ?? "usuario"} · {formatDateTime(reconciliation.currentReview.createdAt)}</p>
          <p className="mt-1">{reconciliation.currentReview.reason}</p>
        </div>
      )}
          {appliedCatalogUpdates.length > 0 && (
            <ul className="mt-2 space-y-1">
              {appliedCatalogUpdates.map((update) => {
                const line = invoiceLineById.get(update.invoiceItemId)
                return <li key={update.invoiceItemId}>Catálogo actualizado: {line?.productName ?? "Producto"} · {update.previousPrice === null ? "sin precio" : formatCLP(update.previousPrice)} → {update.newPrice === null ? "sin precio" : formatCLP(update.newPrice)}</li>
              })}
            </ul>
          )}
      {!reconciliation.currentReview && reconciliation.previousReview && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-(--color-warning-ink)"><ClockCounterClockwise size={14} aria-hidden />La revisión anterior quedó desactualizada porque cambió la evidencia.</p>
      )}

      {receiptBlocksAcceptance && (
        <p className="mt-3 rounded-(--radius-lg) border border-(--color-warning-line) bg-(--color-warning-tint) px-3 py-2 text-xs text-(--color-warning-ink)">
          Esta diferencia no puede cerrarse con la aceptación genérica: primero debe cuadrarse la cantidad aceptada con la evidencia documental correspondiente.
        </p>
      )}

      {canAccept && reconciliation.status === "needs_review" && !receiptBlocksAcceptance && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="mt-3" size="sm" type="button">Aceptar diferencias</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Aceptar diferencias de conciliación</DialogTitle>
              <DialogDescription>
                La aceptación cubre todas las diferencias de la huella visible. Si cambia una factura o un costo, esta revisión quedará histórica.
              </DialogDescription>
            </DialogHeader>
            <form action={action} className="space-y-4">
              <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
              <input type="hidden" name="fingerprint" value={reconciliation.fingerprint} />
              {pendingItems.map((item) => {
                const options = item.linkedInvoiceItemIds.flatMap((id) => {
                  const line = invoiceLineById.get(id)
                  return line ? [{ value: `${item.ocItemId}:${id}`, label: `${line.invoiceNumber} · ${formatCLP(line.subtotal / line.quantity)}` }] : []
                })
                const selected = pendingSelections[item.ocItemId]
                return (
                  <Field key={item.ocItemId} label={`Registrar costo de OC: ${item.productName}`} htmlFor={`pending-${item.ocItemId}`} helper="Se usará el precio efectivo neto de una línea documental concreta.">
                    <OptionSelect
                      id={`pending-${item.ocItemId}`}
                      value={selected ? `${item.ocItemId}:${selected}` : ""}
                      onValueChange={(value) => setPendingSelections((current) => ({ ...current, [item.ocItemId]: value.split(":")[1] ?? "" }))}
                      options={options}
                      placeholder={options.length > 1 ? "Selecciona la factura fuente" : "Selecciona la línea fuente"}
                    />
                    {selected && <input type="hidden" name="pendingCostSelection" value={`${item.ocItemId}:${selected}`} />}
                  </Field>
                )
              })}

              {canUpdateCatalog && catalogLines.length > 0 && (
                <fieldset className="rounded-(--radius-lg) border border-(--color-border) p-3">
                  <legend className="px-1 text-sm font-medium text-(--color-text)">Actualizar catálogo de proveedor (opcional)</legend>
                  <p className="mb-2 text-xs text-(--color-text-subtle)">Solo cambia el precio vigente proveedor-producto; no modifica el precio acordado de la OC.</p>
                  <div className="space-y-1.5">
                    {catalogLines.map((line) => (
                      <Checkbox
                        key={line.id}
                        id={`catalog-${line.id}`}
                        name="catalogInvoiceItemId"
                        value={line.id}
                        label={`${line.productName} · factura ${line.invoiceNumber} · ${formatCLP(line.subtotal / line.quantity)}`}
                      />
                    ))}
                  </div>
                </fieldset>
              )}

              <Field label="Motivo" htmlFor="reconciliation-reason" error={state.fieldErrors?.reason?.[0]} helper="Obligatorio, entre 10 y 1000 caracteres.">
                <Textarea id="reconciliation-reason" name="reason" minLength={10} maxLength={1000} required />
              </Field>
              {!state.ok && state.message && <p role="alert" className="text-xs text-(--color-danger)">{state.message}</p>}
              <SubmitButton label="Aceptar diferencias" loadingLabel="Aceptando..." className="w-full" />
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
