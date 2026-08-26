"use client"

import * as React from "react"
import { useActionState, useEffect, useMemo, useState } from "react"
import { ArrowClockwise, Check, Copy, Prohibit, X } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/utils"
import { INITIAL_STATE } from "@/lib/form-state"
import { cancelInvitation, resendInvitation } from "./actions/invitations"

export interface InvitationRow {
  id: string
  email: string
  name: string | null
  status: "pending" | "accepted" | "cancelled" | "replaced" | "expired"
  roleLabels: string[]
  worksiteCount: number
  invitedByName: string | null
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  lastSentAt: string | null
  sendCount: number
}

const STATUS_LABEL: Record<InvitationRow["status"], string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  cancelled: "Cancelada",
  replaced: "Reemplazada",
  expired: "Expirada",
}

const STATUS_VARIANT: Record<InvitationRow["status"], React.ComponentProps<typeof Badge>["variant"]> = {
  pending: "warning",
  accepted: "success",
  cancelled: "danger",
  replaced: "default",
  expired: "default",
}

export function UserInvitationsPanel({ invitations }: { invitations: InvitationRow[] }) {
  const [status, setStatus] = useState<"pending" | "all">("pending")
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [copyUrl, setCopyUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [cancelState, cancelAction] = useActionState(cancelInvitation, INITIAL_STATE)
  const [resendState, resendAction] = useActionState(resendInvitation, INITIAL_STATE)

  const rows = useMemo(() => (
    status === "pending" ? invitations.filter((invitation) => invitation.status === "pending") : invitations
  ), [invitations, status])

  useEffect(() => {
    if (!cancelState.message) return
    if (cancelState.ok) {
      toast.success(cancelState.message)
      setCancelId(null)
    } else {
      toast.error(cancelState.message)
    }
  }, [cancelState])

  useEffect(() => {
    if (!resendState.message) return
    if (resendState.ok) {
      toast.success(resendState.message)
      const data = resendState.data as { inviteUrl?: string } | undefined
      if (data?.inviteUrl) {
        setCopyUrl(data.inviteUrl)
        setCopied(false)
      }
    } else {
      toast.error(resendState.message)
    }
  }, [resendState])

  async function copyInviteUrl() {
    if (!copyUrl) return
    try {
      await navigator.clipboard.writeText(copyUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("No se pudo copiar al portapapeles")
    }
  }

  return (
    // mt-12 (48px): la separación ENTRE secciones debe superar a la separación
    // interna de la sección anterior (filas de tabla a ~60px). Sin esto el título
    // quedaba a ~25px de la última fila y se leía como parte de la tabla.
    <section className="mt-12 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Invitaciones enviadas</h2>
          <p className="text-xs text-[var(--color-text-subtle)]">Revisa enlaces pendientes, cancela accesos y reenvía invitaciones.</p>
        </div>
        <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          <button
            type="button"
            onClick={() => setStatus("pending")}
            className={`h-11 sm:h-8 px-3 text-xs font-medium ${status === "pending" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-subtle)]"}`}
          >
            Pendientes
          </button>
          <button
            type="button"
            onClick={() => setStatus("all")}
            className={`h-11 sm:h-8 px-3 text-xs font-medium ${status === "all" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-subtle)]"}`}
          >
            Todas
          </button>
        </div>
      </div>

      {copyUrl && (
        <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3">
          <p className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text)]">{copyUrl}</p>
          <Button size="sm" variant="secondary" onClick={copyInviteUrl} aria-label="Copiar enlace al portapapeles">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
          <Button type="button" size="icon-mobile-sm" variant="ghost" onClick={() => setCopyUrl(null)} aria-label="Cerrar enlace">
            <X size={16} />
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {rows.length === 0 ? (
          // A-4: un vacío POR FILTRO no pide "crear el primero", pide volver a
          // ver todo. El vacío real (sin ninguna invitación) sí explica el flujo.
          <EmptyState
            compact
            title={status === "pending" ? "Sin invitaciones pendientes" : "Aún no has invitado a nadie"}
            description={
              status === "pending"
                ? "Todas las invitaciones enviadas ya fueron aceptadas o canceladas."
                : "Usa «Invitar» para enviar un enlace de acceso; aparecerá aquí hasta que la persona lo use."
            }
            action={
              status === "pending" && invitations.length > 0
                ? <Button type="button" size="sm" variant="secondary" onClick={() => setStatus("all")}>Ver todas</Button>
                : undefined
            }
          />
        ) : rows.map((invitation) => (
          <article key={invitation.id} className="grid gap-3 border-b border-[var(--color-border)] p-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-[var(--color-text)]">{invitation.name || invitation.email}</p>
                <Badge variant={STATUS_VARIANT[invitation.status]} dot>
                  {STATUS_LABEL[invitation.status]}
                </Badge>
              </div>
              <p title={invitation.email} className="truncate text-xs text-[var(--color-text-subtle)]">{invitation.email}</p>
              <div className="flex flex-wrap items-center gap-1">
                {invitation.roleLabels.slice(0, 3).map((label) => <Badge key={label} size="sm">{label}</Badge>)}
                {invitation.roleLabels.length > 3 && (
                  <span className="text-[10px] font-medium text-[var(--color-text-subtle)]">+{invitation.roleLabels.length - 3} más</span>
                )}
                <span className="text-xs text-[var(--color-text-subtle)]">{invitation.worksiteCount} faena(s)</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Enviada {formatDate(invitation.createdAt)} · Expira {formatDate(invitation.expiresAt)}
                {invitation.invitedByName ? ` · Por ${invitation.invitedByName}` : ""}
              </p>
              {invitation.lastSentAt && invitation.sendCount > 1 && (
                <p className="text-xs text-[var(--color-text-muted)]">Reenviada {formatDate(invitation.lastSentAt)} · {invitation.sendCount} envíos</p>
              )}
              {invitation.cancelReason && (
                <p className="text-xs text-[var(--color-danger)]">Motivo: {invitation.cancelReason}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              {invitation.status !== "accepted" && (
                <form action={resendAction}>
                  <input type="hidden" name="id" value={invitation.id} />
                  <Button size="sm" variant="secondary" type="submit"><ArrowClockwise size={14} />Reenviar</Button>
                </form>
              )}
              {invitation.status === "pending" && (
                <Button size="sm" variant="destructive" type="button" onClick={() => setCancelId(invitation.id)}>
                  <Prohibit size={14} />Cancelar
                </Button>
              )}
            </div>

            {cancelId === invitation.id && (
              <form action={cancelAction} className="space-y-2 lg:col-span-2">
                <input type="hidden" name="id" value={invitation.id} />
                <Field label="Motivo de cancelación" htmlFor={`cancel-${invitation.id}`} error={cancelState.fieldErrors?.reason?.[0]}>
                  <Input id={`cancel-${invitation.id}`} name="reason" placeholder="Ej: correo equivocado" error={!!cancelState.fieldErrors?.reason} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setCancelId(null)}>Volver</Button>
                  <Button type="submit" size="sm" variant="destructive">Confirmar cancelación</Button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
