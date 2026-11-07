"use client"

import { useActionState, useState, type ReactNode } from "react"
import Link from "next/link"
import { Plus } from "@phosphor-icons/react"
import { addPaymentAction } from "../../actions"
import type { ActionState } from "@/lib/validation/masters"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import { MetaBadge, metaFor } from "@/components/states/state-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { describeStatementStatus, getStatementDisplayStatus, statementPendingAmount } from "@/lib/combustibles/calculations"
import { FUEL_STATEMENT_STATUS_LABELS } from "@/lib/combustibles/labels"
import { fuelLoadHref } from "@/lib/combustibles/routes"
import { toast } from "@/lib/toast"
import { formatCLP, formatDate, formatQty, todayInChile } from "@/lib/utils"

interface StatementData {
  id: string
  month: string
  totalLiters: number
  totalBaseAmount: number
  totalIec: number
  totalIva: number
  totalAmount: number
  paidAmount: number
  dueDate: string | null
  status: string
  supplier: { name: string } | null
  payments: Array<{
    id: string
    paymentDate: string
    amount: number
    paymentMethod: string | null
    reference: string | null
  }>
  loads: Array<{
    id: string
    loadDate: string
    product: string
    receiptNumber: string | null
    liters: number
    totalAmount: number
    vehicle: { plate: string; code?: string | null } | null
    worksite: { name: string } | null
  }>
}

const CARD_TITLE = "text-base"

/**
 * Detalle de un estado de cuenta: el estado dicho en una frase (cuánto se pagó,
 * cuánto falta y para cuándo), el desglose, los pagos y las cargas que lo forman.
 * «Registrar pago» no está aquí sino en la cabecera de la página (`AddPaymentDialog`).
 * `today` es la fecha civil de Chile que calcula el servidor (`todayInChile()`).
 */
export function StatementDetail({ statement, today }: { statement: StatementData; today: string }) {
  const pending = statementPendingAmount(statement)
  const display = getStatementDisplayStatus(statement, today)
  const status = metaFor(FUEL_STATEMENT_STATUS_LABELS, display)
  const loads = statement.loads ?? []

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <MetaBadge meta={status} />
            <p className="text-sm text-[var(--color-text)]">{describeStatementStatus(statement, today)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <SummaryFigure label="Total a pagar" value={formatCLP(statement.totalAmount)} />
            <SummaryFigure label="Pagado" value={formatCLP(statement.paidAmount)} tone="success" />
            <SummaryFigure label="Por pagar" value={formatCLP(pending)} tone={pending > 0 ? "warning" : undefined} />
            <SummaryFigure label="Vence" value={statement.dueDate ? formatDate(statement.dueDate) : "Sin fecha"} valueKind={statement.dueDate ? "number" : "text"} />
          </dl>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle as="h2" className={CARD_TITLE}>Pagos registrados</CardTitle></CardHeader>
          <CardContent>
            {statement.payments.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Todavía no se registra ningún pago. Cuando pagues, anótalo con «Registrar pago», arriba.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Comprobante</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{formatDate(p.paymentDate)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCLP(p.amount)}</TableCell>
                      <TableCell>{p.paymentMethod ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{p.reference ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle as="h2" className={CARD_TITLE}>Desglose</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <SummaryFigure label="Litros" value={`${formatQty(statement.totalLiters)} L`} />
              <SummaryFigure label="Neto" value={formatCLP(statement.totalBaseAmount)} />
              <SummaryFigure label={<FuelTerm term="IEC">IEC</FuelTerm>} value={formatCLP(statement.totalIec)} />
              <SummaryFigure label={<FuelTerm term="IVA">IVA</FuelTerm>} value={formatCLP(statement.totalIva)} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle as="h2" className={CARD_TITLE}>Cargas del estado de cuenta ({loads.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="-mx-4 overflow-x-auto rounded-lg border px-4 sm:mx-0 sm:px-0">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>N.º factura</TableHead>
                  <TableHead className="text-right">Litros</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={fuelLoadHref({ origen: "factura", id: l.id })} className="underline-offset-2 hover:underline">{formatDate(l.loadDate)}</Link>
                    </TableCell>
                    <TableCell>{l.vehicle ? (l.vehicle.code ? `${l.vehicle.code} · ${l.vehicle.plate}` : l.vehicle.plate) : "—"}</TableCell>
                    <TableCell className="max-w-40 truncate">{l.worksite?.name ?? "—"}</TableCell>
                    <TableCell>{l.product}</TableCell>
                    <TableCell className="font-mono text-sm">{l.receiptNumber ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatQty(l.liters)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCLP(l.totalAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** `valueKind="text"` es para palabras («Sin fecha»): en sans y gris, no con el estilo de cifra. */
function SummaryFigure({ label, value, tone, valueKind = "number" }: { label: ReactNode; value: string; tone?: "success" | "warning"; valueKind?: "number" | "text" }) {
  const color = tone === "success" ? "text-[var(--color-success-ink)]" : tone === "warning" ? "text-[var(--color-warning-ink)]" : "text-[var(--color-text)]"
  return (
    <div>
      <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
      <dd className={valueKind === "text" ? "mt-0.5 text-base font-medium text-[var(--color-text-muted)]" : `mt-0.5 font-mono text-xl font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  )
}

/**
 * «Registrar pago». Vive en la cabecera de la página del detalle (acciones de
 * página, A3); la acción rechaza un monto mayor que lo que falta por pagar.
 */
export function AddPaymentDialog({ statementId, pendingAmount }: { statementId: string; pendingAmount: number }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await addPaymentAction(previous, formData)
    if (result.ok) {
      toast.success(result.message ?? "Pago registrado")
      setOpen(false)
    }
    return result
  }, { ok: false, message: "" })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="primary"><Plus aria-hidden="true" />Registrar pago</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>
            Por pagar: <span className="font-mono tabular-nums">{formatCLP(pendingAmount)}</span>. Al registrar el pago, el estado de cuenta se actualiza solo.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="statementId" value={statementId} />
          <Field label="Fecha de pago" htmlFor="payment-date" required error={state.fieldErrors?.paymentDate?.[0]}>
            <DatePicker id="payment-date" name="paymentDate" defaultValue={todayInChile()} />
          </Field>
          <Field label="Monto (en pesos)" htmlFor="payment-amount" required error={state.fieldErrors?.amount?.[0]}>
            <Input id="payment-amount" name="amount" type="number" step="0.01" min="0.01" max={pendingAmount} inputMode="decimal" required />
          </Field>
          <Field label="Método de pago" htmlFor="payment-method" hint="Transferencia, cheque…">
            <Input id="payment-method" name="paymentMethod" />
          </Field>
          <Field label="N.º de comprobante" htmlFor="payment-reference">
            <Input id="payment-reference" name="reference" />
          </Field>
          {state.message && !state.ok && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{state.message}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" disabled={isPending}>{isPending ? "Registrando…" : "Registrar pago"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
