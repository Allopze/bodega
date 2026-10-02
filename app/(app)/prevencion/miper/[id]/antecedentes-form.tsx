"use client"

import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { HEADER_FIELD_LABEL } from "@/lib/prevention/miper/snapshot"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { updateMiperHeaderAction } from "../actions"

type Header = MiperWorkspace["snapshot"]["header"]
type HeadcountKey = "headcountTotal" | "headcountMale" | "headcountFemale" | "headcountOther"

/**
 * Un valor prellenado se muestra con su fuente y se puede volver a traer.
 *
 * `Field.helper` es un `string` en `components/ui/field.tsx` (no admite JSX), así
 * que acá el texto de la fuente va en el helper —el campo lo anuncia— y
 * "Restaurar" queda como control hermano, justo debajo, sólo cuando el valor
 * guardado difiere de su fuente.
 */
function PrefilledField({ label, required, helper, error, onRestore, children }: {
  label: string
  required?: boolean
  helper?: string
  error?: string
  onRestore?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <Field label={label} required={required} helper={helper} error={error}>{children}</Field>
      {onRestore && (
        <button type="button" onClick={onRestore} className="mt-1 self-start text-xs text-[var(--color-text-subtle)] underline underline-offset-2 hover:text-[var(--color-text)]">
          Restaurar valor prellenado
        </button>
      )}
    </div>
  )
}

/** Lo que viaja al servidor: `period` lo fija la matriz al crearla y no se edita. */
function payloadOf(header: Header) {
  const { period: _period, ...payload } = header
  return payload
}

/**
 * Antecedentes RE-04 (identificación, dotación, responsables). Vive en la
 * «Ficha del documento» (spec §5.7): `onSaved` la cierra al guardar y
 * `onDirtyChange` le avisa si hay cambios sin guardar para pedir confirmación.
 */
export function AntecedentesForm({ workspace, editable, onSaved, onDirtyChange }: {
  workspace: MiperWorkspace
  editable: boolean
  onSaved?: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const router = useRouter()
  const { prefill, matrix } = workspace
  const [header, setHeader] = useState<Header>(workspace.snapshot.header)
  // Lo último que el servidor confirmó: contra esto se mide «sin guardar».
  const [saved, setSaved] = useState<Header>(workspace.snapshot.header)
  const [version, setVersion] = useState(matrix.version)
  const dirty = editable && JSON.stringify(payloadOf(header)) !== JSON.stringify(payloadOf(saved))
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const set = <K extends keyof Header>(key: K, value: Header[K]) => setHeader((current) => ({ ...current, [key]: value }))
  const num = (value: string) => (value === "" ? null : Number(value))

  /** Valor prellenado desde su fuente: se muestra y se puede restaurar. */
  const sources: Partial<Record<keyof Header, { value: string | number | null; from: string }>> = {
    companyName: { value: prefill.companyName, from: "perfil de empresa" },
    companyRut: { value: prefill.companyRut, from: "perfil de empresa" },
    companyAddress: { value: prefill.companyAddress, from: "perfil de empresa" },
    economicActivity: { value: prefill.economicActivity, from: "perfil de empresa" },
    adherentNumber: { value: prefill.adherentNumber || null, from: "perfil de empresa" },
    companyCommune: { value: prefill.companyCommune, from: "ficha de la faena" },
    worksiteName: { value: prefill.worksiteName, from: "ficha de la faena" },
    siteRepresentativeName: { value: prefill.siteRepresentativeName, from: "Administrador de contrato asignado a la faena" },
    headcountTotal: { value: prefill.headcount.total, from: "trabajadores activos de la faena" },
    headcountMale: { value: prefill.headcount.male, from: "trabajadores activos" },
    headcountFemale: { value: prefill.headcount.female, from: "trabajadores activos" },
    headcountOther: { value: prefill.headcount.other, from: "trabajadores activos (incluye sin sexo registrado)" },
  }
  function sourceHint(key: keyof Header) {
    const source = sources[key]
    if (!source || source.value === null || source.value === "") return undefined
    return `Desde ${source.from}: ${String(source.value)}`
  }
  function restore(key: keyof Header) {
    const source = sources[key]
    if (!source) return
    set(key, source.value as never)
    if (key === "siteRepresentativeName") set("siteRepresentativeUserId", prefill.siteRepresentativeUserId)
  }
  function restorable(key: keyof Header) {
    const source = sources[key]
    if (!editable || !source || source.value === null || source.value === "") return false
    return source.value !== header[key]
  }
  function textField(key: keyof Header, options: { required?: boolean } = {}) {
    return (
      <PrefilledField label={HEADER_FIELD_LABEL[key]} required={options.required} helper={sourceHint(key)} onRestore={restorable(key) ? () => restore(key) : undefined}>
        <Input value={(header[key] as string | null) ?? ""} disabled={!editable} onChange={(event) => set(key, (event.target.value || null) as never)} />
      </PrefilledField>
    )
  }
  function numberField(key: HeadcountKey) {
    return (
      <PrefilledField label={HEADER_FIELD_LABEL[key]} required helper={sourceHint(key)} onRestore={restorable(key) ? () => restore(key) : undefined}>
        <Input type="number" min={0} value={header[key] ?? ""} disabled={!editable} onChange={(event) => set(key, num(event.target.value))} />
      </PrefilledField>
    )
  }
  const sum = (header.headcountMale ?? 0) + (header.headcountFemale ?? 0) + (header.headcountOther ?? 0)
  const sumMismatch = header.headcountTotal !== null && sum !== header.headcountTotal

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitted = header
    operation.run(() => updateMiperHeaderAction({ matrixId: matrix.id, expectedVersion: version, ...payloadOf(submitted) }), (result) => {
      if (typeof result.data?.version === "number") setVersion(result.data.version)
      setSaved(submitted)
      onSaved?.()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <h3 className="md:col-span-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Identificación</h3>
        {textField("iperCode")}
        <Field label="Período"><Input value={header.period ?? ""} disabled /></Field>
        <Field label={HEADER_FIELD_LABEL.elaboratedOn} required><DatePicker value={header.elaboratedOn ?? undefined} disabled={!editable} onChange={(iso) => set("elaboratedOn", iso)} /></Field>
        <Field label={HEADER_FIELD_LABEL.updatedOn} error={header.updatedOn && header.elaboratedOn && header.updatedOn < header.elaboratedOn ? "No puede ser anterior a la fecha de elaboración." : undefined}>
          <DatePicker value={header.updatedOn ?? undefined} min={header.elaboratedOn ?? undefined} disabled={!editable} onChange={(iso) => set("updatedOn", iso)} />
        </Field>
        {textField("companyName")}
        {textField("companyRut")}
        {textField("companyAddress")}
        {textField("companyCommune")}
        {textField("economicActivity")}
        {textField("adherentNumber")}
        {textField("worksiteName")}
      </section>
      <section className="grid gap-4 md:grid-cols-4">
        <h3 className="md:col-span-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Dotación</h3>
        {numberField("headcountTotal")}{numberField("headcountMale")}{numberField("headcountFemale")}{numberField("headcountOther")}
        {sumMismatch && <p role="alert" className="md:col-span-4 text-sm text-[var(--color-danger-ink)]">Hombres + mujeres + otro suman {sum} y el total declarado es {header.headcountTotal}.</p>}
        {prefill.headcount.unrecorded > 0 && <p className="md:col-span-4 text-xs text-[var(--color-text-subtle)]">{prefill.headcount.unrecorded} trabajador(es) activo(s) no tienen el sexo registrado y se cuentan como &quot;otro&quot;. Complétalo en la ficha del trabajador.</p>}
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <h3 className="md:col-span-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Responsables</h3>
        {textField("siteRepresentativeName", { required: true })}
        <Field label="Elaboró / revisó / aprobó" helper="Se registran solos con el flujo de revisión: no se escriben.">
          <Input disabled value={workspace.versions[0] ? `${workspace.versions[0].elaboratedByName} / ${workspace.versions[0].technicalReviewerName} / ${workspace.versions[0].approverName}` : "Se completa al aprobar la primera versión"} />
        </Field>
      </section>
      <section className="grid gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Participación</h3>
        <Field label={HEADER_FIELD_LABEL.participationSummary}><Textarea value={header.participationSummary} disabled={!editable} onChange={(event) => set("participationSummary", event.target.value)} /></Field>
        <Field label={HEADER_FIELD_LABEL.consultationEvidenceReference}><Input value={header.consultationEvidenceReference} disabled={!editable} onChange={(event) => set("consultationEvidenceReference", event.target.value)} /></Field>
      </section>
      {editable && <div className="flex justify-end"><Button type="submit" disabled={operation.pending || sumMismatch}>Guardar antecedentes</Button></div>}
    </form>
  )
}
