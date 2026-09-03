"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate, formatCLP, cn } from "@/lib/utils"
import { isCivilDateBefore } from "@/lib/services/ti/civil-dates"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"
import { ArrowRight, Wrench } from "@phosphor-icons/react"
import type { AssetRow } from "./page"

const COLUMNS = [
  { key: "code", label: "Código", width: "w-28" },
  { key: "name", label: "Activo", sortable: true },
  { key: "status", label: "Estado", width: "w-32" },
  { key: "worker", label: "Asignado a", sortable: true },
  { key: "worksite", label: "Faena", sortable: true },
  { key: "type", label: "Tipo", sortable: true },
  { key: "warranty", label: "Garantía", width: "w-28" },
  { key: "cost", label: "Costo", numeric: true, width: "w-28" },
  { key: "maintenance", label: "Mant.", numeric: true, width: "w-24" },
  { key: "tickets", label: "Tickets", numeric: true, width: "w-20" },
]

function StatusBadge({ status }: { status: string }) {
  const meta = IT_ASSET_STATUS_META[status]
  if (!meta) return <Badge variant="default">{status}</Badge>
  return (
    <Badge variant={meta.variant} dot>
      {meta.label}
    </Badge>
  )
}

export function AssetTable({ rows, canManage }: { rows: AssetRow[]; canManage: boolean }) {
  return (
    <DataTable
      caption="Inventario de activos TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["code", "brand", "model", "serialNumber", "workerName", "worksiteName", "typeName"]}
      renderRow={(raw) => {
        const row = raw as unknown as AssetRow
        return (
          <TableRow key={row.id} className="group">
            <TableCell className="w-28">
              <Link href={`/ti/activos/${row.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              <div className="font-medium text-[var(--color-text)]">
                {[row.brand, row.model].filter(Boolean).join(" ") || "—"}
              </div>
              {row.serialNumber && <div className="text-xs text-[var(--color-text-subtle)]">Serie: {row.serialNumber}</div>}
            </TableCell>
            <TableCell className="w-32"><StatusBadge status={row.status} /></TableCell>
            <TableCell>{row.workerName ?? "—"}</TableCell>
            <TableCell>{row.worksiteName ?? "—"}</TableCell>
            <TableCell>{row.typeName}</TableCell>
            <TableCell className="w-28">
              {row.warrantyEndDate ? (
                <span className={cn(
                  "text-xs",
                  isCivilDateBefore(row.warrantyEndDate)
                    ? "text-[var(--color-danger-ink)]"
                    : "text-[var(--color-text-muted)]",
                )}>
                  {formatDate(row.warrantyEndDate)}
                </span>
              ) : "—"}
            </TableCell>
            <TableCell className="w-28 text-right">{row.cost != null ? formatCLP(row.cost) : "—"}</TableCell>
            <TableCell className="w-24">
              <span className="flex items-center justify-end gap-1 text-xs">
                <Wrench size={11} className="text-[var(--color-text-subtle)]" aria-hidden />
                {row.maintenanceCount}
                {row.maintenanceCost > 0 && <span className="text-[var(--color-text-subtle)]">({formatCLP(row.maintenanceCost)})</span>}
              </span>
            </TableCell>
            <TableCell className="w-20 text-right">{row.ticketCount}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as AssetRow
        return (
          <Link key={row.id} href={`/ti/activos/${row.id}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</div>
              <div className="text-sm text-[var(--color-text)]">{[row.brand, row.model].filter(Boolean).join(" ") || "—"}</div>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={row.status} />
                {row.workerName && <span className="text-xs text-[var(--color-text-muted)]">{row.workerName}</span>}
              </div>
            </div>
            <ArrowRight size={14} className="text-[var(--color-text-subtle)]" />
          </Link>
        )
      }}
      emptyTitle="Sin activos registrados"
      emptyDescription={canManage ? "Crea el primer activo TI con el botón «Nuevo activo»." : "No hay activos que coincidan con tu búsqueda."}
      pageSize={25}
      enableColumnToggle
      viewKey="ti-activos"
      stickyFirstColumn
    />
  )
}
