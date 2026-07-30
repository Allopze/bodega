"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import {
  updatePdtpActivityAction,
  duplicatePdtpActivityAction,
  batchUpdatePdtpActivitiesAction,
  deletePdtpActivityAction,
  reorderPdtpActivitiesAction,
} from "../../../actions"
import { describePdtpRecurrenceImpact, type PdtpRecurrenceFrequency, type PdtpRecurrenceRule } from "@/lib/services/pdtp/recurrence"
import { todayLocalISO } from "@/lib/sst/date"
import { formatDate } from "@/lib/utils"


import type { PdtpActivityRow } from "./types"

export function ActividadesTab({
  programId,
  programYear,
  periodStart,
  periodEnd,
  activities,
  responsibleCatalog,
}: {
  programId: string
  programYear: number
  periodStart: string | null
  periodEnd: string | null
  activities: PdtpActivityRow[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
}) {
  const router = useRouter()
  const effectivePeriodStart = periodStart ?? `${programYear}-01-01`
  const effectivePeriodEnd = periodEnd ?? `${programYear}-12-31`
  const defaultRetirementDate = (() => {
    const today = todayLocalISO()
    return today >= effectivePeriodStart && today <= effectivePeriodEnd ? today : effectivePeriodStart
  })()
  const [items, setItems] = React.useState(activities)
  const [editing, setEditing] = React.useState<PdtpActivityRow | null>(null)
  const [retiring, setRetiring] = React.useState<PdtpActivityRow | null>(null)
  const [retirementReason, setRetirementReason] = React.useState("")
  const [retirementDate, setRetirementDate] = React.useState(defaultRetirementDate)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [batchOpen, setBatchOpen] = React.useState(false)

  // Ver nota en WorksiteScopePanel: `activities` cambia de identidad en cada
  // render, así que el efecto descartaba el reordenamiento optimista en curso.
  const savedActivities = JSON.stringify(activities)
  const [lastSavedActivities, setLastSavedActivities] = React.useState(savedActivities)
  if (lastSavedActivities !== savedActivities) {
    setLastSavedActivities(savedActivities)
    setItems(activities)
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setItems(next)
    setBusyId(next[target]!.id)
    setError(null)
    try {
      const result = await reorderPdtpActivitiesAction({ programId, orderedIds: next.map((a) => a.id) })
      if (!result.ok) {
        setError(result.message ?? "Error al reordenar.")
        setItems(activities)
      } else {
        router.refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleRetire(activityId: string) {
    setBusyId(activityId)
    setError(null)
    try {
      const result = await deletePdtpActivityAction({
        activityId,
        reason: retirementReason,
        effectiveFrom: retirementDate,
      })
      if (!result.ok) {
        setError(result.message ?? "No se pudo retirar la actividad.")
      } else {
        setRetiring(null)
        setRetirementReason("")
        setRetirementDate(defaultRetirementDate)
        router.refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleDuplicate(activityId: string) {
    setBusyId(activityId)
    setError(null)
    try {
      const result = await duplicatePdtpActivityAction({ activityId })
      if (!result.ok) setError(result.message ?? "Error al duplicar la actividad.")
      else router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const selectedIdSet = new Set(selectedIds)

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-xs text-[var(--color-text-muted)]">{selectedIds.length} actividad(es) seleccionadas</p>
          <Button type="button" size="sm" variant="secondary" disabled={selectedIds.length === 0} onClick={() => setBatchOpen(true)}>Editar selección</Button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          Sin actividades. Agrega una actividad para comenzar a ajustar este programa anual.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-2)] th-type">
              <tr>
                <th scope="col" className="w-10 px-3 py-2 text-left"><span className="sr-only">Seleccionar</span></th>
                <th scope="col" className="w-12 px-3 py-2 text-left">N°</th>
                <th scope="col" className="px-3 py-2 text-left">Actividad</th>
                <th scope="col" className="px-3 py-2 text-left">Guía de ejecución</th>
                <th scope="col" className="w-56 px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.map((activity, index) => (
                <tr key={activity.id} className={activity.status === "retired" ? "bg-[var(--color-surface-2)] opacity-70" : "bg-[var(--color-surface)]"}>
                  <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" aria-label={`Seleccionar actividad ${activity.n}`} disabled={activity.status === "retired"} checked={selectedIdSet.has(activity.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, activity.id] : current.filter((id) => id !== activity.id))} /></td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-subtle)]">{activity.n}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                      {activity.status === "retired" && <Badge variant="outline">Retirada</Badge>}
                    </div>
                    {activity.status === "retired" && activity.retiredReason && (
                      <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                        Desde {activity.retiredEffectiveFrom ? formatDate(activity.retiredEffectiveFrom) : "fecha no disponible"} · {activity.retiredReason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{activity.program}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired" || index === 0} onClick={() => move(index, -1)} aria-label="Subir">↑</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired" || index === items.length - 1} onClick={() => move(index, 1)} aria-label="Bajar">↓</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired"} onClick={() => handleDuplicate(activity.id)}>Duplicar</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired"} onClick={() => setEditing(activity)}>Editar</Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busyId !== null || activity.status === "retired"}
                        onClick={() => {
                          setRetirementDate(defaultRetirementDate)
                          setRetiring(activity)
                        }}
                      >
                        Retirar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditActivityDialog activity={editing} onClose={() => setEditing(null)} onSaved={() => router.refresh()} />
      <BatchEditActivitiesDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        programId={programId}
        activityIds={selectedIds}
        responsibleCatalog={responsibleCatalog}
        onSaved={() => { setSelectedIds([]); router.refresh() }}
      />

      <Dialog open={retiring !== null} onOpenChange={(open) => { if (!open) setRetiring(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retirar actividad N°{retiring?.n}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-text-muted)]">
            El retiro detiene obligaciones futuras, pero conserva el número, la planificación histórica y todas las ejecuciones registradas.
          </p>
          <FieldGroup className="gap-3">
            <Field label="Fecha efectiva" htmlFor="retirement-date" required>
              <DatePicker
                id="retirement-date"
                value={retirementDate}
                onChange={setRetirementDate}
                min={effectivePeriodStart}
                max={effectivePeriodEnd}
                ariaLabel="Fecha efectiva"
              />
            </Field>
            <Field label="Motivo del retiro" htmlFor="retirement-reason" required>
              <Textarea id="retirement-reason" value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} minLength={10} maxLength={3000} required />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRetiring(null)} disabled={busyId !== null}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={() => retiring && handleRetire(retiring.id)} disabled={busyId !== null || retirementReason.trim().length < 10 || !retirementDate}>
              {busyId !== null ? "Retirando..." : "Retirar actividad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BatchEditActivitiesDialog({ open, onOpenChange, programId, activityIds, responsibleCatalog, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  activityIds: string[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  onSaved: () => void
}) {
  const [responsible, setResponsible] = React.useState("keep")
  const [replaceEvidence, setReplaceEvidence] = React.useState(false)
  const [evidence, setEvidence] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function save() {
    const targetResponsible = responsible === "keep" ? undefined : responsibleCatalog.find((item) => item.slug === responsible)
    setPending(true)
    setError(null)
    try {
      const result = await batchUpdatePdtpActivitiesAction({
        programId,
        activityIds,
        responsibleSlugs: targetResponsible ? [targetResponsible.slug] : undefined,
        responsibleDisplay: targetResponsible?.displayName,
        evidenceRequirement: replaceEvidence ? evidence : undefined,
      })
      if (!result.ok) setError(result.message ?? "No se pudo editar la selección.")
      else { onOpenChange(false); onSaved() }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar {activityIds.length} actividades</DialogTitle></DialogHeader>
        <FieldGroup className="gap-4">
          <Field label="Cambiar responsable" htmlFor="batch-responsible">
            <Select value={responsible} onValueChange={setResponsible}>
              <SelectTrigger id="batch-responsible"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="keep">Sin cambio</SelectItem>{responsibleCatalog.map((item) => <SelectItem key={item.slug} value={item.slug}>{item.displayName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]"><input type="checkbox" checked={replaceEvidence} onChange={(event) => setReplaceEvidence(event.target.checked)} /> Reemplazar evidencia mínima</label>
          {replaceEvidence && <Textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={3000} placeholder="Evidencia mínima común para la selección" />}
          <p className="text-xs text-[var(--color-text-muted)]">Solo se cambian los campos indicados. Calendario, vistas, checklist y ejecuciones permanecen asociados.</p>
          {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={pending}>{pending ? "Aplicando..." : "Aplicar cambios"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditActivityDialog({ activity, onClose, onSaved }: {
  activity: PdtpActivityRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [activityText, setActivityText] = React.useState("")
  const [executionGuidance, setExecutionGuidance] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [scheduleMode, setScheduleMode] = React.useState<"scheduled" | "on_demand" | "triggered">("scheduled")
  const [frequency, setFrequency] = React.useState<PdtpRecurrenceFrequency>("monthly")
  const [interval, setRecurrenceInterval] = React.useState(1)
  const [plannedQuantity, setPlannedQuantity] = React.useState(1)
  const [weekOfMonth, setWeekOfMonth] = React.useState(1)
  const [triggerDescription, setTriggerDescription] = React.useState("")
  const [dueDays, setDueDays] = React.useState(5)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [prevActivity, setPrevActivity] = React.useState(activity)
  if (activity !== prevActivity) {
    setPrevActivity(activity)
    if (activity) {
      setActivityText(activity.activity)
      setExecutionGuidance(activity.program)
      setNotes(activity.notes ?? "")
      setScheduleMode((activity.scheduleMode ?? "scheduled") as "scheduled" | "on_demand" | "triggered")
      const rule = activity.recurrenceRule as PdtpRecurrenceRule | null
      setFrequency(rule?.frequency ?? "monthly")
      setRecurrenceInterval(rule?.interval ?? 1)
      setPlannedQuantity(rule?.plannedQuantity ?? 1)
      setWeekOfMonth(rule?.weekOfMonth ?? 1)
      setTriggerDescription(activity.triggerDescription ?? "")
      setDueDays(activity.dueDays ?? 5)
      setError(null)
    }
  }

  async function handleSave() {
    if (!activity) return
    setPending(true)
    setError(null)
    try {
      const recurrenceRule: PdtpRecurrenceRule | null = scheduleMode === "scheduled"
        ? { frequency, interval, plannedQuantity, weekOfMonth }
        : null
      const result = await updatePdtpActivityAction({
        activityId: activity.id,
        activity: activityText,
        program: executionGuidance,
        notes,
        scheduleMode,
        scheduleClassificationStatus: "confirmed",
        recurrenceRule,
        triggerDescription: scheduleMode === "triggered" ? triggerDescription : null,
        dueDays: scheduleMode === "scheduled" ? null : dueDays,
      })
      if (!result.ok) {
        setError(result.message ?? "Error al guardar.")
      } else {
        onSaved()
        onClose()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={activity !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar actividad N°{activity?.n}</DialogTitle>
        </DialogHeader>
        <FieldGroup className="gap-3">
          <Field label="Actividad preventiva" htmlFor="edit-activity">
            <Textarea id="edit-activity" value={activityText} onChange={(e) => setActivityText(e.target.value)} rows={4} maxLength={4000} />
          </Field>
          <Field label="Guía de ejecución" htmlFor="edit-execution-guidance">
            <Textarea id="edit-execution-guidance" value={executionGuidance} onChange={(e) => setExecutionGuidance(e.target.value)} rows={3} maxLength={2000} />
          </Field>
          <Field label="Cuándo se realiza" htmlFor="edit-schedule-mode">
            <Select value={scheduleMode} onValueChange={(value) => setScheduleMode(value as typeof scheduleMode)}>
              <SelectTrigger id="edit-schedule-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Con frecuencia</SelectItem>
                <SelectItem value="on_demand">Cuando se necesite</SelectItem>
                <SelectItem value="triggered">Cuando ocurra un evento</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {scheduleMode === "scheduled" ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Frecuencia" htmlFor="edit-frequency">
                <Select value={frequency} onValueChange={(value) => setFrequency(value as PdtpRecurrenceFrequency)}>
                  <SelectTrigger id="edit-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensual</SelectItem>
                    <SelectItem value="quarterly">Trimestral</SelectItem>
                    <SelectItem value="semiannual">Semestral</SelectItem>
                    <SelectItem value="annual">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cada" htmlFor="edit-interval"><Input id="edit-interval" type="number" min={1} max={52} value={interval} onChange={(event) => setRecurrenceInterval(Number(event.target.value))} /></Field>
              <Field label="Cantidad" htmlFor="edit-planned-quantity"><Input id="edit-planned-quantity" type="number" min={0.01} step={0.25} value={plannedQuantity} onChange={(event) => setPlannedQuantity(Number(event.target.value))} /></Field>
              <Field label="Semana" htmlFor="edit-week"><Input id="edit-week" type="number" min={1} max={4} value={weekOfMonth} onChange={(event) => setWeekOfMonth(Number(event.target.value))} /></Field>
            </div>
          ) : scheduleMode === "triggered" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label="Evento disparador" htmlFor="edit-trigger" required><Input id="edit-trigger" value={triggerDescription} onChange={(event) => setTriggerDescription(event.target.value)} required /></Field>
              <Field label="Plazo (días)" htmlFor="edit-trigger-days"><Input id="edit-trigger-days" type="number" min={0} max={3650} value={dueDays} onChange={(event) => setDueDays(Number(event.target.value))} /></Field>
            </div>
          ) : (
            <Field label="Plazo objetivo cuando haya un caso" htmlFor="edit-demand-days"><Input id="edit-demand-days" type="number" min={0} max={3650} value={dueDays} onChange={(event) => setDueDays(Number(event.target.value))} /></Field>
          )}
          {activity && <RecurrenceImpactPreview
            activity={activity}
            nextMode={scheduleMode}
            nextRule={scheduleMode === "scheduled" ? { frequency, interval, plannedQuantity, weekOfMonth } : null}
          />}
          <Field label="Notas" htmlFor="edit-notes">
            <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          {error && (
            <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={pending}>{pending ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecurrenceImpactPreview({
  activity,
  nextMode,
  nextRule,
}: {
  activity: PdtpActivityRow
  nextMode: "scheduled" | "on_demand" | "triggered"
  nextRule: PdtpRecurrenceRule | null
}) {
  const currentRule = activity.recurrenceRule as PdtpRecurrenceRule | null
  const { currentCount, nextCount, changed } = describePdtpRecurrenceImpact(
    (activity.scheduleMode ?? "scheduled") as "scheduled" | "on_demand" | "triggered",
    currentRule,
    nextMode,
    nextRule,
  )
  return (
    <p className="rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-3 py-2 text-xs text-[var(--color-info-ink)]">
      {changed
        ? `Impacto antes de guardar: pasará de ${currentCount} a ${nextCount} obligación(es) calendarizadas; las ejecuciones existentes no se modifican.`
        : `${nextCount} obligación(es) calendarizadas; no hay cambio de recurrencia pendiente.`}
    </p>
  )
}
