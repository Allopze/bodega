"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { formatCLP } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { validateInvoiceLineAllocationSet } from "@/lib/services/purchasing-module/invoice-line-allocation-validation"
import { INVOICE_ALLOCATION_ERRORS } from "@/lib/services/purchasing-module/invoice-allocation-feedback"
import type { InvoiceReconciliationInvoiceItem } from "@/lib/services/purchasing-module/invoice-reconciliation"
import { saveInvoiceLineAllocationsAction } from "../actions/invoice-allocations"
import type { OcItem } from "./invoices-section"

type EditableLine = InvoiceReconciliationInvoiceItem & { allocationFingerprint: string }
type DraftRow = { key: string; purchaseOrderItemId: string; quantity: string; subtotal: string }
function draftRows(line: EditableLine): DraftRow[] {
  return line.allocations.length ? line.allocations.map(row => ({ key: row.id, purchaseOrderItemId: row.purchaseOrderItemId, quantity: String(row.quantity), subtotal: String(row.subtotal) }))
    : [{ key: "initial", purchaseOrderItemId: "", quantity: String(line.quantity), subtotal: String(line.subtotal) }]
}

export function InvoiceAllocationEditor({ purchaseOrderId, line, orderItems }: { purchaseOrderId: string; line: EditableLine; orderItems: OcItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => ({ rows: draftRows(line), coverage: "complete" as "partial" | "complete" }))
  const [failure, setFailure] = useState<{ code?: string; message: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const saving = useRef(false)
  const rowSequence = useRef(0)
  const allocations = draft.rows.map(row => ({ purchaseOrderItemId: row.purchaseOrderItemId, quantity: row.quantity.trim() ? Number(row.quantity) : NaN, subtotal: row.subtotal.trim() ? Number(row.subtotal) : NaN }))
  const preview = validateInvoiceLineAllocationSet({ invoiceItem: line, orderId: purchaseOrderId, orderItems: orderItems.map(item => ({ ...item, purchaseOrderId })), allocations, coverage: draft.coverage })
  const assignedQuantity = allocations.reduce((sum, row) => sum + (Number.isFinite(row.quantity) ? row.quantity : 0), 0)
  const assignedSubtotal = allocations.reduce((sum, row) => sum + (Number.isFinite(row.subtotal) ? row.subtotal : 0), 0)
  const stale = failure?.code === "STALE_EVIDENCE"
  const disabled = pending || stale

  function changeOpen(next: boolean) {
    if (saving.current) return
    if (next) {
      setDraft({ rows: draftRows(line), coverage: "complete" })
      setFailure(null)
    }
    setOpen(next)
  }

  function updateRow(key: string, values: Partial<DraftRow>) {
    setDraft(current => ({ ...current, rows: current.rows.map(row => row.key === key ? { ...row, ...values } : row) }))
    setFailure(null)
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current || !preview.ok || stale || !draft.rows.length) return
    saving.current = true
    startTransition(async () => {
      try {
        const result = await saveInvoiceLineAllocationsAction(JSON.stringify({ purchaseOrderId, invoiceItemId: line.id, fingerprint: line.allocationFingerprint, coverage: draft.coverage, allocations }))
        if (result.ok) {
          toast.success(result.message)
          setOpen(false)
          router.refresh()
        } else setFailure(result)
      } catch {
        setFailure({ message: "No se pudo conectar. Tus cambios siguen aquí; vuelve a intentar guardar." })
      } finally {
        saving.current = false
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" variant="ghost" size="sm">Dividir línea</Button></DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Repartir línea de factura</DialogTitle>
          <DialogDescription className="break-words">{line.productName}{line.productCode ? ` · ${line.productCode}` : ""}. Asigna la cantidad y el subtotal documental entre las líneas de esta OC.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" aria-busy={pending}>
          <p className="font-mono text-sm tabular-nums break-words">Documento: {line.quantity} {line.unitOfMeasure ?? "sin unidad"} · {formatCLP(line.subtotal)}</p>
          <div className="space-y-3">
            {draft.rows.map((row, index) => (
              <fieldset key={row.key} disabled={disabled} className="min-w-0 grid gap-3 rounded-(--radius-lg) border border-(--color-border) p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm">Asignación {index + 1}</legend>
                <div className="min-w-0 sm:col-span-2">
                  <Field label={`Línea de OC ${index + 1}`} htmlFor={`${line.id}-${row.key}-target`}>
                    <OptionSelect id={`${line.id}-${row.key}-target`} value={row.purchaseOrderItemId} disabled={disabled} onValueChange={purchaseOrderItemId => updateRow(row.key, { purchaseOrderItemId })} placeholder="Selecciona una línea de OC" className="w-full min-w-0"
                      options={orderItems.map(item => ({ value: item.id, label: [item.productName, item.productCode, ...(item.attributes ?? []).map(attribute => `${attribute.name}: ${attribute.value}`), `${item.quantity} ${item.unitOfMeasure}`].filter(Boolean).join(" · "), disabled: draft.rows.some(other => other.key !== row.key && other.purchaseOrderItemId === item.id) }))} />
                  </Field>
                </div>
                <Field label={`Cantidad ${index + 1}`} htmlFor={`${line.id}-${row.key}-quantity`}>
                  <Input id={`${line.id}-${row.key}-quantity`} className="font-mono tabular-nums" type="number" step="any" required value={row.quantity} onChange={event => updateRow(row.key, { quantity: event.target.value })} />
                </Field>
                <Field label={`Subtotal ${index + 1}`} htmlFor={`${line.id}-${row.key}-subtotal`}>
                  <Input id={`${line.id}-${row.key}-subtotal`} className="font-mono tabular-nums" type="number" step="any" required value={row.subtotal} onChange={event => updateRow(row.key, { subtotal: event.target.value })} />
                </Field>
                <Button type="button" variant="ghost" size="sm" disabled={disabled || draft.rows.length === 1} onClick={() => setDraft(current => ({ ...current, rows: current.rows.filter(other => other.key !== row.key) }))}>Quitar asignación {index + 1}</Button>
              </fieldset>
            ))}
          </div>
          <Button type="button" variant="secondary" disabled={disabled || draft.rows.length >= Math.min(100, orderItems.length)} onClick={() => setDraft(current => ({ ...current, rows: [...current.rows, { key: `new-${++rowSequence.current}`, purchaseOrderItemId: "", quantity: "", subtotal: "" }] }))}>Añadir asignación</Button>
          <div aria-live="polite" className="space-y-1 font-mono text-sm tabular-nums break-words">
            <p>Cantidad asignada: {assignedQuantity} · Restante: {Number((line.quantity - assignedQuantity).toFixed(6))}</p>
            <p>Subtotal asignado: {formatCLP(assignedSubtotal)} · Restante: {formatCLP(line.subtotal - assignedSubtotal)}</p>
          </div>
          <Field label="Cobertura del reparto" htmlFor={`${line.id}-coverage`}>
            <OptionSelect id={`${line.id}-coverage`} value={draft.coverage} disabled={disabled} onValueChange={value => setDraft(current => ({ ...current, coverage: value === "partial" ? "partial" : "complete" }))} options={[{ value: "complete", label: "Completa: asignar toda la línea" }, { value: "partial", label: "Parcial: dejar saldo por asignar" }]} />
          </Field>
          <p className="text-xs text-(--color-text-muted)">No se recordará una correspondencia automática con el proveedor desde este editor. Los repartos entre productos no definen un alias único.</p>
          {!preview.ok && <p className="text-sm text-(--color-warning-ink)" aria-live="polite">{INVOICE_ALLOCATION_ERRORS[preview.code]}</p>}
          {failure && <p role="alert" className="text-sm text-(--color-danger-ink)">{failure.message}</p>}
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => changeOpen(false)}>Cancelar</Button>
            {stale && <Button type="button" variant="secondary" onClick={() => { setOpen(false); router.refresh() }}>Recargar evidencia</Button>}
            <Button type="submit" variant="primary" loading={pending} disabled={disabled || !preview.ok || !draft.rows.length}>{pending ? "Guardando…" : "Guardar reparto"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
