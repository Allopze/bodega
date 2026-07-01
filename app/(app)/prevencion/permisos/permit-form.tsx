"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createPermitRequestAction } from "./actions"
import type { PermitTemplate } from "@/db/schema"

interface Props {
  templates: PermitTemplate[]
  worksites: { id: string; name: string }[]
  onDone?: () => void
}

export function PermitForm({ templates, worksites, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({
    templateId: templates[0]?.id ?? "",
    worksiteId: worksites[0]?.id ?? "",
    task: "",
    location: "",
    plannedStart: "",
    plannedEnd: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.templateId || !form.worksiteId || !form.task || !form.location || !form.plannedStart || !form.plannedEnd) {
      toast.error("Completa todos los campos del permiso.")
      return
    }
    setSubmitting(true)
    const result = await createPermitRequestAction({
      templateId: form.templateId,
      worksiteId: form.worksiteId,
      task: form.task,
      location: form.location,
      plannedStart: form.plannedStart,
      plannedEnd: form.plannedEnd,
      ast: {},
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Permiso de trabajo solicitado.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Plantilla / tipo de riesgo" htmlFor="permit-template" required>
            <Select value={form.templateId} onValueChange={(v) => setForm((f) => ({ ...f, templateId: v }))}>
              <SelectTrigger id="permit-template">
                <SelectValue placeholder="Selecciona plantilla" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Faena" htmlFor="permit-worksite" required>
            <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
              <SelectTrigger id="permit-worksite">
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Inicio planificado" htmlFor="permit-start" required>
            <Input
              id="permit-start"
              type="datetime-local"
              value={form.plannedStart}
              onChange={(e) => setForm((f) => ({ ...f, plannedStart: e.target.value }))}
              required
            />
          </Field>

          <Field label="Término planificado" htmlFor="permit-end" required>
            <Input
              id="permit-end"
              type="datetime-local"
              value={form.plannedEnd}
              onChange={(e) => setForm((f) => ({ ...f, plannedEnd: e.target.value }))}
              required
            />
          </Field>
        </div>

        <Field label="Tarea" htmlFor="permit-task" required>
          <Input
            id="permit-task"
            value={form.task}
            onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
            placeholder="Soldadura en estanque de combustible"
            required
          />
        </Field>

        <Field label="Ubicación" htmlFor="permit-location" required>
          <Input
            id="permit-location"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="Patio de mantención, sector B"
            required
          />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Solicitando…" : "Solicitar permiso"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
