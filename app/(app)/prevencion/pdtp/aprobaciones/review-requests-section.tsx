"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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
import { formatDateTime } from "@/lib/utils"
import type { PendingPdtpReviewRequest } from "@/lib/services/pdtp/review-requests"
import { reviewPdtpReviewRequestAction, withdrawPdtpReviewRequestAction } from "../actions"

/**
 * PRV-05 / PRV-12 / M-06 (auditoría 2026-09-28): cancelaciones de
 * obligaciones, anulaciones de aprobaciones y reducciones de meta que esperan
 * a una segunda persona. Mientras
 * están acá no cambian nada del cumplimiento. Igual que en "No aplica", quien
 * pidió ve su fila sin botones de revisión y puede retirarla.
 */
export function ReviewRequestsSection({ items, currentUserId }: { items: PendingPdtpReviewRequest[]; currentUserId: string }) {
  return (
    <section id="solicitudes" className="mt-6 scroll-mt-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">
        Cancelaciones, anulaciones y reducciones de meta por revisar{items.length > 0 ? ` (${items.length})` : ""}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Pedidos para cancelar una obligación, anular una ejecución ya aprobada o bajar la meta de una faena. No cambian el cumplimiento hasta que otra persona los aprueba.
      </p>
      {items.length === 0 ? (
        <EmptyState
          compact
          title="Sin solicitudes por revisar"
          description="Cuando alguien pida cancelar una obligación, anular una ejecución aprobada o bajar una meta en una faena de tu alcance, aparecerá acá para que la apruebes o la rechaces."
        />
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {items.map((item) => (
            <ReviewRequestRow key={item.id} item={item} isOwn={item.requestedByUserId === currentUserId} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ReviewRequestRow({ item, isOwn }: { item: PendingPdtpReviewRequest; isOwn: boolean }) {
  const router = useRouter()
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const [rejecting, setRejecting] = React.useState(false)
  const [withdrawing, setWithdrawing] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const noun = item.kind === "obligation_cancellation" ? "cancelación" : item.kind === "override_reduction" ? "reducción de meta" : "anulación"

  const decide = (decision: "approve" | "reject") => {
    operation.run(async () => {
      const result = await reviewPdtpReviewRequestAction({ requestId: item.id, decision, reason: decision === "reject" ? reason.trim() : undefined })
      return result.ok ? { ok: true, message: `Solicitud de ${noun} ${decision === "approve" ? "aprobada" : "rechazada"}.` } : result
    }, () => {
      setRejecting(false)
      setReason("")
    })
  }

  const withdraw = () => {
    operation.run(async () => {
      const result = await withdrawPdtpReviewRequestAction(item.id)
      return result.ok ? { ok: true, message: `Solicitud de ${noun} retirada.` } : result
    }, () => setWithdrawing(false))
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-[var(--color-text)]">{item.description}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{item.worksiteName}</p>
        <p className="text-sm text-[var(--color-text)]">{item.reason}</p>
        <p className="text-xs text-[var(--color-text-subtle)]">Pedido por {item.requestedByName ?? "—"} · {formatDateTime(item.requestedAt)}</p>
      </div>
      {isOwn ? (
        <div className="flex shrink-0 flex-col gap-2 md:max-w-[14rem] md:items-end">
          <p className="text-xs text-[var(--color-text-muted)] md:text-right">La pediste tú: la revisa otra persona.</p>
          <Button type="button" size="sm" variant="secondary" disabled={operation.pending} aria-label={`Retirar solicitud de ${noun}: ${item.description}`} onClick={() => setWithdrawing(true)}>
            Retirar
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="primary" disabled={operation.pending} aria-label={`Aprobar ${noun}: ${item.description}`} onClick={() => decide("approve")}>
            Aprobar
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={operation.pending} aria-label={`Rechazar ${noun}: ${item.description}`} onClick={() => setRejecting(true)}>
            Rechazar
          </Button>
        </div>
      )}
      {isOwn ? (
        <ConfirmDialog
          open={withdrawing}
          onOpenChange={setWithdrawing}
          title={`Retirar solicitud de ${noun}`}
          description="La solicitud deja de esperar revisión y todo sigue como estaba."
          confirmLabel="Retirar solicitud"
          variant="warning"
          loading={operation.pending}
          onConfirm={withdraw}
        />
      ) : null}
      <Dialog open={rejecting} onOpenChange={(open) => { if (!open) { setRejecting(false); setReason("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar {noun}</DialogTitle>
            <DialogDescription>
              {item.kind === "obligation_cancellation" ? "La obligación se sigue exigiendo." : item.kind === "override_reduction" ? "La meta se mantiene." : "La aprobación se mantiene."} El motivo queda en el control de cambios del programa.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo del rechazo" htmlFor={`rr-reject-${item.id}`} hint={`Al menos ${PDTP_REASON_MIN_LENGTH} caracteres.`}>
            <Textarea id={`rr-reject-${item.id}`} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} className="min-h-0" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setRejecting(false); setReason("") }} disabled={operation.pending}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => decide("reject")} disabled={operation.pending || reason.trim().length < PDTP_REASON_MIN_LENGTH}>
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
