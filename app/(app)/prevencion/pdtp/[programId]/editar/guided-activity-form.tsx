"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { describePdtpRecurrence, type PdtpRecurrenceFrequency, type PdtpRecurrenceRule } from "@/lib/services/pdtp/recurrence"
import { addPdtpActivityAction } from "../../actions"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

type ResponsibleOption = { slug: string; displayName: string }
type ScheduleMode = "scheduled" | "on_demand" | "triggered"

type Draft = {
  catalogActivityId: string
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
  catalogActivityId: "",
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
  responsibleCatalog,
  catalogActivities,
  generalViewCode = "pdtp_general",
}: {
  programId: string
  responsibleCatalog: ResponsibleOption[]
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  generalViewCode?: string
}) {
  const router = useRouter()
  const storageKey = `pdtp-builder:${programId}:activity-draft`
  const defaultResponsibleSlug = responsibleCatalog[0]?.slug ?? ""
  const [draft, setDraft] = React.useState<Draft>(() => ({
    ...EMPTY_DRAFT,
    responsibleSlug: defaultResponsibleSlug,
  }))
  const [hydrated, setHydrated] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null)

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Draft>
        setDraft({
          ...EMPTY_DRAFT,
          ...parsed,
          responsibleSlug: parsed.responsibleSlug || defaultResponsibleSlug,
        })
      }
    } catch {
      // Un borrador local corrupto o storage deshabilitado no bloquea el formulario.
    }
    setHydrated(true)
  }, [defaultResponsibleSlug, storageKey])

  React.useEffect(() => {
    if (!hydrated) return
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)) } catch { /* almacenamiento opcional */ }
  }, [draft, hydrated, storageKey])

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
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
  const selectedCatalogActivity = catalogActivities.find((activity) => activity.id === draft.catalogActivityId)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCatalogActivity || !draft.responsibleSlug) {
      setMessage({ ok: false, text: "Selecciona una actividad del catálogo y su responsable antes de guardar." })
      return
    }
    if (draft.scheduleMode === "triggered" && !draft.triggerDescription.trim()) {
      setMessage({ ok: false, text: "Describe el evento que debe generar la obligación." })
      return
    }

    const responsible = responsibleCatalog.find((option) => option.slug === draft.responsibleSlug)
    setPending(true)
    setMessage(null)
    try {
      const result = await addPdtpActivityAction({
        programId,
        catalogActivityId: selectedCatalogActivity.id,
        activity: selectedCatalogActivity.description,
        program: selectedCatalogActivity.executionGuidance,
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
      if (!result.ok) {
        setMessage({ ok: false, text: result.message ?? "No se pudo guardar la actividad." })
        return
      }

      try { window.localStorage.removeItem(storageKey) } catch { /* almacenamiento opcional */ }
      setDraft({ ...EMPTY_DRAFT, responsibleSlug: defaultResponsibleSlug })
      setMessage({ ok: true, text: "Actividad guardada. Puedes agregar otra o continuar a la programación." })
      router.refresh()
    } catch {
      setMessage({ ok: false, text: "No se pudo guardar la actividad." })
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text)]">Agregar desde catálogo</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Elige la definición corporativa y configura sólo su ejecución anual.</p>
        </div>
        <MetaBadge meta={{ label: hydrated ? "Borrador local guardado" : "Preparando borrador", variant: "outline" }} />
      </div>

      <FieldGroup className="gap-4">
        <div>
          <PdtpActivityPicker
            label="Actividad preventiva"
            options={catalogActivities}
            value={draft.catalogActivityId}
            onChange={(value) => patch("catalogActivityId", value)}
          />
          {selectedCatalogActivity && (
            <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
              <p className="font-semibold text-[var(--color-text)]">{selectedCatalogActivity.title}</p>
              <p className="mt-1 text-[var(--color-text-muted)]">{selectedCatalogActivity.description}</p>
              <p className="mt-2 text-xs text-[var(--color-text-subtle)]"><span className="font-semibold">Guía:</span> {selectedCatalogActivity.executionGuidance}</p>
            </div>
          )}
        </div>

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
        ? "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]"
        : "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger)]")}>{message.text}</p>}

      <div className="flex justify-end border-t border-[var(--color-border)] pt-4">
        <Button type="submit" loading={pending}>Guardar actividad</Button>
      </div>
    </form>
  )
}
