"use client"

/**
 * INC-001: el formulario del trabajador. La casilla de anonimato es el punto
 * del hallazgo, no un extra: sin ella el canal existe sólo para quien no teme
 * dar su nombre.
 */

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { INCIDENT_REPORT_CATEGORY_LABELS } from "@/lib/services/prevention-incident-reports"
import { submitPublicIncidentReportAction } from "./actions"

const CATEGORIES = Object.entries(INCIDENT_REPORT_CATEGORY_LABELS)

export function IncidentReportForm({ worksites, initialWorksiteId }: {
  worksites: { id: string; name: string }[]
  initialWorksiteId: string
}) {
  const [worksiteId, setWorksiteId] = useState(initialWorksiteId)
  const [category, setCategory] = useState("cuasi_accidente")
  const [isAnonymous, setIsAnonymous] = useState(true)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    const response = await submitPublicIncidentReportAction({
      worksiteId,
      category,
      occurredAt: form.get("occurredAt"),
      location: form.get("location"),
      narrative: form.get("narrative"),
      isAnonymous,
      reporterName: isAnonymous ? null : form.get("reporterName"),
      reporterContact: isAnonymous ? null : form.get("reporterContact"),
    })
    setPending(false)
    setResult(response)
  }

  if (result?.ok) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <p className="text-sm font-medium">{result.message}</p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Guarda el folio: es la única forma de referirte a este reporte sin identificarte.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Faena">
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger><SelectValue placeholder="Selecciona la faena" /></SelectTrigger>
          <SelectContent>{worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Qué estás reportando">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{CATEGORIES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Cuándo ocurrió"><Input name="occurredAt" type="date" required /></Field>
      <Field label="Dónde ocurrió"><Input name="location" required minLength={3} /></Field>
      <Field label="Qué pasó"><Textarea name="narrative" required minLength={10} rows={5} /></Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={isAnonymous}
          onChange={(event) => setIsAnonymous(event.currentTarget.checked)}
        />
        <span>
          Enviar de forma anónima.
          <span className="block text-xs text-[var(--color-text-muted)]">
            No se guarda tu nombre, tu sesión ni tu conexión: nadie podrá saber quién envió este reporte.
          </span>
        </span>
      </label>

      {!isAnonymous && (
        <div className="grid gap-3">
          <Field label="Tu nombre"><Input name="reporterName" required minLength={3} /></Field>
          <Field label="Cómo contactarte (opcional)"><Input name="reporterContact" /></Field>
        </div>
      )}

      {result && !result.ok && <p role="alert" className="text-sm text-[var(--color-danger)]">{result.message}</p>}
      <Button type="submit" disabled={pending || !worksiteId} className="w-full">Enviar reporte</Button>
    </form>
  )
}
