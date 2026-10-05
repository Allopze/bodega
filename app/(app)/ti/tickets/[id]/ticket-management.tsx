"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { SubmitButton } from "@/components/ui/submit-button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OptionSelect } from "@/components/ui/option-select"
import { IT_TICKET_STATUS_META } from "@/lib/services/ti/constants"
import { IT_TICKET_RESOLUTION_HELP, IT_TICKET_UNASSIGN, itTicketNextStatuses } from "@/lib/validation/ti"
import { transitionTicketAction, assignTicketAction } from "../actions"
import { useFocusFirstInvalid } from "../use-focus-first-invalid"

interface ManagementProps {
  ticket: {
    id: string
    status: string
    resolution: string | null
    assigneeUserId: string | null
    assigneeName: string | null
  }
  technicians: { id: string; name: string }[]
  currentUserId: string
}

const SECTION = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs"
const HEADING = "text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]"

function FormAlert({ state }: { state: ActionState }) {
  if (!state.message || state.ok || state.fieldErrors) return null
  // Solo la alerta en línea: el mismo error en un toast además era ruido.
  return <p role="alert" tabIndex={-1} data-form-alert className="text-sm text-[var(--color-danger-ink)]">{state.message}</p>
}

/** Valores devueltos por el servidor tras un envío fallido (TIUX-05). */
function keptValues(state: ActionState): Record<string, string> {
  return (state.ok ? {} : (state.data?.values ?? {})) as Record<string, string>
}

/**
 * Responsable del ticket, separado del estado (TIUX-17): asignar no exige
 * cambiar el estado ni inventar un motivo, y cambiar el estado no toca al
 * responsable. Un ticket resuelto o cerrado no se reasigna: primero se reabre.
 */
export function TicketAssignment({ ticket, technicians, currentUserId }: ManagementProps) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [assignee, setAssignee] = React.useState(ticket.assigneeUserId ?? "")
  // El servidor es la fuente de verdad: si el responsable cambia (por esta
  // acción o porque otro técnico lo movió) el selector se resincroniza durante
  // el render, el patrón que el repo ya documenta en `filter-search-input.tsx`.
  const [serverAssignee, setServerAssignee] = React.useState(ticket.assigneeUserId)
  if (serverAssignee !== ticket.assigneeUserId) {
    setServerAssignee(ticket.assigneeUserId)
    setAssignee(ticket.assigneeUserId ?? "")
  }

  const [state, action] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await assignTicketAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Responsable actualizado")
    return result
  }, INITIAL_STATE)
  useFocusFirstInvalid(formRef, state)
  const kept = keptValues(state)

  const closed = ticket.status === "resuelto" || ticket.status === "cerrado"
  const mine = ticket.assigneeUserId === currentUserId
  // Cambiar a quien ya lo tiene exige motivo (regla TI-08: no reasignar en silencio).
  const needsReason = Boolean(ticket.assigneeUserId)
  const unchanged = assignee === (ticket.assigneeUserId ?? "") || assignee === ""

  return (
    <section className={SECTION}>
      <h3 className={HEADING}>Responsable</h3>
      {closed ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          {ticket.assigneeName ? `A cargo de ${ticket.assigneeName}. ` : "Sin responsable. "}
          Reabre el ticket para cambiar el responsable.
        </p>
      ) : (
        <form ref={formRef} action={action} className="mt-3 space-y-3">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <Field label="Técnico responsable" error={state.fieldErrors?.assigneeUserId?.[0]}>
            <OptionSelect
              name="assigneeUserId"
              aria-label="Técnico responsable"
              placeholder="Elige un técnico"
              options={[
                ...technicians.map((t) => ({ value: t.id, label: t.id === currentUserId ? `${t.name} (yo)` : t.name })),
                ...(ticket.assigneeUserId ? [{ value: IT_TICKET_UNASSIGN, label: "Dejar sin responsable" }] : []),
              ]}
              value={assignee}
              onValueChange={setAssignee}
            />
          </Field>
          {needsReason && (
            <Field
              label="Motivo del cambio"
              required
              helper="Obligatorio al cambiar un responsable. Lo ve también quien reportó el ticket."
              error={state.fieldErrors?.reason?.[0]}
            >
              <Textarea name="reason" maxLength={300} rows={2} defaultValue={kept.reason} />
            </Field>
          )}
          <FormAlert state={state} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton label="Asignar" loadingLabel="Asignando..." size="sm" variant="secondary" disabled={unchanged} />
            {!mine && (
              <SubmitButton
                label="Asignarme"
                loadingLabel="Asignando..."
                size="sm"
                variant="secondary"
                name="self"
                value="1"
              />
            )}
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * Cambio de estado. No hay valor preseleccionado: el primer estado de la lista
 * es solo el primero del grafo, no una recomendación, y dejarlo marcado hacía
 * que «Aplicar» pareciera un trámite. «Asignado» no se ofrece: se alcanza
 * asignando un responsable.
 */
export function TicketStatusChange({ ticket }: Pick<ManagementProps, "ticket">) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const nextStatuses = itTicketNextStatuses(ticket.status).filter((s) => s !== "asignado")
  const [status, setStatus] = React.useState("")
  // Tras aplicar el cambio el estado elegido deja de existir en las opciones:
  // se limpia al cambiar el estado del servidor (render-time sync).
  const [serverStatus, setServerStatus] = React.useState(ticket.status)
  if (serverStatus !== ticket.status) {
    setServerStatus(ticket.status)
    setStatus("")
  }

  const [state, action] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await transitionTicketAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Ticket actualizado")
    return result
  }, INITIAL_STATE)
  useFocusFirstInvalid(formRef, state)
  const kept = keptValues(state)

  const label = status ? IT_TICKET_STATUS_META[status]?.label ?? status : ""
  // Resolver exige la solución; cerrar también cuando el ticket no la tiene
  // (cierre directo). Si ya la tiene, se conserva y no se vuelve a pedir.
  const needsResolution = status === "resuelto" || (status === "cerrado" && !ticket.resolution)

  return (
    <section className={SECTION}>
      <h3 className={HEADING}>Cambiar estado</h3>
      {nextStatuses.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">Este ticket no admite más transiciones de estado.</p>
      ) : (
        <form ref={formRef} action={action} className="mt-3 space-y-3">
          <input type="hidden" name="ticketId" value={ticket.id} />
          {/* Solo los estados alcanzables desde el actual: el servidor aplica
              el mismo grafo y rechazaría cualquier otro. */}
          <Field label="Nuevo estado" required error={state.fieldErrors?.status?.[0]}>
            <Select name="status" value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Nuevo estado">
                <SelectValue placeholder="Elige el siguiente estado" />
              </SelectTrigger>
              <SelectContent>
                {nextStatuses.map((s) => (
                  <SelectItem key={s} value={s}>{IT_TICKET_STATUS_META[s]?.label ?? s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {/* El motivo queda en la línea de tiempo que ve el solicitante: lo
              reservado para TI va en una nota interna. */}
          <Field label="Motivo" required helper="Lo ve también quien reportó el ticket. Lo que es solo para TI, como nota interna." error={state.fieldErrors?.reason?.[0]}>
            <Textarea name="reason" maxLength={300} rows={2} defaultValue={kept.reason} />
          </Field>
          {needsResolution && (
            <Field label="Resolución" required helper={IT_TICKET_RESOLUTION_HELP} error={state.fieldErrors?.resolution?.[0]}>
              <Textarea name="resolution" maxLength={1000} rows={4} defaultValue={kept.resolution} />
            </Field>
          )}
          {status === "cerrado" && ticket.resolution && (
            <p className="text-xs text-[var(--color-text-subtle)]">Se conserva la resolución ya registrada.</p>
          )}
          <FormAlert state={state} />
          <SubmitButton
            label={label ? `Pasar a ${label}` : "Cambiar estado"}
            loadingLabel="Aplicando..."
            size="sm"
            variant="secondary"
            disabled={!status}
          />
        </form>
      )}
    </section>
  )
}
