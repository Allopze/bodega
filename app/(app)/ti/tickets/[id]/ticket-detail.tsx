"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { Clock } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { MetaBadge } from "@/components/states/state-badge"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { commentTicketAction } from "../actions"
import { useFocusFirstInvalid } from "../use-focus-first-invalid"
import {
  IT_TICKET_STATUS_META, IT_TICKET_PRIORITY_META, IT_TICKET_CATEGORY_META,
} from "@/lib/services/ti/constants"
import type { TicketDueInfo } from "@/lib/services/ti/ticket-sla"
import type { TicketTimelineItem } from "@/lib/services/ti/tickets"
import { TicketTimeline } from "./ticket-timeline"
import { TicketAssignment, TicketStatusChange } from "./ticket-management"

interface TicketDetailProps {
  ticket: {
    id: string
    code: string
    subject: string
    description: string
    category: string
    priority: string
    status: string
    workerId: string | null
    workerName: string | null
    worksiteId: string
    worksiteName: string
    assetId: string | null
    assetCode: string | null
    assigneeUserId: string | null
    assigneeName: string | null
    requesterUserId: string
    requesterName: string | null
    resolution: string | null
    dueAt: string | null
    createdAt: string
    updatedAt: string
    resolvedAt: string | null
  }
  timeline: TicketTimelineItem[]
  due: TicketDueInfo | null
  currentUserId: string
  technicians: { id: string; name: string }[]
  canManage: boolean
  canInternal: boolean
  canComment: boolean
}

const SECTION = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs"
const HEADING = "text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]"

/**
 * Cuándo vence, donde se decide (TIUX-16). Un ticket abierto cuenta contra el
 * reloj; uno resuelto o cerrado dice si cumplió el plazo y nunca muestra un
 * vencimiento vigente. Texto con tokens `-ink`: el color solo refuerza.
 */
function DueLine({ due, dueAt }: { due: TicketDueInfo | null; dueAt: string | null }) {
  if (!due || !dueAt) return null
  const date = formatDateTime(dueAt)
  let text: string
  let tone = "text-[var(--color-text-muted)]"
  switch (due.kind) {
    case "overdue": text = `Atrasado ${due.span} · venció el ${date}`; tone = "text-[var(--color-danger-ink)]"; break
    case "due_soon": text = `Vence el ${date} · en ${due.span}`; tone = "text-[var(--color-warning-ink)]"; break
    case "on_track": text = `Vence el ${date} · en ${due.span}`; break
    case "met": text = "Resuelto dentro de plazo"; break
    default: text = "Resuelto fuera de plazo"; tone = "text-[var(--color-warning-ink)]"
  }
  return (
    <p className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${tone}`}>
      <Clock size={14} aria-hidden className="shrink-0" />
      <span>{text}</span>
    </p>
  )
}

export function TicketDetail({
  ticket, timeline, due, currentUserId, technicians, canManage, canInternal, canComment,
}: TicketDetailProps) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [commentState, commentAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await commentTicketAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Comentario agregado")
    return result
  }, INITIAL_STATE)
  useFocusFirstInvalid(formRef, commentState)
  const kept = (commentState.ok ? {} : (commentState.data?.values ?? {})) as Record<string, string>

  const statusMeta = IT_TICKET_STATUS_META[ticket.status]

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22.5rem)]">
      <div className="min-w-0 space-y-4">
        <section className={SECTION}>
          {/* El código y el asunto ya están en el encabezado de la página: aquí
              no se repiten. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <MetaBadge meta={{ label: statusMeta?.label ?? ticket.status, variant: statusMeta?.variant ?? "default" }} dot />
              <MetaBadge meta={{ label: IT_TICKET_PRIORITY_META[ticket.priority]?.label ?? ticket.priority, variant: IT_TICKET_PRIORITY_META[ticket.priority]?.variant ?? "default" }} />
              <MetaBadge meta={{ label: IT_TICKET_CATEGORY_META[ticket.category] ?? ticket.category, variant: "outline" }} />
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">Actualizado {formatDateTime(ticket.updatedAt)}</span>
          </div>

          <DueLine due={due} dueAt={ticket.dueAt} />

          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">{ticket.description}</p>

          {ticket.resolution && (
            <Callout tone="success" title="Resolución" className="mt-4">
              <p className="whitespace-pre-wrap break-words text-[var(--color-text)]">{ticket.resolution}</p>
              {ticket.resolvedAt && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDateTime(ticket.resolvedAt)}</p>
              )}
            </Callout>
          )}
        </section>

        <section className={SECTION}>
          <h3 className={HEADING}>Historial</h3>
          <TicketTimeline items={timeline} created={{ at: ticket.createdAt, authorName: ticket.requesterName }} />

          {canComment && (
            <form ref={formRef} action={commentAction} className="mt-4 space-y-3">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <Field label="Nuevo comentario" error={commentState.fieldErrors?.body?.[0]}>
                <Textarea name="body" maxLength={2000} rows={3} defaultValue={kept.body} placeholder="Escribe una actualización…" />
              </Field>
              {canInternal && (
                // La casilla del sistema, con objetivo de 44 px en móvil.
                <div className="[&_label]:min-h-11 sm:[&_label]:min-h-6">
                  <Checkbox
                    name="isInternal"
                    label="Nota interna (solo visible para TI)"
                    defaultChecked={kept.isInternal === "on"}
                  />
                </div>
              )}
              {commentState.message && !commentState.ok && !commentState.fieldErrors && (
                <p role="alert" tabIndex={-1} data-form-alert className="text-sm text-[var(--color-danger-ink)]">{commentState.message}</p>
              )}
              <SubmitButton label="Comentar" loadingLabel="Enviando..." size="sm" variant="secondary" />
            </form>
          )}
        </section>
      </div>

      <aside className="min-w-0 space-y-4">
        <section className={SECTION}>
          <h3 className={HEADING}>Detalle</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"><dt className="text-xs text-[var(--color-text-muted)]">Solicitante</dt><dd className="min-w-0 break-words font-medium text-[var(--color-text)]">{ticket.requesterName ?? "—"}</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"><dt className="text-xs text-[var(--color-text-muted)]">Trabajador</dt><dd className="min-w-0 break-words font-medium text-[var(--color-text)]">{ticket.workerName?.trim() || "—"}</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"><dt className="text-xs text-[var(--color-text-muted)]">Faena</dt><dd className="min-w-0 break-words font-medium text-[var(--color-text)]">{ticket.worksiteName}</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"><dt className="text-xs text-[var(--color-text-muted)]">Activo</dt><dd className="min-w-0 break-words font-medium text-[var(--color-text)]">
              {ticket.assetId
                ? <Link href={`/ti/activos/${ticket.assetId}`} className="inline-flex min-h-11 items-center whitespace-nowrap text-[var(--color-primary)] hover:underline sm:min-h-0">{ticket.assetCode}</Link>
                : "—"}
            </dd></div>
            {/* Quien gestiona ve y cambia el responsable en su propio bloque. */}
            {!canManage && (
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"><dt className="text-xs text-[var(--color-text-muted)]">Técnico</dt><dd className="min-w-0 break-words font-medium text-[var(--color-text)]">{ticket.assigneeName ?? "Sin asignar"}</dd></div>
            )}
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"><dt className="text-xs text-[var(--color-text-muted)]">Creado</dt><dd className="font-medium text-[var(--color-text)]">{formatDateTime(ticket.createdAt)}</dd></div>
          </dl>
        </section>

        {canManage && (
          <>
            <TicketAssignment ticket={ticket} technicians={technicians} currentUserId={currentUserId} />
            <TicketStatusChange ticket={ticket} />
          </>
        )}
      </aside>
    </div>
  )
}
