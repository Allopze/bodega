"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate, formatCLP } from "@/lib/utils"
import { IT_MAINTENANCE_TYPE_META } from "@/lib/services/ti/constants"
import { MaintenanceSheet } from "./maintenance-sheet"

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
}

const COLUMNS = [
  { key: "date", label: "Fecha", sortable: true, width: "w-28" },
  { key: "asset", label: "Activo", sortable: true },
  { key: "type", label: "Tipo", width: "w-28" },
  { key: "issue", label: "Problema reportado" },
  { key: "work", label: "Trabajo realizado" },
  { key: "technician", label: "Técnico / proveedor", width: "w-40" },
  { key: "cost", label: "Costo", numeric: true, width: "w-28" },
  { key: "actions", label: "", width: "w-20" },
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
      searchKeys={["assetCode", "assetBrand", "assetModel", "reportedIssue", "workDone", "technicianName", "technicianUserName", "supplierName"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        return (
          <TableRow key={row.id}>
            <TableCell className="w-28">{formatDate(row.date)}</TableCell>
            <TableCell>
              <Link href={`/ti/activos/${row.assetId}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">
                {row.assetCode}
              </Link>
              <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.assetBrand, row.assetModel].filter(Boolean).join(" ")}</span>
            </TableCell>
            <TableCell className="w-28"><Badge variant="warning">{IT_MAINTENANCE_TYPE_META[row.type] ?? row.type}</Badge></TableCell>
            <TableCell className="max-w-[240px] truncate">{row.reportedIssue ?? "—"}</TableCell>
            <TableCell className="max-w-[280px] truncate">{row.workDone}</TableCell>
            <TableCell className="w-40">
              <span className="text-xs text-[var(--color-text-muted)]">
                {[row.technicianName, row.technicianUserName, row.supplierName].filter(Boolean).join(" · ") || "—"}
              </span>
            </TableCell>
            <TableCell className="w-28 text-right font-mono text-xs font-semibold">{formatCLP(Number(row.cost ?? 0))}</TableCell>
            <TableCell className="w-20 text-right">
              {canManage && (
                <MaintenanceSheet
                  trigger={<span className="cursor-pointer text-xs font-semibold text-[var(--color-primary)] hover:underline">Editar</span>}
                  suppliers={suppliers}
                  editMaintenance={row}
                />
              )}
            </TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        return (
          <Link key={row.id} href={`/ti/activos/${row.assetId}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="text-sm font-medium text-[var(--color-text)]">{row.assetCode} · {IT_MAINTENANCE_TYPE_META[row.type] ?? row.type}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{formatDate(row.date)} · {formatCLP(Number(row.cost ?? 0))}</div>
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
