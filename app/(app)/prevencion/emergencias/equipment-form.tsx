"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { registerEmergencyEquipmentAction } from "./actions"

interface Props {
  worksites: { id: string; name: string }[]
  onDone?: () => void
}

export function EquipmentForm({ worksites, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    worksiteId: worksites[0]?.id ?? "",
    kind: "",
    code: "",
    location: "",
    nextInspectionAt: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.worksiteId || !form.kind || !form.code || !form.location) {
      toast.error("Completa faena, tipo, código y ubicación.")
      return
    }
    setSubmitting(true)
    setFieldErrors({})
    const result = await registerEmergencyEquipmentAction(form)
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Equipo de emergencia registrado.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="equip-worksite" required error={fieldErrors.worksiteId?.[0]}>
            <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
              <SelectTrigger id="equip-worksite">
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tipo" htmlFor="equip-kind" required error={fieldErrors.kind?.[0]}>
            <Input
              id="equip-kind"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              placeholder="Extintor, camilla, DEA…"
              required
            />
          </Field>

          <Field label="Código" htmlFor="equip-code" required error={fieldErrors.code?.[0]}>
            <Input
              id="equip-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="EXT-001"
              required
            />
          </Field>

          <Field label="Próxima inspección" htmlFor="equip-next" error={fieldErrors.nextInspectionAt?.[0]}>
            <Input
              id="equip-next"
              type="date"
              value={form.nextInspectionAt}
              onChange={(e) => setForm((f) => ({ ...f, nextInspectionAt: e.target.value }))}
            />
          </Field>
        </div>

        <Field label="Ubicación" htmlFor="equip-location" required error={fieldErrors.location?.[0]}>
          <Input
            id="equip-location"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="Bodega central, sector A…"
            required
          />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar equipo"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
