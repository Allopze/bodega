"use client"

import Link from "next/link"
import { DataTable } from "@/components/admin/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCLP, formatDate } from "@/lib/utils"
import { FUEL_STATEMENT_STATUS_LABELS as statusLabels } from "@/lib/combustibles/labels"
import { getStatementDisplayStatus } from "@/lib/combustibles/calculations"

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

const LITERS_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })
const formatLiters = (n: number) => LITERS_FORMAT.format(n)

const COLUMNS = [
  { key: "month", label: "Mes", sortable: true },
  { key: "supplierName", label: "Proveedor", sortable: true },
  { key: "totalLiters", label: "Litros", sortable: true, numeric: true },
  { key: "totalAmount", label: "Total", sortable: true, numeric: true },
  { key: "paidAmount", label: "Pagado", sortable: true, numeric: true },
  { key: "pending", label: "Pendiente", sortable: true, numeric: true },
  { key: "dueDate", label: "Vencimiento", sortable: true },
  { key: "displayStatus", label: "Estado", sortable: true },
  { key: "_actions", label: "", sortable: false },
]

export function StatementsTable({ statements, today }: { statements: StatementRow[]; today: string }) {
  // "Vencido" nunca se persiste en `status` (nadie lo escribe) — se deriva
  // igual que en las notificaciones, para que la tabla no contradiga los
  // avisos que ya recibió el usuario. Se calcula antes de pasar a DataTable
  // para que quede disponible como searchKey y columna ordenable.
  const rows = statements.map((s) => ({
    ...s,
    supplierName: s.supplier?.name ?? "—",
    pending: Math.max(0, s.totalAmount - s.paidAmount),
    displayStatus: getStatementDisplayStatus(s, today),
  }))

  return (
    <DataTable
      caption="Resúmenes mensuales de cuenta corriente"
      columns={COLUMNS}
      rows={rows}
      searchKeys={["month", "supplierName"]}
      pageSize={25}
      emptyTitle="Sin resúmenes mensuales"
      emptyDescription='Crea uno desde "+ Nuevo resumen".'
      renderRow={(s) => {
        const st = statusLabels[s.displayStatus] ?? { label: s.displayStatus, variant: "default" as const }
        return (
          <TableRow key={s.id}>
            <TableCell className="font-mono">{s.month}</TableCell>
            <TableCell className="font-semibold">{s.supplierName}</TableCell>
            <TableCell className="text-right font-mono">{formatLiters(s.totalLiters)}</TableCell>
            <TableCell className="text-right font-mono">{formatCLP(s.totalAmount)}</TableCell>
            <TableCell className="text-right font-mono text-[var(--color-success-ink)]">{formatCLP(s.paidAmount)}</TableCell>
            <TableCell className="text-right font-mono text-[var(--color-warning-ink)]">{formatCLP(s.pending)}</TableCell>
            <TableCell className="font-mono text-sm">{s.dueDate ? formatDate(s.dueDate) : "—"}</TableCell>
            <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
            <TableCell>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/combustibles/cuenta-corriente/${s.id}`}>Ver</Link>
              </Button>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
