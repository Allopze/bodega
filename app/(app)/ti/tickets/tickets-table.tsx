"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDateTime } from "@/lib/utils"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import { IT_TICKET_STATUS_META, IT_TICKET_PRIORITY_META, IT_TICKET_CATEGORY_META } from "@/lib/services/ti/constants"
import { ticketDueInfo } from "@/lib/services/ti/ticket-sla"

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
  /** TIT-001: vencimiento comprometido según la prioridad. */
  dueAt: string | null
}

/**
 * Sin `sortable`: la lista pagina en el servidor y `DataTable` solo ordenaría la
 * página cargada, mostrando un orden que no es el de la lista completa. El
 * orden vive en `?orden=` (selector de la barra de filtros).
 */
const COLUMNS = [
  { key: "code", label: "Código", width: "w-32" },
  { key: "subject", label: "Asunto" },
  { key: "status", label: "Estado", width: "w-36" },
  { key: "priority", label: "Prioridad", width: "w-24" },
  { key: "worksite", label: "Faena" },
  { key: "assignee", label: "Técnico", width: "w-36" },
  { key: "due", label: "Vence", width: "w-40" },
  { key: "updated", label: "Actualizado", width: "w-32" },
]

function statusMeta(status: string) {
  return { label: IT_TICKET_STATUS_META[status]?.label ?? status, variant: IT_TICKET_STATUS_META[status]?.variant ?? "default" as const }
}

function priorityMeta(priority: string) {
  return { label: IT_TICKET_PRIORITY_META[priority]?.label ?? priority, variant: IT_TICKET_PRIORITY_META[priority]?.variant ?? "default" as const }
}

/**
 * El compromiso, donde se decide qué atender. Un ticket abierto muestra su
 * tramo (vencido / por vencer) y la fecha; uno resuelto, si cumplió el plazo.
 * Nunca un vencimiento vigente en un ticket que ya no corre contra el reloj.
 */
function DueCell({ row }: { row: Row }) {
  const info = ticketDueInfo(row)
  if (!info) return <span className="text-xs text-[var(--color-text-muted)]">—</span>
  if (info.kind === "met") return <span className="text-xs text-[var(--color-text-muted)]">Dentro de plazo</span>
  if (info.kind === "missed") return <span className="text-xs text-[var(--color-text-muted)]">Fuera de plazo</span>
  return (
    <div className="flex flex-col items-start gap-1">
      {info.kind === "overdue" && <MetaBadge meta={{ label: `Atrasado ${info.span}`, variant: "danger" }} />}
      {info.kind === "due_soon" && <MetaBadge meta={{ label: `Vence en ${info.span}`, variant: "warning" }} />}
      <span className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{formatDateTime(row.dueAt as string)}</span>
    </div>
  )
}

/** Trabajador, categoría y equipo en una línea secundaria bajo el asunto. */
function subline(row: Row): string {
  return [
    row.workerName?.trim() || null,
    IT_TICKET_CATEGORY_META[row.category] ?? row.category,
    row.assetCode,
  ].filter(Boolean).join(" · ")
}

export function TicketsTable({ rows }: { rows: Row[]; canManage: boolean }) {
  return (
    <DataTable
      caption="Tickets de mesa de ayuda TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["code"]}
      // La búsqueda ya se resolvió en el servidor (`?q=`): filtrar otra vez
      // en memoria solo dejaría fuera lo que la consulta devolvió.
      disableInternalSearch
      renderRow={(raw) => {
        const row = raw as unknown as Row
        return (
          <TableRow key={row.id}>
            <TableCell className="w-32">
              <Link href={`/ti/tickets/${row.id}`} className="whitespace-nowrap font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/ti/tickets/${row.id}`} className="font-medium text-[var(--color-text)] hover:underline">{row.subject}</Link>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{subline(row)}</p>
            </TableCell>
            <TableCell className="w-36">
              <MetaBadge meta={statusMeta(row.status)} dot />
            </TableCell>
            <TableCell className="w-24">
              <MetaBadge meta={priorityMeta(row.priority)} />
            </TableCell>
            <TableCell>{row.worksiteName}</TableCell>
            <TableCell className="w-36">{row.assigneeName ?? "—"}</TableCell>
            <TableCell className="w-40"><DueCell row={row} /></TableCell>
            <TableCell className="w-32 whitespace-nowrap">{formatDateTime(row.updatedAt)}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        return (
          <Link key={row.id} href={`/ti/tickets/${row.id}`} className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="whitespace-nowrap font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</span>
              <MetaBadge meta={priorityMeta(row.priority)} />
            </div>
            <div className="mt-1 text-sm font-medium text-[var(--color-text)]">{row.subject}</div>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{subline(row)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <MetaBadge meta={statusMeta(row.status)} dot />
              <DueCell row={row} />
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {row.worksiteName} · Técnico: {row.assigneeName ?? "sin asignar"}
            </p>
          </Link>
        )
      }}
      emptyTitle="Sin tickets"
      emptyDescription="No hay tickets que coincidan con los filtros."
      pageSize={DEFAULT_PAGE_SIZE}
      viewKey="ti-tickets"
      enableColumnToggle
    />
  )
}
