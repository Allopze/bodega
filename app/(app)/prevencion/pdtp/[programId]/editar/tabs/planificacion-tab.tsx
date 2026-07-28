"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { updatePdtpActivityAction } from "../../../actions"
import { describePdtpRecurrence, deriveScheduleHorizon, type PdtpRecurrenceRule, type PdtpScheduleHorizon } from "@/lib/services/pdtp/recurrence"
import { useDebouncedAutosave, autosaveStatusLabel } from "@/lib/hooks/use-debounced-autosave"


import type { PdtpActivityRow, PdtpScheduleRow } from "./types"

export function ScheduleOverview({ activities, schedule }: { activities: PdtpActivityRow[]; schedule: PdtpScheduleRow[] }) {
  const legacyCellsByActivity = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const cell of schedule) counts.set(cell.activityId, (counts.get(cell.activityId) ?? 0) + 1)
    return counts
  }, [schedule])

  if (activities.length === 0) {
    return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">Agrega una actividad para definir cuándo debe realizarse.</div>
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="text-h3 text-[var(--color-text)]">Programación comprensible</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">La frecuencia o el evento son la fuente de verdad; la matriz semanal queda como proyección avanzada.</p>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {activities.map((activity) => {
          const mode = activity.scheduleMode ?? "scheduled"
          const needsReview = activity.scheduleClassificationStatus === "needs_review"
          const rule = activity.recurrenceRule as PdtpRecurrenceRule | null
          const description = needsReview
            ? "La planilla de origen no indicó programación. Elige al editar si ocurre con frecuencia, cuando se necesite o ante un evento."
            : mode === "scheduled"
            ? rule
              ? describePdtpRecurrence(rule)
              : `${legacyCellsByActivity.get(activity.id) ?? 0} período(s) heredado(s); define una recurrencia para usar el constructor general.`
            : mode === "on_demand"
              ? `Cuando se necesite${activity.dueDays !== null ? ` · plazo objetivo ${activity.dueDays} día(s)` : ""}.`
              : `${activity.triggerDescription || "Evento pendiente de describir"}${activity.dueDays !== null ? ` · plazo ${activity.dueDays} día(s)` : ""}.`
          const label = needsReview ? "Clasificación pendiente" : mode === "scheduled" ? "Con frecuencia" : mode === "on_demand" ? "A demanda" : "Por evento"
          return (
            <li key={activity.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]"><span className="font-mono text-xs text-[var(--color-text-subtle)]">N°{activity.n}</span> {activity.activity}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>
              </div>
              <Badge variant={needsReview || (mode === "scheduled" && !rule) ? "warning" : "outline"} size="sm">{label}</Badge>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const PLAN_MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function scheduleKey(month: number, week: number) {
  return `${month}-${week}`
}

export function PlanificacionTab({ programId: _programId, year, periodStart, periodEnd, activities, schedule }: {
  programId: string
  year: number
  periodStart?: string | null
  periodEnd?: string | null
  activities: PdtpActivityRow[]
  schedule: PdtpScheduleRow[]
}) {
  const scheduleByActivity = React.useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const activity of activities) map.set(activity.id, {})
    for (const cell of schedule) {
      const row = map.get(cell.activityId)
      if (row) row[scheduleKey(cell.month, cell.week)] = cell.plannedQuantity
    }
    return map
  }, [activities, schedule])

  // El horizonte real del programa (meses que su período cubre dentro del
  // año) acota "Rellenar": sin período declarado equivale al año completo,
  // igual que antes; con un período parcial, no fabrica celdas fuera de él.
  const horizon = React.useMemo(() => deriveScheduleHorizon({ year, periodStart, periodEnd }), [year, periodStart, periodEnd])
  const horizonMonths = new Set(horizon.months)
  const visibleMonthLabels = PLAN_MONTH_LABELS.filter((_, index) => horizonMonths.has(index + 1))

  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
        Sin actividades. Agrega actividades antes de planificar cantidades.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        Cantidad planificada por semana para {year}
        {horizon.months.length < 12 ? ` (período de ${horizon.months.length} mes(es))` : ""}. Cada mes tiene {horizon.weeksPerMonth} celda(s).
        &ldquo;Rellenar&rdquo; fija una cantidad en las {horizon.months.length * horizon.weeksPerMonth} semanas del período de la fila (sin guardar todavía) — revisa y presiona Guardar.
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[var(--color-surface-2)] th-type">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-[16rem] border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-left">Actividad</th>
              {visibleMonthLabels.map((m) => (
                <th scope="col" key={m} className="min-w-[5.5rem] border-b border-[var(--color-border)] px-1 py-2 text-center">{m}</th>
              ))}
              <th scope="col" className="min-w-[13rem] border-b border-[var(--color-border)] px-2 py-2 text-left">Rellenar / Guardar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {activities.map((activity) => (
              <PlanificacionRow key={activity.id} activity={activity} initial={scheduleByActivity.get(activity.id) ?? {}} horizon={horizon} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Huella estable (orden e ausencia-vs-cero no importan) para detectar cambios reales de planificación. */
function scheduleFingerprint(values: Record<string, number>): string {
  return Object.entries(values)
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, quantity]) => `${key}=${quantity}`)
    .join(",")
}

function PlanificacionRow({ activity, initial, horizon }: { activity: PdtpActivityRow; initial: Record<string, number>; horizon: PdtpScheduleHorizon }) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, number>>(initial)
  const [fillValue, setFillValue] = React.useState("")
  const savedFingerprint = React.useMemo(() => scheduleFingerprint(initial), [initial])
  const currentFingerprint = React.useMemo(() => scheduleFingerprint(values), [values])
  const isDirty = currentFingerprint !== savedFingerprint

  // savedFingerprint ya resume el contenido de `initial`; comparar contra él
  // evita re-adoptar (y perder lo tecleado) por el mero cambio de identidad.
  const [lastSavedSchedule, setLastSavedSchedule] = React.useState(savedFingerprint)
  if (lastSavedSchedule !== savedFingerprint) {
    setLastSavedSchedule(savedFingerprint)
    setValues(initial)
  }

  function setCell(month: number, week: number, raw: string) {
    const n = raw === "" ? 0 : Number(raw)
    setValues((prev) => ({ ...prev, [scheduleKey(month, week)]: Number.isFinite(n) ? n : 0 }))
  }

  function fillAll() {
    const n = Number(fillValue)
    if (!Number.isFinite(n) || n < 0) return
    const next: Record<string, number> = {}
    // Solo rellena los meses del horizonte real del programa (año completo
    // por defecto); un período parcial no fabrica celdas fuera de su rango.
    for (const m of horizon.months) for (let w = 1; w <= horizon.weeksPerMonth; w++) next[scheduleKey(m, w)] = n
    setValues(next)
  }

  const { status, error, saveNow } = useDebouncedAutosave({
    watchKey: currentFingerprint,
    isDirty,
    onSave: async () => {
      // scheduleOverrides es autoritativo para el año del programa: reemplaza
      // por completo la planificación de esta actividad (ver updatePdtpActivity
      // en lib/services/pdtp/activities.ts). Por eso la matriz mantiene las 48
      // celdas en memoria en vez de solo las que el usuario tocó.
      const scheduleOverrides = Object.entries(values)
        .map(([key, plannedQuantity]) => {
          const [month, week] = key.split("-").map(Number) as [number, number]
          return { month, week, plannedQuantity }
        })
        .filter((c) => c.plannedQuantity > 0)
      const result = await updatePdtpActivityAction({ activityId: activity.id, scheduleOverrides })
      if (result.ok) router.refresh()
      return result
    },
  })
  const pending = status === "saving"

  return (
    <tr className="bg-[var(--color-surface)] align-top">
      <td className="sticky left-0 z-10 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <span className="font-mono text-[var(--color-text-subtle)]">N°{activity.n}</span> {activity.activity}
      </td>
      {horizon.months.map((month) => (
        <td key={month} className="p-1">
          <div className="grid grid-cols-2 gap-0.5">
            {Array.from({ length: horizon.weeksPerMonth }, (_, i) => i + 1).map((week) => (
              <input
                key={week}
                type="number"
                min="0"
                step="0.25"
                value={values[scheduleKey(month, week)] || ""}
                onChange={(e) => setCell(month, week, e.target.value)}
                title={`${PLAN_MONTH_LABELS[month - 1]} · Semana ${week}`}
                aria-label={`${PLAN_MONTH_LABELS[month - 1]} · Semana ${week}`}
                className="h-6 w-11 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-center text-[11px] text-[var(--color-text)]"
              />
            ))}
          </div>
        </td>
      ))}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            step="0.25"
            placeholder="cant."
            value={fillValue}
            onChange={(e) => setFillValue(e.target.value)}
            aria-label="Cantidad a llenar"
            className="h-7 w-14 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-xs text-[var(--color-text)]"
          />
          <Button type="button" variant="ghost" size="sm" onClick={fillAll} disabled={fillValue === ""}>Rellenar</Button>
          <Button type="button" size="sm" onClick={saveNow} disabled={pending || !isDirty}>{pending ? "..." : "Guardar"}</Button>
        </div>
        <p aria-live="polite" className="mt-1 text-[11px] text-[var(--color-text-subtle)]">{autosaveStatusLabel(status)}</p>
        {error && <p className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</p>}
      </td>
    </tr>
  )
}
