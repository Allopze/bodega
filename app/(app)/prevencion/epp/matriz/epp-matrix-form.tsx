"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { setEppPositionEntryAction } from "./actions"

interface Props {
  worksites: { id: string; name: string }[]
  defaultWorksiteId?: string
  onDone?: () => void
}

export function EppMatrixForm({ worksites, defaultWorksiteId, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    worksiteId: defaultWorksiteId ?? worksites[0]?.id ?? "",
    position: "",
    eppProductId: "",
    riskId: "",
    requiredSince: new Date().toISOString().slice(0, 10),
    notes: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await setEppPositionEntryAction(form)
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo guardar la entrada.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success(result.message ?? "Entrada de matriz guardada.")
    setForm((f) => ({ ...f, position: "", eppProductId: "", riskId: "", notes: "" }))
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="epp-worksite" required>
            <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
              <SelectTrigger id="epp-worksite">
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Cargo" htmlFor="epp-position" required error={fieldErrors.position?.[0]}>
            <Input
              id="epp-position"
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              placeholder="Operador de grúa"
              required
            />
          </Field>

          <Field label="EPP (código/SKU)" htmlFor="epp-product" required error={fieldErrors.eppProductId?.[0]}>
            <Input
              id="epp-product"
              value={form.eppProductId}
              onChange={(e) => setForm((f) => ({ ...f, eppProductId: e.target.value }))}
              placeholder="EPP-CASCO-001"
              required
            />
          </Field>

          <Field label="Riesgo IPER (opcional)" htmlFor="epp-risk" error={fieldErrors.riskId?.[0]}>
            <Input
              id="epp-risk"
              value={form.riskId}
              onChange={(e) => setForm((f) => ({ ...f, riskId: e.target.value }))}
              placeholder="ID de riesgo asociado"
            />
          </Field>

          <Field label="Vigente desde" htmlFor="epp-since" required error={fieldErrors.requiredSince?.[0]}>
            <Input
              id="epp-since"
              type="date"
              value={form.requiredSince}
              onChange={(e) => setForm((f) => ({ ...f, requiredSince: e.target.value }))}
              required
            />
          </Field>
        </div>

        <Field label="Notas (opcional)" htmlFor="epp-notes" error={fieldErrors.notes?.[0]}>
          <Input
            id="epp-notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Observaciones"
          />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Guardar entrada"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
