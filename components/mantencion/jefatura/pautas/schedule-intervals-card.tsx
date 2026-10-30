"use client"

import * as React from "react"
import { X } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatReading, plural } from "@/lib/mantencion/format"
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
 * 15) y lo deja «por revisar» hasta que alguien toque esa columna o use el botón.
 * Quitar uno pide confirmar y dice a cuántos equipos alcanza: la edición es en
 * vivo (sube la versión que descarga la app), así que no puede ser un clic suelto.
 */
export function ScheduleIntervalsCard({ scheduleId, unit, intervals, equipmentCount }: {
  scheduleId: string
  unit: MantUnit
  intervals: EditorInterval[]
  /** Equipos activos que usan la pauta: el impacto que se muestra al quitar un intervalo. */
  equipmentCount: number
}) {
  const [text, setText] = React.useState("")
  const [target, setTarget] = React.useState<EditorInterval | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const { pending, edit } = useScheduleEdit()
  const listRef = React.useRef<HTMLUListElement>(null)
  // Dónde vuelve el foco al cerrar el diálogo: al botón que lo abrió, o a la lista si ese intervalo ya no existe.
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const base = intervals[0]?.value
  const toReview = intervals.filter((interval) => interval.needsReview)
  const onlyOne = intervals.length < 2

  function add() {
    const value = Number(text.replace(/\./g, "").trim())
    if (!Number.isInteger(value) || value <= 0) { toast.error("Escribe un número entero mayor que 0."); return }
    edit(() => addScheduleIntervalAction({ scheduleId, value }), (outcome) => { setText(""); toast.success(outcome.message ?? "Intervalo agregado.") })
  }

  function askToRemove(interval: EditorInterval, trigger: HTMLElement) {
    returnFocusRef.current = trigger
    setTarget(interval)
    setConfirmOpen(true)
  }

  function remove() {
    if (!target) return
    const interval = target
    const label = formatReading(interval.value, unit)
    edit(
      () => setScheduleIntervalActiveAction({ scheduleId, intervalId: interval.id, active: false }),
      () => {
        returnFocusRef.current = listRef.current
        setConfirmOpen(false)
        toastWithUndo(`Intervalo de ${label} quitado. Los registros ya firmados no cambian.`, () => {
          edit(() => setScheduleIntervalActiveAction({ scheduleId, intervalId: interval.id, active: true }), () => toast.success(`Intervalo de ${label} restituido con su columna.`))
        })
      },
      () => setConfirmOpen(false),
    )
  }

  const targetLabel = target ? formatReading(target.value, unit) : ""
  const nextBase = intervals.find((interval) => interval.id !== target?.id)?.value
  const impact = target
    ? [
        equipmentCount > 0
          ? `${plural(equipmentCount, "equipo asignado dejará", "equipos asignados dejarán")} de tener la mantención de ${targetLabel}.`
          : `Ningún equipo usa esta pauta todavía, así que nadie deja de tener la mantención de ${targetLabel}.`,
        target.id === intervals[0]?.id && nextBase !== undefined
          ? `Es el intervalo base: la app pasará a redondear la lectura a ${formatReading(nextBase, unit)}.`
          : null,
        "Los registros ya firmados no cambian.",
      ].filter(Boolean).join(" ")
    : ""

  return (
    <SectionCard
      title="Intervalos"
      description={base ? `Cada intervalo es una mantención de la pauta. El menor (${formatReading(base, unit)}) es la base: la app redondea la lectura a ese intervalo y sugiere el mayor que calce.` : undefined}
    >
      <ul ref={listRef} tabIndex={-1} className="flex flex-wrap items-center gap-2" aria-label="Intervalos de la pauta">
        {intervals.map((interval) => (
          <li
            key={interval.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-control)] bg-[var(--color-surface)] py-0 pl-3 pr-0.5 font-mono text-[13px] sm:py-0.5"
          >
            {formatReading(interval.value, unit)}
            {interval.needsReview && <Badge variant="warning" size="sm">Por revisar</Badge>}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={pending || onlyOne}
              onClick={(event) => askToRemove(interval, event.currentTarget)}
              aria-label={`Quitar el intervalo de ${formatReading(interval.value, unit)}`}
              className="rounded-full hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"
            >
              <X size={12} weight="bold" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {onlyOne && <p className="mt-2 text-xs text-[var(--color-text-muted)]">La pauta necesita al menos un intervalo: el único que queda no se puede quitar.</p>}
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
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`¿Quitar el intervalo de ${targetLabel}?`}
        description={impact}
        confirmLabel="Quitar intervalo"
        variant="destructive"
        loading={pending}
        returnFocusRef={returnFocusRef}
        onConfirm={remove}
      />
    </SectionCard>
  )
}
