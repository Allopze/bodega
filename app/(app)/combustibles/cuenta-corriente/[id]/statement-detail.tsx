"use client"

import { useActionState, useState } from "react"
import { addPaymentAction } from "../../actions"
import type { ActionState } from "@/lib/validation/masters"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { formatCLP } from "@/lib/utils"

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
    serviceType: string
    product: string
    receiptNumber: string | null
    liters: number
    totalAmount: number
    vehicle: { plate: string } | null
    worksite: { name: string } | null
  }>
}

const LITERS_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })
const formatLiters = (n: number) => LITERS_FORMAT.format(n)

export function StatementDetail({ statement }: { statement: StatementData }) {
  const pending = statement.totalAmount - statement.paidAmount
  const isPayable = statement.status !== "paid" && statement.status !== "cancelled"

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total litros</p>
            <p className="text-2xl font-bold">{formatLiters(statement.totalLiters)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total a pagar</p>
            <p className="text-2xl font-bold">{formatCLP(statement.totalAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Pagado</p>
            <p className="text-2xl font-bold text-green-600">{formatCLP(statement.paidAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Pendiente</p>
            <p className="text-2xl font-bold text-amber-600">{formatCLP(pending > 0 ? pending : 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown */}
      <Card>
        <CardHeader><CardTitle>Desglose</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-muted-foreground">Base afecta:</span> {formatCLP(statement.totalBaseAmount)}</div>
          <div><span className="text-muted-foreground">IEC total:</span> {formatCLP(statement.totalIec)}</div>
          <div><span className="text-muted-foreground">IVA:</span> {formatCLP(statement.totalIva)}</div>
          <div><span className="text-muted-foreground">Vencimiento:</span> {statement.dueDate ?? "—"}</div>
        </CardContent>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pagos registrados</CardTitle>
          {isPayable && <AddPaymentDialog statementId={statement.id} pendingAmount={pending} />}
        </CardHeader>
        <CardContent>
          {statement.payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No hay pagos registrados</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.paymentDate}</TableCell>
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

      {/* Loads */}
      <Card>
        <CardHeader><CardTitle>Cargas asociadas ({statement.loads?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Litros</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(statement.loads ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-sm">{l.loadDate}</TableCell>
                    <TableCell>{l.serviceType}</TableCell>
                    <TableCell>{l.vehicle?.plate ?? "—"}</TableCell>
                    <TableCell className="max-w-40 truncate">{l.worksite?.name ?? "—"}</TableCell>
                    <TableCell>{l.product}</TableCell>
                    <TableCell className="text-right font-mono">{formatLiters(l.liters)}</TableCell>
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

function AddPaymentDialog({ statementId, pendingAmount }: { statementId: string; pendingAmount: number }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(addPaymentAction, { ok: false, message: "" })

  if (state.ok && open) {
    toast.success(state.message)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Registrar pago</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="statementId" value={statementId} />
          <p className="text-sm text-muted-foreground">Pendiente: {formatCLP(pendingAmount)}</p>
          <div className="space-y-2">
            <Label>Fecha de pago *</Label>
            <DatePicker name="paymentDate" />
          </div>
          <div className="space-y-2">
            <Label>Monto (CLP) *</Label>
            <Input name="amount" type="number" step="0.01" min="0.01" required />
          </div>
          <div className="space-y-2">
            <Label>Método de pago</Label>
            <Input name="paymentMethod" placeholder="Transferencia, cheque..." />
          </div>
          <div className="space-y-2">
            <Label>Nro comprobante</Label>
            <Input name="reference" />
          </div>
          {state.message && !state.ok && <p className="text-sm text-destructive">{state.message}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Registrando..." : "Registrar pago"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
