"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { savePdtpProgramActivityAction } from "@/app/(app)/prevencion/pdtp/actions"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { describePdtpRecurrence, type PdtpRecurrenceFrequency, type PdtpRecurrenceRule } from "@/lib/services/pdtp/recurrence"
import type { ActionState } from "@/lib/validation/prevention"

type SourceMode = "catalog" | "new"
type ScheduleMode = "scheduled" | "on_demand" | "triggered"
type ResponsibleOption = { slug: string; displayName: string }
type ProgramOption = { id: string; title: string; year: number; version: number }

type Draft = {
  sourceMode: SourceMode
  programId: string
  catalogActivityId: string
  code: string
  title: string
  description: string
  executionGuidance: string
  codeManuallyEdited: boolean
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

type SaveAction = (input: unknown) => Promise<ActionState>

const EMPTY_DRAFT: Draft = {
  sourceMode: "catalog",
  programId: "",
  catalogActivityId: "",
  code: "",
  title: "",
  description: "",
  executionGuidance: "",
  codeManuallyEdited: false,
  responsibleSlug: "",
  audienceRoles: "",
  scheduleMode: "scheduled",
  frequency: "monthly",
  interval: 1,
  plannedQuantity: 1,
  weekOfMonth: 1,
  triggerType: "evento_operacional",
  triggerDescription: "",
  dueDays: 5,
  evidenceRequirement: "Registro de ejecución y evidencia verificable",
  notes: "",
}

const MODE_OPTIONS: Array<{ value: ScheduleMode; label: string; description: string }> = [
  { value: "scheduled", label: "Programada", description: "Se repite con una frecuencia definida." },
  { value: "on_demand", label: "Bajo demanda", description: "Se realiza cuando exista un caso real." },
  { value: "triggered", label: "Por evento", description: "Se activa cuando ocurre un hecho definido." },
]

const FREQUENCY_OPTIONS: Array<{ value: PdtpRecurrenceFrequency; label: string }> = [
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
  { value: "quarterly", label: "Trimestral" },
  { value: "semiannual", label: "Semestral" },
  { value: "annual", label: "Anual" },
]

export function suggestPdtpActivityCode(title: string): string {
  const normalized = title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 118)
    .replace(/-+$/g, "")
  return normalized ? `PDT-${normalized}` : ""
}

function initialDraft(sourceMode: SourceMode, programId: string, responsibleSlug: string): Draft {
  return { ...EMPTY_DRAFT, sourceMode, programId, responsibleSlug }
}

export function PdtpActivityCreator({
  fixedProgramId,
  programs = [],
  initialSourceMode = "catalog",
  responsibleCatalog,
  catalogActivities,
  saveAction = savePdtpProgramActivityAction,
  onSaved,
  surface = "card",
}: {
  fixedProgramId?: string
  programs?: ProgramOption[]
  initialSourceMode?: SourceMode
  responsibleCatalog: ResponsibleOption[]
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  saveAction?: SaveAction
  onSaved?: () => void
  surface?: "card" | "plain"
}) {
  const router = useRouter()
  const defaultResponsibleSlug = responsibleCatalog[0]?.slug ?? ""
  const [draft, setDraft] = React.useState<Draft>(() => initialDraft(initialSourceMode, fixedProgramId ?? "", defaultResponsibleSlug))
  const [hydratedKey, setHydratedKey] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const skipNextPersistence = React.useRef<string | null>(null)
  const selectedProgramId = fixedProgramId ?? draft.programId
  const storageKey = selectedProgramId ? `pdtp-activity-creator:${selectedProgramId}` : null

  React.useEffect(() => {
    if (!storageKey) {
      setHydratedKey(null)
      return
    }
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Draft>
        setDraft((current) => ({
          ...EMPTY_DRAFT,
          ...current,
          ...parsed,
          programId: fixedProgramId ?? current.programId,
          responsibleSlug: parsed.responsibleSlug || current.responsibleSlug || defaultResponsibleSlug,
        }))
      }
    } catch {
      // El almacenamiento local es una ayuda; nunca bloquea la creación.
    }
    setHydratedKey(storageKey)
  }, [defaultResponsibleSlug, fixedProgramId, storageKey])

  React.useEffect(() => {
    if (!storageKey || hydratedKey !== storageKey) return
    if (skipNextPersistence.current === storageKey) {
      skipNextPersistence.current = null
      return
    }
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)) } catch { /* almacenamiento opcional */ }
  }, [draft, hydratedKey, storageKey])

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setMessage(null)
    clearFieldError(String(key))
  }

  function clearFieldError(key: string) {
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function changeTitle(title: string) {
    setDraft((current) => ({
      ...current,
      title,
      code: current.codeManuallyEdited ? current.code : suggestPdtpActivityCode(title),
    }))
    setMessage(null)
    clearFieldError("title")
  }

  function changeSourceMode(sourceMode: SourceMode) {
    patch("sourceMode", sourceMode)
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
      ? `Sin cuota periódica; cada caso tendrá un plazo objetivo de ${draft.dueDays} día(s).`
      : `Cada evento abre una obligación con plazo de ${draft.dueDays} día(s).`
  const selectedCatalogActivity = catalogActivities.find((activity) => activity.id === draft.catalogActivityId)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProgramId) {
      setMessage({ ok: false, text: "Selecciona un programa anual editable." })
      return
    }
    if (draft.sourceMode === "catalog" && !selectedCatalogActivity) {
      setMessage({ ok: false, text: "Selecciona una actividad existente." })
      return
    }
    if (!draft.responsibleSlug) {
      setMessage({ ok: false, text: "Selecciona el responsable principal." })
      return
    }

    setPending(true)
    setMessage(null)
    setFieldErrors({})
    try {
      const source = draft.sourceMode === "catalog"
        ? { kind: "catalog" as const, catalogActivityId: draft.catalogActivityId }
        : {
          kind: "new" as const,
          code: draft.code,
          title: draft.title,
          description: draft.description,
          executionGuidance: draft.executionGuidance,
        }
      const result = await saveAction({
        programId: selectedProgramId,
        source,
        responsibleSlug: draft.responsibleSlug,
        audienceRoles: draft.audienceRoles.split(",").map((role) => role.trim()).filter(Boolean),
        scheduleMode: draft.scheduleMode,
        recurrenceRule: draft.scheduleMode === "scheduled" ? recurrenceRule : null,
        triggerType: draft.scheduleMode === "triggered" ? draft.triggerType : null,
        triggerDescription: draft.scheduleMode === "triggered" ? draft.triggerDescription : null,
        dueDays: draft.scheduleMode === "scheduled" ? null : draft.dueDays,
        evidenceRequirement: draft.evidenceRequirement || null,
        notes: draft.notes,
      })
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        setMessage({ ok: false, text: result.message ?? "No se pudo guardar la actividad." })
        return
      }

      if (storageKey) {
        skipNextPersistence.current = storageKey
        try { window.localStorage.removeItem(storageKey) } catch { /* almacenamiento opcional */ }
      }
      setDraft(initialDraft(initialSourceMode, fixedProgramId ?? "", defaultResponsibleSlug))
      setMessage({ ok: true, text: "Actividad creada e incorporada al programa." })
      toast.success("Actividad creada e incorporada al programa.")
      router.refresh()
      onSaved?.()
    } catch {
      setMessage({ ok: false, text: "No se pudo guardar la actividad." })
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className={cn(
      "space-y-5",
      surface === "card" && "rounded-xl border border-(--color-border) bg-(--color-surface) p-4 md:p-5",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-(--color-text)">Agregar actividad al programa</h3>
          <p className="mt-1 text-sm text-(--color-text-muted)">Define la actividad, su responsable y cuándo debe realizarse.</p>
        </div>
        <MetaBadge meta={{ label: storageKey && hydratedKey === storageKey ? "Borrador local guardado" : "Preparando borrador", variant: "outline" }} />
      </div>

      <FieldGroup className="gap-4">
        {!fixedProgramId && (
          <Field label="Programa anual" htmlFor="pdtp-creator-program" error={fieldErrors.programId?.[0]}>
            <Select value={draft.programId} onValueChange={(value) => patch("programId", value)}>
              <SelectTrigger id="pdtp-creator-program"><SelectValue placeholder="Selecciona un programa editable" /></SelectTrigger>
              <SelectContent>{programs.map((program) => <SelectItem key={program.id} value={program.id}>{program.title} · {program.year} · v{program.version}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-(--color-text)">Origen de la actividad</legend>
          <div className="inline-flex rounded-lg border border-(--color-border) bg-(--color-surface-2) p-1">
            <Button type="button" size="sm" variant={draft.sourceMode === "catalog" ? "primary" : "ghost"} onClick={() => changeSourceMode("catalog")}>Usar existente</Button>
            <Button type="button" size="sm" variant={draft.sourceMode === "new" ? "primary" : "ghost"} onClick={() => changeSourceMode("new")}>Crear nueva</Button>
          </div>
        </fieldset>

        {draft.sourceMode === "catalog" ? (
          <div>
            <PdtpActivityPicker label="Actividad existente" options={catalogActivities} value={draft.catalogActivityId} onChange={(value) => patch("catalogActivityId", value)} />
            {selectedCatalogActivity && (
              <div className="mt-2 rounded-lg border border-(--color-border) bg-(--color-surface-2) p-3 text-sm">
                <p className="font-semibold text-(--color-text)">{selectedCatalogActivity.title}</p>
                <p className="mt-1 text-(--color-text-muted)">{selectedCatalogActivity.description}</p>
                <p className="mt-2 text-xs text-(--color-text-subtle)"><span className="font-semibold">Guía:</span> {selectedCatalogActivity.executionGuidance}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <Field label="Título" htmlFor="pdtp-creator-title" error={fieldErrors.title?.[0]}>
              <Input id="pdtp-creator-title" value={draft.title} onChange={(event) => changeTitle(event.target.value)} maxLength={80} required />
            </Field>
            <Field label="Descripción de la actividad" htmlFor="pdtp-creator-description" error={fieldErrors.description?.[0]}>
              <Textarea id="pdtp-creator-description" value={draft.description} onChange={(event) => patch("description", event.target.value)} rows={3} maxLength={4000} required />
            </Field>
            <Field label="Guía de ejecución" htmlFor="pdtp-creator-guidance" error={fieldErrors.executionGuidance?.[0]}>
              <Textarea id="pdtp-creator-guidance" value={draft.executionGuidance} onChange={(event) => patch("executionGuidance", event.target.value)} rows={2} maxLength={2000} required />
            </Field>
          </div>
        )}

        <Field label="Responsable principal" htmlFor="pdtp-creator-responsible" required error={fieldErrors.responsibleSlug?.[0]}>
          <Select value={draft.responsibleSlug} onValueChange={(value) => patch("responsibleSlug", value)}>
            <SelectTrigger id="pdtp-creator-responsible"><SelectValue placeholder="Selecciona un responsable" /></SelectTrigger>
            <SelectContent>{responsibleCatalog.map((option) => <SelectItem key={option.slug} value={option.slug}>{option.displayName}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-(--color-text)">Modalidad</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {MODE_OPTIONS.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={draft.scheduleMode === option.value} onClick={() => patch("scheduleMode", option.value)} className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                draft.scheduleMode === option.value ? "border-(--color-primary) bg-(--color-primary-tint)" : "border-(--color-border) hover:bg-(--color-surface-2)",
              )}>
                <span className="block text-sm font-semibold text-(--color-text)">{option.label}</span>
                <span className="mt-1 block text-xs leading-5 text-(--color-text-muted)">{option.description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {draft.scheduleMode === "scheduled" && (
          <div className="grid gap-4 rounded-lg bg-(--color-surface-2) p-3 sm:grid-cols-3">
            <Field label="Frecuencia" htmlFor="pdtp-creator-frequency">
              <Select value={draft.frequency} onValueChange={(value) => patch("frequency", value as PdtpRecurrenceFrequency)}>
                <SelectTrigger id="pdtp-creator-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>{FREQUENCY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Cantidad por fecha" htmlFor="pdtp-creator-quantity">
              <Input id="pdtp-creator-quantity" type="number" min="0.25" step="0.25" value={draft.plannedQuantity} onChange={(event) => patch("plannedQuantity", Number(event.target.value))} />
            </Field>
            <Field label="Semana del mes" htmlFor="pdtp-creator-week">
              <Select value={String(draft.weekOfMonth)} onValueChange={(value) => patch("weekOfMonth", Number(value))}>
                <SelectTrigger id="pdtp-creator-week"><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4].map((week) => <SelectItem key={week} value={String(week)}>Semana {week}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {draft.scheduleMode === "triggered" && (
          <div className="grid gap-4 rounded-lg bg-(--color-surface-2) p-3 md:grid-cols-[1fr_10rem]">
            <Field label="Evento que genera la obligación" htmlFor="pdtp-creator-trigger" required error={fieldErrors.triggerDescription?.[0]}>
              <Input id="pdtp-creator-trigger" value={draft.triggerDescription} onChange={(event) => patch("triggerDescription", event.target.value)} placeholder="Ej.: ingreso de un trabajador nuevo" required />
            </Field>
            <Field label="Plazo en días" htmlFor="pdtp-creator-trigger-due">
              <Input id="pdtp-creator-trigger-due" type="number" min="0" max="3650" value={draft.dueDays} onChange={(event) => patch("dueDays", Number(event.target.value))} />
            </Field>
          </div>
        )}

        {draft.scheduleMode === "on_demand" && (
          <Field label="Plazo objetivo en días" htmlFor="pdtp-creator-on-demand-due" helper="Solo se mide cuando exista un caso real.">
            <Input id="pdtp-creator-on-demand-due" type="number" min="0" max="3650" value={draft.dueDays} onChange={(event) => patch("dueDays", Number(event.target.value))} className="max-w-40" />
          </Field>
        )}

        <p className="rounded-lg border border-(--color-info-line) bg-(--color-info-tint) px-3 py-2 text-sm text-(--color-info-ink)">
          <span className="font-semibold">Vista previa:</span> {recurrencePreview}
        </p>

        <details className="rounded-lg border border-(--color-border) px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-(--color-text)">Detalles adicionales</summary>
          <div className="mt-4 grid gap-4">
            {draft.sourceMode === "new" && (
              <Field label="Código estable" htmlFor="pdtp-creator-code" error={fieldErrors.code?.[0]} helper="Se sugiere desde el título; puedes personalizarlo.">
                <Input id="pdtp-creator-code" value={draft.code} onChange={(event) => {
                  setDraft((current) => ({ ...current, code: event.target.value.toUpperCase(), codeManuallyEdited: true }))
                  clearFieldError("code")
                  setMessage(null)
                }} placeholder="PDT-AREA-ACCION" required />
              </Field>
            )}
            <Field label="Evidencia mínima esperada" htmlFor="pdtp-creator-evidence">
              <Textarea id="pdtp-creator-evidence" value={draft.evidenceRequirement} onChange={(event) => patch("evidenceRequirement", event.target.value)} rows={2} maxLength={3000} />
            </Field>
            <Field label="Audiencias adicionales" htmlFor="pdtp-creator-audience" helper="Separa roles o grupos con comas.">
              <Input id="pdtp-creator-audience" value={draft.audienceRoles} onChange={(event) => patch("audienceRoles", event.target.value)} placeholder="CPHS, jefatura de terreno" />
            </Field>
            <Field label="Notas" htmlFor="pdtp-creator-notes">
              <Textarea id="pdtp-creator-notes" value={draft.notes} onChange={(event) => patch("notes", event.target.value)} rows={2} maxLength={5000} />
            </Field>
          </div>
        </details>
      </FieldGroup>

      {message && <p role="status" className={cn("rounded-lg border px-3 py-2 text-sm", message.ok
        ? "border-(--color-success-line) bg-(--color-success-tint) text-(--color-success-ink)"
        : "border-(--color-danger-line) bg-(--color-danger-tint) text-(--color-danger-ink)")}>{message.text}</p>}

      <div className="flex justify-end border-t border-(--color-border) pt-4">
        <Button type="submit" loading={pending}>Guardar actividad</Button>
      </div>
    </form>
  )
}
