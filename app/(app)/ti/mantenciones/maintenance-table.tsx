"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate, formatCLP } from "@/lib/utils"
import { IT_MAINTENANCE_TYPE_META } from "@/lib/services/ti/constants"
import { MaintenanceSheet } from "./maintenance-sheet"
import { VoidMaintenanceDialog } from "./void-maintenance-dialog"

interface Row {
  id: string
  assetId: string
  assetCode: string
  assetBrand: string | null
  assetModel: string | null
  type: string
  date: string
  reportedIssue: string | null
  diagnosis: string | null
  workDone: string
  partsUsed: string | null
  cost: number
  supplierId: string | null
  supplierName: string | null
  technicianName: string | null
  technicianUserId: string | null
  technicianUserName: string | null
  observations: string | null
  voidedAt: string | null
  voidReason: string | null
  voidedByUserName: string | null
}

const COLUMNS = [
  { key: "date", label: "Fecha", sortable: true, width: "w-28" },
  { key: "asset", label: "Activo", sortable: true },
  { key: "type", label: "Tipo", width: "w-28" },
  { key: "issue", label: "Problema reportado" },
  { key: "work", label: "Trabajo realizado" },
  { key: "technician", label: "Técnico / proveedor", width: "w-40" },
  { key: "cost", label: "Costo", numeric: true, width: "w-28" },
  { key: "actions", label: "", width: "w-28" },
]

export function MaintenanceTable({ rows, canManage = false, suppliers = [] }: {
  rows: Row[]
  canManage?: boolean
  suppliers?: { id: string; name: string }[]
}) {
  return (
    <DataTable
      caption="Mantenciones y reparaciones TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["assetCode", "assetBrand", "assetModel", "reportedIssue", "workDone", "technicianName", "technicianUserName", "supplierName", "voidReason"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        const voided = Boolean(row.voidedAt)
        return (
          <TableRow key={row.id} className={voided ? "opacity-70" : undefined}>
            <TableCell className="w-28">{formatDate(row.date)}</TableCell>
            <TableCell>
              <Link href={`/ti/activos/${row.assetId}`} className={`font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline ${voided ? "line-through" : ""}`}>
                {row.assetCode}
              </Link>
              <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.assetBrand, row.assetModel].filter(Boolean).join(" ")}</span>
              {voided && (
                <span className="ml-2"><MetaBadge meta={{ label: "Anulada", variant: "danger" }} /></span>
              )}
            </TableCell>
            <TableCell className="w-28"><MetaBadge meta={{ label: IT_MAINTENANCE_TYPE_META[row.type] ?? row.type, variant: "warning" }} /></TableCell>
            <TableCell className={`max-w-[240px] truncate ${voided ? "line-through" : ""}`}>{row.reportedIssue ?? "—"}</TableCell>
            <TableCell className={`max-w-[280px] truncate ${voided ? "line-through" : ""}`}>{row.workDone}</TableCell>
            <TableCell className="w-40">
              <span className="text-xs text-[var(--color-text-muted)]">
                {[row.technicianName, row.technicianUserName, row.supplierName].filter(Boolean).join(" · ") || "—"}
              </span>
            </TableCell>
            <TableCell className={`w-28 text-right font-mono text-xs font-semibold ${voided ? "line-through" : ""}`}>{formatCLP(Number(row.cost ?? 0))}</TableCell>
            <TableCell className="w-28 text-right">
              {voided ? (
                <span className="text-xs text-[var(--color-text-subtle)]" title={row.voidReason ?? undefined}>
                  por {row.voidedByUserName ?? "—"}
                </span>
              ) : canManage ? (
                <div className="flex items-center justify-end gap-1">
                  <MaintenanceSheet
                    trigger={<Button type="button" variant="link" size="sm">Editar</Button>}
                    suppliers={suppliers}
                    editMaintenance={row}
                  />
                  <VoidMaintenanceDialog maintenanceId={row.id} assetCode={row.assetCode} date={formatDate(row.date)} cost={Number(row.cost ?? 0)} />
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        const voided = Boolean(row.voidedAt)
        return (
          <Link key={row.id} href={`/ti/activos/${row.assetId}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                <span className={voided ? "line-through" : undefined}>{row.assetCode} · {IT_MAINTENANCE_TYPE_META[row.type] ?? row.type}</span>
                {voided && <MetaBadge meta={{ label: "Anulada", variant: "danger" }} />}
              </div>
              {/* El costo va tachado también acá: en móvil esta tarjeta es la
                  única lectura del monto, y sin la marca se re-reporta como real. */}
              <div className={`text-xs text-[var(--color-text-muted)] ${voided ? "line-through" : ""}`}>{formatDate(row.date)} · {formatCLP(Number(row.cost ?? 0))}</div>
            </div>
          </Link>
        )
      }}
      emptyTitle="Sin mantenciones"
      emptyDescription="Las mantenciones y reparaciones registradas aparecerán acá."
      pageSize={25}
      viewKey="ti-mantenciones"
      enableColumnToggle
    />
  )
}
