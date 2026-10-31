"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { assignAnomalyAction, commentAnomalyAction, updateAnomalyStatusAction } from "@/app/(app)/combustibles/anomalias/actions"
import { takeAnomalyCaseAction } from "@/app/(app)/combustibles/revisar/actions"
import { METER_RESOLUTION_KIND_LABELS, METER_RESOLUTION_KINDS, requiresMeterResolutionKind } from "@/lib/combustibles/anomaly-labels"
import type { FuelInboxItem } from "@/lib/combustibles/inbox/detail-types"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

type Outcome = { ok: boolean; message?: string }

/**
 * Lo que se puede hacer con un caso desde la bandeja, con los permisos de
 * siempre: tomarlo, asignarlo, comentarlo y reabrirlo piden
 * `combustibles:review_anomalies`; resolverlo o descartarlo, `resolve_anomalies`.
 *
 * «Descartar» es la única confirmación de la bandeja: un caso descartado no se
 * vuelve a crear para esa carga, aunque la regla se siga cumpliendo.
 */
export function CaseActions({ item, canReview, canResolve, onDone }: { item: FuelInboxItem; canReview: boolean; canResolve: boolean; onDone?: () => void }) {
  const info = item.extras.case
  const router = useRouter()
  const motiveId = useId()
  const commentId = useId()
  const { pending, run } = useOperation({ feedback: "toast" })
  const [motive, setMotive] = useState("")
  const [kind, setKind] = useState("")
  const [comment, setComment] = useState("")
  const [dismissing, setDismissing] = useState(false)
  const [dismissError, setDismissError] = useState<string | undefined>()
  if (!info) return null

  const closed = info.status === "resolved" || info.status === "dismissed"
  const needsKind = requiresMeterResolutionKind(info.ruleCode)
  const missingClosing = !motive.trim() || (needsKind && !kind)
  const refresh = () => { router.refresh(); onDone?.() }

  function call(operation: () => Promise<Outcome>, after?: () => void) {
    run(operation, (result) => {
      toast.success(result.message ?? "Listo")
      after?.()
      refresh()
    })
  }

  const status = (next: "resolved" | "dismissed" | "reopened") =>
    updateAnomalyStatusAction({ caseId: info.id, expectedStatus: info.status, status: next, resolution: motive, resolutionKind: needsKind && kind ? kind : undefined })

  async function confirmDismiss() {
    setDismissError(undefined)
    const result = await status("dismissed").catch(() => ({ ok: false, message: "No se pudo descartar el caso. Reintenta." }))
    if (result.ok) {
      setDismissing(false)
      toast.success(result.message ?? "Caso descartado")
      refresh()
    } else {
      setDismissError(result.message ?? "No se pudo descartar el caso")
    }
  }

  return (
    <div className="space-y-4">
      {!closed && canReview && info.status !== "in_review" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" loading={pending} disabled={pending}
            onClick={() => call(() => takeAnomalyCaseAction({ caseId: info.id, expectedStatus: info.status, expectedAssigneeId: info.assigneeId }))}>
            Tomar el caso
          </Button>
          <p className="text-xs text-[var(--color-text-muted)]">Al tomar el caso quedas como responsable y lo ven todos.</p>
        </div>
      ) : null}

      {info.status === "in_review" && canReview && (item.extras.assignees?.length ?? 0) > 0 ? (
        <Field label="Responsable" helper="Quien lo tiene en sus manos. Puedes pasárselo a otra persona de la faena.">
          <OptionSelect
            aria-label="Asignar el caso a"
            value={info.assigneeId ?? ""}
            placeholder="Asignar a…"
            onValueChange={(value) => {
              if (!value || value === info.assigneeId) return
              call(() => assignAnomalyAction({ caseId: info.id, expectedAssigneeId: info.assigneeId, assigneeId: value }))
            }}
            options={(item.extras.assignees ?? []).map((person) => ({ value: person.id, label: person.name }))}
          />
        </Field>
      ) : null}

      {!closed && canResolve ? (
        <div className="space-y-3">
          <Field label="Motivo" htmlFor={motiveId} helper="Obligatorio para resolver o descartar: queda en el caso." required>
            <Textarea id={motiveId} value={motive} onChange={(event) => setMotive(event.target.value)} rows={2} disabled={pending} />
          </Field>
          {needsKind ? (
            <Field label="¿Qué pasó con el medidor?" helper="Sólo un medidor reemplazado reinicia la serie del equipo en Flota y Mantenciones." required>
              <OptionSelect
                aria-label="Qué pasó con el medidor"
                placeholder="¿Qué pasó con el medidor?"
                value={kind}
                onValueChange={setKind}
                options={METER_RESOLUTION_KINDS.map((value) => ({ value, label: METER_RESOLUTION_KIND_LABELS[value] }))}
              />
            </Field>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="destructive" disabled={pending || missingClosing} onClick={() => { setDismissError(undefined); setDismissing(true) }}>
              Descartar
            </Button>
            {info.status === "in_review" ? (
              <Button type="button" variant="primary" loading={pending} disabled={pending || missingClosing}
                onClick={() => call(() => status("resolved"), () => { setMotive(""); setKind("") })}>
                Resolver
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {closed && canReview ? (
        <Button type="button" variant="secondary" loading={pending} disabled={pending} onClick={() => call(() => status("reopened"))}>
          Reabrir el caso
        </Button>
      ) : null}

      {canReview ? (
        <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
          <Field label="Comentario" htmlFor={commentId}>
            <Textarea id={commentId} value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Añadir un comentario…" disabled={pending} />
          </Field>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" size="sm" loading={pending} disabled={pending || !comment.trim()}
              onClick={() => call(() => commentAnomalyAction({ caseId: info.id, body: comment }), () => setComment(""))}>
              Comentar
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={dismissing}
        onOpenChange={(open) => { if (!open) setDismissing(false) }}
        title="¿Descartar este caso?"
        description="El caso no volverá a aparecer para esta carga, aunque la regla se vuelva a cumplir."
        variant="destructive"
        confirmLabel="Descartar caso"
        cancelLabel="Volver"
        error={dismissError}
        onConfirm={() => { void confirmDismiss() }}
      />
    </div>
  )
}
