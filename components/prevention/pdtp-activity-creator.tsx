"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { cn, codeYear, countOf, pluralize } from "@/lib/utils"
import type { PdtpRecurrenceFrequency, PdtpRecurrenceRule } from "@/lib/services/pdtp/recurrence"
import { expandPdtpScheduleDefinition, type PdtpScheduleDefinition } from "@/lib/services/pdtp/schedule-definition"
import { listPdtpExecutionConnectors, type PdtpCompletionPolicy, type PdtpEvidenceKind } from "@/lib/services/pdtp/connectors"
import { savePdtpProgramActivityAction, updatePdtpActivityAction } from "@/app/(app)/prevencion/pdtp/actions"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

type ResponsibleOption = { slug: string; displayName: string }
type ScheduleMode = "scheduled" | "on_demand" | "triggered"
type ConnectorOption = {
  key: string
  label: string
  moduleHref: string
  supportedEvents: Array<{ key: string; label: string }>
  supportedBindingSourceTypes: readonly string[]
  supportedCompletionPolicies: readonly PdtpCompletionPolicy[]
  supportedEvidenceKinds: readonly PdtpEvidenceKind[]
}
type InstrumentOption = {
  id: string
  label: string
  sourceType: string
  catalogActivityId: string
}

type ReminderDraft = { offsetValue: number; offsetUnit: "hour" | "day" }

export type PdtpActivityCreatorMode = "annual_add" | "admin_create_and_add" | "edit"

export type PdtpActivityCreatorProgramOption = {
  id: string
  title: string
  year: number
  version?: number
  periodStart?: string | null
  periodEnd?: string | null
}

export type PdtpActivityCreatorInitialValue = {
  id: string
  n: number
  catalogActivityId: string | null
  activity: string
  program: string
  responsibleSlugs: string[]
  audienceRoles: string[]
  scheduleMode: ScheduleMode
  recurrenceRule: PdtpRecurrenceRule | null
  scheduleDefinition: PdtpScheduleDefinition | null
  triggerType: string | null
  triggerDescription: string | null
  dueDays: number | null
  dueHours: number | null
  evidenceRequirement: string | null
  notes: string | null
  executionConfig: {
    destinationConnectorKey: string
    accreditationBindingId: string | null
    completionPolicy: PdtpCompletionPolicy
    evidenceRequired: boolean
    acceptedEvidenceKinds: PdtpEvidenceKind[]
  } | null
  reminderRules: ReminderDraft[]
}

type Draft = {
  sourceKind: "catalog" | "new"
  code: string
  title: string
  description: string
  executionGuidance: string
  catalogActivityId: string
  responsibleSlug: string
  audienceRoles: string
  scheduleMode: ScheduleMode
  frequency: PdtpRecurrenceFrequency
  interval: number
  plannedQuantity: number
  weekOfMonth: number
  scheduleKind: "one_time" | "recurring"
  oneTimeDate: string
  startDate: string
  endDate: string
  recurrenceUnit: "day" | "week" | "month" | "year"
  recurrenceEvery: number
  dayOfMonth: number
  weekdays: number[]
  triggerType: string
  triggerDescription: string
  triggerConnectorKey: string
  triggerEventKey: string
  dueUnit: "hour" | "day"
  dueDays: number
  dueHours: number
  destinationConnectorKey: string
  completionPolicy: PdtpCompletionPolicy
  evidenceRequired: boolean
  acceptedEvidenceKinds: PdtpEvidenceKind[]
  instrumentId: string
  reminderRules: ReminderDraft[]
  evidenceRequirement: string
  notes: string
}

const EMPTY_DRAFT: Draft = {
  sourceKind: "catalog",
  code: "PDT-",
  title: "",
  description: "",
  executionGuidance: "",
  catalogActivityId: "",
  responsibleSlug: "",
  audienceRoles: "",
  scheduleMode: "scheduled",
  frequency: "monthly",
  interval: 1,
  plannedQuantity: 1,
  weekOfMonth: 1,
  scheduleKind: "recurring",
  oneTimeDate: "",
  startDate: "",
  endDate: "",
  recurrenceUnit: "month",
  recurrenceEvery: 1,
  dayOfMonth: 1,
  weekdays: [1],
  triggerType: "",
  triggerDescription: "",
  triggerConnectorKey: "worker",
  triggerEventKey: "worker_created",
  dueUnit: "day",
  dueDays: 5,
  dueHours: 24,
  destinationConnectorKey: "inspections",
  completionPolicy: "source_completed",
  evidenceRequired: true,
  acceptedEvidenceKinds: ["generated_record", "file"],
  instrumentId: "",
  reminderRules: [{ offsetValue: -5, offsetUnit: "day" }],
  evidenceRequirement: "Registro de ejecución y evidencia verificable",
  notes: "",
}

const DEFAULT_CONNECTORS: ConnectorOption[] = listPdtpExecutionConnectors().map((connector) => ({
  key: connector.key,
  label: connector.label,
  moduleHref: connector.moduleHref,
  supportedEvents: connector.supportedEvents.map((event) => ({ key: event.key, label: event.label })),
  supportedBindingSourceTypes: connector.supportedBindingSourceTypes,
  supportedCompletionPolicies: connector.supportedCompletionPolicies,
  supportedEvidenceKinds: connector.supportedEvidenceKinds,
}))

const EVIDENCE_LABELS: Record<PdtpEvidenceKind, string> = {
  file: "Archivo",
  photo: "Fotografía",
  checklist: "Checklist",
  signature: "Firma",
  generated_record: "Registro del submódulo",
}

const MODE_OPTIONS: Array<{ value: ScheduleMode; label: string; description: string }> = [
  { value: "scheduled", label: "Con frecuencia", description: "Se repite semanal, mensual o en otro intervalo." },
  { value: "on_demand", label: "Cuando se necesite", description: "Permanece disponible sin inventar una meta semanal." },
  { value: "triggered", label: "Cuando ocurra un evento", description: "Nace una obligación con plazo al ocurrir un hecho." },
]

function compatibilityFrequency(unit: Draft["recurrenceUnit"], every: number): PdtpRecurrenceFrequency {
  if (unit === "week") return "weekly"
  if (unit === "year") return "annual"
  if (unit === "month" && every === 3) return "quarterly"
  if (unit === "month" && every === 6) return "semiannual"
  if (unit === "month" && every === 12) return "annual"
  // La grilla histórica no puede expresar días civiles. La definición nueva
  // sí los conserva; esta proyección sólo mantiene consumidores antiguos
  // compatibles y nunca genera celdas para la actividad nueva.
  return "monthly"
}

function draftFromInitial(
  initial: PdtpActivityCreatorInitialValue | undefined,
  defaults: { responsibleSlug: string; startDate: string; endDate: string; sourceKind: Draft["sourceKind"] },
): Draft {
  if (!initial) return {
    ...EMPTY_DRAFT,
    sourceKind: defaults.sourceKind,
    responsibleSlug: defaults.responsibleSlug,
    startDate: defaults.startDate,
    endDate: defaults.endDate,
  }

  const definition = initial.scheduleDefinition
  const recurrence = initial.recurrenceRule
  const config = initial.executionConfig
  const dueUnit: Draft["dueUnit"] = initial.dueHours != null || (definition?.kind === "event" || definition?.kind === "on_demand") && definition.dueUnit === "hour"
    ? "hour"
    : "day"
  return {
    ...EMPTY_DRAFT,
    sourceKind: "catalog",
    catalogActivityId: initial.catalogActivityId ?? "",
    description: initial.activity,
    executionGuidance: initial.program,
    responsibleSlug: initial.responsibleSlugs[0] ?? defaults.responsibleSlug,
    audienceRoles: initial.audienceRoles.join(", "),
    scheduleMode: initial.scheduleMode,
    frequency: recurrence?.frequency ?? "monthly",
    interval: recurrence?.interval ?? 1,
    plannedQuantity: definition?.kind === "recurring" ? definition.plannedQuantity ?? 1 : recurrence?.plannedQuantity ?? 1,
    weekOfMonth: recurrence?.weekOfMonth ?? 1,
    scheduleKind: definition?.kind === "one_time" ? "one_time" : "recurring",
    oneTimeDate: definition?.kind === "one_time" ? definition.date : "",
    startDate: definition?.kind === "recurring" ? definition.startDate : defaults.startDate,
    endDate: definition?.kind === "recurring" ? definition.endDate : defaults.endDate,
    recurrenceUnit: definition?.kind === "recurring" ? definition.unit : "month",
    recurrenceEvery: definition?.kind === "recurring" ? definition.every : 1,
    dayOfMonth: definition?.kind === "recurring" ? definition.dayOfMonth ?? 1 : 1,
    weekdays: definition?.kind === "recurring" ? definition.weekdays ?? [1] : [1],
    triggerType: initial.triggerType ?? "",
    triggerDescription: initial.triggerDescription ?? "",
    triggerConnectorKey: definition?.kind === "event" ? definition.triggerConnectorKey : EMPTY_DRAFT.triggerConnectorKey,
    triggerEventKey: definition?.kind === "event" ? definition.triggerEventKey : EMPTY_DRAFT.triggerEventKey,
    dueUnit,
    dueDays: dueUnit === "day" ? initial.dueDays ?? ((definition?.kind === "event" || definition?.kind === "on_demand") ? definition.dueValue : 5) : 5,
    dueHours: dueUnit === "hour" ? initial.dueHours ?? ((definition?.kind === "event" || definition?.kind === "on_demand") ? definition.dueValue : 24) : 24,
    destinationConnectorKey: config?.destinationConnectorKey ?? EMPTY_DRAFT.destinationConnectorKey,
    completionPolicy: config?.completionPolicy ?? EMPTY_DRAFT.completionPolicy,
    evidenceRequired: config?.evidenceRequired ?? Boolean(initial.evidenceRequirement),
    acceptedEvidenceKinds: config?.acceptedEvidenceKinds ?? EMPTY_DRAFT.acceptedEvidenceKinds,
    instrumentId: config?.accreditationBindingId ?? "",
    reminderRules: initial.reminderRules,
    evidenceRequirement: initial.evidenceRequirement ?? "",
    notes: initial.notes ?? "",
  }
}

export type PdtpActivityCreatorProps = {
  mode: PdtpActivityCreatorMode
  programId?: string
  programs?: PdtpActivityCreatorProgramOption[]
  responsibleCatalog: ResponsibleOption[]
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  generalViewCode?: string
  programYear?: number
  programPeriodStart?: string | null
  programPeriodEnd?: string | null
  connectors?: ConnectorOption[]
  instruments?: InstrumentOption[]
  initialCatalogActivityId?: string
  initialActivity?: PdtpActivityCreatorInitialValue
  canCreateCatalogActivity?: boolean
  onSaved?: () => void
  onCancel?: () => void
}

export function PdtpActivityCreator({
  mode,
  programId,
  programs = [],
  responsibleCatalog,
  catalogActivities,
  generalViewCode = "pdtp_general",
  programYear,
  programPeriodStart,
  programPeriodEnd,
  connectors = DEFAULT_CONNECTORS,
  instruments = [],
  initialCatalogActivityId,
  initialActivity,
  canCreateCatalogActivity = false,
  onSaved,
  onCancel,
}: PdtpActivityCreatorProps) {
  const router = useRouter()
  const [selectedProgramId, setSelectedProgramId] = React.useState(programId ?? programs[0]?.id ?? "")
  const selectedProgram = programs.find((program) => program.id === selectedProgramId)
  const effectiveProgramId = programId ?? selectedProgramId
  const storageKey = `pdtp-builder:${effectiveProgramId || "sin-programa"}:activity-draft:${mode}`
  const defaultResponsibleSlug = responsibleCatalog[0]?.slug ?? ""
  const defaultYear = programYear ?? selectedProgram?.year ?? codeYear()
  const defaultStartDate = programPeriodStart ?? selectedProgram?.periodStart ?? `${defaultYear}-01-01`
  const defaultEndDate = programPeriodEnd ?? selectedProgram?.periodEnd ?? `${defaultYear}-12-31`
  const allowNewCatalogActivity = mode === "admin_create_and_add" && canCreateCatalogActivity
  const initialSourceKind: Draft["sourceKind"] = allowNewCatalogActivity ? "new" : "catalog"
  const [draft, setDraft] = React.useState<Draft>(() => ({
    ...draftFromInitial(initialActivity, {
      responsibleSlug: defaultResponsibleSlug,
      startDate: defaultStartDate,
      endDate: defaultEndDate,
      sourceKind: initialSourceKind,
    }),
    catalogActivityId: initialActivity?.catalogActivityId ?? initialCatalogActivityId ?? "",
  }))
  const [hydrated, setHydrated] = React.useState(mode === "edit")
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null)

  React.useEffect(() => {
    if (mode === "edit") return
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Draft>
        const legacyOffset = (parsed as Partial<Draft> & { reminderOffset?: unknown }).reminderOffset
        const storedRules = Array.isArray(parsed.reminderRules)
          ? parsed.reminderRules.filter((rule): rule is ReminderDraft => Boolean(rule && typeof rule === "object"
            && typeof (rule as ReminderDraft).offsetValue === "number"
            && ((rule as ReminderDraft).offsetUnit === "hour" || (rule as ReminderDraft).offsetUnit === "day")))
          : typeof legacyOffset === "number" && Number.isFinite(legacyOffset)
            ? [{ offsetValue: legacyOffset, offsetUnit: "day" as const }]
            : EMPTY_DRAFT.reminderRules
        setDraft({
          ...EMPTY_DRAFT,
          ...parsed,
          reminderRules: storedRules,
          catalogActivityId: initialCatalogActivityId || parsed.catalogActivityId || "",
          responsibleSlug: parsed.responsibleSlug || defaultResponsibleSlug,
          startDate: parsed.startDate || defaultStartDate,
          endDate: parsed.endDate || defaultEndDate,
        })
      }
    } catch {
      // Un borrador local corrupto o storage deshabilitado no bloquea el formulario.
    }
    setHydrated(true)
  }, [defaultEndDate, defaultResponsibleSlug, defaultStartDate, initialCatalogActivityId, initialSourceKind, mode, storageKey])

  React.useEffect(() => {
    if (!hydrated || mode === "edit") return
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)) } catch { /* almacenamiento opcional */ }
  }, [draft, hydrated, mode, storageKey])

  function selectProgram(nextProgramId: string) {
    const nextProgram = programs.find((program) => program.id === nextProgramId)
    setSelectedProgramId(nextProgramId)
    if (!nextProgram) return
    setDraft((current) => ({
      ...current,
      startDate: nextProgram.periodStart ?? `${nextProgram.year}-01-01`,
      endDate: nextProgram.periodEnd ?? `${nextProgram.year}-12-31`,
      oneTimeDate: "",
    }))
    setMessage(null)
  }

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === "catalogActivityId" || key === "destinationConnectorKey" ? { instrumentId: "" } : {}),
    }))
    setMessage(null)
  }

  function updateReminderRule(index: number, patchValue: Partial<ReminderDraft>) {
    setDraft((current) => ({
      ...current,
      reminderRules: current.reminderRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patchValue } : rule),
    }))
    setMessage(null)
  }

  function addReminderRule() {
    setDraft((current) => current.reminderRules.length >= 20
      ? current
      : { ...current, reminderRules: [...current.reminderRules, { offsetValue: 0, offsetUnit: "day" }] })
    setMessage(null)
  }

  function removeReminderRule(index: number) {
    setDraft((current) => ({ ...current, reminderRules: current.reminderRules.filter((_, ruleIndex) => ruleIndex !== index) }))
    setMessage(null)
  }

  const recurrenceRule: PdtpRecurrenceRule = {
    frequency: compatibilityFrequency(draft.recurrenceUnit, draft.recurrenceEvery),
    interval: draft.recurrenceUnit === "month" || draft.recurrenceUnit === "year" ? draft.recurrenceEvery : draft.interval,
    plannedQuantity: draft.plannedQuantity,
    weekOfMonth: draft.weekOfMonth,
  }
  const selectedCatalogActivity = catalogActivities.find((activity) => activity.id === draft.catalogActivityId)
  const selectedDestination = connectors.find((connector) => connector.key === draft.destinationConnectorKey) ?? connectors[0]
  const selectedTriggerConnector = connectors.find((connector) => connector.key === draft.triggerConnectorKey) ?? connectors[0]
  const availableEvents = selectedTriggerConnector?.supportedEvents ?? []
  const acceptedEvidenceKinds = selectedDestination?.supportedEvidenceKinds ?? []
  const availableInstruments = instruments.filter((instrument) => instrument.catalogActivityId === selectedCatalogActivity?.id
    && (selectedDestination?.supportedBindingSourceTypes ?? []).includes(instrument.sourceType))

  React.useEffect(() => {
    if (!selectedDestination) return
    setDraft((current) => ({
      ...current,
      completionPolicy: selectedDestination.supportedCompletionPolicies.includes(current.completionPolicy)
        ? current.completionPolicy
        : (selectedDestination.supportedCompletionPolicies[0] ?? "manual_confirmed"),
      acceptedEvidenceKinds: current.acceptedEvidenceKinds.filter((kind) => selectedDestination.supportedEvidenceKinds.includes(kind)),
    }))
  }, [selectedDestination])
  const recurrencePreview = draft.scheduleMode === "scheduled"
    ? draft.scheduleKind === "one_time"
      ? "Una ejecución en la fecha seleccionada."
      : (() => {
          try {
            const occurrences = expandPdtpScheduleDefinition({
              version: 1,
              kind: "recurring",
              startDate: draft.startDate,
              endDate: draft.endDate,
              every: draft.recurrenceEvery,
              unit: draft.recurrenceUnit,
              ...(draft.recurrenceUnit === "week" ? { weekdays: draft.weekdays } : {}),
              ...(draft.recurrenceUnit === "month" || draft.recurrenceUnit === "year" ? { dayOfMonth: draft.dayOfMonth } : {}),
              plannedQuantity: draft.plannedQuantity,
            }, { startDate: defaultStartDate, endDate: defaultEndDate })
            const unit = draft.recurrenceUnit === "day" ? "día" : draft.recurrenceUnit === "week" ? "semana" : draft.recurrenceUnit === "month" ? "mes" : "año"
            return `Cada ${draft.recurrenceEvery} ${pluralize(draft.recurrenceEvery, unit)}. Genera ${countOf(occurrences.length, "obligación", "obligaciones")} en el período del programa.`
          } catch {
            return "Define un inicio y fin válidos para previsualizar la recurrencia."
          }
        })()
    : draft.scheduleMode === "on_demand"
      ? "No genera una cuota semanal. Se mide solo cuando existan solicitudes o casos reales."
      : `Cada evento abre una obligación con plazo de ${draft.dueUnit === "day" ? draft.dueDays : draft.dueHours} ${pluralize(draft.dueUnit === "day" ? draft.dueDays : draft.dueHours, draft.dueUnit === "day" ? "día" : "hora")}.`
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!effectiveProgramId) {
      setMessage({ ok: false, text: "Selecciona un programa anual editable." })
      return
    }
    if (mode === "edit" && !initialActivity) {
      setMessage({ ok: false, text: "No se encontró la actividad que quieres editar." })
      return
    }
    if (mode !== "edit" && draft.sourceKind === "catalog" && !selectedCatalogActivity) {
      setMessage({ ok: false, text: "Selecciona una actividad del catálogo antes de guardar." })
      return
    }
    if (mode !== "edit" && draft.sourceKind === "new" && (!draft.code.trim() || !draft.title.trim() || !draft.description.trim() || !draft.executionGuidance.trim())) {
      setMessage({ ok: false, text: "Completa código, título, descripción y guía de ejecución." })
      return
    }
    if (!draft.responsibleSlug) {
      setMessage({ ok: false, text: "Selecciona el responsable antes de guardar." })
      return
    }
    if (draft.scheduleMode === "triggered" && !draft.triggerDescription.trim()) {
      setMessage({ ok: false, text: "Describe el evento que debe generar la obligación." })
      return
    }
    if (draft.scheduleMode === "scheduled" && draft.scheduleKind === "one_time" && !draft.oneTimeDate) {
      setMessage({ ok: false, text: "Selecciona la fecha de la actividad." })
      return
    }
    if (draft.scheduleMode === "scheduled" && draft.scheduleKind === "recurring" && (!draft.startDate || !draft.endDate)) {
      setMessage({ ok: false, text: "Define el inicio y el fin de la recurrencia." })
      return
    }
    if (!selectedDestination) {
      setMessage({ ok: false, text: "Selecciona el submódulo donde se ejecutará la actividad." })
      return
    }

    const responsible = responsibleCatalog.find((option) => option.slug === draft.responsibleSlug)
    const scheduleDefinition = draft.scheduleMode === "scheduled"
      ? draft.scheduleKind === "one_time"
        ? { version: 1 as const, kind: "one_time" as const, date: draft.oneTimeDate }
        : {
            version: 1 as const,
            kind: "recurring" as const,
            startDate: draft.startDate,
            endDate: draft.endDate,
            every: draft.recurrenceEvery,
            unit: draft.recurrenceUnit,
            ...(draft.recurrenceUnit === "week" ? { weekdays: draft.weekdays } : {}),
            ...(draft.recurrenceUnit === "month" || draft.recurrenceUnit === "year" ? { dayOfMonth: draft.dayOfMonth } : {}),
            plannedQuantity: draft.plannedQuantity,
          }
      : draft.scheduleMode === "triggered"
        ? {
            version: 1 as const,
            kind: "event" as const,
            triggerConnectorKey: draft.triggerConnectorKey,
            triggerEventKey: draft.triggerEventKey,
            dueValue: draft.dueUnit === "day" ? draft.dueDays : draft.dueHours,
            dueUnit: draft.dueUnit,
          }
        : { version: 1 as const, kind: "on_demand" as const, dueValue: draft.dueUnit === "day" ? draft.dueDays : draft.dueHours, dueUnit: draft.dueUnit }
    const executionConfig = {
      destinationConnectorKey: selectedDestination.key,
      completionPolicy: draft.completionPolicy,
      evidencePolicy: {
        required: draft.evidenceRequired,
        acceptedKinds: draft.acceptedEvidenceKinds.filter((kind) => acceptedEvidenceKinds.includes(kind)),
      },
      accreditationBindingId: draft.instrumentId || null,
    }
    setPending(true)
    setMessage(null)
    try {
      const common = {
        responsibleSlugs: [draft.responsibleSlug],
        responsibleDisplay: responsible?.displayName ?? draft.responsibleSlug,
        audienceRoles: draft.audienceRoles.split(",").map((role) => role.trim()).filter(Boolean),
        scheduleMode: draft.scheduleMode,
        recurrenceRule: draft.scheduleMode === "scheduled" ? recurrenceRule : null,
        scheduleDefinition,
        executionConfig,
        reminderRules: draft.reminderRules,
        triggerType: draft.scheduleMode === "triggered" ? draft.triggerType || "evento_operacional" : null,
        triggerDescription: draft.scheduleMode === "triggered" ? draft.triggerDescription : null,
        dueDays: draft.scheduleMode === "scheduled" || draft.dueUnit === "hour" ? null : draft.dueDays,
        dueHours: draft.scheduleMode === "scheduled" || draft.dueUnit === "day" ? null : draft.dueHours,
        evidenceRequirement: draft.evidenceRequirement || null,
        indicatorMode: draft.scheduleMode === "scheduled" ? "planned_vs_completed" : "closed_on_time",
        targetValue: 100,
        targetUnit: "%",
        notes: draft.notes,
      }
      const catalogContent = selectedCatalogActivity
        ? { activity: selectedCatalogActivity.description, program: selectedCatalogActivity.executionGuidance }
        : { activity: draft.description, program: draft.executionGuidance }
      const result = mode === "edit"
        ? await updatePdtpActivityAction({
          activityId: initialActivity!.id,
          ...catalogContent,
          ...common,
          executionConfig,
          reminderRules: draft.reminderRules,
          dueDays: draft.scheduleMode === "scheduled" || draft.dueUnit === "hour" ? null : draft.dueDays,
          dueHours: draft.scheduleMode === "scheduled" || draft.dueUnit === "day" ? null : draft.dueHours,
        })
        : await savePdtpProgramActivityAction({
          programId: effectiveProgramId,
          sheetCode: generalViewCode,
          source: draft.sourceKind === "new"
            ? {
              kind: "new" as const,
              code: draft.code,
              title: draft.title,
              description: draft.description,
              executionGuidance: draft.executionGuidance,
            }
            : { kind: "catalog" as const, catalogActivityId: selectedCatalogActivity!.id },
          responsibleSlug: draft.responsibleSlug,
          audienceRoles: common.audienceRoles,
          scheduleMode: common.scheduleMode,
          recurrenceRule: common.recurrenceRule,
          scheduleDefinition,
          executionConfig,
          reminderRules: draft.reminderRules,
          triggerType: common.triggerType,
          triggerDescription: common.triggerDescription,
          evidenceRequirement: common.evidenceRequirement,
          notes: common.notes,
        })
      if (!result.ok) {
        setMessage({ ok: false, text: result.message ?? "No se pudo guardar la actividad." })
        return
      }

      try { window.localStorage.removeItem(storageKey) } catch { /* almacenamiento opcional */ }
      if (mode !== "edit") setDraft({ ...EMPTY_DRAFT, sourceKind: allowNewCatalogActivity ? "new" : "catalog", responsibleSlug: defaultResponsibleSlug, startDate: defaultStartDate, endDate: defaultEndDate })
      setMessage({ ok: true, text: mode === "edit" ? "Actividad actualizada." : "Actividad creada e incorporada al programa." })
      router.refresh()
      onSaved?.()
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
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            {mode === "edit" ? "Editar actividad preventiva" : mode === "admin_create_and_add" ? "Publicar y agregar actividad" : "Agregar actividad al programa"}
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {mode === "edit" ? "Actualiza la programación y las reglas de ejecución sin alterar el historial." : "Define la actividad y configura cómo se ejecutará en el programa anual."}
          </p>
        </div>
        <MetaBadge meta={{ label: mode === "edit" ? "Configuración existente" : hydrated ? "Borrador local guardado" : "Preparando borrador", variant: "outline" }} />
      </div>

      <FieldGroup className="gap-4">
        {mode === "admin_create_and_add" && (
          <>
            {programs.length > 0 && (
              <Field label="Programa anual" htmlFor="pdtp-creator-program" required>
                <Select value={selectedProgramId} onValueChange={selectProgram}>
                  <SelectTrigger id="pdtp-creator-program"><SelectValue placeholder="Selecciona un programa borrador" /></SelectTrigger>
                  <SelectContent>{programs.map((program) => <SelectItem key={program.id} value={program.id}>{program.title} · {program.year} · v{program.version}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            {allowNewCatalogActivity && <fieldset>
              <legend className="mb-2 text-sm font-medium text-[var(--color-text)]">Origen de la actividad</legend>
              <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
                <Button type="button" size="sm" variant={draft.sourceKind === "catalog" ? "primary" : "ghost"} onClick={() => patch("sourceKind", "catalog")}>Usar existente</Button>
                <Button type="button" size="sm" variant={draft.sourceKind === "new" ? "primary" : "ghost"} onClick={() => patch("sourceKind", "new")}>Crear nueva</Button>
              </div>
            </fieldset>}
          </>
        )}

        {mode === "edit" || draft.sourceKind === "catalog" ? (
          <div>
            <PdtpActivityPicker
              label="Actividad preventiva"
              options={catalogActivities}
              value={draft.catalogActivityId}
              onChange={(value) => patch("catalogActivityId", value)}
              disabled={mode === "edit"}
            />
            {selectedCatalogActivity && (
              <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
                <p className="font-semibold text-[var(--color-text)]">{selectedCatalogActivity.title}</p>
                <p className="mt-1 text-[var(--color-text-muted)]">{selectedCatalogActivity.description}</p>
                <p className="mt-2 text-xs text-[var(--color-text-subtle)]"><span className="font-semibold">Guía:</span> {selectedCatalogActivity.executionGuidance}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <Field label="Código de catálogo" htmlFor="pdtp-creator-code" required>
              <Input id="pdtp-creator-code" value={draft.code} onChange={(event) => patch("code", event.target.value.toUpperCase())} maxLength={120} required />
            </Field>
            <Field label="Título" htmlFor="pdtp-creator-title" required>
              <Input id="pdtp-creator-title" value={draft.title} onChange={(event) => patch("title", event.target.value)} maxLength={80} required />
            </Field>
            <Field label="Descripción" htmlFor="pdtp-creator-description" required>
              <Textarea id="pdtp-creator-description" value={draft.description} onChange={(event) => patch("description", event.target.value)} rows={3} maxLength={4000} required />
            </Field>
            <Field label="Guía de ejecución" htmlFor="pdtp-creator-guidance" required>
              <Textarea id="pdtp-creator-guidance" value={draft.executionGuidance} onChange={(event) => patch("executionGuidance", event.target.value)} rows={2} maxLength={2000} required />
            </Field>
          </div>
        )}

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
          <div className="space-y-4 rounded-lg bg-[var(--color-surface-2)] p-3">
            <Field label="Tipo de programación" htmlFor="guided-schedule-kind">
              <Select value={draft.scheduleKind} onValueChange={(value) => patch("scheduleKind", value as Draft["scheduleKind"])}>
                <SelectTrigger id="guided-schedule-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recurring">Recurrencia</SelectItem>
                  <SelectItem value="one_time">Fecha específica</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {draft.scheduleKind === "one_time" ? (
              <Field label="Fecha planificada" htmlFor="guided-one-time-date" required>
                <DatePicker id="guided-one-time-date" ariaLabel="Fecha planificada" value={draft.oneTimeDate} onChange={(value) => patch("oneTimeDate", value)} min={programPeriodStart ?? undefined} max={programPeriodEnd ?? undefined} />
              </Field>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Inicio" htmlFor="guided-start-date" required>
                    <DatePicker id="guided-start-date" ariaLabel="Inicio de recurrencia" value={draft.startDate} onChange={(value) => patch("startDate", value)} min={programPeriodStart ?? undefined} max={programPeriodEnd ?? undefined} />
                  </Field>
                  <Field label="Fin" htmlFor="guided-end-date" required>
                    <DatePicker id="guided-end-date" ariaLabel="Fin de recurrencia" value={draft.endDate} onChange={(value) => patch("endDate", value)} min={programPeriodStart ?? undefined} max={programPeriodEnd ?? undefined} />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label="Cada" htmlFor="guided-every">
                    <Input id="guided-every" type="number" min="1" max="366" value={draft.recurrenceEvery} onChange={(event) => patch("recurrenceEvery", Number(event.target.value))} />
                  </Field>
                  <Field label="Unidad" htmlFor="guided-unit">
                    <Select value={draft.recurrenceUnit} onValueChange={(value) => patch("recurrenceUnit", value as Draft["recurrenceUnit"])}>
                      <SelectTrigger id="guided-unit"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">días</SelectItem>
                        <SelectItem value="week">semanas</SelectItem>
                        <SelectItem value="month">meses</SelectItem>
                        <SelectItem value="year">años</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Cantidad por fecha" htmlFor="guided-quantity">
                    <Input id="guided-quantity" type="number" min="0.25" step="0.25" value={draft.plannedQuantity} onChange={(event) => patch("plannedQuantity", Number(event.target.value))} />
                  </Field>
                  {(draft.recurrenceUnit === "month" || draft.recurrenceUnit === "year") && (
                    <Field label="Día del período" htmlFor="guided-day-of-month" helper="Si el mes no tiene ese día, se usa su último día.">
                      <Input id="guided-day-of-month" type="number" min="1" max="31" value={draft.dayOfMonth} onChange={(event) => patch("dayOfMonth", Number(event.target.value))} />
                    </Field>
                  )}
                </div>
                {draft.recurrenceUnit === "week" && (
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-[var(--color-text)]">Días de la semana (ISO)</legend>
                    <div className="flex flex-wrap gap-2">
                      {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((label, index) => {
                        const weekday = index + 1
                        const checked = draft.weekdays.includes(weekday)
                        return <label key={weekday} className="inline-flex items-center gap-2 text-sm text-[var(--color-text)]"><input type="checkbox" checked={checked} onChange={() => patch("weekdays", checked ? draft.weekdays.filter((day) => day !== weekday) : [...draft.weekdays, weekday].sort())} />{label}</label>
                      })}
                    </div>
                  </fieldset>
                )}
              </>
            )}
          </div>
        )}

        {draft.scheduleMode === "triggered" && (
          <div className="grid gap-4 rounded-lg bg-[var(--color-surface-2)] p-3 md:grid-cols-2">
            <Field label="Conector que emite el evento" htmlFor="guided-trigger-connector" required>
              <Select value={draft.triggerConnectorKey} onValueChange={(value) => { patch("triggerConnectorKey", value); const next = connectors.find((connector) => connector.key === value)?.supportedEvents[0]; if (next) patch("triggerEventKey", next.key) }}>
                <SelectTrigger id="guided-trigger-connector"><SelectValue /></SelectTrigger>
                <SelectContent>{connectors.filter((connector) => connector.supportedEvents.length > 0).map((connector) => <SelectItem key={connector.key} value={connector.key}>{connector.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Evento" htmlFor="guided-trigger-event" required>
              <Select value={draft.triggerEventKey} onValueChange={(value) => patch("triggerEventKey", value)}>
                <SelectTrigger id="guided-trigger-event"><SelectValue /></SelectTrigger>
                <SelectContent>{availableEvents.map((event) => <SelectItem key={event.key} value={event.key}>{event.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Evento que genera la obligación — descripción operativa" htmlFor="guided-trigger" required>
              <Input id="guided-trigger" value={draft.triggerDescription} onChange={(event) => patch("triggerDescription", event.target.value)} placeholder="Ej.: ingreso de un trabajador nuevo" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
              <Field label="Plazo" htmlFor="guided-due-value" helper="Se cuenta desde el evento que seleccionaste.">
                <Input
                  id="guided-due-value"
                  type="number"
                  min="1"
                  max={draft.dueUnit === "day" ? 3650 : 8760}
                  value={draft.dueUnit === "day" ? draft.dueDays : draft.dueHours}
                  onChange={(event) => patch(draft.dueUnit === "day" ? "dueDays" : "dueHours", event.target.value === "" ? 0 : Number(event.target.value))}
                />
              </Field>
              <Field label="Unidad" htmlFor="guided-due-unit">
                <Select value={draft.dueUnit} onValueChange={(value) => patch("dueUnit", value as Draft["dueUnit"]) }>
                  <SelectTrigger id="guided-due-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour">horas</SelectItem>
                    <SelectItem value="day">días</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
        )}

        {draft.scheduleMode === "on_demand" && (
          <div className="grid gap-4 rounded-lg bg-[var(--color-surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
            <Field label="Plazo objetivo cuando exista un caso" htmlFor="guided-on-demand-due" helper="No se contabiliza nada mientras no existan casos reales.">
              <Input id="guided-on-demand-due" type="number" min="1" max={draft.dueUnit === "day" ? 3650 : 8760} value={draft.dueUnit === "day" ? draft.dueDays : draft.dueHours} onChange={(event) => patch(draft.dueUnit === "day" ? "dueDays" : "dueHours", event.target.value === "" ? 0 : Number(event.target.value))} />
            </Field>
            <Field label="Unidad" htmlFor="guided-on-demand-due-unit">
              <Select value={draft.dueUnit} onValueChange={(value) => patch("dueUnit", value as Draft["dueUnit"]) }>
                <SelectTrigger id="guided-on-demand-due-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour">horas</SelectItem>
                  <SelectItem value="day">días</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        <p className="rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-3 py-2 text-sm text-[var(--color-info-ink)]">
          <span className="font-semibold">Vista previa:</span> {recurrencePreview}
        </p>

        <section className="space-y-4 rounded-lg border border-[var(--color-border)] p-3" aria-labelledby="guided-execution-heading">
          <div>
            <h4 id="guided-execution-heading" className="text-sm font-semibold text-[var(--color-text)]">¿Dónde se ejecuta?</h4>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">La instancia aparecerá en Pendientes y abrirá el registro nativo del submódulo seleccionado.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Submódulo" htmlFor="guided-destination" required>
              <Select value={draft.destinationConnectorKey} onValueChange={(value) => patch("destinationConnectorKey", value)}>
                <SelectTrigger id="guided-destination"><SelectValue /></SelectTrigger>
                <SelectContent>{connectors.map((connector) => <SelectItem key={connector.key} value={connector.key}>{connector.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Criterio de cumplimiento" htmlFor="guided-completion-policy" required>
              <Select value={draft.completionPolicy} onValueChange={(value) => patch("completionPolicy", value as PdtpCompletionPolicy)}>
                <SelectTrigger id="guided-completion-policy"><SelectValue /></SelectTrigger>
                <SelectContent>{(selectedDestination?.supportedCompletionPolicies ?? []).map((policy) => <SelectItem key={policy} value={policy}>{policy === "manual_confirmed" ? "Confirmación manual" : policy === "source_completed" ? "Registro completado" : policy === "source_approved" ? "Registro aprobado" : "Checklist completado"}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {availableInstruments.length > 0 && (
              <Field label="Instrumento específico" htmlFor="guided-instrument" helper="Opcional: relaciona esta actividad con una plantilla, curso o registro ya configurado.">
                <Select value={draft.instrumentId || "none"} onValueChange={(value) => patch("instrumentId", value === "none" ? "" : value)}>
                  <SelectTrigger id="guided-instrument"><SelectValue placeholder="Sin instrumento específico" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin instrumento específico</SelectItem>
                    {availableInstruments.map((instrument) => <SelectItem key={instrument.id} value={instrument.id}>{instrument.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <details className="rounded-lg border border-[var(--color-border)] px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">Evidencia y recordatorios</summary>
            <div className="mt-4 space-y-4">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text)]"><input type="checkbox" checked={draft.evidenceRequired} onChange={(event) => patch("evidenceRequired", event.target.checked)} />Evidencia requerida</label>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-[var(--color-text)]">Mecanismos admitidos</legend>
                <div className="flex flex-wrap gap-3">
                  {acceptedEvidenceKinds.map((kind) => {
                    const checked = draft.acceptedEvidenceKinds.includes(kind)
                    return <label key={kind} className="inline-flex items-center gap-2 text-sm text-[var(--color-text)]"><input type="checkbox" checked={checked} onChange={() => patch("acceptedEvidenceKinds", checked ? draft.acceptedEvidenceKinds.filter((item) => item !== kind) : [...draft.acceptedEvidenceKinds, kind])} />{EVIDENCE_LABELS[kind]}</label>
                  })}
                </div>
              </fieldset>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">Recordatorios</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Negativo = antes, cero = el día, positivo = después de vencer.</p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={addReminderRule} disabled={draft.reminderRules.length >= 20}>
                    Agregar recordatorio
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  {draft.reminderRules.length === 0 && (
                    <p className="rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">Sin recordatorios configurados.</p>
                  )}
                  {draft.reminderRules.map((rule, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,8rem)_minmax(0,10rem)_auto] sm:items-end">
                      <Field label={`Desfase ${index + 1}`} htmlFor={`guided-reminder-${index}`}>
                        <Input
                          id={`guided-reminder-${index}`}
                          aria-label={`Desfase del recordatorio ${index + 1}`}
                          type="number"
                          min="-8760"
                          max="8760"
                          value={rule.offsetValue}
                          onChange={(event) => updateReminderRule(index, { offsetValue: event.target.value === "" ? 0 : Number(event.target.value) })}
                        />
                      </Field>
                      <Field label="Unidad" htmlFor={`guided-reminder-unit-${index}`}>
                        <Select value={rule.offsetUnit} onValueChange={(value) => updateReminderRule(index, { offsetUnit: value as ReminderDraft["offsetUnit"] })}>
                          <SelectTrigger id={`guided-reminder-unit-${index}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hour">horas</SelectItem>
                            <SelectItem value="day">días</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeReminderRule(index)} aria-label={`Quitar recordatorio ${index + 1}`}>
                        Quitar
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </section>

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

      <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" loading={pending}>Guardar actividad</Button>
      </div>
    </form>
  )
}
