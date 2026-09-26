"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import { PDTP_REASON_MIN_LENGTH } from "@/lib/prevention/pdtp"
import { formatDateTime, MONTH_LABELS } from "@/lib/utils"
import { reviewPdtpNotApplicableAction } from "../actions"

export type NotApplicableReviewItem = {
  id: string
  activityN: number
  activityName: string
  worksiteName: string
  year: number
  month: number
  week: number
  reason: string
  createdByUserId: string
  createdByName: string
  createdAt: string
}

/**
 * PREV-C07 (D8): "No aplica" declarados que esperan revisión. Mientras están
 * acá la celda sigue contando en el cumplimiento; aprobar la saca del
 * denominador, rechazar la deja exigible y libre para otro desvío.
 *
 * Quien declaró ve su propia fila sin botones: la segregación la impone el
 * servicio, pero ofrecer un botón que siempre falla es peor que explicar por
 * qué no está.
 */
export function NotApplicableReviewSection({ items, currentUserId }: { items: NotApplicableReviewItem[]; currentUserId: string }) {
  return (
    <section id="no-aplica" className="mt-6 scroll-mt-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">
        &quot;No aplica&quot; por revisar{items.length > 0 ? ` (${items.length})` : ""}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Semanas que alguien declaró como no aplicables. No cambian el cumplimiento hasta que otra persona las aprueba.
      </p>
      {items.length === 0 ? (
        <EmptyState
          compact
          title='Sin "no aplica" por revisar'
          description="Cuando alguien declare que una semana no aplica en una faena de tu alcance, aparecerá acá para que la apruebes o la rechaces."
        />
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {items.map((item) => (
            <NotApplicableReviewRow key={item.id} item={item} isOwn={item.createdByUserId === currentUserId} />
          ))}
        </ul>
      )}
    </section>
  )
}

function NotApplicableReviewRow({ item, isOwn }: { item: NotApplicableReviewItem; isOwn: boolean }) {
  const router = useRouter()
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const period = `${MONTH_LABELS[item.month - 1]} · semana ${item.week} de ${item.year}`
  const label = `N°${item.activityN}`

  const submit = (decision: "approve" | "reject") => {
    const formData = new FormData()
    formData.set("deviationId", item.id)
    formData.set("decision", decision)
    if (decision === "reject") formData.set("reason", reason.trim())
    operation.run(async () => {
      const result = await reviewPdtpNotApplicableAction(formData)
      return result.ok
        ? { ok: true, message: decision === "approve" ? `"No aplica" de ${label} aprobado.` : `"No aplica" de ${label} rechazado.` }
        : result
    }, () => {
      setRejecting(false)
      setReason("")
    })
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-[var(--color-text)]">
          <span className="text-[var(--color-text-faint)]">{label}</span> {item.activityName}
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">{item.worksiteName} · {period}</p>
        <p className="text-sm text-[var(--color-text)]">{item.reason}</p>
        <p className="text-xs text-[var(--color-text-subtle)]">Declarado por {item.createdByName} · {formatDateTime(item.createdAt)}</p>
      </div>
      {isOwn ? (
        <p className="text-xs text-[var(--color-text-muted)] md:max-w-[14rem] md:text-right">Lo declaraste tú: lo revisa otra persona.</p>
      ) : (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={operation.pending}
            aria-label={`Aprobar "no aplica" de ${label}, ${period}`}
            onClick={() => submit("approve")}
          >
            Aprobar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={operation.pending}
            aria-label={`Rechazar "no aplica" de ${label}, ${period}`}
            onClick={() => setRejecting(true)}
          >
            Rechazar
          </Button>
        </div>
      )}
      <Dialog open={rejecting} onOpenChange={(open) => { if (!open) { setRejecting(false); setReason("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar &quot;no aplica&quot; · {label}</DialogTitle>
            <DialogDescription>
              La semana {period} vuelve a exigirse en {item.worksiteName}. El motivo queda en el control de cambios del programa.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo del rechazo" htmlFor={`na-reject-${item.id}`} hint={`Al menos ${PDTP_REASON_MIN_LENGTH} caracteres.`}>
            <Textarea
              id={`na-reject-${item.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={1000}
              aria-label="Motivo del rechazo"
              className="min-h-0"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setRejecting(false); setReason("") }} disabled={operation.pending}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => submit("reject")}
              disabled={operation.pending || reason.trim().length < PDTP_REASON_MIN_LENGTH}
            >
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
