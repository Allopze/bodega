"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MetaBadge } from "@/components/states/state-badge"
import {
  updatePdtpActivityAction,
  duplicatePdtpActivityAction,
  batchUpdatePdtpActivitiesAction,
  deletePdtpActivityAction,
  reorderPdtpActivitiesAction,
  adoptLatestCatalogRevisionAction,
  setPdtpActivityObjectiveAction,
} from "../../../actions"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import type { PdtpObjective } from "@/lib/services/prevention-pdtp"
import {
  derivePdtpScheduleSource,
  deriveScheduleHorizon,
  describePdtpRecurrenceImpact,
  diffScheduleCells,
  projectRecurrenceToLegacySchedule,
  recurrenceRulesEqual,
  type PdtpRecurrenceFrequency,
  type PdtpRecurrenceRule,
  type PdtpScheduleCell,
  type PdtpScheduleHorizon,
} from "@/lib/services/pdtp/recurrence"
import type { PdtpScheduleDefinition } from "@/lib/services/pdtp/schedule-definition"
import type { PdtpCompletionPolicy } from "@/lib/services/pdtp/connectors"
import { todayLocalISO } from "@/lib/sst/date"
import { formatDate, MONTH_LABELS } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { pdtpActivityExecutionConfigs, pdtpActivityReminderRules } from "@/db/schema"
import { DialogDescription } from "@/components/ui/dialog"
import { PdtpActivityCreator, type PdtpActivityCreatorInitialValue } from "@/components/prevention/pdtp-activity-creator"


import type { PdtpActivityRow, PdtpScheduleRow } from "./types"

export function ActividadesTab({
  programId,
  programYear,
  periodStart,
  periodEnd,
  activities,
  schedule,
  responsibleCatalog,
  catalogActivities,
  connectors = [],
  instruments = [],
  activityExecutionConfigs = [],
  activityReminderRules = [],
  onSaved,
  objectives = [],
}: {
  programId: string
  programYear: number
  periodStart: string | null
  periodEnd: string | null
  activities: PdtpActivityRow[]
  /** Celdas del año del programa. El diálogo de edición las necesita para saber
   *  si la planificación vigente se ajustó a mano antes de reemplazarla. */
  schedule: PdtpScheduleRow[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  connectors?: Array<{
    key: string
    label: string
    moduleHref: string
    supportedEvents: Array<{ key: string; label: string }>
    supportedBindingSourceTypes: readonly string[]
    supportedCompletionPolicies: readonly import("@/lib/services/pdtp/connectors").PdtpCompletionPolicy[]
    supportedEvidenceKinds: readonly import("@/lib/services/pdtp/connectors").PdtpEvidenceKind[]
  }>
  instruments?: Array<{ id: string; label: string; sourceType: string; catalogActivityId: string }>
  activityExecutionConfigs?: Array<typeof pdtpActivityExecutionConfigs.$inferSelect>
  activityReminderRules?: Array<typeof pdtpActivityReminderRules.$inferSelect>
  onSaved?: () => void
  /** Sin objetivos, la columna y el select por fila no se muestran: la tabla
   *  se ve igual que antes de que este programa tuviera objetivos. */
  objectives?: PdtpObjective[]
}) {
  const router = useRouter()
  const effectivePeriodStart = periodStart ?? `${programYear}-01-01`
  const effectivePeriodEnd = periodEnd ?? `${programYear}-12-31`
  const defaultRetirementDate = (() => {
    const today = todayLocalISO()
    return today >= effectivePeriodStart && today <= effectivePeriodEnd ? today : effectivePeriodStart
  })()
  const horizon = React.useMemo(
    () => deriveScheduleHorizon({ year: programYear, periodStart, periodEnd }),
    [programYear, periodStart, periodEnd],
  )
  const cellsByActivity = React.useMemo(() => {
    const map = new Map<string, PdtpScheduleCell[]>()
    for (const cell of schedule) {
      const cells = map.get(cell.activityId) ?? []
      cells.push({ month: cell.month, week: cell.week, plannedQuantity: Number(cell.plannedQuantity) })
      map.set(cell.activityId, cells)
    }
    return map
  }, [schedule])
  const [items, setItems] = React.useState(activities)
  const [editing, setEditing] = React.useState<PdtpActivityRow | null>(null)
  const [modernEditing, setModernEditing] = React.useState<PdtpActivityRow | null>(null)
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

  async function handleAdoptRevision(activityId: string) {
    setBusyId(activityId)
    setError(null)
    try {
      const result = await adoptLatestCatalogRevisionAction({ activityId })
      if (!result.ok) setError(result.message ?? "No se pudo adoptar la revisión.")
      else router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function handleSetObjective(activityId: string, objectiveId: string | null) {
    setBusyId(activityId)
    setError(null)
    try {
      const result = await setPdtpActivityObjectiveAction({ programId, activityId, objectiveId })
      if (!result.ok) setError(result.message ?? "No se pudo actualizar el objetivo.")
      else router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const selectedIdSet = new Set(selectedIds)
  const hasObjectives = objectives.length > 0
  const configByActivity = React.useMemo(() => new Map(activityExecutionConfigs.map((config) => [config.activityId, config])), [activityExecutionConfigs])
  const remindersByActivity = React.useMemo(() => {
    const map = new Map<string, typeof activityReminderRules>()
    for (const rule of activityReminderRules) map.set(rule.activityId, [...(map.get(rule.activityId) ?? []), rule])
    return map
  }, [activityReminderRules])

  function modernInitialValue(activity: PdtpActivityRow): PdtpActivityCreatorInitialValue {
    const config = configByActivity.get(activity.id)
    const acceptedEvidenceKinds = Array.isArray(config?.acceptedEvidenceKinds)
      ? config.acceptedEvidenceKinds.filter((kind): kind is "file" | "photo" | "checklist" | "signature" | "generated_record" => typeof kind === "string")
      : []
    return {
      id: activity.id,
      n: activity.n,
      catalogActivityId: activity.catalogActivityId,
      activity: activity.activity,
      program: activity.program,
      responsibleSlugs: Array.isArray(activity.responsibleSlugs) ? activity.responsibleSlugs.filter((value): value is string => typeof value === "string") : [],
      audienceRoles: Array.isArray(activity.audienceRoles) ? activity.audienceRoles.filter((value): value is string => typeof value === "string") : [],
      scheduleMode: activity.scheduleMode as "scheduled" | "on_demand" | "triggered",
      recurrenceRule: activity.recurrenceRule as PdtpActivityCreatorInitialValue["recurrenceRule"],
      scheduleDefinition: activity.scheduleDefinition as PdtpActivityCreatorInitialValue["scheduleDefinition"],
      triggerType: activity.triggerType,
      triggerDescription: activity.triggerDescription,
      dueDays: activity.dueDays,
      dueHours: activity.dueHours,
      evidenceRequirement: activity.evidenceRequirement,
      notes: activity.notes,
      executionConfig: config ? {
        destinationConnectorKey: config.destinationConnectorKey,
        accreditationBindingId: config.accreditationBindingId,
        completionPolicy: config.completionPolicy as PdtpCompletionPolicy,
        evidenceRequired: config.evidenceRequired,
        acceptedEvidenceKinds,
      } : null,
      reminderRules: (remindersByActivity.get(activity.id) ?? []).map((rule) => ({ offsetValue: rule.offsetValue, offsetUnit: rule.offsetUnit as "hour" | "day" })),
    }
  }

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
          <TableRoot className="rounded-none border-0">
          <Table className="text-sm">
            <caption className="sr-only">Actividades del programa PDTP</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">Seleccionar</span></TableHead>
                <TableHead className="w-12">N°</TableHead><TableHead>Actividad</TableHead><TableHead>Guía de ejecución</TableHead>
                {hasObjectives && <TableHead className="w-56">Objetivo</TableHead>}
                <TableHead className="w-56 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((activity, index) => {
                const catalog = catalogActivities.find((entry) => entry.id === activity.catalogActivityId)
                const hasNewRevision = Boolean(catalog && activity.catalogRevision && activity.catalogRevision < catalog.currentRevision)
                return (
                <TableRow key={activity.id} className={activity.status === "retired" ? "bg-[var(--color-surface-2)] opacity-70" : "bg-[var(--color-surface)]"}>
                  <TableCell><Checkbox labelHidden label={`Seleccionar actividad ${activity.n}`} disabled={activity.status === "retired"} checked={selectedIdSet.has(activity.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, activity.id] : current.filter((id) => id !== activity.id))} /></TableCell>
                  <TableCell className="font-mono text-xs text-[var(--color-text-subtle)]">{activity.n}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-[var(--color-text)]">{catalog?.title ?? activity.activity}</p>
                      {activity.status === "retired" && <MetaBadge meta={{ label: "Retirada", variant: "outline" }} />}
                      {activity.catalogRevision && <MetaBadge meta={{ label: `Rev. ${activity.catalogRevision}`, variant: "outline" }} />}
                    </div>
                    {catalog && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{activity.activity}</p>}
                    {activity.status === "retired" && activity.retiredReason && (
                      <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                        Desde {activity.retiredEffectiveFrom ? formatDate(activity.retiredEffectiveFrom) : "fecha no disponible"} · {activity.retiredReason}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-[var(--color-text-muted)]">{activity.program}</TableCell>
                  {hasObjectives && (
                    <TableCell>
                      <Select
                        value={activity.objectiveId ?? "none"}
                        onValueChange={(value) => handleSetObjective(activity.id, value === "none" ? null : value)}
                        disabled={busyId !== null || activity.status === "retired"}
                      >
                        <SelectTrigger aria-label={`Objetivo de la actividad ${activity.n}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin objetivo</SelectItem>
                          {objectives.map((objective) => <SelectItem key={objective.id} value={objective.id}>{objective.code} · {objective.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired" || index === 0} onClick={() => move(index, -1)} aria-label="Subir">↑</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired" || index === items.length - 1} onClick={() => move(index, 1)} aria-label="Bajar">↓</Button>
                      {!activity.catalogActivityId && <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired"} onClick={() => handleDuplicate(activity.id)}>Duplicar</Button>}
                      {hasNewRevision && <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired"} onClick={() => handleAdoptRevision(activity.id)}>Adoptar revisión</Button>}
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || activity.status === "retired"} onClick={() => {
                        const modern = activity.scheduleDefinition != null && (activity.scheduleDefinition as PdtpScheduleDefinition).kind !== "legacy_grid"
                        if (modern) setModernEditing(activity)
                        else setEditing(activity)
                      }}>{activity.scheduleDefinition != null && (activity.scheduleDefinition as PdtpScheduleDefinition).kind !== "legacy_grid" ? "Configurar" : "Editar"}</Button>
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
                  </TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </TableRoot>
        </div>
      )}

      <EditActivityDialog
        activity={editing}
        horizon={horizon}
        currentCells={editing ? cellsByActivity.get(editing.id) ?? [] : []}
        onClose={() => setEditing(null)}
        onSaved={() => router.refresh()}
      />
      <Dialog open={modernEditing !== null} onOpenChange={(open) => { if (!open) setModernEditing(null) }}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurar actividad N°{modernEditing?.n}</DialogTitle>
            <DialogDescription>Los cambios actualizan la definición futura y conservan las ejecuciones ya registradas.</DialogDescription>
          </DialogHeader>
          {modernEditing && (
            <PdtpActivityCreator
              mode="edit"
              programId={programId}
              responsibleCatalog={responsibleCatalog}
              catalogActivities={catalogActivities}
              programYear={programYear}
              programPeriodStart={periodStart}
              programPeriodEnd={periodEnd}
              connectors={connectors}
              instruments={instruments}
              initialActivity={modernInitialValue(modernEditing)}
              onSaved={() => { setModernEditing(null); onSaved?.() }}
              onCancel={() => setModernEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <BatchEditActivitiesDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        programId={programId}
        activityIds={selectedIds}
        responsibleCatalog={responsibleCatalog}
        objectives={objectives}
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

function BatchEditActivitiesDialog({ open, onOpenChange, programId, activityIds, responsibleCatalog, objectives, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  activityIds: string[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  objectives: PdtpObjective[]
  onSaved: () => void
}) {
  const [responsible, setResponsible] = React.useState("keep")
  const [replaceEvidence, setReplaceEvidence] = React.useState(false)
  const [evidence, setEvidence] = React.useState("")
  const [objective, setObjective] = React.useState("keep")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function save() {
    const targetResponsible = responsible === "keep" ? undefined : responsibleCatalog.find((item) => item.slug === responsible)
    // `undefined` = sin cambio, `null` = quitar objetivo, string = asignar.
    const objectiveChange: string | null | undefined = objective === "keep" ? undefined : objective === "none" ? null : objective
    if (!targetResponsible && !replaceEvidence && objectiveChange === undefined) {
      setError("Selecciona al menos un cambio para aplicar.")
      return
    }
    setPending(true)
    setError(null)
    try {
      // Un único envío atómico: `batchUpdatePdtpActivities` ya valida
      // pertenencia del objetivo, rechaza retiradas y escribe el UPDATE + su
      // entrada de changelog dentro de la misma transacción. Antes esto
      // disparaba N `setPdtpActivityObjectiveAction` (una por actividad
      // seleccionada) sin atomicidad: si una fallaba a mitad, las anteriores
      // ya habían escrito y la UI se quedaba sin refrescar.
      const result = await batchUpdatePdtpActivitiesAction({
        programId,
        activityIds,
        responsibleSlugs: targetResponsible ? [targetResponsible.slug] : undefined,
        responsibleDisplay: targetResponsible?.displayName,
        evidenceRequirement: replaceEvidence ? evidence : undefined,
        objectiveId: objectiveChange,
      })
      if (!result.ok) { setError(result.message ?? "No se pudo editar la selección."); return }
      onOpenChange(false)
      onSaved()
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
          <Checkbox label="Reemplazar evidencia mínima" checked={replaceEvidence} onChange={(event) => setReplaceEvidence(event.target.checked)} />
          {replaceEvidence && <Textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={3000} placeholder="Evidencia mínima común para la selección" />}
          {objectives.length > 0 && (
            <Field label="Cambiar objetivo" htmlFor="batch-objective">
              <Select value={objective} onValueChange={setObjective}>
                <SelectTrigger id="batch-objective"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Sin cambio</SelectItem>
                  <SelectItem value="none">Quitar objetivo</SelectItem>
                  {objectives.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
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

function EditActivityDialog({ activity, horizon, currentCells, onClose, onSaved }: {
  activity: PdtpActivityRow | null
  horizon: PdtpScheduleHorizon
  currentCells: PdtpScheduleCell[]
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
  const [months, setMonths] = React.useState<number[]>([])
  const [replaceConfirmed, setReplaceConfirmed] = React.useState(false)
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
      // `months` se hidrata y se reenvía siempre: descartarlo hacía que una
      // actividad con frecuencia "meses seleccionados" fuera inguardable, y
      // por tanto ineditable incluso para corregir su texto.
      setMonths(rule?.months ?? [])
      setReplaceConfirmed(false)
      setTriggerDescription(activity.triggerDescription ?? "")
      setDueDays(activity.dueDays ?? 5)
      setError(null)
    }
  }

  // Las actividades nuevas tienen una definición civil/ISO en
  // `scheduleDefinition`; este diálogo histórico sólo entiende la grilla de
  // cuatro semanas. No debe enviar una recurrencia legacy encima de esa
  // definición (en particular, tampoco `dueDays=5` sobre una actividad que
  // usa horas), porque dejaría dos fuentes de verdad o violaría el CHECK de
  // días/horas. La edición textual sigue disponible y la programación se
  // conserva intacta hasta que se abra el creador guiado correspondiente.
  const modernSchedule = Boolean(
    activity
    && activity.scheduleDefinition
    && (activity.scheduleDefinition as PdtpScheduleDefinition).kind !== "legacy_grid",
  )

  const nextRule: PdtpRecurrenceRule | null = scheduleMode === "scheduled"
    ? { frequency, interval, plannedQuantity, weekOfMonth, ...(frequency === "custom" ? { months } : {}) }
    : null

  // Qué pasaría con la planificación vigente si se guarda esto. Se calcula con
  // los mismos helpers que usa el servidor, así que el aviso y la puerta de
  // confirmación del servicio no pueden discrepar.
  const currentSource = activity
    ? derivePdtpScheduleSource({
        cells: currentCells,
        scheduleMode: (activity.scheduleMode ?? "scheduled") as "scheduled" | "on_demand" | "triggered",
        recurrenceRule: activity.recurrenceRule as PdtpRecurrenceRule | null,
        horizon,
      })
    : "none"
  const nextCells = scheduleMode === "scheduled" && nextRule
    ? projectRecurrenceToLegacySchedule(nextRule, horizon)
    : []
  const scheduleDiff = diffScheduleCells(currentCells, nextCells)
  // Solo se reescribe el calendario si el modo o la regla cambian de verdad
  // (mismo criterio que resolveScheduleWrite en el servicio). Sin esta guarda,
  // abrir el diálogo para corregir un texto ya avisaría y bloquearía Guardar en
  // toda actividad con matriz manual.
  const scheduleWouldBeRewritten = activity !== null
    && (scheduleMode !== (activity.scheduleMode ?? "scheduled")
      || !recurrenceRulesEqual(nextRule, activity.recurrenceRule as PdtpRecurrenceRule | null))
  const wouldReplaceManualSchedule = scheduleWouldBeRewritten
    && currentSource === "manual"
    && (scheduleDiff.removedCells.length > 0 || scheduleDiff.changedCells.some((cell) => cell.to < cell.from))

  async function handleSave() {
    if (!activity) return
    setPending(true)
    setError(null)
    try {
      const result = await updatePdtpActivityAction({
        activityId: activity.id,
        activity: activityText,
        program: executionGuidance,
        notes,
        ...(modernSchedule ? {} : {
          scheduleMode,
          scheduleClassificationStatus: "confirmed" as const,
          recurrenceRule: nextRule,
          triggerDescription: scheduleMode === "triggered" ? triggerDescription : null,
          dueDays: scheduleMode === "scheduled" ? null : dueDays,
          ...(replaceConfirmed ? { scheduleReplaceConfirmed: true } : {}),
        }),
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
          {modernSchedule ? (
            <p className="rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-3 py-2 text-xs text-[var(--color-info-ink)]">
              Esta actividad usa la programación nueva (fecha, recurrencia o evento) y conserva su configuración,
              instrumento, evidencia y recordatorios. El editor histórico no la reemplaza por la grilla de cuatro semanas.
            </p>
          ) : (<>
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
                    <SelectItem value="custom">Meses seleccionados</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cada" htmlFor="edit-interval"><Input id="edit-interval" type="number" min={1} max={52} value={interval} onChange={(event) => setRecurrenceInterval(Number(event.target.value))} /></Field>
              <Field label="Cantidad" htmlFor="edit-planned-quantity"><Input id="edit-planned-quantity" type="number" min={0.01} step={0.25} value={plannedQuantity} onChange={(event) => setPlannedQuantity(Number(event.target.value))} /></Field>
              <Field label="Semana" htmlFor="edit-week"><Input id="edit-week" type="number" min={1} max={4} value={weekOfMonth} onChange={(event) => setWeekOfMonth(Number(event.target.value))} /></Field>
            </div>
          ) : null}
          {scheduleMode === "scheduled" && frequency === "custom" ? (
            <fieldset className="rounded-[var(--radius)] border border-[var(--color-border)] p-3">
              <legend className="px-1 text-xs font-medium text-[var(--color-text-muted)]">Meses en que se realiza</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {MONTH_LABELS.map((label, index) => {
                  const month = index + 1
                  return (
                    <Checkbox
                      key={month}
                      label={label}
                      checked={months.includes(month)}
                      onChange={(event) => setMonths((prev) => (
                        event.target.checked ? [...prev, month].sort((a, b) => a - b) : prev.filter((m) => m !== month)
                      ))}
                    />
                  )
                })}
              </div>
            </fieldset>
          ) : null}
          {scheduleMode === "triggered" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label="Evento disparador" htmlFor="edit-trigger" required><Input id="edit-trigger" value={triggerDescription} onChange={(event) => setTriggerDescription(event.target.value)} required /></Field>
              <Field label="Plazo (días)" htmlFor="edit-trigger-days"><Input id="edit-trigger-days" type="number" min={0} max={3650} value={dueDays} onChange={(event) => setDueDays(Number(event.target.value))} /></Field>
            </div>
          ) : scheduleMode === "on_demand" ? (
            <Field label="Plazo objetivo cuando haya un caso" htmlFor="edit-demand-days"><Input id="edit-demand-days" type="number" min={0} max={3650} value={dueDays} onChange={(event) => setDueDays(Number(event.target.value))} /></Field>
          ) : null}
          {activity && <RecurrenceImpactPreview
            activity={activity}
            horizon={horizon}
            nextMode={scheduleMode}
            nextRule={nextRule}
          />}
          {wouldReplaceManualSchedule && (
            <div className="rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">
              <p>
                Esta actividad tiene {currentCells.length} semana(s) planificadas que no vienen de esta frecuencia.
                Guardar las reemplaza: {scheduleDiff.removedCells.length} semana(s) se eliminan y la cantidad planificada
                pasa de {scheduleDiff.currentPlannedTotal} a {scheduleDiff.nextPlannedTotal}.
              </p>
              <div className="mt-2">
                <Checkbox
                  label="Entiendo que se reemplazará la planificación ajustada manualmente"
                  checked={replaceConfirmed}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                />
              </div>
            </div>
          )}
          </>)}
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
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={pending || (wouldReplaceManualSchedule && !replaceConfirmed)}
          >
            {pending ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecurrenceImpactPreview({
  activity,
  horizon,
  nextMode,
  nextRule,
}: {
  activity: PdtpActivityRow
  horizon: PdtpScheduleHorizon
  nextMode: "scheduled" | "on_demand" | "triggered"
  nextRule: PdtpRecurrenceRule | null
}) {
  const currentRule = activity.recurrenceRule as PdtpRecurrenceRule | null
  // Con `horizon`: sin él el conteo se calculaba sobre 12 meses y no coincidía
  // con lo que se guarda en un programa de período parcial.
  const { currentCount, nextCount, changed } = describePdtpRecurrenceImpact(
    (activity.scheduleMode ?? "scheduled") as "scheduled" | "on_demand" | "triggered",
    currentRule,
    nextMode,
    nextRule,
    horizon,
  )
  return (
    <p className="rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-3 py-2 text-xs text-[var(--color-info-ink)]">
      {changed
        ? `Impacto antes de guardar: pasará de ${currentCount} a ${nextCount} obligación(es) calendarizadas; las ejecuciones existentes no se modifican.`
        : `${nextCount} obligación(es) calendarizadas; no hay cambio de recurrencia pendiente.`}
    </p>
  )
}
