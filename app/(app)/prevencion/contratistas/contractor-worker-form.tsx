"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { addContractorWorkerAction } from "./actions"

interface Props {
  contractorId: string
  workers: { id: string; firstName: string; lastName: string; rut: string | null }[]
  onDone?: () => void
}

export function ContractorWorkerForm({ contractorId, workers, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    workerId: workers[0]?.id ?? "",
    position: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await addContractorWorkerAction({ ...form, contractorId })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo asociar el trabajador.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success(result.message ?? "Trabajador asociado.")
    setForm((f) => ({ ...f, position: "", endDate: "" }))
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Trabajador" htmlFor={`cw-worker-${contractorId}`} required error={fieldErrors.workerId?.[0]}>
            <Select value={form.workerId} onValueChange={(v) => setForm((f) => ({ ...f, workerId: v }))}>
              <SelectTrigger id={`cw-worker-${contractorId}`}>
                <SelectValue placeholder="Selecciona trabajador" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}{w.rut ? ` · ${w.rut}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cargo" htmlFor={`cw-position-${contractorId}`} required error={fieldErrors.position?.[0]}>
            <Input id={`cw-position-${contractorId}`} value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} required />
          </Field>
          <Field label="Fecha inicio" htmlFor={`cw-start-${contractorId}`} required error={fieldErrors.startDate?.[0]}>
            <Input id={`cw-start-${contractorId}`} type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
          </Field>
          <Field label="Fecha término (opcional)" htmlFor={`cw-end-${contractorId}`} error={fieldErrors.endDate?.[0]}>
            <Input id={`cw-end-${contractorId}`} type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" size="sm" disabled={submitting}>{submitting ? "Guardando…" : "Asociar trabajador"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
