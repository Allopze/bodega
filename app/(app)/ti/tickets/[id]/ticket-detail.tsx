"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { formatDateTime, formatDate } from "@/lib/utils"
import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/ui/submit-button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { transitionTicketAction, commentTicketAction } from "../actions"
import {
  IT_TICKET_STATUS_META, IT_TICKET_PRIORITY_META, IT_TICKET_CATEGORY_META,
} from "@/lib/services/ti/constants"
import { IT_TICKET_STATUSES } from "@/lib/validation/ti"

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
    createdAt: string
    updatedAt: string
    resolvedAt: string | null
  }
  comments: {
    id: string
    body: string
    isInternal: boolean
    authorName: string
    createdAt: string
  }[]
  canManage: boolean
  canInternal: boolean
  canComment: boolean
}

export function TicketDetail({ ticket, comments, canManage, canInternal, canComment }: TicketDetailProps) {
  const [status, setStatus] = React.useState(ticket.status)
  const [transitionState, transitionAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await transitionTicketAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Ticket actualizado")
    else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  const [commentState, commentAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await commentTicketAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Comentario agregado")
    else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-[var(--color-primary)]">{ticket.code}</span>
              <MetaBadge meta={{ label: `${IT_TICKET_STATUS_META[ticket.status]?.label ?? ticket.status}`, variant: IT_TICKET_STATUS_META[ticket.status]?.variant ?? "default" }} dot />
              <MetaBadge meta={{ label: `${IT_TICKET_PRIORITY_META[ticket.priority]?.label ?? ticket.priority}`, variant: IT_TICKET_PRIORITY_META[ticket.priority]?.variant ?? "default" }} />
              <MetaBadge meta={{ label: IT_TICKET_CATEGORY_META[ticket.category] ?? ticket.category, variant: "outline" }} />
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">Actualizado {formatDateTime(ticket.updatedAt)}</span>
          </div>

          <h2 className="mt-4 text-base font-semibold text-[var(--color-text)]">{ticket.subject}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text)]">{ticket.description}</p>

          {ticket.resolution && (
            <div className="mt-4 rounded-xl border-l-2 border-[var(--color-success)] bg-[var(--color-success-tint)] p-3">
              <p className="text-xs font-semibold text-[var(--color-success-ink)]">Resolución</p>
              <p className="mt-1 text-sm text-[var(--color-text)]">{ticket.resolution}</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Comentarios ({comments.length})
          </h3>
          {comments.length === 0 ? (
            <EmptyState compact align="start" title="Sin comentarios todavía" description="Las actualizaciones del caso aparecerán aquí." />
          ) : (
            <ul className="mt-3 space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className={`rounded-xl p-3 ${comment.isInternal ? "border border-dashed border-[var(--color-signal-line)] bg-[var(--color-signal-tint)]" : "bg-[var(--color-surface-2)]"}`}>
                  {comment.isInternal && (
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-signal-ink)]">Nota interna</p>
                  )}
                  <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{comment.body}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {comment.authorName} · {formatDateTime(comment.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canComment && (
            <form action={commentAction} className="mt-4 space-y-3">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <Field label="Nuevo comentario" error={commentState.fieldErrors?.body?.[0]}>
                <Input name="body" maxLength={2000} placeholder="Escribe una actualización…" />
              </Field>
              {canInternal && (
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <input type="checkbox" name="isInternal" className="h-3.5 w-3.5 rounded" />
                  Nota interna (solo visible para TI)
                </label>
              )}
              {commentState.message && !commentState.ok && !commentState.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{commentState.message}</p>
              )}
              <SubmitButton label="Comentar" loadingLabel="Enviando..." size="sm" variant="secondary" />
            </form>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Detalle</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-xs text-[var(--color-text-muted)]">Solicitante</dt><dd className="font-medium text-[var(--color-text)]">{ticket.requesterName ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-xs text-[var(--color-text-muted)]">Trabajador</dt><dd className="font-medium text-[var(--color-text)]">{ticket.workerName ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-xs text-[var(--color-text-muted)]">Faena</dt><dd className="font-medium text-[var(--color-text)]">{ticket.worksiteName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-xs text-[var(--color-text-muted)]">Activo</dt><dd className="font-medium text-[var(--color-text)]">
              {ticket.assetId
                ? <Link href={`/ti/activos/${ticket.assetId}`} className="text-[var(--color-primary)] hover:underline">{ticket.assetCode}</Link>
                : "—"}
            </dd></div>
            <div className="flex justify-between gap-3"><dt className="text-xs text-[var(--color-text-muted)]">Técnico</dt><dd className="font-medium text-[var(--color-text)]">{ticket.assigneeName ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-xs text-[var(--color-text-muted)]">Creado</dt><dd className="font-medium text-[var(--color-text)]">{formatDateTime(ticket.createdAt)}</dd></div>
            {ticket.resolvedAt && (
              <div className="flex justify-between gap-3"><dt className="text-xs text-[var(--color-text-muted)]">Resuelto</dt><dd className="font-medium text-[var(--color-text)]">{formatDate(ticket.resolvedAt)}</dd></div>
            )}
          </dl>
        </section>

        {canManage && (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Cambiar estado</h3>
            <form action={transitionAction} className="mt-3 space-y-3">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <Field label="Nuevo estado" error={transitionState.fieldErrors?.status?.[0]}>
                <Select name="status" value={status} onValueChange={setStatus}>
                  <SelectTrigger aria-label="Nuevo estado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IT_TICKET_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{IT_TICKET_STATUS_META[s]?.label ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Motivo" required error={transitionState.fieldErrors?.reason?.[0]}>
                <Input name="reason" maxLength={300} />
              </Field>
              {status === "resuelto" && (
                <Field label="Resolución" helper="Qué se hizo para resolver el problema.">
                  <Input name="resolution" maxLength={1000} />
                </Field>
              )}
              {transitionState.message && !transitionState.ok && !transitionState.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{transitionState.message}</p>
              )}
              <SubmitButton label="Aplicar cambio" loadingLabel="Aplicando..." size="sm" variant="secondary" />
            </form>
          </section>
        )}
      </aside>
    </div>
  )
}
