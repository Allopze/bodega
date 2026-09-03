import Link from "next/link"
import { formatDateTime } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { IT_TICKET_STATUS_META, IT_TICKET_PRIORITY_META } from "@/lib/services/ti/constants"

interface TicketRow {
  id: string
  code: string
  subject: string
  status: string
  priority: string
  createdAt: string
  updatedAt: string
  requesterName: string | null
}

export function AssetTickets({ rows }: { rows: TicketRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin tickets para este activo"
        description="Cuando un trabajador reporte un problema con este equipo, el ticket aparecerá acá."
      />
    )
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/ti/tickets/${row.id}`}
          className="block rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs transition-colors hover:bg-[var(--color-surface-2)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</span>
              <Badge variant={IT_TICKET_STATUS_META[row.status]?.variant ?? "default"}>
                {IT_TICKET_STATUS_META[row.status]?.label ?? row.status}
              </Badge>
            </div>
            <Badge variant={IT_TICKET_PRIORITY_META[row.priority]?.variant ?? "default"}>
              {IT_TICKET_PRIORITY_META[row.priority]?.label ?? row.priority}
            </Badge>
          </div>
          <p className="mt-2 text-sm font-medium text-[var(--color-text)]">{row.subject}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Creado {formatDateTime(row.createdAt)} · {row.requesterName ?? "Sistema"}
          </p>
        </Link>
      ))}
    </div>
  )
}
