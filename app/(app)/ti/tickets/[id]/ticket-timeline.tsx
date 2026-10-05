import { formatDateTime } from "@/lib/utils"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { IT_TICKET_STATUS_META } from "@/lib/services/ti/constants"
import type { TicketTimelineItem } from "@/lib/services/ti/tickets"

function statusLabel(status: string | null): string {
  return status ? IT_TICKET_STATUS_META[status]?.label ?? status : "—"
}

function Meta({ author, at }: { author: string | null; at: string }) {
  return (
    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
      {author ?? "Usuario"} · {formatDateTime(at)}
    </p>
  )
}

/** Un evento del caso (cambio de estado o de responsable): una línea, sin globo. */
function Event({ children, reason, author, at }: { children: React.ReactNode; reason: string | null; author: string | null; at: string }) {
  return (
    <li className="flex gap-3 text-sm">
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-border-strong)]" />
      <div className="min-w-0">
        <p className="break-words text-[var(--color-text)]">{children}</p>
        {reason && <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">Motivo: {reason}</p>}
        <Meta author={author} at={at} />
      </div>
    </li>
  )
}

/**
 * Una sola línea de tiempo: comentarios, cambios de estado (con quién y por
 * qué) y asignaciones, en el orden en que ocurrieron. Antes los cambios de
 * estado no se veían en la ficha y los comentarios iban en otra lista.
 *
 * Las notas internas usan el tono `info` con la etiqueta «Nota interna»: el
 * tono `signal` está reservado a lo pendiente.
 */
export function TicketTimeline({
  items,
  created,
}: {
  items: TicketTimelineItem[]
  created: { at: string; authorName: string | null }
}) {
  return (
    <ol className="mt-3 space-y-3" aria-label="Historial del ticket">
      <Event author={created.authorName} at={created.at} reason={null}>Ticket creado</Event>
      {items.map((item) => {
        if (item.kind === "comment") {
          return (
            <li key={item.id}>
              {item.isInternal ? (
                <Callout tone="info" role="none" title="Nota interna" className="border-dashed">
                  <p className="whitespace-pre-wrap break-words text-[var(--color-text)]">{item.body}</p>
                  <Meta author={item.authorName} at={item.at} />
                </Callout>
              ) : (
                <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
                  <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">{item.body}</p>
                  <Meta author={item.authorName} at={item.at} />
                </div>
              )}
            </li>
          )
        }
        if (item.kind === "status") {
          return (
            <Event key={item.id} reason={item.reason} author={item.authorName} at={item.at}>
              Estado: <strong className="font-semibold">{statusLabel(item.from)}</strong> → <strong className="font-semibold">{statusLabel(item.to)}</strong>
              {item.assignment && (
                <> · {item.assignment.assigneeName ? `asignado a ${item.assignment.assigneeName}` : "sin responsable"}</>
              )}
            </Event>
          )
        }
        return (
          <Event key={item.id} reason={item.reason} author={item.authorName} at={item.at}>
            {item.assigneeName ? <>Asignado a <strong className="font-semibold">{item.assigneeName}</strong></> : "Quedó sin responsable"}
          </Event>
        )
      })}
      {items.length === 0 && (
        <li>
          <EmptyState compact align="start" title="Sin novedades todavía" description="Los comentarios y cambios del caso aparecerán aquí." />
        </li>
      )}
    </ol>
  )
}
