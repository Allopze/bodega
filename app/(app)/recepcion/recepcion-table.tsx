"use client"

import Link from "next/link"
import { DataTable } from "@/components/admin/data-table"
import { TableRow, TableCell } from "@/components/ui/table"
import { StateBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { formatDate } from "@/lib/utils"

interface OrderRow {
  id:          string
  code:        string
  worksiteId:  string
  supplierId:  string
  status:      string
  sentAt:      string | null
  createdAt:   string
}

interface RecepcionTableProps {
  orders:       OrderRow[]
  wsMap:        Record<string, string>
  supMap:       Record<string, string>
  gapMap:       Record<string, number>
  canRegister:  boolean
}

const COLUMNS = [
  { key: "code",         label: "OC",         sortable: true,  width: "w-36" },
  { key: "worksiteId",   label: "Faena",      sortable: true  },
  { key: "supplierId",   label: "Proveedor",  sortable: true  },
  { key: "status",       label: "Estado",     sortable: true,  width: "w-40" },
  { key: "transit",      label: "En tránsito", sortable: false, width: "w-32" },
  { key: "sentAt",       label: "Enviada",    sortable: true,  width: "w-32" },
  { key: "",             label: "",           sortable: false, width: "w-12" },
]

export function RecepcionTable({ orders, wsMap, supMap, gapMap, canRegister }: RecepcionTableProps) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={orders as unknown as Record<string, unknown>[]}
      searchKeys={["code"]}
      pageSize={20}
      searchPlaceholder="Buscar OC..."
      emptyTitle="Sin OCs pendientes de recepción"
      emptyDescription="Las órdenes enviadas aparecerán aquí para registrar llegada a oficina y distribución a faena."
      renderRow={(row) => {
        const o = row as unknown as OrderRow
        return (
          <TableRow key={o.id} className="group">
            <TableCell>
              <span className="font-mono text-xs">{o.code}</span>
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {wsMap[o.worksiteId] ?? o.worksiteId}
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {supMap[o.supplierId] ?? o.supplierId}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <StateBadge state={o.status} entity="oc" size="sm" />
                {canRegister && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/recepcion/nueva?oc=${o.id}`}>Recibir</Link>
                  </Button>
                )}
              </div>
            </TableCell>
            <TableCell>
              {(gapMap[o.id] ?? 0) > 0
                ? <Badge variant="warning" size="sm">{gapMap[o.id]} pend. faena</Badge>
                : <span className="text-xs text-[var(--color-text-subtle)]">—</span>}
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-subtle)]">
              {o.sentAt ? formatDate(o.sentAt) : "—"}
            </TableCell>
            <TableCell className="text-right pr-3">
              <Link
                href={`/compras/${o.id}`}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 h-9 w-9 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] opacity-100 transition-[background-color,color,opacity,transform] duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]  sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                aria-label={`Ver OC ${o.code}`}
              >
                <ArrowRight size={16} />
              </Link>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
