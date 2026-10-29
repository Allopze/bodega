"use client"

import * as React from "react"
import { X } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatReading } from "@/lib/mantencion/format"
import type { MantUnit } from "@/lib/mantencion/types"
import type { EditorInterval } from "@/lib/services/mantencion/schedules"
import { toast } from "@/lib/toast"
import {
  addScheduleIntervalAction, clearIntervalReviewAction, setScheduleIntervalActiveAction,
} from "@/app/(app)/mantencion/pautas/[id]/actions"
import { SectionCard } from "../shared/section-card"
import { toastWithUndo, useScheduleEdit } from "./use-schedule-edit"

/**
 * Intervalos de la pauta como fichas con «Quitar» y «Deshacer». El menor es la
 * base. Agregar uno hereda la columna del mayor intervalo que lo divide (regla
 * 15) y lo deja «Por revisar» hasta que alguien toque esa columna o use el botón.
 */
export function ScheduleIntervalsCard({ scheduleId, unit, intervals }: { scheduleId: string; unit: MantUnit; intervals: EditorInterval[] }) {
  const [text, setText] = React.useState("")
  const { pending, edit } = useScheduleEdit()
  const base = intervals[0]?.value
  const toReview = intervals.filter((interval) => interval.needsReview)

  function add() {
    const value = Number(text.replace(/\./g, "").trim())
    if (!Number.isInteger(value) || value <= 0) { toast.error("Escribe un número entero mayor que 0."); return }
    edit(() => addScheduleIntervalAction({ scheduleId, value }), (outcome) => { setText(""); toast.success(outcome.message ?? "Intervalo agregado.") })
  }

  function remove(interval: EditorInterval) {
    const label = formatReading(interval.value, unit)
    edit(
      () => setScheduleIntervalActiveAction({ scheduleId, intervalId: interval.id, active: false }),
      () => toastWithUndo(`Intervalo de ${label} quitado. Los registros ya firmados no cambian.`, () => {
        edit(() => setScheduleIntervalActiveAction({ scheduleId, intervalId: interval.id, active: true }), () => toast.success(`Intervalo de ${label} restituido.`))
      }),
    )
  }

  return (
    <SectionCard
      title="Intervalos"
      description={base ? `El menor (${formatReading(base, unit)}) es la base: la app redondea la lectura a ese intervalo y sugiere el mayor que calce.` : undefined}
    >
      <ul className="flex flex-wrap items-center gap-2" aria-label="Intervalos de la pauta">
        {intervals.map((interval) => (
          <li
            key={interval.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-control)] bg-[var(--color-surface)] py-1 pl-3 pr-1 font-mono text-[13px]"
          >
            {formatReading(interval.value, unit)}
            {interval.needsReview && <Badge variant="warning" size="sm">Por revisar</Badge>}
            <button
              type="button"
              disabled={pending || intervals.length < 2}
              onClick={() => remove(interval)}
              aria-label={`Quitar el intervalo de ${formatReading(interval.value, unit)}`}
              title={intervals.length < 2 ? "La pauta necesita al menos un intervalo" : undefined}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger-ink)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
            >
              <X size={12} weight="bold" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => { event.preventDefault(); add() }}
      >
        <Field label={`Nuevo intervalo (${unit})`} htmlFor="schedule-new-interval" className="w-40">
          <Input id="schedule-new-interval" inputMode="numeric" className="font-mono" autoComplete="off" value={text} onChange={(event) => setText(event.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Button type="submit" variant="secondary" loading={pending} disabled={!text.trim()}>Agregar intervalo</Button>
        {toReview.length > 0 && (
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => edit(() => clearIntervalReviewAction({ scheduleId }), () => toast.success("Columnas dadas por revisadas."))}
          >
            Dar por revisadas las columnas nuevas
          </Button>
        )}
      </form>
    </SectionCard>
  )
}
