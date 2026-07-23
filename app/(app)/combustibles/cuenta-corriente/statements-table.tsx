"use client"

import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCLP } from "@/lib/utils"

interface StatementRow {
  id: string
  month: string
  totalLiters: number
  totalAmount: number
  paidAmount: number
  status: string
  dueDate: string | null
  supplier: { name: string } | null
  payments: Array<{ amount: number }>
}

const statusLabels: Record<string, { label: string; variant: "primary" | "default" | "info" | "warning" | "success" | "signal" | "danger" | "outline" }> = {
  open: { label: "Abierto", variant: "default" as const },
  partial: { label: "Pago parcial", variant: "outline" as const },
  paid: { label: "Pagado", variant: "success" as const },
  overdue: { label: "Vencido", variant: "danger" as const },
  cancelled: { label: "Anulado", variant: "danger" as const },
}

const LITERS_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })
const formatLiters = (n: number) => LITERS_FORMAT.format(n)

export function StatementsTable({ statements }: { statements: StatementRow[] }) {
  return (
    <div className="border rounded-lg overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <Table className="min-w-[700px]">
        <TableHeader>
          <TableRow>
            <TableHead>Mes</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead className="text-right">Litros</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Pagado</TableHead>
            <TableHead className="text-right">Pendiente</TableHead>
            <TableHead>Vencimiento</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {statements.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                No hay resúmenes mensuales. Crea uno desde &quot;+ Nuevo resumen&quot;.
              </TableCell>
            </TableRow>
          ) : (
            statements.map((s) => {
              const st = statusLabels[s.status] ?? { label: s.status, variant: "default" as const }
              const pending = s.totalAmount - s.paidAmount
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-mono">{s.month}</TableCell>
                  <TableCell className="font-semibold">{s.supplier?.name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatLiters(s.totalLiters)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCLP(s.totalAmount)}</TableCell>
                  <TableCell className="text-right font-mono text-green-600">{formatCLP(s.paidAmount)}</TableCell>
                  <TableCell className="text-right font-mono text-amber-600">{formatCLP(pending > 0 ? pending : 0)}</TableCell>
                  <TableCell className="font-mono text-sm">{s.dueDate ?? "—"}</TableCell>
                  <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/combustibles/cuenta-corriente/${s.id}`}>Ver</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
