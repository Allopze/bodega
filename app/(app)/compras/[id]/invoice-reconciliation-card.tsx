"use client"

import * as React from "react"
import { useActionState } from "react"
import { CheckCircle, ClockCounterClockwise, Info, Warning } from "@phosphor-icons/react"
import { INITIAL_STATE } from "@/lib/form-state"
import { SubmitButton } from "@/components/ui/submit-button"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { formatCLP, formatDateTime } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { isSoftInvoiceReconciliationIssue, type InvoiceReconciliationEvidence, type InvoiceReconciliationIssueCode } from "@/lib/services/purchasing-module/invoice-reconciliation"
import { acceptInvoiceReconciliationAction } from "../actions/invoice-reconciliation"
import type { InvoiceRow } from "./invoices-section"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

const STATUS = {
  no_invoices: { label: "Sin facturas", variant: "neutral" as const },
  partially_invoiced: { label: "Facturación parcial", variant: "info" as const },
  awaiting_receipt: { label: "Recepción pendiente", variant: "info" as const },
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
  quantity_over_received: "La recepción aceptada todavía no cubre la cantidad facturada",
  supplier_unverified: "RUT del proveedor no verificado en factura manual",
  total_mismatch: "Total facturado distinto del total OC",
}

/**
 * Un issue blando no describe un problema sino el supuesto bajo el que se
 * comparó, así que se redacta completo en vez de con la etiqueta corta que usa
 * la lista de advertencias.
 */
const SOFT_ISSUE_NOTES: Partial<Record<InvoiceReconciliationIssueCode, string>> = {
  missing_unit: "Hay líneas sin unidad de medida declarada en el documento. El precio se comparó asumiendo que la unidad es la misma que la de la OC.",
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
  // Sólo `unit_mismatch` apaga la comparación de precio en el motor. Mostrar
  // `$0` en esas líneas afirmaría una verificación que no ocurrió.
  const uncomparableItemIds = new Set(reconciliation.issues.flatMap((issue) =>
    issue.code === "unit_mismatch" && issue.orderItemId ? [issue.orderItemId] : [],
  ))
  const hardIssueLabels = [...new Set(reconciliation.issues
    .filter((issue) => !isSoftInvoiceReconciliationIssue(issue.code))
    .map((issue) => ISSUE_LABELS[issue.code]))]
  const softIssueNotes = [...new Set(reconciliation.issues
    .flatMap((issue) => isSoftInvoiceReconciliationIssue(issue.code) ? [SOFT_ISSUE_NOTES[issue.code]] : []))]
    .filter((note): note is string => Boolean(note))
  const receiptBlocksAcceptance = reconciliation.issues.some((issue) => issue.code === "quantity_over_received")
  const coverageBlocksAcceptance = ["partial", "not_evaluable", "no_invoices"].includes(reconciliation.coverage.status)

  return (
    <div className="mb-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface-2) p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">Conciliación de facturación</h3>
          <p className="mt-0.5 text-xs text-(--color-text-subtle)">
            {/* La tolerancia sale de la evidencia y no de un literal: desde que
                se configura en Administración, un número fijo acá le mentiría
                al operador sobre la regla con la que se evaluó su orden. */}
            Compara OC, entrega aceptada del proveedor y factura, además de unidades y precios efectivos netos.
            {" "}Tolerancia monetaria: ${reconciliation.money.tolerance.toLocaleString("es-CL")}.
          </p>
        </div>
        <MetaBadge meta={status} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-(--color-border) py-3 sm:grid-cols-4">
        <CoverageMetric label="Facturas" value={String(invoices.length)} />
        <CoverageMetric label="Total facturado" value={formatCLP(reconciliation.totalInvoiced)} />
        <CoverageMetric label="Saldo por facturar" value={formatCLP(reconciliation.coverage.remainingAmount)} />
        <CoverageMetric
          label="Líneas cubiertas"
          value={`${reconciliation.coverage.coveredItemCount}/${reconciliation.coverage.totalItemCount}`}
        />
      </dl>

      {reconciliation.status === "partially_invoiced" && (
        <p className="mt-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-xs text-(--color-text-muted)">
          Las facturas registradas son válidas, pero todavía queda cobertura documental pendiente. No es una diferencia aceptable ni una inconsistencia.
        </p>
      )}

      {reconciliation.status === "awaiting_receipt" && (
        <p className="mt-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-xs text-(--color-text-muted)">
          La facturación está completa. La conciliación se actualizará automáticamente cuando se registre recepción suficiente del proveedor.
        </p>
      )}

      {reconciliation.hasInvoices && (
        <div className="mt-3 overflow-x-auto">
          <TableRoot className="rounded-none border-0">
          <Table className="min-w-[720px] text-left text-xs">
            <caption className="sr-only">Conciliación de líneas de factura contra la orden de compra</caption>
            <TableHeader className="text-(--color-text-subtle)">
              <TableRow className="border-b border-(--color-border)">
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad OC / aceptada / factura</TableHead>
                <TableHead className="text-right">Precio OC</TableHead>
                <TableHead className="text-right">Precio factura</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead className="text-right">Catálogo vigente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliation.items.map((item) => (
                <TableRow key={item.ocItemId}>
                  <TableCell className="font-medium text-(--color-text)">{item.productName}</TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${item.receiptStatus === "over_invoiced" ? "text-(--color-warning-ink)" : ""}`}>
                    {item.ocQuantity} / {item.supplierReceivedQty} / {item.invoicedQty}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{item.ocEffectiveUnitPrice === null ? "Pendiente" : formatCLP(item.ocEffectiveUnitPrice)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{item.invoiceEffectiveUnitPrice === null ? "No evaluable" : formatCLP(item.invoiceEffectiveUnitPrice)}</TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${!uncomparableItemIds.has(item.ocItemId) && item.priceDifference && Math.abs(item.priceDifference) > 1 ? "text-(--color-warning-ink)" : "text-(--color-text-muted)"}`}>
                    {uncomparableItemIds.has(item.ocItemId)
                      ? "No comparable"
                      : item.priceDifference === null ? "—" : `${item.priceDifference > 0 ? "+" : ""}${formatCLP(item.priceDifference)}${item.pricePercentage === null ? "" : ` (${item.pricePercentage.toFixed(1)}%)`}`}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{item.currentSupplierPrice === null ? "—" : formatCLP(item.currentSupplierPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </TableRoot>
        </div>
      )}

      {hardIssueLabels.length > 0 && reconciliation.status !== "accepted_exception" && (
        <ul className="mt-3 space-y-1 text-xs text-(--color-warning-ink)">
          {hardIssueLabels.map((label) => (
            <li key={label} className="flex items-start gap-1.5"><Warning className="mt-0.5 shrink-0" size={13} weight="bold" aria-hidden />{label}</li>
          ))}
        </ul>
      )}

      {/* Se muestra incluso con la orden conciliada: es el supuesto con el que
          se leyó la tabla de arriba, y ocultarlo la haría afirmar de más. */}
      {softIssueNotes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-(--color-text-muted)">
          {softIssueNotes.map((note) => (
            <li key={note} className="flex items-start gap-1.5"><Info className="mt-0.5 shrink-0" size={13} aria-hidden />{note}</li>
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

      {coverageBlocksAcceptance && reconciliation.status === "needs_review" && (
        <p className="mt-3 rounded-(--radius-lg) border border-(--color-warning-line) bg-(--color-warning-tint) px-3 py-2 text-xs text-(--color-warning-ink)">
          Esta diferencia no puede cerrarse con la aceptación genérica: todavía falta cobertura documental de la OC.
        </p>
      )}

      {canAccept && reconciliation.status === "needs_review" && !receiptBlocksAcceptance && !coverageBlocksAcceptance && (
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

function CoverageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.06em] text-(--color-text-subtle)">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-(--color-text)">{value}</dd>
    </div>
  )
}
