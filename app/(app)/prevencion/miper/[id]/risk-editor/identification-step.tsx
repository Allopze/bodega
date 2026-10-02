"use client"

import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { Combobox } from "@/components/ui/combobox"
import { DetailItem } from "@/components/ui/detail-item"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import type { RiskEditorData, StepProps } from "./types"

type TextField = "activity" | "task" | "position" | "location" | "hazard" | "risk" | "probableDamage"
const LIST: Record<TextField, keyof RiskEditorData["dictionaries"]> = {
  activity: "activities", task: "tasks", position: "positions", location: "locations", hazard: "hazards", risk: "risks", probableDamage: "damages",
}
const ROUTINE = [{ value: "yes", title: "Rutinaria" }, { value: "no", title: "No rutinaria" }] as const

export function IdentificationStep({ entry, data, editable, autosave, issues }: StepProps) {
  const commit = (values: MiperEntryValues) => { void autosave.commit(entry, values) }
  const missing = (field: string) => issues.find((issue) => issue.severity === "error" && issue.field === field)?.message
  const id = (field: string) => `${entry.id}-${field}`

  if (!editable) {
    return (
      <dl className="grid gap-3 sm:grid-cols-2">
        {([["Factor de riesgo", entry.riskFactor], ["Rutinaria", entry.isRoutine === null ? null : entry.isRoutine ? "Rutinaria" : "No rutinaria"], ["Peligro", entry.hazard], ["Riesgo", entry.risk], ["Daño probable", entry.probableDamage], ["Actividad", entry.activity], ["Tarea", entry.task], ["Puesto de trabajo", entry.position], ["Lugar específico", entry.location], ["Expuestos F / M / Otro", `${entry.exposedFemale} / ${entry.exposedMale} / ${entry.exposedOther}`]] as const).map(([label, value]) => (
          <DetailItem key={label} label={label} value={value ?? "—"} layout="stacked" />
        ))}
      </dl>
    )
  }

  const text = (field: TextField, label: string, required = true) => (
    <Field label={label} htmlFor={id(field)} required={required} error={autosave.fieldError(entry.id, field)} helper={missing(field)}>
      <Combobox id={id(field)} allowCustomValue options={data.dictionaries[LIST[field]].map((value) => ({ value, label: value }))} value={entry[field] ?? ""} placeholder="Escribe o elige…" onChange={(value) => commit({ [field]: value || null } as MiperEntryValues)} />
    </Field>
  )
  const exposed = (field: "exposedFemale" | "exposedMale" | "exposedOther", label: string) => (
    <Field label={label} htmlFor={id(field)} error={autosave.fieldError(entry.id, field)}>
      <Input id={id(field)} type="number" min={0} inputMode="numeric" defaultValue={entry[field]} key={`${field}-${entry[field]}`}
        onBlur={(event) => {
          const value = Math.max(0, Math.trunc(Number(event.target.value) || 0))
          if (value !== entry[field]) commit({ [field]: value } as MiperEntryValues)
          else event.target.value = String(entry[field])
        }} />
    </Field>
  )
  const placementMissing = Boolean(missing("activity") || missing("task"))
  const factors = data.riskFactors.filter((factor) => factor.isActive || factor.id === entry.riskFactorId)

  return (
    <div className="space-y-6">
      <section aria-labelledby={id("h-peligro")} className="space-y-3">
        <h3 id={id("h-peligro")} className="text-sm font-semibold">Peligro y riesgo</h3>
        <p className="text-sm text-[var(--color-text-subtle)]">Describe la fuente o situación observable y el daño que podría producir.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Factor de riesgo" required error={autosave.fieldError(entry.id, "riskFactorId")} helper={missing("riskFactorId")}>
            <OptionSelect aria-label="Factor de riesgo" emptyLabel="Sin factor" options={factors.map((factor) => ({ value: factor.id, label: factor.name }))} value={entry.riskFactorId ?? ""} onValueChange={(value) => commit({ riskFactorId: value || null })} />
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">¿Es una tarea rutinaria?</p>
            <ChoiceCardGroup label="¿Es una tarea rutinaria?" className="sm:grid-cols-2" options={[...ROUTINE]} value={entry.isRoutine === null ? null : entry.isRoutine ? "yes" : "no"} onChange={(value) => commit({ isRoutine: value === "yes" })} />
            {autosave.fieldError(entry.id, "isRoutine") && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{autosave.fieldError(entry.id, "isRoutine")}</p>}
          </div>
          {text("hazard", "Peligro")}
          {text("risk", "Riesgo")}
          <div className="md:col-span-2">{text("probableDamage", "Daño probable")}</div>
        </div>
      </section>
      <section aria-labelledby={id("h-donde")} className="space-y-3">
        <h3 id={id("h-donde")} className="text-sm font-semibold">Dónde ocurre</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {text("position", "Puesto de trabajo")}
          {text("location", "Lugar específico", false)}
        </div>
        <div className="grid grid-cols-3 gap-3 md:max-w-md">
          {exposed("exposedFemale", "Expuestas (F)")}
          {exposed("exposedMale", "Expuestos (M)")}
          {exposed("exposedOther", "Expuestos (otro)")}
        </div>
      </section>
      <details open={placementMissing || undefined} className="rounded-xl border border-[var(--color-border)] p-3">
        <summary className="cursor-pointer text-sm font-medium">{placementMissing ? "Actividad y tarea" : "Mover a otra actividad o tarea"}</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {text("activity", "Actividad")}
          {text("task", "Tarea")}
        </div>
      </details>
    </div>
  )
}
