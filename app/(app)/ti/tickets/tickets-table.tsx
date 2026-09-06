"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDateTime } from "@/lib/utils"
import { IT_TICKET_STATUS_META, IT_TICKET_PRIORITY_META, IT_TICKET_CATEGORY_META } from "@/lib/services/ti/constants"

interface Row {
  id: string
  code: string
  subject: string
  category: string
  priority: string
  status: string
  workerId: string | null
  workerName: string | null
  worksiteId: string
  worksiteName: string
  assetId: string | null
  assetCode: string | null
  assigneeUserId: string | null
  assigneeName: string | null
  requesterName: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

const COLUMNS = [
  { key: "code", label: "Código", width: "w-32" },
  { key: "subject", label: "Asunto", sortable: true },
  { key: "status", label: "Estado", width: "w-36" },
  { key: "priority", label: "Prioridad", width: "w-24" },
  { key: "category", label: "Categoría", width: "w-32" },
  { key: "worker", label: "Trabajador", sortable: true },
  { key: "worksite", label: "Faena", sortable: true },
  { key: "assignee", label: "Técnico", width: "w-36" },
  { key: "updated", label: "Actualizado", sortable: true, width: "w-32" },
]

export function TicketsTable({ rows }: { rows: Row[]; canManage: boolean }) {
  return (
    <DataTable
      caption="Tickets de mesa de ayuda TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["code", "subject", "workerName", "worksiteName", "assigneeName", "requesterName", "assetCode"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        return (
          <TableRow key={row.id}>
            <TableCell className="w-32">
              <Link href={`/ti/tickets/${row.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              <span className="font-medium text-[var(--color-text)]">{row.subject}</span>
              {row.assetCode && <span className="ml-2 text-xs text-[var(--color-text-subtle)]">· {row.assetCode}</span>}
            </TableCell>
            <TableCell className="w-36">
              <MetaBadge meta={{ label: `${IT_TICKET_STATUS_META[row.status]?.label ?? row.status}`, variant: IT_TICKET_STATUS_META[row.status]?.variant ?? "default" }} dot />
            </TableCell>
            <TableCell className="w-24">
              <MetaBadge meta={{ label: `${IT_TICKET_PRIORITY_META[row.priority]?.label ?? row.priority}`, variant: IT_TICKET_PRIORITY_META[row.priority]?.variant ?? "default" }} />
            </TableCell>
            <TableCell className="w-32">{IT_TICKET_CATEGORY_META[row.category] ?? row.category}</TableCell>
            <TableCell>{row.workerName ?? "—"}</TableCell>
            <TableCell>{row.worksiteName}</TableCell>
            <TableCell className="w-36">{row.assigneeName ?? "—"}</TableCell>
            <TableCell className="w-32">{formatDateTime(row.updatedAt)}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        return (
          <Link key={row.id} href={`/ti/tickets/${row.id}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</div>
              <div className="text-sm text-[var(--color-text)]">{row.subject}</div>
              <div className="mt-1 flex items-center gap-2">
                <MetaBadge meta={{ label: `${IT_TICKET_STATUS_META[row.status]?.label ?? row.status}`, variant: IT_TICKET_STATUS_META[row.status]?.variant ?? "default" }} />
                <span className="text-xs text-[var(--color-text-muted)]">{row.worksiteName}</span>
              </div>
            </div>
          </Link>
        )
      }}
      emptyTitle="Sin tickets"
      emptyDescription="No hay tickets que coincidan con los filtros."
      pageSize={25}
      viewKey="ti-tickets"
      enableColumnToggle
    />
  )
}
