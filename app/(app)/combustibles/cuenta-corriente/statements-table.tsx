"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { MetaBadge, metaFor } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
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
        const st = metaFor(statusLabels, s.displayStatus)
        return (
          <TableRow key={s.id}>
            <TableCell className="font-mono">{s.month}</TableCell>
            <TableCell className="font-semibold">{s.supplierName}</TableCell>
            <TableCell className="text-right font-mono">{formatQty(s.totalLiters)}</TableCell>
            <TableCell className="text-right font-mono">{formatCLP(s.totalAmount)}</TableCell>
            <TableCell className="text-right font-mono text-[var(--color-success-ink)]">{formatCLP(s.paidAmount)}</TableCell>
            <TableCell className="text-right font-mono text-[var(--color-warning-ink)]">{formatCLP(s.pending)}</TableCell>
            <TableCell className="font-mono text-sm">{s.dueDate ? formatDate(s.dueDate) : "—"}</TableCell>
            <TableCell><MetaBadge meta={st} /></TableCell>
            <TableCell>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/combustibles/cuenta-corriente/${s.id}`}>Ver</Link>
              </Button>
            </TableCell>
          </TableRow>
        )
      }}
      /* UX-003 (auditoría 2026-09-14): esta era una de las dos únicas tablas de
         `DataTable` sin `renderMobileCard`. La cartola de combustible se
         consulta en terreno, y a 390 px sus 8 columnas quedaban tras un
         desplazamiento horizontal —el patrón que el resto de la plataforma
         resolvió deliberadamente (ver el comentario A-1 en la tabla de
         Recepción)—. La otra tabla sin vista móvil es la hoja de impresión de
         la OC, donde la ausencia es correcta.

         Qué muestra la tarjeta: el mismo conjunto que la fila, sin inventar
         política. Mes y proveedor identifican la cartola; pagado y pendiente
         conservan el color semántico que ya usaba la fila; el estado va en el
         mismo `MetaBadge`; y "Ver" queda como acción principal a ancho
         completo, igual que en la tarjeta de Recepción. */
      renderMobileCard={(s) => {
        const st = metaFor(statusLabels, s.displayStatus)
        return (
          <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold text-[var(--color-text)]">{s.month}</p>
                <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">{s.supplierName}</p>
              </div>
              <MetaBadge meta={st} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-[var(--color-text-subtle)]">Litros</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{formatQty(s.totalLiters)}</dd>
              <dt className="text-[var(--color-text-subtle)]">Total</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{formatCLP(s.totalAmount)}</dd>
              <dt className="text-[var(--color-text-subtle)]">Pagado</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-success-ink)]">{formatCLP(s.paidAmount)}</dd>
              <dt className="text-[var(--color-text-subtle)]">Pendiente</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-warning-ink)]">{formatCLP(s.pending)}</dd>
              <dt className="text-[var(--color-text-subtle)]">Vencimiento</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{s.dueDate ? formatDate(s.dueDate) : "\u2014"}</dd>
            </dl>
            <Button asChild variant="primary" size="sm" className="mt-3 w-full">
              <Link href={`/combustibles/cuenta-corriente/${s.id}`}>Ver cartola</Link>
            </Button>
          </article>
        )
      }}
    />
  )
}
