"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createEquipmentChecklistAction } from "../actions"

interface Props {
  worksites: { id: string; name: string }[]
  onDone?: () => void
}

const KIND_OPTIONS = [
  { value: "contenedor", label: "Contenedor" },
  { value: "camion", label: "Camión" },
  { value: "equipo", label: "Equipo" },
  { value: "carro", label: "Carro" },
  { value: "batea", label: "Batea" },
  { value: "taller_respel", label: "Taller / RESPEL" },
] as const

const STATUS_OPTIONS = [
  { value: "ok", label: "OK" },
  { value: "observado", label: "Observado" },
  { value: "fuera_servicio", label: "Fuera de servicio" },
] as const

export function ChecklistForm({ worksites, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    worksiteId: worksites[0]?.id ?? "",
    kind: "equipo",
    assetCode: "",
    status: "ok",
    closeRequired: false,
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})
    if (!form.worksiteId || !form.assetCode) {
      toast.error("Completa faena y código de activo.")
      return
    }
    setSubmitting(true)
    const result = await createEquipmentChecklistAction({
      worksiteId: form.worksiteId,
      kind: form.kind as "contenedor" | "camion" | "equipo" | "carro" | "batea" | "taller_respel",
      assetCode: form.assetCode,
      items: {},
      status: form.status as "ok" | "observado" | "fuera_servicio",
      closeRequired: form.closeRequired,
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Checklist registrado.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="echk-worksite" required error={fieldErrors.worksiteId?.[0]}>
            <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
              <SelectTrigger id="echk-worksite">
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tipo" htmlFor="echk-kind" required error={fieldErrors.kind?.[0]}>
            <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
              <SelectTrigger id="echk-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Código de activo" htmlFor="echk-asset" required error={fieldErrors.assetCode?.[0]}>
            <Input
              id="echk-asset"
              value={form.assetCode}
              onChange={(e) => setForm((f) => ({ ...f, assetCode: e.target.value }))}
              placeholder="CONT-014"
              required
            />
          </Field>

          <Field label="Estado" htmlFor="echk-status" required error={fieldErrors.status?.[0]}>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger id="echk-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Requiere cierre" htmlFor="echk-close">
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="echk-close"
              label="Este checklist queda pendiente de cierre"
              checked={form.closeRequired}
              onChange={(e) => setForm((f) => ({ ...f, closeRequired: e.target.checked }))}
            />
          </div>
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar checklist"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
