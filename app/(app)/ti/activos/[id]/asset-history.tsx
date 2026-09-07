import { formatDate } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"

interface HistoryRow {
  id: string
  action: string
  detail: string
  changes: string | null
  actorUserId: string | null
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

const ACTION_LABELS: Record<string, string> = {
  created: "Ingreso",
  assigned: "Asignación",
  returned: "Devolución",
  status_changed: "Cambio de estado",
  edited: "Edición",
  maintenance: "Mantención",
  maintenance_voided: "Mantención anulada",
  ticket: "Ticket",
  document: "Documento",
  photo: "Fotografía",
  warranty: "Garantía",
  retired: "Baja",
  retirement_reversed: "Baja revertida",
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

export function AssetHistory({ assetId: _assetId, rows, retirements }: AssetHistoryProps) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Línea de tiempo del activo</h3>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Todo lo que le ha ocurrido al equipo desde que ingresó. Nada se sobrescribe.</p>

      {rows.length === 0 ? (
        <EmptyState
          compact
          className="mt-4"
          title="Sin registros en el historial"
          description="Los movimientos del activo aparecerán aquí cuando se registre una entrega, mantención o cambio de estado."
        />
      ) : (
        <ol className="relative mt-5 space-y-6 border-l border-[var(--color-border)] pl-6">
          {rows.map((row) => (
            <li key={row.id} className="relative">
              <span className={`absolute -left-[31px] top-1 h-2.5 w-2.5 rounded-full ${ACTION_DOT[row.action] ?? "bg-[var(--color-text-subtle)]"}`} aria-hidden />
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)]">
                <span className="font-semibold">{formatDate(row.createdAt)}</span>
                <span>·</span>
                <span className="font-medium text-[var(--color-text)]">{ACTION_LABELS[row.action] ?? row.action}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--color-text)]">{row.detail}</p>
              {row.changes && (
                <pre className="mt-1.5 max-h-24 overflow-auto rounded-lg bg-[var(--color-surface-2)] p-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(row.changes), null, 2) } catch { return row.changes }
                  })()}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}

      {retirements.length > 0 && (() => {
        // Si TODAS las bajas del activo están revertidas, la caja no debe
        // gritar en rojo: el activo está vigente. La línea de tiempo de arriba
        // ya dice "Baja revertida" y las dos lecturas no pueden contradecirse.
        const vigentes = retirements.filter((r) => !r.reversedAt)
        const soloRevertidas = vigentes.length === 0
        return (
          <div className={`mt-5 rounded-xl border-l-2 p-3 ${soloRevertidas
            ? "border-[var(--color-border)] bg-[var(--color-surface-2)]"
            : "border-[var(--color-danger)] bg-[var(--color-danger-tint)]"}`}>
            <p className={`text-xs font-semibold ${soloRevertidas ? "text-[var(--color-text-muted)]" : "text-[var(--color-danger-ink)]"}`}>
              Bajas registradas
            </p>
            <ul className="mt-1 space-y-1 text-xs text-[var(--color-text)]">
              {retirements.map((r) => (
                <li key={r.id} className={r.reversedAt ? "text-[var(--color-text-subtle)]" : undefined}>
                  <span className={r.reversedAt ? "line-through" : undefined}>
                    {formatDate(r.date)} — {r.reason}{r.destination ? ` · destino: ${r.destination}` : ""}
                  </span>
                  {r.reversedAt && ` · revertida por ${r.reversedByName ?? "—"}`}
                </li>
              ))}
            </ul>
          </div>
        )
      })()}
    </section>
  )
}
