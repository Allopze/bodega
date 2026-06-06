"use client"

import * as React from "react"
import Link from "next/link"
import { Plus, ArrowRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"

export interface RequestRow {
  id:            string
  code:          string
  worksiteName:  string
  costCenterName: string | null
  urgency:       string
  status:        string
  itemCount:     number
  submittedAt:   string | null
  createdAt:     string
}

const COLUMNS = [
  { key: "code",          label: "Código",     sortable: true,  width: "w-36" },
  { key: "worksiteName",  label: "Faena",      sortable: true  },
  { key: "urgency",       label: "Urgencia",   sortable: true,  width: "w-28" },
  { key: "itemCount",     label: "Ítems",      sortable: true,  numeric: true, width: "w-20" },
  { key: "status",        label: "Estado",     sortable: true,  width: "w-36" },
  { key: "createdAt",     label: "Fecha",      sortable: true,  width: "w-32" },
  { key: "",              label: "",           sortable: false, width: "w-12" },
]

const URGENCY_LABELS: Record<string, string> = {
  normal:   "Normal",
  high:     "Alta",
  critical: "Crítica",
}

const URGENCY_DOT: Record<string, string> = {
  normal:   "text-[var(--color-text-subtle)]",
  high:     "text-[var(--color-warning)]",
  critical: "text-[var(--color-danger)]",
}

export function RequestList({ requests, canCreate }: { requests: RequestRow[]; canCreate: boolean }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={requests as unknown as Record<string, unknown>[]}
      searchKeys={["code", "worksiteName", "status"]}
      pageSize={25}
      searchPlaceholder="Buscar solicitud, faena, código..."
      emptyTitle="Sin solicitudes"
      emptyDescription="Las solicitudes de compra aparecerán aquí."
      emptyAction={
        canCreate ? (
          <Button variant="primary" size="sm" asChild>
            <Link href="/solicitudes/nueva">
              <Plus weight="bold" size={14} />
              Nueva solicitud
            </Link>
          </Button>
        ) : undefined
      }
      actions={
        canCreate ? (
          <Button variant="primary" size="sm" asChild>
            <Link href="/solicitudes/nueva">
              <Plus weight="bold" size={14} />
              Nueva solicitud
            </Link>
          </Button>
        ) : undefined
      }
      renderRow={(row) => {
        const r = row as unknown as RequestRow
        return (
          <TableRow key={r.id} className="group">
            <TableCell>
              <span className="font-mono text-xs text-[var(--color-text)]">{r.code}</span>
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {r.worksiteName}
              {r.costCenterName && (
                <span className="text-[var(--color-text-subtle)]"> · {r.costCenterName}</span>
              )}
            </TableCell>
            <TableCell>
              <span className={`text-xs font-medium ${URGENCY_DOT[r.urgency] ?? ""}`}>
                {URGENCY_LABELS[r.urgency] ?? r.urgency}
              </span>
            </TableCell>
            <TableCell className="tabular-nums text-sm text-[var(--color-text-muted)] text-right pr-6">
              {r.itemCount}
            </TableCell>
            <TableCell>
              <StateBadge state={r.status} entity="request" size="sm" />
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-subtle)]">
              {formatDate(r.submittedAt ?? r.createdAt)}
            </TableCell>
            <TableCell className="text-right pr-3">
              <Link
                href={`/solicitudes/${r.id}`}
                className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] opacity-0 group-hover:opacity-100"
                aria-label={`Ver solicitud ${r.code}`}
              >
                <ArrowRight size={14} />
              </Link>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
