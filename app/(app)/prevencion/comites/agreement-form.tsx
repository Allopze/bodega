"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { addAgreementAction } from "./actions"

interface UserOption { id: string; name: string }

interface Props {
  meetingId: string
  users: UserOption[]
  onDone?: () => void
}

export function AgreementForm({ meetingId, users, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({
    description: "",
    responsibleId: "",
    dueDate: new Date(new Date().getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  })
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({})

  function resetError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const { [field]: _drop, ...rest } = prev
      return rest
    })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})
    const result = await addAgreementAction({
      meetingId,
      description: form.description,
      responsibleId: form.responsibleId,
      dueDate: form.dueDate,
    })
    setSubmitting(false)
    if (!result.ok) {
      const fe = (result as { fieldErrors?: Record<string, string[]> }).fieldErrors
      if (fe) {
        setErrors(fe)
        const firstField = Object.keys(fe)[0]
        const firstMsg = firstField ? fe[firstField]?.[0] : undefined
        toast.error(firstMsg ? `${firstField}: ${firstMsg}` : (result.message ?? "Revisa los campos."))
      } else {
        toast.error(result.message ?? "Error al registrar el acuerdo.")
      }
      return
    }
    toast.success("Acuerdo registrado.")
    setForm({ description: "", responsibleId: "", dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) })
    onDone?.()
    router.refresh()
  }

  const fe = (k: string) => errors[k]?.[0]

  return (
    <form onSubmit={onSubmit} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <FieldGroup>
        <Field label="Descripción" htmlFor="ca-desc" required error={fe("description")}>
          <Textarea
            id="ca-desc"
            rows={2}
            value={form.description}
            onChange={(e) => { resetError("description"); setForm((f) => ({ ...f, description: e.target.value })) }}
            aria-invalid={!!fe("description")}
            required
          />
        </Field>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Field label="Responsable" htmlFor="ca-resp" required error={fe("responsibleId")}>
            <Select value={form.responsibleId} onValueChange={(v) => { resetError("responsibleId"); setForm((f) => ({ ...f, responsibleId: v })) }}>
              <SelectTrigger id="ca-resp" aria-invalid={!!fe("responsibleId")}>
                <SelectValue placeholder="Selecciona responsable" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vence" htmlFor="ca-due" required error={fe("dueDate")}>
            <Input
              id="ca-due"
              type="date"
              value={form.dueDate}
              onChange={(e) => { resetError("dueDate"); setForm((f) => ({ ...f, dueDate: e.target.value })) }}
              aria-invalid={!!fe("dueDate")}
              required
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
