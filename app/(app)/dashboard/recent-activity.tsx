import Link from "next/link"
import type { WorkOrderRow, WorkRequestRow } from "@/lib/work-queue"
import { StateBadge } from "@/components/states/state-badge"
import { cn } from "@/lib/utils"
import { ClipboardText, ShoppingCart } from "@phosphor-icons/react/dist/ssr"

interface RecentActivityProps {
  requests:    WorkRequestRow[]
  orders:      WorkOrderRow[]
  viewerId:    string
  canViewAll:  boolean
  limit?:      number
}

interface ActivityEntry {
  id:           string
  kind:         "request" | "oc"
  code:         string
  worksiteName: string
  status:       string
  date:         string
  href:         string
}

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", timeZone: "America/Santiago" })

function formatShortDate(value: string) {
  return SHORT_DATE_FORMAT.format(new Date(value))
}

function buildEntries({ requests, orders, viewerId, canViewAll, limit }: Required<RecentActivityProps>): ActivityEntry[] {
  return [
    ...requests
      .filter((request) => canViewAll || request.requesterId === viewerId)
      .map((request) => ({
        id:           request.id,
        kind:         "request" as const,
        code:         request.code,
        worksiteName: request.worksiteName,
        status:       request.status,
        date:         request.submittedAt ?? request.createdAt,
        href:         `/solicitudes/${request.id}`,
      })),
    ...orders.map((order) => ({
      id:           order.id,
      kind:         "oc" as const,
      code:         order.code,
      worksiteName: order.worksiteName,
      status:       order.status,
      date:         order.sentAt ?? order.issuedAt ?? order.createdAt,
      href:         `/compras/${order.id}`,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)
}

/**
 * Lista editorial de actividad reciente — sin tarjeta, acotada por reglas hairline
 * con filas divididas. Si no hay actividad devuelve `null` (la página muestra una
 * línea tenue en su lugar, evitando el void). Deriva de datos ya consultados.
 */
export function RecentActivity({ requests, orders, viewerId, canViewAll, limit = 7 }: RecentActivityProps) {
  const entries = buildEntries({ requests, orders, viewerId, canViewAll, limit })

  if (entries.length === 0) {
    return (
      <section>
        <h2 className="text-h2 text-[var(--color-text)] mb-2">Actividad reciente</h2>
        <p className="border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-text-muted)]">
          Sin actividad todavía. Las solicitudes y órdenes de compra aparecerán aquí a medida que se registren.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-h2 text-[var(--color-text)] mb-3">Actividad reciente</h2>
      <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {entries.map((entry) => (
          <li key={`${entry.kind}-${entry.id}`}>
            <Link
              href={entry.href}
              className={cn(
                "group grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:gap-4",
                "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-tint)]",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
              )}
            >
              <span className="flex h-7 w-7 items-center justify-center text-[var(--color-text-faint)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]">
                {entry.kind === "request" ? <ClipboardText size={16} /> : <ShoppingCart size={16} />}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--color-text)]">{entry.code}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{entry.kind === "request" ? "Solicitud" : "Orden de compra"}</span>
                  <span className="text-[var(--color-text-faint)]" aria-hidden>·</span>
                  <span className="truncate text-xs text-[var(--color-text-muted)]">{entry.worksiteName}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 justify-self-end">
                <StateBadge state={entry.status} entity={entry.kind === "request" ? "request" : "oc"} size="sm" />
                <span className="hidden w-12 text-right font-mono text-[11px] tabular-nums text-[var(--color-text-subtle)] sm:inline">
                  {formatShortDate(entry.date)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
