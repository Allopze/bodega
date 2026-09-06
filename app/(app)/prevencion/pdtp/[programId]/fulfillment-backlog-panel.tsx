import { Badge } from "@/components/ui/badge"
import { countPdtpFulfillmentBacklog } from "@/lib/services/pdtp/backlog"

/**
 * Lo que el libro de cumplimiento (`pdtp_fulfillment_events`) tiene sin
 * resolver. Nada leía esa tabla antes: un evento en `error` —la N°1 firmada en
 * revisión, entre otros— era invisible hasta que alguien corría el script
 * manual del deploy. Server component de sólo lectura: no ofrece reintentar
 * desde acá, el reintento lo hace el cron o la activación.
 */
export async function FulfillmentBacklogPanel({ programId }: { programId: string }) {
  const backlog = await countPdtpFulfillmentBacklog(programId)
  if (backlog.pending === 0 && backlog.errored === 0 && !backlog.digestDrift) return null

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Libro de cumplimiento</h2>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {backlog.errored > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="danger" dot>{backlog.errored}</Badge>
            <span className="text-sm text-[var(--color-text-muted)]">evento(s) en error, sin acreditar</span>
          </div>
        )}
        {backlog.pending > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="warning" dot>{backlog.pending}</Badge>
            <span className="text-sm text-[var(--color-text-muted)]">evento(s) pendiente(s) de reintento</span>
          </div>
        )}
        {backlog.digestDrift && (
          <div className="flex items-center gap-2">
            <Badge variant="warning" dot>1</Badge>
            <span className="text-sm text-[var(--color-text-muted)]">
              el contenido vigente ya no coincide con lo firmado
            </span>
          </div>
        )}
      </div>

      {backlog.lastError && (
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
          Último error: {backlog.lastError}
        </p>
      )}
    </section>
  )
}
