"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Callout } from "@/components/ui/callout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { cn, MONTH_LABELS, pluralize } from "@/lib/utils"
import type { PdtpScheduleHorizon } from "@/lib/services/pdtp/recurrence"
import {
  PDTP_SCHEDULE_PRESETS,
  type PdtpSchedulePresetKey,
  type PdtpSchedulePresetParams,
} from "@/lib/services/pdtp/schedule-presets"
// `import type`: se borra por completo en el bundle de cliente (Next/SWC lo
// elide porque es un tipo, no un valor), así que traer el tipo desde el
// mismo módulo que el servicio usa —aunque ese módulo importe `@/db`— no
// arrastra nada al navegador. Derivarlo así, en vez de duplicar la unión de
// motivos a mano, evita que un motivo nuevo se degrade en silencio al texto
// genérico de `describeScheduleBatchSkipReason`.
import type { PdtpScheduleBatchSkipReason } from "@/lib/services/pdtp/schedule-batch"
import { applyPdtpSchedulePresetAction } from "../../actions"

type SkipEntry = { activityId: string; n: number; reason: PdtpScheduleBatchSkipReason }

/**
 * Copy en español de cada motivo de omisión que
 * `applyPdtpSchedulePresetToActivities` (Tarea 2.3) devuelve — nunca se
 * muestra el enum crudo (`manual_schedule_would_be_replaced`, etc.) en
 * pantalla. `preset_produced_no_cells` explica el POR QUÉ (rango de meses
 * fuera del período del programa), no sólo que "no se aplicó" — es el motivo
 * menos obvio de los cuatro.
 */
export function describeScheduleBatchSkipReason(reason: PdtpScheduleBatchSkipReason): string {
  switch (reason) {
    case "manual_schedule_would_be_replaced":
      return "Tiene una planificación hecha a mano que este patrón reemplazaría."
    case "retired":
      return "Está retirada."
    case "not_scheduled_mode":
      return "Es a demanda o por evento: no se planifica con celdas."
    case "preset_produced_no_cells":
      return "El patrón elegido no genera ninguna semana dentro del período del programa (por ejemplo, una campaña cuyo rango de meses no cae dentro del período declarado)."
    default:
      return "No se pudo aplicar."
  }
}

/**
 * Parámetros iniciales razonables por preset — sólo lo que cada uno necesita
 * según `PDTP_SCHEDULE_PRESETS[].needs`. Exportada para que el menú rápido
 * por fila de `planificacion-tab.tsx` arranque su submenú con los mismos
 * valores por defecto que este diálogo, en vez de duplicar la lista.
 */
export function defaultParamsFor(preset: PdtpSchedulePresetKey): PdtpSchedulePresetParams {
  switch (preset) {
    case "daily":
      return { plannedQuantity: 5 }
    case "monthly_week":
      return { weekOfMonth: 1 }
    case "campaign":
      return { monthFrom: 1, monthTo: 2 }
    case "punctual":
      return { cells: [] }
    default:
      return {}
  }
}

/**
 * Campos de parámetros para un preset, según lo que declara
 * `PDTP_SCHEDULE_PRESETS[].needs`. Sin campos si el preset no necesita
 * ninguno (`weekly`, `biweekly_13`, `biweekly_24`, `quarterly`). Se usa tanto
 * en este diálogo (aplicación masiva) como en el menú rápido por fila de
 * `planificacion-tab.tsx` — un solo lugar que sabe qué pedir por preset.
 */
export function PresetParamsFields({ preset, params, onChange, horizon }: {
  preset: PdtpSchedulePresetKey
  params: PdtpSchedulePresetParams
  onChange: (next: PdtpSchedulePresetParams) => void
  horizon: PdtpScheduleHorizon
}) {
  const needs = PDTP_SCHEDULE_PRESETS.find((option) => option.key === preset)?.needs ?? []
  if (needs.length === 0) return null

  return (
    <div className="space-y-3">
      {needs.includes("weekOfMonth") && (
        <label className="block text-xs font-medium text-[var(--color-text-muted)]">
          Semana del mes
          <Select value={String(params.weekOfMonth ?? 1)} onValueChange={(value) => onChange({ ...params, weekOfMonth: Number(value) })}>
            <SelectTrigger className="mt-1" aria-label="Semana del mes"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((week) => <SelectItem key={week} value={String(week)}>Semana {week}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      )}
      {needs.includes("plannedQuantity") && (
        <label className="block text-xs font-medium text-[var(--color-text-muted)]">
          Cantidad por semana
          <Input
            type="number"
            min={1}
            step={1}
            className="mt-1"
            value={params.plannedQuantity ?? ""}
            onChange={(event) => onChange({ ...params, plannedQuantity: event.target.value === "" ? undefined : Number(event.target.value) })}
          />
        </label>
      )}
      {(needs.includes("monthFrom") || needs.includes("monthTo")) && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-[var(--color-text-muted)]">
            Desde
            <Select value={String(params.monthFrom ?? 1)} onValueChange={(value) => onChange({ ...params, monthFrom: Number(value) })}>
              <SelectTrigger className="mt-1" aria-label="Mes desde"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block text-xs font-medium text-[var(--color-text-muted)]">
            Hasta
            <Select value={String(params.monthTo ?? 12)} onValueChange={(value) => onChange({ ...params, monthTo: Number(value) })}>
              <SelectTrigger className="mt-1" aria-label="Mes hasta"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        </div>
      )}
      {needs.includes("cells") && (
        <PunctualCellGrid
          horizon={horizon}
          cells={params.cells ?? []}
          onChange={(cells) => onChange({ ...params, cells })}
        />
      )}
    </div>
  )
}

function PunctualCellGrid({ horizon, cells, onChange }: {
  horizon: PdtpScheduleHorizon
  cells: Array<{ month: number; week: number }>
  onChange: (cells: Array<{ month: number; week: number }>) => void
}) {
  const selected = new Set(cells.map((cell) => `${cell.month}-${cell.week}`))
  const weeks = Array.from({ length: horizon.weeksPerMonth }, (_, index) => index + 1)

  function toggle(month: number, week: number) {
    const key = `${month}-${week}`
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange([...next].map((entry) => {
      const [monthPart, weekPart] = entry.split("-").map(Number)
      return { month: monthPart!, week: weekPart! }
    }))
  }

  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-text-muted)]">
        Semanas elegidas ({cells.length})
      </p>
      <div className="mt-1 grid max-h-48 grid-cols-4 gap-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-2 sm:grid-cols-6">
        {horizon.months.flatMap((month) => weeks.map((week) => {
          const key = `${month}-${week}`
          const isChecked = selected.has(key)
          return (
            <button
              type="button"
              key={key}
              onClick={() => toggle(month, week)}
              aria-pressed={isChecked}
              className={cn(
                "rounded-[var(--radius-sm)] border px-1 py-1 font-mono text-[10px]",
                isChecked
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              {MONTH_LABELS[month - 1]} S{week}
            </button>
          )
        }))}
      </div>
    </div>
  )
}

type SelectedActivity = { id: string; n: number; activity: string }

type BatchActionResult = {
  ok: boolean
  message?: string
  data?: { applied?: string[]; skippedConflicts?: SkipEntry[] }
}

/**
 * Aplica un preset de planificación a varias actividades a la vez.
 *
 * Flujo de confirmación (Tarea 2.3, corrección respecto al brief original):
 * el servicio no recibe un booleano "confirmar reemplazo" — un "sí" global
 * autorizaría a reemplazar actividades que se volvieron manuales mientras el
 * usuario decidía, o que ni siquiera revisó. En su lugar:
 *
 *   1. Se aplica sin confirmación.
 *   2. El servicio devuelve `skippedConflicts`: actividades con planificación
 *      manual que el patrón habría reemplazado, sin tocarlas.
 *   3. Este diálogo MUESTRA esas actividades (número + nombre, nunca sólo su
 *      id) con una casilla por cada una, marcadas por defecto.
 *   4. Al confirmar, se reenvía `replaceConfirmedActivityIds` con SÓLO los
 *      ids que quedaron marcados — nunca la selección original completa.
 *
 * El resultado final (aplicadas/omitidas) se comunica con un toast, no
 * quedándose en una pantalla dentro del diálogo. En pruebas E2E el botón
 * "Cerrar" de una pantalla de resultado quedaba "detached from the DOM" justo
 * después de aplicar. La causa era que la plataforma entera se volvía a montar
 * con cada Server Action que revalida (`AppShell` exportado como objeto
 * `memo`, ya corregido: ver `lib/__tests__/client-memo-boundary.test.ts`). El
 * diálogo se cierra explícitamente al decidir el resultado final.
 */
export function ApplyPresetDialog({
  programId,
  open,
  onOpenChange,
  activities,
  horizon,
  onApplied,
}: {
  programId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Actividades seleccionadas en la tabla al momento de abrir el diálogo. */
  activities: SelectedActivity[]
  horizon: PdtpScheduleHorizon
  /** Se invoca tras cada aplicación exitosa (con o sin conflictos
   *  pendientes) — la pestaña la usa para vaciar la selección. */
  onApplied?: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [preset, setPreset] = React.useState<PdtpSchedulePresetKey>("weekly")
  const [params, setParams] = React.useState<PdtpSchedulePresetParams>({})
  const [mode, setMode] = React.useState<"replace" | "fill_empty">("replace")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [manualConflicts, setManualConflicts] = React.useState<SkipEntry[] | null>(null)
  const [confirmSelected, setConfirmSelected] = React.useState<Set<string>>(new Set())
  // Acumulado entre la aplicación inicial y una eventual confirmación de
  // reemplazo: el toast final debe reflejar las DOS llamadas, no sólo la
  // última.
  const [otherSkips, setOtherSkips] = React.useState<SkipEntry[]>([])
  const [appliedCount, setAppliedCount] = React.useState(0)

  function resetState() {
    setPreset("weekly")
    setParams({})
    setMode("replace")
    setErrorMessage(null)
    setManualConflicts(null)
    setConfirmSelected(new Set())
    setOtherSkips([])
    setAppliedCount(0)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState()
    onOpenChange(next)
  }

  function selectPreset(next: PdtpSchedulePresetKey) {
    setPreset(next)
    setParams(defaultParamsFor(next))
  }

  function handleResult(result: BatchActionResult, appliedSoFar: number, skipsSoFar: SkipEntry[]) {
    if (!result.ok) {
      setErrorMessage(result.message ?? "No se pudo aplicar el patrón.")
      return
    }
    const applied = result.data?.applied ?? []
    const skipped = result.data?.skippedConflicts ?? []
    const manual = skipped.filter((skip) => skip.reason === "manual_schedule_would_be_replaced")
    const others = skipped.filter((skip) => skip.reason !== "manual_schedule_would_be_replaced")
    const totalApplied = appliedSoFar + applied.length
    const totalOthers = [...skipsSoFar, ...others]
    setAppliedCount(totalApplied)
    setOtherSkips(totalOthers)
    if (manual.length > 0) {
      setManualConflicts(manual)
      setConfirmSelected(new Set(manual.map((skip) => skip.activityId)))
    } else {
      finish(totalApplied, totalOthers)
    }
  }

  function finish(finalApplied: number, finalOtherSkips: SkipEntry[]) {
    const base = `${finalApplied} ${pluralize(finalApplied, "actividad actualizada", "actividades actualizadas")}.`
    if (finalOtherSkips.length === 0) {
      toast.success(base)
    } else {
      const detail = finalOtherSkips.map((skip) => `N°${skip.n}: ${describeScheduleBatchSkipReason(skip.reason)}`).join(" · ")
      const message = `${base} ${finalOtherSkips.length} sin cambios — ${detail}`
      if (finalApplied > 0) toast.success(message)
      else toast(message)
    }
    router.refresh()
    handleOpenChange(false)
    onApplied?.()
  }

  function submit() {
    setErrorMessage(null)
    startTransition(async () => {
      const result = await applyPdtpSchedulePresetAction({
        programId,
        activityIds: activities.map((activity) => activity.id),
        preset,
        params,
        mode,
      })
      handleResult(result as BatchActionResult, appliedCount, otherSkips)
    })
  }

  function toggleConfirm(activityId: string, checked: boolean) {
    setConfirmSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(activityId)
      else next.delete(activityId)
      return next
    })
  }

  function confirmReplace() {
    const ids = [...confirmSelected]
    if (ids.length === 0) return
    setErrorMessage(null)
    // No se limpia `manualConflicts` acá: hacerlo antes de que vuelva la
    // respuesta mostraba de nuevo el formulario del preset con "Cancelar"
    // habilitado durante el viaje al servidor, como si la decisión de
    // reemplazo nunca se hubiera tomado. La pantalla de conflicto se queda
    // (con los controles deshabilitados, ver más abajo) hasta que
    // `handleResult` la reemplace por la respuesta real —una nueva lista de
    // conflictos, si los hay, o el cierre del diálogo si no.
    startTransition(async () => {
      const result = await applyPdtpSchedulePresetAction({
        programId,
        activityIds: ids,
        preset,
        params,
        mode,
        replaceConfirmedActivityIds: ids,
      })
      handleResult(result as BatchActionResult, appliedCount, otherSkips)
    })
  }

  const activityCount = activities.length
  // La lista de conflictos sólo trae `activityId`/`n`/`reason` (ver
  // `PdtpScheduleBatchResult`); el nombre sale de la selección que este
  // diálogo ya tiene en memoria, para que el usuario decida qué reemplazar
  // leyendo la actividad, no sólo un número.
  const activityById = new Map(activities.map((activity) => [activity.id, activity]))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar patrón de planificación</DialogTitle>
          <DialogDescription>
            {manualConflicts
              ? "Algunas actividades tienen planificación hecha a mano."
              : `Se aplicará a ${activityCount} ${pluralize(activityCount, "actividad seleccionada", "actividades seleccionadas")}.`}
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <Callout tone="danger" role="alert" className="mb-3 text-xs">
            {errorMessage}
          </Callout>
        )}

        {manualConflicts ? (
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Elige cuáles reemplazar. Sólo se reemplaza lo que dejes marcado; el resto conserva su planificación manual.
            </p>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
              {manualConflicts.map((skip) => {
                const activityName = activityById.get(skip.activityId)?.activity
                return (
                  <li key={skip.activityId}>
                    <Checkbox
                      label={`N°${skip.n}${activityName ? ` — ${activityName}` : ""} — ${describeScheduleBatchSkipReason(skip.reason)}`}
                      checked={confirmSelected.has(skip.activityId)}
                      disabled={pending}
                      onChange={(event) => toggleConfirm(skip.activityId, event.target.checked)}
                    />
                  </li>
                )
              })}
            </ul>
            {otherSkips.length > 0 && (
              <ul className="space-y-1 text-xs text-[var(--color-text-muted)]">
                {otherSkips.map((skip) => (
                  <li key={skip.activityId}>N°{skip.n}: {describeScheduleBatchSkipReason(skip.reason)}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-[var(--color-text-muted)]">
              Patrón
              <Select value={preset} onValueChange={(value) => selectPreset(value as PdtpSchedulePresetKey)}>
                <SelectTrigger className="mt-1" aria-label="Patrón"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PDTP_SCHEDULE_PRESETS.map((option) => (
                    <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <PresetParamsFields preset={preset} params={params} onChange={setParams} horizon={horizon} />

            <label className="block text-xs font-medium text-[var(--color-text-muted)]">
              Actividades ya planificadas
              <Select value={mode} onValueChange={(value) => setMode(value as "replace" | "fill_empty")}>
                <SelectTrigger className="mt-1" aria-label="Actividades ya planificadas"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace">Reemplazar su planificación</SelectItem>
                  <SelectItem value="fill_empty">No tocarlas (sólo llenar las vacías)</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        )}

        <DialogFooter>
          {manualConflicts ? (
            <>
              {/* Las manuales que el usuario decide NO reemplazar quedan
                  mencionadas en el aviso final igual que cualquier otra
                  omisión — "no reemplazar" no es "olvidar que existían". */}
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => finish(appliedCount, [...otherSkips, ...(manualConflicts ?? [])])}
              >
                No reemplazar
              </Button>
              <Button type="button" disabled={pending || confirmSelected.size === 0} aria-busy={pending} onClick={confirmReplace}>
                {pending ? "Reemplazando…" : "Reemplazar manuales"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Cancelar</Button>
              <Button type="button" disabled={pending || activityCount === 0} onClick={submit}>Aplicar</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
