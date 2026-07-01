"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createEquipmentReportAction } from "../actions"

interface Props {
  worksites: { id: string; name: string }[]
  workers: { id: string; firstName: string; lastName: string }[]
  onDone?: () => void
}

const SHIFT_OPTIONS = [
  { value: "dia", label: "Día" },
  { value: "noche", label: "Noche" },
] as const

const STATUS_OPTIONS = [
  { value: "ok", label: "OK" },
  { value: "observado", label: "Observado" },
  { value: "fuera_servicio", label: "Fuera de servicio" },
] as const

export function ReporteForm({ worksites, workers, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    worksiteId: worksites[0]?.id ?? "",
    equipmentId: "",
    operatorWorkerId: workers[0]?.id ?? "",
    shift: "dia",
    status: "ok",
    odometer: "",
    hourmeter: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})
    if (!form.worksiteId || !form.equipmentId || !form.operatorWorkerId) {
      toast.error("Completa faena, equipo y operador.")
      return
    }
    setSubmitting(true)
    const result = await createEquipmentReportAction({
      worksiteId: form.worksiteId,
      equipmentId: form.equipmentId,
      operatorWorkerId: form.operatorWorkerId,
      shift: form.shift,
      status: form.status as "ok" | "observado" | "fuera_servicio",
      odometer: form.odometer ? Number(form.odometer) : undefined,
      hourmeter: form.hourmeter ? Number(form.hourmeter) : undefined,
      checklist: {},
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Reporte registrado.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="edr-worksite" required error={fieldErrors.worksiteId?.[0]}>
            <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
              <SelectTrigger id="edr-worksite">
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Equipo" htmlFor="edr-equipment" required helper="Código o identificador del equipo" error={fieldErrors.equipmentId?.[0]}>
            <Input
              id="edr-equipment"
              value={form.equipmentId}
              onChange={(e) => setForm((f) => ({ ...f, equipmentId: e.target.value }))}
              placeholder="EXC-001"
              required
            />
          </Field>

          <Field label="Operador" htmlFor="edr-operator" required error={fieldErrors.operatorWorkerId?.[0]}>
            <Select value={form.operatorWorkerId} onValueChange={(v) => setForm((f) => ({ ...f, operatorWorkerId: v }))}>
              <SelectTrigger id="edr-operator">
                <SelectValue placeholder="Selecciona operador" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Turno" htmlFor="edr-shift" required error={fieldErrors.shift?.[0]}>
            <Select value={form.shift} onValueChange={(v) => setForm((f) => ({ ...f, shift: v }))}>
              <SelectTrigger id="edr-shift">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Estado" htmlFor="edr-status" required error={fieldErrors.status?.[0]}>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger id="edr-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Odómetro" htmlFor="edr-odometer" helper="Opcional" error={fieldErrors.odometer?.[0]}>
            <Input
              id="edr-odometer"
              type="number"
              min={0}
              value={form.odometer}
              onChange={(e) => setForm((f) => ({ ...f, odometer: e.target.value }))}
            />
          </Field>

          <Field label="Horómetro" htmlFor="edr-hourmeter" helper="Opcional" error={fieldErrors.hourmeter?.[0]}>
            <Input
              id="edr-hourmeter"
              type="number"
              min={0}
              value={form.hourmeter}
              onChange={(e) => setForm((f) => ({ ...f, hourmeter: e.target.value }))}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar reporte"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
