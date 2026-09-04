"use client"

import { useActionState, useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle, Scan, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import {
  resolveTraceabilityIntegrityCaseAction,
  scanTraceabilityIntegrityAction,
  type TraceabilityIntegrityActionState,
} from "../actions"

const INITIAL_STATE: TraceabilityIntegrityActionState = { ok: false, message: "" }

export interface TraceabilityIntegrityCaseRow {
  id: string
  requestItemId: string
  worksiteId: string
  findingCode: string
  snapshot: Record<string, unknown>
  detectedAt: string
  resolutionId: string | null
  resolutionAction: string | null
  resolvedAt: string | null
}

export interface TraceabilityIntegrityAdjustmentOption {
  id: string
  worksiteId: string
  label: string
}

const CASE_LABELS: Record<string, string> = {
  DELIVERY_EXCEEDS_FAENA_RECEIPT: "Entrega trazable supera lo recepcionado en faena",
  DELIVERY_BEFORE_FAENA_RECEIPT: "Entrega trazable anterior a la recepción en faena",
}

export function TraceabilityIntegrityCases({
  cases,
  canReconcile,
  adjustmentOptions,
}: {
  cases: TraceabilityIntegrityCaseRow[]
  canReconcile: boolean
  adjustmentOptions: TraceabilityIntegrityAdjustmentOption[]
}) {
  const [scanState, scanAction, scanPending] = useActionState(scanTraceabilityIntegrityAction, INITIAL_STATE)

  useEffect(() => {
    if (!scanState.message) return
    if (scanState.ok) toast.success(scanState.message)
    else toast.error(scanState.message)
  }, [scanState])

  if (cases.length === 0 && !canReconcile) return null

  const scanButton = canReconcile && (
    <form action={scanAction}>
      <Button size="sm" type="submit" variant="secondary" disabled={scanPending}>
        <Scan size={15} aria-hidden />
        {scanPending ? "Revisando…" : "Revisar historial"}
      </Button>
    </form>
  )

  /**
   * Sin excepciones no hay nada que alertar.
   *
   * El bloque iba siempre en color de señal, con título de advertencia y el
   * texto "aún no hay excepciones": una alarma permanente que decía que todo
   * estaba bien. Vacío se reduce a una línea neutra con su botón.
   */
  if (cases.length === 0) {
    return (
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-2xl) border border-(--color-border) bg-(--color-surface) px-4 py-3">
        <p className="text-xs text-(--color-text-muted)">
          <span className="font-medium text-(--color-text)">Integridad de trazabilidad:</span>{" "}
          sin excepciones registradas en tu alcance de faena.
        </p>
        {scanButton}
      </section>
    )
  }

  return (
    <section className="mb-4 rounded-(--radius-2xl) border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-signal-ink)]">
            <Warning weight="fill" className="h-4 w-4" aria-hidden />
            Excepciones de integridad
          </h2>
          <p className="mt-1 text-xs text-[var(--color-signal-ink)]">
            Se conservan con su snapshot original; una salida libre de bodega no se evalúa como trazabilidad de solicitud.
          </p>
        </div>
        {scanButton}
      </div>

      <ul className="mt-3 space-y-2">
          {cases.map((caseRow) => (
            <li key={caseRow.id} className="rounded-(--radius-lg) border border-[var(--color-signal-line)] bg-(--color-surface) p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-(--color-text)">{CASE_LABELS[caseRow.findingCode] ?? caseRow.findingCode}</p>
                  <p className="mt-0.5 text-[11px] text-(--color-text-subtle)">
                    Detectado {formatDateTime(caseRow.detectedAt)} ·{" "}
                    {/* El id suelto no le decía nada a nadie: abre el
                        expediente donde se ve qué pasó con ese ítem. */}
                    <Link
                      href={`/bodega/trazabilidad/${caseRow.requestItemId}`}
                      className="font-mono text-(--color-primary) hover:underline underline-offset-2"
                    >
                      ver expediente del ítem
                    </Link>
                  </p>
                </div>
                {caseRow.resolutionId ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success)]">
                    <CheckCircle size={14} weight="fill" aria-hidden />
                    Regularizado
                  </span>
                ) : (
                  <span className="text-xs font-medium text-[var(--color-signal-ink)]">Pendiente de regularización</span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-(--color-text-subtle)">
                Recibido en faena: {String(caseRow.snapshot.receivedAtFaena ?? 0)} · entregado: {String(caseRow.snapshot.delivered ?? 0)}
              </p>
              {!caseRow.resolutionId && canReconcile && (
                <IntegrityResolutionForm
                  caseId={caseRow.id}
                  worksiteId={caseRow.worksiteId}
                  adjustmentOptions={adjustmentOptions}
                />
              )}
            </li>
          ))}
      </ul>
    </section>
  )
}

function IntegrityResolutionForm({
  caseId,
  worksiteId,
  adjustmentOptions,
}: {
  caseId: string
  worksiteId: string
  adjustmentOptions: TraceabilityIntegrityAdjustmentOption[]
}) {
  const [state, action, pending] = useActionState(resolveTraceabilityIntegrityCaseAction, INITIAL_STATE)
  const [resolutionAction, setResolutionAction] = useState<"acknowledge" | "compensating_movement">("acknowledge")
  const [compensatingMovementId, setCompensatingMovementId] = useState("")
  const scopedAdjustments = adjustmentOptions.filter((movement) => movement.worksiteId === worksiteId)

  useEffect(() => {
    if (!state.message) return
    if (state.ok) toast.success(state.message)
    else toast.error(state.message)
  }, [state])

  return (
    <form action={action} className="mt-3 grid gap-2 border-t border-(--color-border) pt-3">
      <input name="caseId" type="hidden" value={caseId} />
      <Field label="Resolución" htmlFor={`integrity-resolution-${caseId}`}>
        <OptionSelect
          id={`integrity-resolution-${caseId}`}
          name="action"
          value={resolutionAction}
          onValueChange={(value) => setResolutionAction(value as "acknowledge" | "compensating_movement")}
          options={[
            { value: "acknowledge", label: "Reconocer sin movimiento" },
            { value: "compensating_movement", label: "Vincular ajuste compensatorio" },
          ]}
        />
      </Field>
      {resolutionAction === "compensating_movement" && (
        <Field
          label="Ajuste compensatorio existente"
          htmlFor={`integrity-adjustment-${caseId}`}
          hint="Sólo se pueden vincular ajustes ya registrados en esta misma faena; no se crea stock automáticamente."
          required
        >
          <OptionSelect
            id={`integrity-adjustment-${caseId}`}
            name="compensatingMovementId"
            value={compensatingMovementId}
            onValueChange={setCompensatingMovementId}
            emptyLabel={scopedAdjustments.length === 0 ? "No hay ajustes disponibles en esta faena" : "Selecciona un ajuste…"}
            options={scopedAdjustments.map((movement) => ({ value: movement.id, label: movement.label }))}
            disabled={scopedAdjustments.length === 0}
          />
        </Field>
      )}
      <Field label="Motivo" htmlFor={`integrity-reason-${caseId}`} hint="Obligatorio; se guarda como evidencia append-only.">
        <Textarea
          id={`integrity-reason-${caseId}`}
          name="reason"
          minLength={10}
          maxLength={2000}
          required
          placeholder="Explica qué ocurrió y cómo se regulariza la excepción…"
        />
      </Field>
      <div>
        <Button
          type="submit"
          size="sm"
          disabled={pending || (resolutionAction === "compensating_movement" && !compensatingMovementId)}
        >
          {pending ? "Guardando…" : "Regularizar caso"}
        </Button>
      </div>
    </form>
  )
}
