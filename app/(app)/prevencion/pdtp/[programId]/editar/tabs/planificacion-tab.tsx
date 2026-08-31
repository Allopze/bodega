"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn, pluralize } from "@/lib/utils"
import { PdtpDensityToggle, usePdtpDensity } from "../../../pdtp-sheet-table-ui"
import { updatePdtpActivityAction } from "../../../actions"
import {
  DEFAULT_SCHEDULE_HORIZON,
  derivePdtpScheduleSource,
  describePdtpRecurrence,
  describePdtpScheduleSource,
  deriveScheduleHorizon,
  projectRecurrenceToLegacySchedule,
  scheduleCellsFingerprint,
  type PdtpRecurrenceRule,
  type PdtpScheduleHorizon,
  type PdtpScheduleSource,
} from "@/lib/services/pdtp/recurrence"
import { useDebouncedAutosave } from "@/lib/hooks/use-debounced-autosave"
import { useEnterAdvancesFields } from "@/lib/hooks/use-enter-advances-fields"
import { Table, TableBody, TableCell, TableCellNum, TableFooter, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"


import type { PdtpActivityRow, PdtpScheduleRow } from "./types"

export function ScheduleOverview({ activities, schedule, horizon = DEFAULT_SCHEDULE_HORIZON }: {
  activities: PdtpActivityRow[]
  schedule: PdtpScheduleRow[]
  /** Horizonte real del programa. Sin él los conteos se calculan sobre 12
   *  meses y no coinciden con lo que se guardará en un período parcial. */
  horizon?: PdtpScheduleHorizon
}) {
  const cellsByActivity = React.useMemo(() => {
    const map = new Map<string, Array<{ month: number; week: number; plannedQuantity: number }>>()
    for (const cell of schedule) {
      const cells = map.get(cell.activityId) ?? []
      cells.push({ month: cell.month, week: cell.week, plannedQuantity: Number(cell.plannedQuantity) })
      map.set(cell.activityId, cells)
    }
    return map
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
          const cells = cellsByActivity.get(activity.id) ?? []
          const source = derivePdtpScheduleSource({ cells, scheduleMode: mode as "scheduled" | "on_demand" | "triggered", recurrenceRule: rule, horizon })
          const description = needsReview
            ? "La planilla de origen no indicó programación. Elige al editar si ocurre con frecuencia, cuando se necesite o ante un evento."
            : mode === "scheduled"
            ? rule
              ? describePdtpRecurrence(rule, horizon)
              : `${cells.length} período(s) heredado(s); define una recurrencia para usar el constructor general.`
            : mode === "on_demand"
              ? `Cuando se necesite${activity.dueDays !== null ? ` · plazo objetivo ${activity.dueDays} día(s)` : ""}.`
              : `${activity.triggerDescription || "Evento pendiente de describir"}${activity.dueDays !== null ? ` · plazo ${activity.dueDays} día(s)` : ""}.`
          const label = needsReview ? "Clasificación pendiente" : mode === "scheduled" ? "Con frecuencia" : mode === "on_demand" ? "A demanda" : "Por evento"
          // La matriz puede haberse ajustado a mano y dejar la recurrencia
          // desalineada: el modelo lo permite, así que hay que mostrarlo.
          const divergent = mode === "scheduled" && rule !== null && source === "manual"
          return (
            <li key={activity.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]"><span className="font-mono text-xs text-[var(--color-text-subtle)]">N°{activity.n}</span> {activity.activity}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>
                {divergent && (
                  <p className="mt-1 text-xs leading-5 text-[var(--color-warning-ink)]">{describePdtpScheduleSource(source, cells.length)}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <Badge variant={needsReview || (mode === "scheduled" && !rule) ? "warning" : "outline"} size="sm">{label}</Badge>
                {divergent && <Badge variant="warning" size="sm">Matriz manual</Badge>}
              </div>
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
      if (row) row[scheduleKey(cell.month, cell.week)] = Number(cell.plannedQuantity)
    }
    return map
  }, [activities, schedule])

  // El horizonte real del programa (meses que su período cubre dentro del
  // año) acota los presets: sin período declarado equivale al año completo;
  // con un período parcial, no fabrica celdas fuera de él.
  const horizon = React.useMemo(() => deriveScheduleHorizon({ year, periodStart, periodEnd }), [year, periodStart, periodEnd])
  const weeks = React.useMemo(
    () => Array.from({ length: horizon.weeksPerMonth }, (_, index) => index + 1),
    [horizon.weeksPerMonth],
  )

  // Estado por fila reportado hacia arriba: la barra al pie agrega los avances
  // sin guardar y el pie de tabla agrega los totales. Antes cada fila tenía su
  // propio botón Guardar y su propia etiqueta de estado — 40 de cada uno en
  // pantalla — compitiendo con el autoguardado que ya existía.
  const [rowStates, setRowStates] = React.useState<Record<string, RowState>>({})
  const reportRowState = React.useCallback((activityId: string, state: RowState) => {
    setRowStates((prev) => (prev[activityId] === state ? prev : { ...prev, [activityId]: state }))
  }, [])

  const [filter, setFilter] = React.useState<PlanFilter>("all")
  const sources = React.useMemo(() => {
    const map = new Map<string, PdtpScheduleSource>()
    for (const activity of activities) {
      const values = scheduleByActivity.get(activity.id) ?? {}
      map.set(activity.id, derivePdtpScheduleSource({
        cells: valuesToCells(values),
        scheduleMode: (activity.scheduleMode ?? "scheduled") as "scheduled" | "on_demand" | "triggered",
        recurrenceRule: activity.recurrenceRule as PdtpRecurrenceRule | null,
        horizon,
      }))
    }
    return map
  }, [activities, scheduleByActivity, horizon])

  const counts = React.useMemo(() => ({
    all: activities.length,
    unplanned: activities.filter((activity) => sources.get(activity.id) === "none").length,
    manual: activities.filter((activity) => sources.get(activity.id) === "manual").length,
  }), [activities, sources])

  const visibleActivities = React.useMemo(() => activities.filter((activity) => {
    if (filter === "all") return true
    if (filter === "unplanned") return sources.get(activity.id) === "none"
    return sources.get(activity.id) === "manual"
  }), [activities, filter, sources])

  // Misma preferencia de densidad que la hoja operativa: ambas son tablas PDTP
  // y el usuario espera un único ajuste.
  const router = useRouter()
  const [density, toggleDensity] = usePdtpDensity()
  const gridRef = React.useRef<HTMLFormElement>(null)
  useEnterAdvancesFields(gridRef)

  // ↑/↓ mueven entre filas por la misma semana. ←/→ se dejan al cursor del
  // texto, que es donde el usuario los espera dentro de un campo editable.
  const handleGridArrows = React.useCallback((event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    const target = event.target as HTMLElement | null
    const cell = target?.dataset?.planCell
    if (!cell || !gridRef.current) return
    const column = [...gridRef.current.querySelectorAll<HTMLInputElement>(`[data-plan-cell="${cell}"]`)]
    const index = column.indexOf(target as HTMLInputElement)
    const next = column[index + (event.key === "ArrowDown" ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    next.select()
  }, [])

  // Las filas en conflicto se excluyen de "Guardar todo": guardarlas
  // sobrescribiría lo que hizo la otra sesión, que es justo lo que se evita.
  const conflictedRows = Object.values(rowStates).filter((state) => state.conflict)
  const dirtyRows = Object.entries(rowStates).filter(([, state]) => state.isDirty && !state.conflict)
  const savingRows = Object.values(rowStates).filter((state) => state.status === "saving").length
  const failedRows = Object.values(rowStates).filter((state) => state.status === "error" && !state.conflict)

  const monthTotals = React.useMemo(() => {
    const totals = new Map<number, number>()
    for (const activity of visibleActivities) {
      const values = rowStates[activity.id]?.values ?? scheduleByActivity.get(activity.id) ?? {}
      for (const month of horizon.months) {
        let sum = totals.get(month) ?? 0
        for (const week of weeks) sum += values[scheduleKey(month, week)] ?? 0
        totals.set(month, sum)
      }
    }
    return totals
  }, [visibleActivities, rowStates, scheduleByActivity, horizon.months, weeks])
  const grandTotal = [...monthTotals.values()].reduce((sum, value) => sum + value, 0)

  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
        Sin actividades. Agrega actividades antes de planificar cantidades.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar actividades">
          {PLAN_FILTERS.map((option) => (
            <Button
              key={option.key}
              type="button"
              variant={filter === option.key ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label} ({counts[option.key]})
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <PdtpDensityToggle density={density} onToggle={toggleDensity} />
        <details className="text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">¿Cómo funciona?</summary>
          <p className="mt-1 max-w-prose leading-5">
            Cada fila es una actividad y cada columna una semana del mes: escribe cuántas veces debe realizarse.
            Lo que escribas se guarda solo, sin pulsar nada; la barra al pie avisa mientras haya cambios pendientes.
            Los atajos de la izquierda de cada fila rellenan el período completo del programa
            ({horizon.months.length} {pluralize(horizon.months.length, "mes", "meses")} de {year},
            {" "}{horizon.weeksPerMonth} {pluralize(horizon.weeksPerMonth, "semana")} por mes).
          </p>
        </details>
        </div>
      </div>

      {/* La tabla va dentro de un form solo para reutilizar el avance con Enter
          entre celdas (hook ya probado); no hay envío que hacer, el guardado es
          automático. */}
      <form ref={gridRef} onSubmit={(event) => event.preventDefault()} onKeyDown={handleGridArrows} data-density={density}>
      <TableRoot className="rounded-lg" stickyHeader>
        <Table className="border-collapse text-sm">
          <caption className="sr-only">Planificación semanal de actividades PDTP para {year}</caption>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="sticky left-0 z-20 min-w-[18rem] bg-[var(--color-surface-2)] text-left">Actividad</TableHead>
              {horizon.months.map((month) => (
                <TableHead
                  key={month}
                  colSpan={horizon.weeksPerMonth}
                  className={cn("min-w-[6.5rem] text-center", isQuarterStart(month) && "border-l border-[var(--color-border-strong)]")}
                >
                  {PLAN_MONTH_LABELS[month - 1]}
                </TableHead>
              ))}
              <TableHead rowSpan={2} className="min-w-[5rem] text-right">Total</TableHead>
            </TableRow>
            <TableRow>
              {horizon.months.flatMap((month) => weeks.map((week) => (
                <TableHead
                  key={`${month}-${week}`}
                  className={cn(
                    "px-0 py-1 text-center font-mono text-[10px] font-normal normal-case tracking-normal",
                    week === 1 && isQuarterStart(month) && "border-l border-[var(--color-border-strong)]",
                  )}
                >
                  {week}
                </TableHead>
              )))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleActivities.map((activity) => (
              <PlanificacionRow
                key={activity.id}
                activity={activity}
                initial={scheduleByActivity.get(activity.id) ?? {}}
                horizon={horizon}
                weeks={weeks}
                source={sources.get(activity.id) ?? "none"}
                onStateChange={reportRowState}
              />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="sticky left-0 z-10 bg-[var(--color-surface-2)] text-xs">
                Total por mes ({visibleActivities.length} {pluralize(visibleActivities.length, "actividad")})
              </TableCell>
              {horizon.months.map((month) => (
                <TableCell
                  key={month}
                  colSpan={horizon.weeksPerMonth}
                  className={cn("text-center font-mono text-xs tabular-nums", isQuarterStart(month) && "border-l border-[var(--color-border-strong)]")}
                >
                  {formatPlannedTotal(monthTotals.get(month) ?? 0)}
                </TableCell>
              ))}
              <TableCellNum className="text-xs">{formatPlannedTotal(grandTotal)}</TableCellNum>
            </TableRow>
          </TableFooter>
        </Table>
      </TableRoot>
      </form>

      {(dirtyRows.length > 0 || savingRows > 0 || failedRows.length > 0 || conflictedRows.length > 0) && (
        <div
          role="region"
          aria-label="Estado de la planificación"
          className="sticky bottom-0 z-30 -mx-4 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p aria-live="polite" className="text-xs text-[var(--color-text-muted)]">
              {conflictedRows.length > 0
                ? `La planificación de ${conflictedRows.length} ${pluralize(conflictedRows.length, "actividad")} cambió en otra sesión. Recarga para ver lo vigente antes de seguir editando.`
                : failedRows.length > 0
                  ? failedRows[0]!.error ?? "Error al guardar la planificación."
                  : savingRows > 0
                    ? `Guardando ${savingRows} ${pluralize(savingRows, "actividad")}…`
                    : `${dirtyRows.length} ${pluralize(dirtyRows.length, "actividad")} con cambios sin guardar.`}
            </p>
            <div className="flex items-center gap-2">
              {conflictedRows.length > 0 && (
                <Button type="button" variant="secondary" size="sm" onClick={() => router.refresh()}>Recargar</Button>
              )}
              <Button
                type="button"
                size="sm"
                disabled={dirtyRows.length === 0}
                onClick={() => { for (const [, state] of dirtyRows) void state.saveNow() }}
              >
                Guardar todo
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type PlanFilter = "all" | "unplanned" | "manual"

const PLAN_FILTERS: Array<{ key: PlanFilter; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "unplanned", label: "Sin planificar" },
  { key: "manual", label: "Manual" },
]

type RowState = {
  status: ReturnType<typeof useDebouncedAutosave>["status"]
  isDirty: boolean
  error: string | null
  saveNow: () => Promise<void>
  values: Record<string, number>
  /** La planificación cambió en otra sesión: guardar sobrescribiría lo que hizo
   *  la otra, así que hace falta recargar antes de continuar. */
  conflict: boolean
}

const isQuarterStart = (month: number) => month % 3 === 1

/** Sin decimales cuando no hacen falta: la mayoría de las cantidades son enteras. */
function formatPlannedTotal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function valuesToCells(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([, quantity]) => quantity > 0)
    .map(([key, plannedQuantity]) => {
      const [month, week] = key.split("-").map(Number) as [number, number]
      return { month, week, plannedQuantity }
    })
}

function cellsToValues(cells: Array<{ month: number; week: number; plannedQuantity: number }>) {
  const values: Record<string, number> = {}
  for (const cell of cells) values[scheduleKey(cell.month, cell.week)] = cell.plannedQuantity
  return values
}

/** Huella estable (orden e ausencia-vs-cero no importan) para detectar cambios reales de planificación. */
function scheduleFingerprint(values: Record<string, number>): string {
  return scheduleCellsFingerprint(valuesToCells(values))
}

/** Acepta solo un número con hasta dos decimales; vacío significa "sin planificar". */
const CELL_PATTERN = /^\d{0,6}([.,]\d{0,2})?$/

const ROW_PRESETS = [
  { key: "weekly", label: "Semanal", rule: { frequency: "weekly" as const, interval: 1, plannedQuantity: 1, weekOfMonth: 1 } },
  { key: "monthly", label: "1 × mes", rule: { frequency: "monthly" as const, interval: 1, plannedQuantity: 1, weekOfMonth: 1 } },
  { key: "quarterly", label: "Trimestral", rule: { frequency: "quarterly" as const, interval: 1, plannedQuantity: 1, weekOfMonth: 1 } },
]

function PlanificacionRow({ activity, initial, horizon, weeks, source, onStateChange }: {
  activity: PdtpActivityRow
  initial: Record<string, number>
  horizon: PdtpScheduleHorizon
  weeks: number[]
  source: PdtpScheduleSource
  onStateChange: (activityId: string, state: RowState) => void
}) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, number>>(initial)
  // Lo tecleado se conserva aparte del número: "1," o "1.2" son estados
  // intermedios válidos que no deben perderse ni convertirse en 0 al vuelo.
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [clearing, setClearing] = React.useState(false)
  // Un conflicto de huella no se arregla reintentando: la huella obsoleta no
  // cambia sola, así que el reintento automático del autoguardado giraría para
  // siempre. Se detiene el autoguardado y se pide recargar explícitamente.
  const [conflict, setConflict] = React.useState(false)
  const savedFingerprint = React.useMemo(() => scheduleFingerprint(initial), [initial])
  const currentFingerprint = React.useMemo(() => scheduleFingerprint(values), [values])
  const isDirty = currentFingerprint !== savedFingerprint

  // savedFingerprint ya resume el contenido de `initial`; comparar contra él
  // evita re-adoptar (y perder lo tecleado) por el mero cambio de identidad.
  const [lastSavedSchedule, setLastSavedSchedule] = React.useState(savedFingerprint)
  if (lastSavedSchedule !== savedFingerprint) {
    setLastSavedSchedule(savedFingerprint)
    setValues(initial)
    setDrafts({})
    setConflict(false)
  }

  function setCell(month: number, week: number, raw: string) {
    const key = scheduleKey(month, week)
    if (!CELL_PATTERN.test(raw)) {
      setDrafts((prev) => ({ ...prev, [key]: raw }))
      return
    }
    setDrafts((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    const parsed = raw === "" ? 0 : Number(raw.replace(",", "."))
    setValues((prev) => ({ ...prev, [key]: Number.isFinite(parsed) ? parsed : 0 }))
  }

  function applyPreset(rule: PdtpRecurrenceRule) {
    // Se construye con la misma proyección que usa el guardado del servicio,
    // así que el preset y la recurrencia equivalente coinciden exactamente.
    setValues(cellsToValues(projectRecurrenceToLegacySchedule(rule, horizon)))
    setDrafts({})
  }

  const { status, error, saveNow } = useDebouncedAutosave({
    watchKey: currentFingerprint,
    isDirty,
    enabled: !conflict,
    onSave: async () => {
      // scheduleOverrides es autoritativo para el año del programa: reemplaza
      // por completo la planificación de esta actividad (ver updatePdtpActivity
      // en lib/services/pdtp/activities.ts). Por eso la matriz mantiene las 48
      // celdas en memoria en vez de solo las que el usuario tocó.
      const result = await updatePdtpActivityAction({
        activityId: activity.id,
        scheduleOverrides: valuesToCells(values),
        expectedScheduleFingerprint: savedFingerprint,
      })
      if (result.ok) router.refresh()
      else if ((result.data as { scheduleConflict?: unknown } | undefined)?.scheduleConflict) setConflict(true)
      return result
    },
  })

  // El padre necesita el estado para la barra al pie y los totales del pie de
  // tabla; se reporta en un efecto para no escribir en el padre durante el
  // render de la fila.
  React.useEffect(() => {
    onStateChange(activity.id, { status, isDirty, error, saveNow, values, conflict })
  }, [activity.id, status, isDirty, error, saveNow, values, conflict, onStateChange])

  const rowTotal = Object.values(values).reduce((sum, value) => sum + value, 0)
  const invalidCells = Object.keys(drafts).length > 0

  return (
    <TableRow className="bg-[var(--color-surface)] align-top">
      <TableCell className="sticky left-0 z-10 border-r border-[var(--color-border)] bg-[var(--color-surface)] text-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2" title={activity.activity}>
              <span className="font-mono text-[var(--color-text-subtle)]">N°{activity.n}</span> {activity.activity}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <RowStatusBadge status={status} isDirty={isDirty} conflict={conflict} />
              {source === "manual" && <Badge variant="outline" size="sm">Manual</Badge>}
              {invalidCells && <Badge variant="danger" size="sm">Revisa las cantidades</Badge>}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Atajos de planificación para la actividad N°${activity.n}`}>⋯</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Rellenar el período</DropdownMenuLabel>
              {ROW_PRESETS.map((preset) => (
                <DropdownMenuItem key={preset.key} onSelect={() => applyPreset(preset.rule)}>{preset.label}</DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setClearing(true)}>Limpiar fila</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ConfirmDialog
          open={clearing}
          onOpenChange={setClearing}
          title={`Limpiar la planificación de la actividad N°${activity.n}`}
          description={`Se quitarán las ${Object.values(values).filter((value) => value > 0).length} semanas planificadas de esta actividad. Es la cantidad que el indicador de cumplimiento usa como denominador.`}
          confirmLabel="Limpiar"
          variant="destructive"
          onConfirm={() => { setValues({}); setDrafts({}); setClearing(false) }}
        />
      </TableCell>
      {horizon.months.map((month) => (
        <React.Fragment key={month}>
          {weeks.map((week) => {
            const key = scheduleKey(month, week)
            const draft = drafts[key]
            return (
              <TableCell
                key={week}
                className={cn("px-0.5 py-1", week === 1 && isQuarterStart(month) && "border-l border-[var(--color-border-strong)]")}
              >
                <Input
                  type="text"
                  inputMode="decimal"
                  value={draft ?? (values[key] ? String(values[key]) : "")}
                  error={draft !== undefined}
                  onChange={(event) => setCell(month, week, event.target.value)}
                  title={`${PLAN_MONTH_LABELS[month - 1]} · Semana ${week}`}
                  aria-label={`N°${activity.n} ${activity.activity} · ${PLAN_MONTH_LABELS[month - 1]} · Semana ${week}`}
                  data-plan-cell={key}
                  className="h-7 w-11 px-1 text-center text-[11px] sm:h-7 sm:text-[11px]"
                />
              </TableCell>
            )
          })}
        </React.Fragment>
      ))}
      <TableCellNum className="text-xs">{formatPlannedTotal(rowTotal)}</TableCellNum>
    </TableRow>
  )
}

function RowStatusBadge({ status, isDirty, conflict }: {
  status: ReturnType<typeof useDebouncedAutosave>["status"]
  isDirty: boolean
  conflict: boolean
}) {
  if (conflict) return <Badge variant="danger" size="sm">Cambió en otra sesión</Badge>
  if (status === "error") return <Badge variant="danger" size="sm">Error al guardar</Badge>
  if (status === "saving") return <Badge variant="neutral" size="sm">Guardando…</Badge>
  if (isDirty) return <Badge variant="warning" size="sm">Sin guardar</Badge>
  return null
}
