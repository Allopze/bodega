"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { analyzeLecture, type LectureAnalysis } from "@/lib/mantencion/client/flow-validate"
import { brandAndModel, formatReading, parseReadingInput, recordKindText } from "@/lib/mantencion/format"
import { formatDate, todayInChile } from "@/lib/utils"

/** El equipo de la OT, fijo: el registro desde la ficha no deja cambiarlo. */
export function RecordEquipment({ row }: { row: FleetRow }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
      <p className="font-mono text-sm font-semibold text-[var(--color-text)]">{equipmentLabel(row.eq)}</p>
      <p className="text-xs text-[var(--color-text-muted)]">
        {[brandAndModel(row.eq.brandName, row.eq.model), row.eq.typeName, row.eq.worksiteName].filter(Boolean).join(" · ")}
      </p>
    </div>
  )
}

/** Aviso que se confirma en la misma pantalla (salto de lectura, preventiva repetida): no tapa lo que se corrige. */
function AskCallout({ title, children, confirm, revise }: {
  title: string
  children?: React.ReactNode
  confirm: { label: string; onClick: () => void }
  revise: { label: string; onClick: () => void }
}) {
  return (
    <Callout tone="warning" role="alert" title={title}>
      {children}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={confirm.onClick}>{confirm.label}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={revise.onClick}>{revise.label}</Button>
      </div>
    </Callout>
  )
}

/** «Pauta que corresponde»: qué toca según la lectura y, si hace falta, otra pauta con su motivo. */
function PautaPanel({ draft, dispatch, row, analysis }: { draft: FlowDraft; dispatch: React.Dispatch<FlowAction>; row: FleetRow; analysis: LectureAnalysis }) {
  const { schedule, suggestion, intervalValue, manual, value } = analysis
  const unit = row.eq.unit
  if (!schedule || schedule.intervals.length === 0) {
    return (
      <Callout tone="warning" title="Pauta que corresponde">
        Este equipo no tiene pauta asignada: no se puede registrar una preventiva. Registra una correctiva o pide a la jefatura que le asigne una pauta.
        {draft.errors.schedule && <p role="alert" className="mt-1 font-semibold">{draft.errors.schedule}</p>}
      </Callout>
    )
  }
  if (value === null || !suggestion || intervalValue === null) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 text-sm">
        <p className="font-semibold">Pauta que corresponde · {schedule.name}</p>
        <p className="mt-1 text-[var(--color-text-muted)]">Escribe la lectura y te decimos qué pauta toca.</p>
      </div>
    )
  }
  const last = row.status.lastPreventive
  const open = draft.intervalOpen || manual
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 text-sm">
      <p className="font-semibold">Pauta que corresponde · {schedule.name}</p>
      <p className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-lg font-semibold tabular-nums">{formatReading(intervalValue, unit)}</span>
        <span className="text-xs text-[var(--color-text-muted)]">{analysis.items.length} ítems</span>
      </p>
      <p className="mt-1 text-[var(--color-text-muted)]">
        {manual
          ? `Elegida a mano. Por la lectura correspondía la de ${formatReading(suggestion.intervalValue, unit)}.`
          : `Lectura ${formatReading(value, unit)} → toca la de ${formatReading(intervalValue, unit)}${last ? ` (última preventiva: ${formatReading(last.intervalValue, unit)}, ${formatDate(last.date)})` : ""}.`}
      </p>
      {open ? (
        <div className="mt-2 flex flex-col gap-3">
          <div role="group" aria-label="Pauta a usar" className="flex flex-wrap gap-2">
            {schedule.intervals.map((interval, index) => (
              <Button
                key={interval}
                type="button"
                size="sm"
                variant={interval === intervalValue ? "primary" : "secondary"}
                aria-pressed={interval === intervalValue}
                onClick={() => dispatch({ type: "patch", patch: { intervalIndex: interval === suggestion.intervalValue ? null : index } })}
              >
                {formatReading(interval, unit)}{interval === suggestion.intervalValue ? " (sugerida)" : ""}
              </Button>
            ))}
          </div>
          {manual ? (
            <Field label="¿Por qué usas otra pauta?" htmlFor="ot-rec-ivreason" error={draft.errors.ivReason} required>
              <Input id="ot-rec-ivreason" value={draft.intervalReason} placeholder="Ej: la anterior quedó incompleta" maxLength={500}
                onChange={(event) => dispatch({ type: "patch", patch: { intervalReason: event.target.value } })} />
            </Field>
          ) : (
            <Button type="button" variant="link" size="sm" className="self-start" onClick={() => dispatch({ type: "patch", patch: { intervalOpen: false, intervalIndex: null } })}>
              Usar la sugerida
            </Button>
          )}
        </div>
      ) : (
        <Button type="button" variant="link" size="sm" className="mt-1 px-0" onClick={() => dispatch({ type: "patch", patch: { intervalOpen: true } })}>
          Elegir otra pauta
        </Button>
      )}
    </div>
  )
}

/**
 * Lectura y fecha del trabajo (y, en una preventiva, la pauta que toca). Los
 * avisos que piden confirmar —salto de lectura, preventiva repetida— salen aquí
 * mismo, igual que en la app.
 */
export function RecordStepLectura({ draft, dispatch, row, onConfirm }: {
  draft: FlowDraft
  dispatch: React.Dispatch<FlowAction>
  row: FleetRow
  /** Aplica el cambio y sigue al paso siguiente en un solo gesto. */
  onConfirm: (patch: Partial<FlowDraft>) => void
}) {
  const readingRef = React.useRef<HTMLInputElement>(null)
  const analysis = React.useMemo(() => analyzeLecture(draft, row), [draft, row])
  const { errors } = draft
  const unit = row.eq.unit
  const last = row.status.currentReading
  const typed = parseReadingInput(draft.readingText)
  const focusReading = () => readingRef.current?.focus()

  return (
    <div className="flex flex-col gap-4">
      <RecordEquipment row={row} />
      <Field
        label={unit === "km" ? "Odómetro actual" : "Horómetro actual"}
        htmlFor="ot-rec-reading"
        required
        error={errors.reading}
        helper={last ? `Última lectura registrada: ${formatReading(last.value, unit)} · ${formatDate(last.date)}` : "No hay lecturas anteriores de este equipo."}
      >
        <Input
          ref={readingRef}
          id="ot-rec-reading"
          inputMode="decimal"
          autoComplete="off"
          value={typed.text}
          placeholder="0"
          onChange={(event) => dispatch({ type: "patch", patch: { readingText: parseReadingInput(event.target.value).stored } })}
        />
      </Field>

      {errors.jump && analysis.value !== null && (
        <AskCallout
          title={errors.jump}
          confirm={{ label: "Sí, está bien", onClick: () => onConfirm({ ackJump: { reading: analysis.value ?? 0, workDate: draft.workDate } }) }}
          revise={{ label: "Corregir la lectura", onClick: focusReading }}
        />
      )}

      {draft.kind === "P" && <PautaPanel draft={draft} dispatch={dispatch} row={row} analysis={analysis} />}

      {errors.duplicate && analysis.duplicate && (
        <AskCallout
          title="Ya hay una preventiva parecida de este equipo."
          confirm={{ label: "Registrar otra igual", onClick: () => onConfirm({ ackDuplicate: analysis.duplicate?.id ?? null }) }}
          revise={{ label: "Revisar los datos", onClick: focusReading }}
        >
          {analysis.duplicate.folio ?? "Un registro anterior"}: {recordKindText("P", analysis.duplicate.intervalValue, unit)} a {formatReading(analysis.duplicate.reading, unit)}, el {formatDate(analysis.duplicate.date)}.{" "}
          {analysis.duplicate.folio && (
            <Link href={`/mantencion/registros/${analysis.duplicate.id}`} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
              Ver ese registro
            </Link>
          )}
        </AskCallout>
      )}

      <Field label="Fecha del trabajo" htmlFor="ot-rec-date" required error={errors.workDate}>
        <DatePicker id="ot-rec-date" value={draft.workDate} max={todayInChile()} error={!!errors.workDate}
          onChange={(iso) => dispatch({ type: "patch", patch: { workDate: iso } })} />
      </Field>
    </div>
  )
}
