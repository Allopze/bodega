import Link from "next/link"
import { formatDate, formatDateTime } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { Callout } from "@/components/ui/callout"
import { IT_RETIREMENT_REASON_META } from "@/lib/services/ti/constants"
import { formatHistoryEvent } from "@/lib/services/ti/history-format"
import { ASSET_HISTORY_LIMIT } from "@/lib/services/ti/history"

interface HistoryRow {
  id: string
  action: string
  detail: string
  changes: string | null
  actorName: string | null
  createdAt: string
}

interface AssetHistoryProps {
  assetId: string
  rows: HistoryRow[]
  retirements: {
    id: string
    date: string
    reason: string
    destination: string | null
    reversedAt?: string | null
    reversedByName?: string | null
  }[]
}

const ACTION_DOT: Record<string, string> = {
  created: "bg-[var(--color-success)]",
  assigned: "bg-[var(--color-info)]",
  returned: "bg-[var(--color-warning-ink)]",
  status_changed: "bg-[var(--color-signal-ink)]",
  edited: "bg-[var(--color-text-subtle)]",
  maintenance: "bg-[var(--color-primary)]",
  maintenance_voided: "bg-[var(--color-danger)]",
  ticket: "bg-[var(--color-primary)]",
  document: "bg-[var(--color-text-subtle)]",
  photo: "bg-[var(--color-text-subtle)]",
  warranty: "bg-[var(--color-signal-ink)]",
  retired: "bg-[var(--color-danger)]",
  retirement_reversed: "bg-[var(--color-success)]",
}

export function AssetHistory({ assetId, rows, retirements }: AssetHistoryProps) {
  const truncated = rows.length >= ASSET_HISTORY_LIMIT

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Línea de tiempo del activo</h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Todo lo que le ha ocurrido al equipo desde que ingresó. Nada se sobrescribe.</p>
      {truncated && (
        <p className="mt-1 text-xs font-medium text-[var(--color-text)]">Mostrando los {ASSET_HISTORY_LIMIT} más recientes.</p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          compact
          className="mt-4"
          title="Sin registros en el historial"
          description="Los movimientos del activo aparecerán aquí cuando se registre una entrega, mantención o cambio de estado."
        />
      ) : (
        <ol className="relative mt-5 space-y-6 border-l border-[var(--color-border)] pl-6">
          {rows.map((row) => {
            const view = formatHistoryEvent(row)
            const happened = view.eventDate ?? view.recordedAt
            const recordedDay = formatDate(view.recordedAt)
            // La fecha del evento manda; la de registro va aparte solo si difiere.
            const showRecorded = view.eventDate !== null && formatDate(view.eventDate) !== recordedDay
            return (
              <li key={row.id} className="relative">
                <span className={`absolute -left-[31px] top-1 h-2.5 w-2.5 rounded-full ${ACTION_DOT[row.action] ?? "bg-[var(--color-text-subtle)]"}`} aria-hidden />
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)]">
                  <span className="font-semibold">{formatDate(happened)}</span>
                  <span aria-hidden>·</span>
                  <span className="font-medium text-[var(--color-text)]">{view.title}</span>
                  {view.actorName && (<><span aria-hidden>·</span><span>{view.actorName}</span></>)}
                </div>
                {view.summary && <p className="mt-1 text-sm text-[var(--color-text)]">{view.summary}</p>}
                {view.lines.length > 0 && (
                  <dl className="mt-1 space-y-0.5 text-sm">
                    {view.lines.map((line) => (
                      <div key={line.label} className="flex flex-wrap gap-x-1.5">
                        <dt className="text-[var(--color-text-muted)]">{line.label}:</dt>
                        <dd className="text-[var(--color-text)]">
                          {line.value ?? <>{line.before} <span aria-hidden>→</span><span className="sr-only">a</span> {line.after}</>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {view.links.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
                    {view.links.map((link) => (
                      <Link
                        key={link.href + link.label}
                        href={link.href.startsWith("?") ? `/ti/activos/${assetId}${link.href}` : link.href}
                        className="inline-flex min-h-11 items-center font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-0"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </p>
                )}
                {showRecorded && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">Registrado el {formatDateTime(view.recordedAt)}</p>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {retirements.length > 0 && (() => {
        // Si TODAS las bajas del activo están revertidas, el aviso no debe gritar
        // en rojo: el activo está vigente y la línea de tiempo ya dice «Baja revertida».
        const soloRevertidas = retirements.every((r) => r.reversedAt)
        return (
          <Callout tone={soloRevertidas ? "info" : "danger"} title="Bajas registradas" className="mt-5">
            <ul className="space-y-1 text-xs">
              {retirements.map((r) => (
                <li key={r.id}>
                  <span className={r.reversedAt ? "line-through" : undefined}>
                    {formatDate(r.date)} — {IT_RETIREMENT_REASON_META[r.reason] ?? r.reason}{r.destination ? ` · destino: ${r.destination}` : ""}
                  </span>
                  {r.reversedAt && ` · revertida por ${r.reversedByName ?? "—"}`}
                </li>
              ))}
            </ul>
          </Callout>
        )
      })()}
    </section>
  )
}
