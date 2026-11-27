import type { PartsNoteEvent } from "@/lib/services/mantencion/parts/types"
import { formatDateTime } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"
import { NoteStatusBadge } from "./note-status-badge"

/** Qué pasó, en una frase: la alta, el cambio de estado «De → A» o el estado con el que ya venía la nota al activarse el historial. */
function EventTitle({ event }: { event: PartsNoteEvent }) {
  const to = <NoteStatusBadge status={event.toStatus} />
  if (event.kind === "creada") return <span className="flex flex-wrap items-center gap-1.5">Nota creada {to}</span>
  if (event.kind === "migrada") return <span className="flex flex-wrap items-center gap-1.5">Estado inicial del historial {to}</span>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {event.fromStatus && <NoteStatusBadge status={event.fromStatus} />}
      <span aria-label="a" className="text-[var(--color-text-faint)]">→</span>
      {to}
    </span>
  )
}

/**
 * Historial de la nota: cada alta y cada cambio de estado, del primero al último, con la fecha y hora, de qué estado a cuál,
 * el motivo si lo hubo y quién lo hizo («Automático» cuando fue el sistema: una llegada, una recepción, la OT que termina).
 * Es la lectura de `mant_parts_note_events` (append-only). Componente de servidor.
 */
export function NoteHistory({ events }: { events: readonly PartsNoteEvent[] }) {
  return (
    <SectionCard title="Historial">
      {events.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Esta nota todavía no tiene movimientos registrados.</p>
      ) : (
        <ol aria-label="Historial de la nota" className="flex flex-col divide-y divide-[var(--color-border)]">
          {events.map((event) => (
            <li key={event.id} className="grid gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr]">
              <time dateTime={event.createdAt} className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDateTime(event.createdAt)}</time>
              <div className="min-w-0 text-sm text-[var(--color-text)]">
                <EventTitle event={event} />
                {event.reason && <p className="mt-1 break-words">Motivo: {event.reason}</p>}
                {event.itemDescription && <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">Línea: {event.itemDescription}</p>}
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{event.actorName ?? "Automático"}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}
