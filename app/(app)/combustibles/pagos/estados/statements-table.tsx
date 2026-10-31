"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { MetaBadge, metaFor } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { formatCLP, formatDate, formatDateRelative, formatQty } from "@/lib/utils"
import { FUEL_STATEMENT_STATUS_LABELS as statusLabels } from "@/lib/combustibles/labels"
import { fuelMonthLabel, getStatementDisplayStatus, statementPendingAmount } from "@/lib/combustibles/calculations"
import { fuelStatementHref } from "@/lib/combustibles/routes"
import { NewStatementDialog } from "./new-statement-dialog"

interface StatementRow {
  id: string
  month: string
  totalLiters: number
  totalAmount: number
  paidAmount: number
  status: string
  dueDate: string | null
  supplier: { name: string } | null
  payments?: Array<{ amount: number }>
}

/** Un mes con cargas facturadas que todavía no tiene estado de cuenta (`getPayablesSummary`). */
export interface MissingStatementRow {
  supplierId: string
  supplierName: string
  month: string
  loads: number
  totalAmount: number
  monthClosed?: boolean
}

interface TableRowData extends Record<string, unknown> {
  key: string
  kind: "statement" | "missing"
  id: string | null
  month: string
  monthLabel: string
  supplierId: string | null
  supplierName: string
  totalLiters: number | null
  totalAmount: number
  paidAmount: number
  pending: number
  dueDate: string | null
  displayStatus: string
  loads: number | null
  monthClosed: boolean
}

const COLUMNS = [
  { key: "month", label: "Mes", sortable: true },
  { key: "supplierName", label: "Proveedor", sortable: true },
  { key: "totalLiters", label: "Litros", sortable: true, numeric: true },
  { key: "totalAmount", label: "Total", sortable: true, numeric: true },
  { key: "paidAmount", label: "Pagado", sortable: true, numeric: true },
  { key: "pending", label: "Por pagar", sortable: true, numeric: true },
  { key: "dueDate", label: "Vence", sortable: true },
  { key: "displayStatus", label: "Estado", sortable: true },
  { key: "_actions", label: "", sortable: false },
]

const MISSING_BADGE = { label: "Sin estado de cuenta", variant: "signal" } as const

/**
 * Estados de cuenta del período y, arriba, los meses que todavía no tienen uno
 * (con su botón «Crear»). «Vencido» nunca se guarda en `status` (nadie lo
 * escribe): se deriva igual que en las notificaciones, con `today` inyectado
 * (`todayInChile()`), para que la tabla no contradiga los avisos. La misma
 * información sale como tarjetas en pantalla angosta: la lista se consulta en
 * terreno y a 390 px sus 8 columnas quedaban tras un desplazamiento horizontal
 * (UX-003, auditoría 2026-09-14).
 */
export function StatementsTable({
  statements,
  missing = [],
  suppliers = [],
  canManage = false,
  today,
}: {
  statements: StatementRow[]
  missing?: MissingStatementRow[]
  suppliers?: Array<{ id: string; name: string }>
  canManage?: boolean
  today: string
}) {
  const missingRows: TableRowData[] = missing.map((m) => ({
    key: `missing:${m.supplierId}:${m.month}`,
    kind: "missing",
    id: null,
    month: m.month,
    monthLabel: fuelMonthLabel(m.month),
    supplierId: m.supplierId,
    supplierName: m.supplierName,
    totalLiters: null,
    totalAmount: m.totalAmount,
    paidAmount: 0,
    pending: 0,
    dueDate: null,
    displayStatus: "missing",
    loads: m.loads,
    monthClosed: m.monthClosed ?? true,
  }))
  const statementRows: TableRowData[] = statements.map((s) => ({
    key: s.id,
    kind: "statement",
    id: s.id,
    month: s.month,
    monthLabel: fuelMonthLabel(s.month),
    supplierId: null,
    supplierName: s.supplier?.name ?? "—",
    totalLiters: s.totalLiters,
    totalAmount: s.totalAmount,
    paidAmount: s.paidAmount,
    pending: statementPendingAmount(s),
    dueDate: s.dueDate,
    displayStatus: getStatementDisplayStatus(s, today),
    loads: null,
    monthClosed: true,
  }))
  const rows = [...missingRows, ...statementRows]

  const createButton = (row: TableRowData) =>
    canManage && row.supplierId ? (
      <NewStatementDialog suppliers={suppliers} defaultMonth={row.month} defaultSupplierId={row.supplierId} trigger="row" />
    ) : null

  return (
    <DataTable
      caption="Estados de cuenta mensuales por proveedor"
      columns={COLUMNS}
      rows={rows}
      searchKeys={["monthLabel", "supplierName"]}
      disableInternalSearch
      hideDensityToggle
      pageSize={25}
      emptyTitle="Todavía no hay estados de cuenta"
      emptyDescription="El estado de cuenta es el resumen mensual de un proveedor, con lo que se debe y lo que ya se pagó. Se crea al cerrar el mes, con las cargas facturadas."
      emptyAction={canManage ? <NewStatementDialog suppliers={suppliers} /> : undefined}
      renderRow={(row) => {
        const missingRow = row.kind === "missing"
        const st = missingRow ? MISSING_BADGE : metaFor(statusLabels, row.displayStatus)
        return (
          <TableRow key={row.key}>
            <TableCell className="whitespace-nowrap">{row.monthLabel}</TableCell>
            <TableCell className="font-semibold">{row.supplierName}</TableCell>
            <TableCell className="text-right font-mono">{row.totalLiters === null ? "—" : formatQty(row.totalLiters)}</TableCell>
            <TableCell
              className={`text-right font-mono ${missingRow ? "text-[var(--color-text-subtle)]" : ""}`}
              title={missingRow ? `Suma de las ${row.loads} cargas que todavía no están en un estado de cuenta` : undefined}
            >
              {formatCLP(row.totalAmount)}
            </TableCell>
            <TableCell className="text-right font-mono text-[var(--color-success-ink)]">{missingRow ? "—" : formatCLP(row.paidAmount)}</TableCell>
            <TableCell className="text-right font-mono text-[var(--color-warning-ink)]">{missingRow ? "—" : formatCLP(row.pending)}</TableCell>
            <TableCell className="whitespace-nowrap">
              {row.dueDate ? (
                <>
                  <span className="font-mono text-sm">{formatDate(row.dueDate)}</span>
                  {row.pending > 0 && <span className="block text-xs text-[var(--color-text-subtle)]">{formatDateRelative(row.dueDate, today)}</span>}
                </>
              ) : "—"}
            </TableCell>
            <TableCell><MetaBadge meta={st} /></TableCell>
            <TableCell>
              {missingRow ? createButton(row) : row.id ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={fuelStatementHref(row.id)} aria-label={`Ver el estado de cuenta de ${row.supplierName} de ${row.monthLabel}`}>Ver</Link>
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(row) => {
        const missingRow = row.kind === "missing"
        const st = missingRow ? MISSING_BADGE : metaFor(statusLabels, row.displayStatus)
        return (
          <article key={row.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)]">{row.monthLabel}</p>
                <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">{row.supplierName}</p>
              </div>
              <MetaBadge meta={st} />
            </div>
            {missingRow ? (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                {row.loads} {row.loads === 1 ? "carga facturada" : "cargas facturadas"} por{" "}
                <span className="font-mono tabular-nums text-[var(--color-text)]">{formatCLP(row.totalAmount)}</span> todavía sin estado de cuenta.
              </p>
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-[var(--color-text-subtle)]">Litros</dt>
                <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{formatQty(row.totalLiters ?? 0)}</dd>
                <dt className="text-[var(--color-text-subtle)]">Total</dt>
                <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{formatCLP(row.totalAmount)}</dd>
                <dt className="text-[var(--color-text-subtle)]">Pagado</dt>
                <dd className="text-right font-mono tabular-nums text-[var(--color-success-ink)]">{formatCLP(row.paidAmount)}</dd>
                <dt className="text-[var(--color-text-subtle)]">Por pagar</dt>
                <dd className="text-right font-mono tabular-nums text-[var(--color-warning-ink)]">{formatCLP(row.pending)}</dd>
                <dt className="text-[var(--color-text-subtle)]">Vence</dt>
                <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{row.dueDate ? formatDate(row.dueDate) : "—"}</dd>
              </dl>
            )}
            <div className="mt-3">
              {missingRow ? createButton(row) : row.id ? (
                <Button asChild variant="primary" size="sm" className="w-full">
                  <Link href={fuelStatementHref(row.id)}>Ver estado de cuenta</Link>
                </Button>
              ) : null}
            </div>
          </article>
        )
      }}
    />
  )
}
