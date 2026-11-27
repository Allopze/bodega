import type { PartsNoteEvent } from "@/lib/services/mantencion/parts/types"
import { formatDateTime } from "@/lib/utils"
import { NOTE_STATUS_TEXT } from "./parts-notes-format"

/**
 * Qué dice el historial de la nota cuando el evento no es un cambio de estado: la alta y el estado con el que ya venía la nota al
 * activarse el historial. Los comparten `NoteHistory` (el renglón) y la línea del encabezado (`NotePeopleLine`), para que digan lo mismo.
 */
export const EVENT_KIND_TEXT = { creada: "Nota creada", migrada: "Estado inicial del historial" } as const

/** La acción de un evento, en una frase: «Nota creada», «Estado inicial del historial» o «Pasó a «En compra»». */
export function eventActionText(event: Pick<PartsNoteEvent, "kind" | "toStatus">): string {
  if (event.kind === "creada" || event.kind === "migrada") return EVENT_KIND_TEXT[event.kind]
  return `Pasó a «${NOTE_STATUS_TEXT[event.toStatus]}»`
}

/**
 * La línea de personas bajo el título del detalle: quién pide y la última acción de la nota, tomada del último evento de su historial
 * («el sistema» cuando no hay persona: una llegada, una recepción, la OT que termina). `requestedByName` ya viene resuelto por el
 * servidor: el nombre del usuario o, en una nota importada, el solicitante que trajo el archivo. Componente de servidor.
 */
export function NotePeopleLine({ requestedByName, lastEvent }: { requestedByName: string; lastEvent: PartsNoteEvent | null }) {
  return (
    <p className="text-sm text-[var(--color-text-muted)]">
      Pide: <span className="font-medium text-[var(--color-text)]">{requestedByName.trim() || "—"}</span>
      {lastEvent && (
        <>
          {" · "}Última acción: <span className="font-medium text-[var(--color-text)]">{eventActionText(lastEvent)}</span>
          {" por "}<span className="font-medium text-[var(--color-text)]">{lastEvent.actorName ?? "el sistema"}</span>
          {" · "}<time dateTime={lastEvent.createdAt}>{formatDateTime(lastEvent.createdAt)}</time>
        </>
      )}
    </p>
  )
}
