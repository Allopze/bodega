"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { describePdtpRecurrence, type PdtpRecurrenceFrequency, type PdtpRecurrenceRule } from "@/lib/services/pdtp/recurrence"
import { addPdtpActivityAction } from "../../actions"

type ActivitySummary = { objectiveOrder: number; objective: string }
type ResponsibleOption = { slug: string; displayName: string }
type ScheduleMode = "scheduled" | "on_demand" | "triggered"

type Draft = {
  objectiveChoice: string
  objective: string
  activityDescription: string
  executionGuidance: string
  responsibleSlug: string
  audienceRoles: string
  scheduleMode: ScheduleMode
  frequency: PdtpRecurrenceFrequency
  interval: number
  plannedQuantity: number
  weekOfMonth: number
  triggerType: string
  triggerDescription: string
  dueDays: number
  evidenceRequirement: string
  notes: string
}

const EMPTY_DRAFT: Draft = {
  objectiveChoice: "new",
  objective: "",
  activityDescription: "",
  executionGuidance: "Registrar cómo se realizó y conservar evidencia verificable",
  responsibleSlug: "",
  audienceRoles: "",
  scheduleMode: "scheduled",
  frequency: "monthly",
  interval: 1,
  plannedQuantity: 1,
  weekOfMonth: 1,
  triggerType: "",
  triggerDescription: "",
  dueDays: 5,
  evidenceRequirement: "Registro de ejecución y evidencia verificable",
  notes: "",
}

const MODE_OPTIONS: Array<{ value: ScheduleMode; label: string; description: string }> = [
  { value: "scheduled", label: "Con frecuencia", description: "Se repite semanal, mensual o en otro intervalo." },
  { value: "on_demand", label: "Cuando se necesite", description: "Permanece disponible sin inventar una meta semanal." },
  { value: "triggered", label: "Cuando ocurra un evento", description: "Nace una obligación con plazo al ocurrir un hecho." },
]

const FREQUENCY_OPTIONS: Array<{ value: PdtpRecurrenceFrequency; label: string }> = [
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
  { value: "quarterly", label: "Trimestral" },
  { value: "semiannual", label: "Semestral" },
  { value: "annual", label: "Anual" },
]

export function GuidedActivityForm({
  programId,
  activities,
  responsibleCatalog,
  generalViewCode = "pdtp_general",
}: {
  programId: string
  activities: ActivitySummary[]
  responsibleCatalog: ResponsibleOption[]
  generalViewCode?: string
}) {
  const router = useRouter()
  const storageKey = `pdtp-builder:${programId}:activity-draft`
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [hydrated, setHydrated] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null)

  const objectives = React.useMemo(() => {
    const map = new Map<number, string>()
    for (const activity of activities) if (!map.has(activity.objectiveOrder)) map.set(activity.objectiveOrder, activity.objective)
    return [...map.entries()].sort(([left], [right]) => left - right)
  }, [activities])
  const nextObjectiveOrder = Math.max(0, ...objectives.map(([order]) => order)) + 1

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Draft> & { activity?: string; programName?: string }
        setDraft({
          ...EMPTY_DRAFT,
          ...parsed,
          activityDescription: parsed.activityDescription ?? parsed.activity ?? EMPTY_DRAFT.activityDescription,
          executionGuidance: parsed.executionGuidance ?? parsed.programName ?? EMPTY_DRAFT.executionGuidance,
        })
      }
    } catch {
      // Un borrador local corrupto o storage deshabilitado no bloquea el formulario.
    }
    setHydrated(true)
  }, [storageKey])

  React.useEffect(() => {
    if (!hydrated) return
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)) } catch { /* almacenamiento opcional */ }
  }, [draft, hydrated, storageKey])

  if (!draft.responsibleSlug && responsibleCatalog[0]) {
    setDraft((current) => current.responsibleSlug ? current : ({ ...current, responsibleSlug: responsibleCatalog[0]!.slug }))
  }

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setMessage(null)
  }

  function chooseObjective(value: string) {
    const existing = objectives.find(([order]) => String(order) === value)
    setDraft((current) => ({
      ...current,
      objectiveChoice: value,
      objective: existing?.[1] ?? "",
    }))
    setMessage(null)
  }

  const recurrenceRule: PdtpRecurrenceRule = {
    frequency: draft.frequency,
    interval: draft.interval,
    plannedQuantity: draft.plannedQuantity,
    weekOfMonth: draft.weekOfMonth,
  }
  const recurrencePreview = draft.scheduleMode === "scheduled"
    ? describePdtpRecurrence(recurrenceRule)
    : draft.scheduleMode === "on_demand"
      ? "No genera una cuota semanal. Se mide solo cuando existan solicitudes o casos reales."
      : `Cada evento abre una obligación con plazo de ${draft.dueDays} día(s).`

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.objective.trim() || !draft.activityDescription.trim() || !draft.responsibleSlug) {
      setMessage({ ok: false, text: "Completa objetivo, actividad y responsable antes de guardar." })
      return
    }
    if (draft.scheduleMode === "triggered" && !draft.triggerDescription.trim()) {
      setMessage({ ok: false, text: "Describe el evento que debe generar la obligación." })
      return
    }

    const responsible = responsibleCatalog.find((option) => option.slug === draft.responsibleSlug)
    setPending(true)
    setMessage(null)
    const result = await addPdtpActivityAction({
      programId,
      objectiveOrder: draft.objectiveChoice === "new" ? nextObjectiveOrder : Number(draft.objectiveChoice),
      objective: draft.objective,
      activity: draft.activityDescription,
      program: draft.executionGuidance,
      responsibleSlugs: [draft.responsibleSlug],
      responsibleDisplay: responsible?.displayName ?? draft.responsibleSlug,
      audienceRoles: draft.audienceRoles.split(",").map((role) => role.trim()).filter(Boolean),
      scheduleMode: draft.scheduleMode,
      recurrenceRule: draft.scheduleMode === "scheduled" ? recurrenceRule : null,
      triggerType: draft.scheduleMode === "triggered" ? draft.triggerType || "evento_operacional" : null,
      triggerDescription: draft.scheduleMode === "triggered" ? draft.triggerDescription : null,
      dueDays: draft.scheduleMode === "scheduled" ? null : draft.dueDays,
      evidenceRequirement: draft.evidenceRequirement || null,
      indicatorMode: draft.scheduleMode === "scheduled" ? "planned_vs_completed" : "closed_on_time",
      targetValue: 100,
      targetUnit: "%",
      notes: draft.notes,
      sheetCodes: [generalViewCode],
    })
    setPending(false)
    if (!result.ok) {
      setMessage({ ok: false, text: result.message ?? "No se pudo guardar la actividad." })
      return
    }

    try { window.localStorage.removeItem(storageKey) } catch { /* almacenamiento opcional */ }
    setDraft({ ...EMPTY_DRAFT, responsibleSlug: responsibleCatalog[0]?.slug ?? "" })
    setMessage({ ok: true, text: "Actividad guardada. Puedes agregar otra o continuar a la programación." })
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text)]">Agregar una actividad</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Describe qué debe ocurrir; la plataforma generará la planificación correspondiente.</p>
        </div>
        <Badge variant="outline" size="sm">{hydrated ? "Borrador local guardado" : "Preparando borrador"}</Badge>
      </div>

      <FieldGroup className="gap-4">
        <div className="grid gap-4 md:grid-cols-[15rem_1fr]">
          <Field label="Objetivo" htmlFor="guided-objective-choice" required>
            <Select value={draft.objectiveChoice} onValueChange={chooseObjective}>
              <SelectTrigger id="guided-objective-choice"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Crear un objetivo nuevo</SelectItem>
                {objectives.map(([order, objective]) => <SelectItem key={order} value={String(order)}>{order}. {objective}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={draft.objectiveChoice === "new" ? "Nombre del nuevo objetivo" : "Objetivo seleccionado"} htmlFor="guided-objective" required>
            <Input id="guided-objective" value={draft.objective} onChange={(event) => patch("objective", event.target.value)} readOnly={draft.objectiveChoice !== "new"} required />
          </Field>
        </div>

        <Field label="¿Qué actividad preventiva se realizará?" htmlFor="guided-activity" required>
          <Textarea id="guided-activity" value={draft.activityDescription} onChange={(event) => patch("activityDescription", event.target.value)} rows={3} maxLength={4000} placeholder="Ej.: revisar condiciones de almacenamiento y registrar hallazgos" required />
        </Field>

        <Field label="Responsable principal" htmlFor="guided-responsible" required>
          {responsibleCatalog.length > 0 ? (
            <Select value={draft.responsibleSlug} onValueChange={(value) => patch("responsibleSlug", value)}>
              <SelectTrigger id="guided-responsible"><SelectValue placeholder="Selecciona un responsable" /></SelectTrigger>
              <SelectContent>{responsibleCatalog.map((option) => <SelectItem key={option.slug} value={option.slug}>{option.displayName}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input id="guided-responsible" value={draft.responsibleSlug} onChange={(event) => patch("responsibleSlug", event.target.value)} placeholder="Rol o equipo responsable" required />
          )}
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-[var(--color-text)]">¿Cuándo debe realizarse?</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {MODE_OPTIONS.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={draft.scheduleMode === option.value} onClick={() => patch("scheduleMode", option.value)} className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                draft.scheduleMode === option.value
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)]"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]",
              )}>
                <span className="block text-sm font-semibold text-[var(--color-text)]">{option.label}</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]">{option.description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {draft.scheduleMode === "scheduled" && (
          <div className="grid gap-4 rounded-lg bg-[var(--color-surface-2)] p-3 sm:grid-cols-3">
            <Field label="Frecuencia" htmlFor="guided-frequency">
              <Select value={draft.frequency} onValueChange={(value) => patch("frequency", value as PdtpRecurrenceFrequency)}>
                <SelectTrigger id="guided-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>{FREQUENCY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Cantidad por fecha" htmlFor="guided-quantity">
              <Input id="guided-quantity" type="number" min="0.25" step="0.25" value={draft.plannedQuantity} onChange={(event) => patch("plannedQuantity", Number(event.target.value))} />
            </Field>
            <Field label="Semana del mes" htmlFor="guided-week">
              <Select value={String(draft.weekOfMonth)} onValueChange={(value) => patch("weekOfMonth", Number(value))}>
                <SelectTrigger id="guided-week"><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4].map((week) => <SelectItem key={week} value={String(week)}>Semana {week}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {draft.scheduleMode === "triggered" && (
          <div className="grid gap-4 rounded-lg bg-[var(--color-surface-2)] p-3 md:grid-cols-[1fr_10rem]">
            <Field label="Evento que genera la obligación" htmlFor="guided-trigger" required>
              <Input id="guided-trigger" value={draft.triggerDescription} onChange={(event) => patch("triggerDescription", event.target.value)} placeholder="Ej.: ingreso de un trabajador nuevo" required />
            </Field>
            <Field label="Plazo en días" htmlFor="guided-due-days">
              <Input id="guided-due-days" type="number" min="0" max="3650" value={draft.dueDays} onChange={(event) => patch("dueDays", Number(event.target.value))} />
            </Field>
          </div>
        )}

        {draft.scheduleMode === "on_demand" && (
          <Field label="Plazo objetivo cuando exista un caso" htmlFor="guided-on-demand-due" helper="No se contabiliza nada mientras no existan casos reales.">
            <Input id="guided-on-demand-due" type="number" min="0" max="3650" value={draft.dueDays} onChange={(event) => patch("dueDays", Number(event.target.value))} className="max-w-40" />
          </Field>
        )}

        <p className="rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-3 py-2 text-sm text-[var(--color-info-ink)]">
          <span className="font-semibold">Vista previa:</span> {recurrencePreview}
        </p>

        <details className="rounded-lg border border-[var(--color-border)] px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">Responsabilidades, evidencia y detalles opcionales</summary>
          <div className="mt-4 grid gap-4">
            <Field label="Guía de ejecución" htmlFor="guided-execution-guidance" helper="Explica cómo realizar y demostrar el trabajo; no corresponde a una columna obligatoria del Excel.">
              <Textarea id="guided-execution-guidance" value={draft.executionGuidance} onChange={(event) => patch("executionGuidance", event.target.value)} rows={3} maxLength={2000} />
            </Field>
            <Field label="Evidencia mínima esperada" htmlFor="guided-evidence">
              <Textarea id="guided-evidence" value={draft.evidenceRequirement} onChange={(event) => patch("evidenceRequirement", event.target.value)} rows={2} maxLength={3000} />
            </Field>
            <Field label="Audiencias adicionales" htmlFor="guided-audience" helper="Separa roles o grupos con comas.">
              <Input id="guided-audience" value={draft.audienceRoles} onChange={(event) => patch("audienceRoles", event.target.value)} placeholder="CPHS, jefatura de terreno" />
            </Field>
            <Field label="Notas" htmlFor="guided-notes">
              <Textarea id="guided-notes" value={draft.notes} onChange={(event) => patch("notes", event.target.value)} rows={2} maxLength={5000} />
            </Field>
          </div>
        </details>
      </FieldGroup>

      {message && <p role="status" className={cn("rounded-lg border px-3 py-2 text-sm", message.ok
        ? "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success)]"
        : "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger)]")}>{message.text}</p>}

      <div className="flex justify-end border-t border-[var(--color-border)] pt-4">
        <Button type="submit" loading={pending}>Guardar actividad</Button>
      </div>
    </form>
  )
}
