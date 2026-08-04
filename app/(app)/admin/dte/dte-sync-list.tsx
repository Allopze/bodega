import { CheckCircle, Clock, XCircle, WarningCircle, Archive } from "@phosphor-icons/react/dist/ssr"
import { formatDateTime } from "@/lib/utils"

export interface DteSyncRunRow {
  id: string
  periodo: string
  trigger: "manual" | "cron"
  status: "running" | "success" | "partial" | "failed"
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

const STATUS_ICONS = {
  success: { icon: CheckCircle, color: "text-[var(--color-success)]", label: "Exitosa" },
  partial: { icon: WarningCircle, color: "text-[var(--color-warning)]", label: "Parcial" },
  failed: { icon: XCircle, color: "text-[var(--color-danger)]", label: "Fallida" },
  running: { icon: Clock, color: "text-[var(--color-warning)]", label: "En curso" },
} as const

const TRIGGER_LABELS = { manual: "Manual", cron: "Programado" } as const

export function DteSyncList({ runs }: { runs: DteSyncRunRow[] }) {
  if (runs.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-10 text-center shadow-[var(--shadow-card)]">
        <Archive size={32} className="mx-auto text-[var(--color-text-faint)]" />
        <h2 className="mt-3 text-h3 text-[var(--color-text)]">Sin corridas registradas</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Aparecerán aquí cuando se ejecute la sincronización (manual o por el cron mensual).
        </p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
              <th scope="col" className="px-4 py-2.5 th-type">Período</th>
              <th scope="col" className="px-4 py-2.5 th-type">Fecha</th>
              <th scope="col" className="px-4 py-2.5 th-type">Estado</th>
              <th scope="col" className="px-4 py-2.5 th-type">Origen</th>
              <th scope="col" className="px-4 py-2.5 th-type">Vistos</th>
              <th scope="col" className="px-4 py-2.5 th-type">Nuevos</th>
              <th scope="col" className="px-4 py-2.5 th-type">Actualizados</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {runs.map((run) => {
              const statusInfo = STATUS_ICONS[run.status]
              const StatusIcon = statusInfo.icon
              return (
                <tr key={run.id} className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]">
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-[var(--color-text)]">{run.periodo}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-text-muted)]">{formatDateTime(run.startedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="inline-flex items-center gap-1 text-sm" title={run.error ?? undefined}>
                      <StatusIcon size={14} className={statusInfo.color} />
                      <span className={statusInfo.color}>{statusInfo.label}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-text-muted)]">{TRIGGER_LABELS[run.trigger]}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-[var(--color-text-muted)]">{run.rowsSeen}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-[var(--color-text)]">{run.rowsInserted}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-[var(--color-text-muted)]">{run.rowsUpdated}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
