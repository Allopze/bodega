"use client"

import * as React from "react"
import { CalendarBlank, CheckCircle, Prohibit, WarningCircle } from "@phosphor-icons/react"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"

/**
 * El checklist del programa: qué se esperaba, qué pasó y por qué.
 *
 * Es presentación compartida entre simulacros y CGRD —no un servicio ni un
 * modelo—: cada módulo conserva su tabla, su acción y sus reglas. Lo que se
 * comparte a propósito es el vocabulario, porque que un módulo diga "No
 * corresponde" y el otro "No aplica" es duplicación que el usuario sí ve.
 */

export type ProgramSlotStatus = "pending" | "completed" | "not_completed" | "not_applicable"

export interface ProgramSlotRow {
  id: string
  version: number
  slotKey: string
  scheduledMonth: number
  scheduledWeek: number
  status: ProgramSlotStatus
  observation: string | null
  notApplicableReason: string | null
  /** Qué llenó la casilla, para mostrarlo sin que el componente sepa de qué es. */
  fulfilledLabel: string | null
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

const STATUS_LABELS: Record<ProgramSlotStatus, string> = {
  pending: "Pendiente",
  completed: "Hecha",
  not_completed: "No hecha",
  not_applicable: "No aplica",
}

function statusMeta(status: ProgramSlotStatus): StateMetaInput {
  if (status === "completed") return { label: STATUS_LABELS[status], variant: "success" }
  if (status === "not_completed") return { label: STATUS_LABELS[status], variant: "danger" }
  // Neutro: no es un logro ni una falta, es algo que salió del denominador.
  if (status === "not_applicable") return { label: STATUS_LABELS[status], variant: "outline" }
  return { label: STATUS_LABELS[status], variant: "warning" }
}

/** El motivo mínimo. Debe coincidir con el CHECK de la tabla y con el servicio. */
const NOT_APPLICABLE_REASON_MIN = 10

export function ProgramSlotList({
  rows,
  year,
  canRecord,
  emptyHint,
  notApplicableSuggestion,
  onRecord,
}: {
  rows: ProgramSlotRow[]
  year: number
  canRecord: boolean
  /** Qué decir cuando no hay casillas: el motivo difiere por módulo. */
  emptyHint: string
  /** Texto sugerido para el motivo de "no aplica", si el módulo tiene uno. */
  notApplicableSuggestion?: string | null
  onRecord: (input: {
    slotId: string
    expectedVersion: number
    status: "not_completed" | "not_applicable"
    observation: string | null
    notApplicableReason: string | null
  }) => Promise<{ ok: boolean; message?: string }>
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">{emptyHint}</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-text-subtle)]">
        Lo que el programa {year} planifica para esta faena. Una casilla sin resolver al vencer su mes cuenta como incumplimiento.
      </p>
      {rows.map((row) => (
        <article key={row.id} className="rounded-lg border border-[var(--color-border)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                <CalendarBlank size={15} aria-hidden />
                {MONTHS[row.scheduledMonth - 1]} · semana {row.scheduledWeek}
              </p>
              {row.status === "completed" && row.fulfilledLabel && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.fulfilledLabel}</p>
              )}
              {row.status === "not_applicable" && (
                <p className="mt-1 inline-flex max-w-xl items-start gap-1.5 text-xs text-[var(--color-text-subtle)]">
                  <Prohibit size={13} className="mt-0.5 shrink-0" aria-hidden />{row.notApplicableReason}
                </p>
              )}
              {row.status === "not_completed" && row.observation && (
                <p className="mt-1 inline-flex max-w-xl items-start gap-1.5 text-xs text-[var(--color-text-subtle)]">
                  <WarningCircle size={13} className="mt-0.5 shrink-0 text-[var(--color-danger-ink)]" aria-hidden />{row.observation}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <MetaBadge meta={statusMeta(row.status)} dot />
              {canRecord && row.status !== "completed" && (
                <>
                  {row.status !== "not_completed" && (
                    <SlotDialog row={row} target="not_completed" onRecord={onRecord} />
                  )}
                  {row.status !== "not_applicable" && (
                    <SlotDialog row={row} target="not_applicable" suggestion={notApplicableSuggestion} onRecord={onRecord} />
                  )}
                </>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

function SlotDialog({
  row,
  target,
  suggestion,
  onRecord,
}: {
  row: ProgramSlotRow
  target: "not_completed" | "not_applicable"
  suggestion?: string | null
  onRecord: Parameters<typeof ProgramSlotList>[0]["onRecord"]
}) {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const operation = useOperation()
  const isNotApplicable = target === "not_applicable"

  /* La sugerencia se pre-llena y queda editable: el módulo sabe por qué
   * probablemente no aplica —la dotación no alcanza el umbral del DS 44— pero
   * quien firma el motivo es quien lo declara, no el sistema. */
  React.useEffect(() => {
    if (open && isNotApplicable && suggestion && !text) setText(suggestion)
  }, [open, isNotApplicable, suggestion, text])

  function submit() {
    if (isNotApplicable && text.trim().length < NOT_APPLICABLE_REASON_MIN) {
      operation.setMessage(`Explica por qué no aplica (al menos ${NOT_APPLICABLE_REASON_MIN} caracteres).`)
      return
    }
    operation.run(
      () => onRecord({
        slotId: row.id,
        expectedVersion: row.version,
        status: target,
        observation: isNotApplicable ? null : (text.trim() || null),
        notApplicableReason: isNotApplicable ? text.trim() : null,
      }),
      () => { setOpen(false); setText("") },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setText("") }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          {isNotApplicable ? <Prohibit size={14} aria-hidden /> : <WarningCircle size={14} aria-hidden />}
          {isNotApplicable ? "No aplica" : "No hecha"}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={`slot-${row.id}-description`}>
        <DialogHeader>
          <DialogTitle>{isNotApplicable ? "Declarar que no aplica" : "Marcar como no hecha"}</DialogTitle>
          <DialogDescription id={`slot-${row.id}-description`}>
            {MONTHS[row.scheduledMonth - 1]} · semana {row.scheduledWeek}
          </DialogDescription>
        </DialogHeader>

        <div className={`rounded-xl px-3.5 py-3 text-sm ${isNotApplicable ? "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]" : "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]"}`}>
          {isNotApplicable
            ? "La actividad saldrá del programa de esta faena: no cuenta como cumplida ni como incumplida. El motivo queda registrado y es lo que un fiscalizador va a leer."
            : "Queda declarado que la actividad planificada no se realizó."}
        </div>

        <Field
          label={isNotApplicable ? "Motivo" : "Observación"}
          htmlFor={`slot-${row.id}-text`}
          required={isNotApplicable}
          helper={isNotApplicable
            ? `Obligatorio: explica por qué no corresponde en esta faena (al menos ${NOT_APPLICABLE_REASON_MIN} caracteres).`
            : "Opcional: explica por qué no se realizó."}
          className="mt-4"
        >
          <Textarea
            id={`slot-${row.id}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={isNotApplicable ? 1000 : 3000}
            disabled={operation.pending}
          />
        </Field>

        {operation.message && <p role="status" className="mt-2 text-sm text-[var(--color-danger-ink)]">{operation.message}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={operation.pending}>Cancelar</Button>
          <Button
            type="button"
            variant={isNotApplicable ? "secondary" : "destructive"}
            onClick={submit}
            loading={operation.pending}
          >
            {isNotApplicable ? <CheckCircle size={15} aria-hidden /> : <WarningCircle size={15} aria-hidden />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
