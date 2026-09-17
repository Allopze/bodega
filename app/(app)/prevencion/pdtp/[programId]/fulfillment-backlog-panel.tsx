import { MetaBadge } from "@/components/states/state-badge"
import { countPdtpFulfillmentBacklog } from "@/lib/services/pdtp/backlog"
import { CreatePdtpRevisionButton } from "./create-pdtp-revision-button"

/**
 * Si corresponde ofrecer "Crear revisión v+1" cuando el contenido vigente ya
 * no coincide con lo firmado (QA 2026-09-16 P1(b)). Un programa `active` es
 * inmutable —su editor redirige al detalle—, así que ante un desvío de huella
 * la única salida accionable es abrir una revisión nueva, y sólo tiene sentido
 * ofrecérsela a quien puede gestionar el programa.
 *
 * Extraída como función pura (en vez de dejar la condición inline en el JSX)
 * para poder cubrir su tabla de verdad completa sin montar
 * `FulfillmentBacklogPanel`, que es un server component `async` que consulta
 * la base directamente.
 */
export function shouldOfferPdtpRevision({
  digestDrift,
  programStatus,
  canManageProgram,
}: {
  digestDrift: boolean
  programStatus: string
  canManageProgram: boolean
}): boolean {
  return digestDrift && programStatus === "active" && canManageProgram
}

/**
 * Lo que el libro de cumplimiento (`pdtp_fulfillment_events`) tiene sin
 * resolver. Nada leía esa tabla antes: un evento en `error` —la N°1 firmada en
 * revisión, entre otros— era invisible hasta que alguien corría el script
 * manual del deploy. Server component de sólo lectura: no ofrece reintentar
 * desde acá, el reintento lo hace el cron o la activación.
 *
 * PDTP-002 (auditoría 2026-09-14): también muestra los `rejected`, que no son
 * un fallo sino una decisión —el hecho quedó fuera del año del programa, la
 * actividad está excluida de la faena o su número no existe—. Ésos el cron no
 * los reintenta: si nadie los ve, el trabajo hecho simplemente desaparece.
 */
export async function FulfillmentBacklogPanel({ programId, canManageProgram, programStatus }: { programId: string; canManageProgram: boolean; programStatus: string }) {
  const backlog = await countPdtpFulfillmentBacklog(programId)
  // PDTP-002: los rechazados también abren el panel. Antes sólo lo hacían
  // `pending` y `error`, así que un hecho que la plataforma decidió no
  // acreditar —fecha retroactiva fuera del año del programa, actividad
  // excluida de la faena, número inexistente— no aparecía en ninguna pantalla.
  if (backlog.pending === 0 && backlog.errored === 0 && backlog.rejected === 0 && !backlog.digestDrift) return null

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Libro de cumplimiento</h2>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {backlog.errored > 0 && (
          <div className="flex items-center gap-2">
            <MetaBadge meta={{ label: String(backlog.errored), variant: "danger" }} dot />
            <span className="text-sm text-[var(--color-text-muted)]">evento(s) en error, sin acreditar</span>
          </div>
        )}
        {backlog.pending > 0 && (
          <div className="flex items-center gap-2">
            <MetaBadge meta={{ label: String(backlog.pending), variant: "warning" }} dot />
            <span className="text-sm text-[var(--color-text-muted)]">evento(s) pendiente(s) de reintento</span>
          </div>
        )}
        {backlog.rejected > 0 && (
          <div className="flex items-center gap-2">
            <MetaBadge meta={{ label: String(backlog.rejected), variant: "warning" }} dot />
            <span className="text-sm text-[var(--color-text-muted)]">
              hecho(s) sin acreditar por decisión del motor
            </span>
          </div>
        )}
        {backlog.digestDrift && (
          <div className="flex items-center gap-2">
            <MetaBadge meta={{ label: "1", variant: "warning" }} dot />
            <span className="text-sm text-[var(--color-text-muted)]">
              el contenido vigente ya no coincide con lo firmado
            </span>
          </div>
        )}
      </div>

      {shouldOfferPdtpRevision({ digestDrift: backlog.digestDrift, programStatus, canManageProgram }) && (
        <div className="mt-3">
          <CreatePdtpRevisionButton sourceProgramId={programId} />
        </div>
      )}

      {backlog.recentRejected.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--color-text-subtle)]">
          {backlog.recentRejected.map((event) => (
            <li key={`${event.sourceType}:${event.sourceId}:${event.occurredAt}`}>
              <span className="font-medium">{event.sourceType}</span> {event.sourceId} — {event.reason}
            </li>
          ))}
        </ul>
      )}

      {backlog.lastError && (
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
          Último error: {backlog.lastError}
        </p>
      )}
    </section>
  )
}
