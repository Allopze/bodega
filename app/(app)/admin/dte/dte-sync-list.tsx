import { Archive } from "@phosphor-icons/react/dist/ssr"
import { formatDateTime } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { syncStatusLabel } from "@/lib/services/billing/labels"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

export interface DteSyncRunRow {
  id: string
  periodo: string
  trigger: "manual" | "cron"
  status: "running" | "success" | "partial" | "failed"
  /** Motivo ya redactado de una corrida parcial o fallida. */
  error: string | null
  reconciliationStatus: "not_run" | "success" | "partial" | "failed"
  reconciliationError: string | null
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  startedAt: string
  finishedAt: string | null
}

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
        <TableRoot className="rounded-none border-0">
        <Table className="text-left">
          <caption className="sr-only">Corridas de sincronización DTE y su conciliación</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead><TableHead>Fecha</TableHead><TableHead>Estado</TableHead><TableHead>Conciliación</TableHead>
              <TableHead>Origen</TableHead><TableHead>Vistos</TableHead><TableHead>Nuevos</TableHead><TableHead>Actualizados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              // Mismo vocabulario visual que /facturacion/sincronizacion
              // (UI/UX 2026-08-05, M3): un solo estilo de chip para el mismo concepto.
              const statusInfo = syncStatusLabel(run.status)
              return (
                <TableRow key={run.id} className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]">
                  <TableCell className="whitespace-nowrap font-medium text-[var(--color-text)]">{run.periodo}</TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--color-text-muted)]">{formatDateTime(run.startedAt)}</TableCell>
                  <TableCell>
                    <Badge variant={statusInfo.tone}>{statusInfo.label}</Badge>
                    {run.error && <p className="mt-1 max-w-[40ch] text-xs text-[var(--color-text-muted)]">{run.error}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={reconciliationInfo(run.reconciliationStatus).tone}>{reconciliationInfo(run.reconciliationStatus).label}</Badge>
                    {run.reconciliationError && <p className="mt-1 max-w-[32ch] truncate text-xs text-[var(--color-text-muted)]">{run.reconciliationError}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--color-text-muted)]">{TRIGGER_LABELS[run.trigger]}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono tabular-nums text-[var(--color-text-muted)]">{run.rowsSeen}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono tabular-nums text-[var(--color-text)]">{run.rowsInserted}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono tabular-nums text-[var(--color-text-muted)]">{run.rowsUpdated}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </TableRoot>
      </div>
    </section>
  )
}

function reconciliationInfo(status: DteSyncRunRow["reconciliationStatus"]): { label: string; tone: "neutral" | "success" | "warning" | "danger" } {
  switch (status) {
    case "success": return { label: "Conciliada", tone: "success" }
    case "partial": return { label: "Parcial", tone: "warning" }
    case "failed": return { label: "Fallida", tone: "danger" }
    default: return { label: "No ejecutada", tone: "neutral" }
  }
}
