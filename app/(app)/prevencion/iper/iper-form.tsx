"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createIperMatrixAction } from "./actions"

interface Props {
  worksites: { id: string; name: string }[]
  onDone?: () => void
}

export function IperForm({ worksites, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({
    worksiteId: worksites[0]?.id ?? "",
    code: "",
    version: "1",
    title: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.worksiteId || !form.code || !form.title) {
      toast.error("Completa faena, código y título.")
      return
    }
    setSubmitting(true)
    const result = await createIperMatrixAction({
      worksiteId: form.worksiteId,
      code: form.code,
      version: Number(form.version),
      title: form.title,
      effectiveFrom: form.effectiveFrom,
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Matriz IPER creada.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="iper-worksite" required>
            <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
              <SelectTrigger id="iper-worksite">
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Código" htmlFor="iper-code" required>
            <Input
              id="iper-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="IPER-FA-2026"
              required
            />
          </Field>

          <Field label="Versión" htmlFor="iper-version" required>
            <Input
              id="iper-version"
              type="number"
              min={1}
              value={form.version}
              onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
              required
            />
          </Field>

          <Field label="Vigente desde" htmlFor="iper-from" required>
            <Input
              id="iper-from"
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
              required
            />
          </Field>
        </div>

        <Field label="Título" htmlFor="iper-title" required>
          <Input
            id="iper-title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Matriz IPER Faena Norte 2026"
            required
          />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creando…" : "Crear matriz"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}