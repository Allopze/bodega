"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/lib/toast"
import { scheduleMeetingAction } from "./actions"
import type { CommitteeMember } from "@/db/schema"

interface UserOption { id: string; name: string }

interface Props {
  committeeId: string
  members: CommitteeMember[]
  users: UserOption[]
  onDone?: () => void
}

export function MeetingForm({ committeeId, members, users, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const defaultAttendees = members.map((m) => m.userId)
  const [form, setForm] = React.useState({
    scheduledAt: new Date().toISOString().slice(0, 16),
    agenda: "Revisión de acuerdos previos; casos nuevos; varios.",
    attendeeIds: defaultAttendees,
  })
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({})

  function resetError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const { [field]: _drop, ...rest } = prev
      return rest
    })
  }

  function toggleAttendee(userId: string) {
    setForm((f) => {
      const has = f.attendeeIds.includes(userId)
      return { ...f, attendeeIds: has ? f.attendeeIds.filter((id) => id !== userId) : [...f.attendeeIds, userId] }
    })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})
    const result = await scheduleMeetingAction({
      committeeId,
      scheduledAt: form.scheduledAt,
      agenda: form.agenda,
      attendeeIds: form.attendeeIds,
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
        toast.error(result.message ?? "Error al agendar la reunión.")
      }
      return
    }
    toast.success("Reunión agendada.")
    setForm({ scheduledAt: new Date().toISOString().slice(0, 16), agenda: "", attendeeIds: defaultAttendees })
    onDone?.()
    router.refresh()
  }

  const fe = (k: string) => errors[k]?.[0]

  return (
    <form onSubmit={onSubmit} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Field label="Fecha y hora" htmlFor="cm-when" required error={fe("scheduledAt")}>
            <Input
              id="cm-when"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => { resetError("scheduledAt"); setForm((f) => ({ ...f, scheduledAt: e.target.value })) }}
              aria-invalid={!!fe("scheduledAt")}
              required
            />
          </Field>
          <Field label="Asistentes" error={fe("attendeeIds")}>
            <p className="text-xs text-[var(--color-text-subtle)]">Marca los asistentes esperados</p>
            <div className="mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
              {members.length === 0 ? (
                <p className="text-xs text-[var(--color-text-subtle)]">Sin integrantes en el comité.</p>
              ) : members.map((m) => {
                const user = users.find((u) => u.id === m.userId)
                return (
                  <Checkbox
                    key={m.id}
                    id={`cm-att-${m.id}`}
                    label={`${user?.name ?? m.userId} — ${m.role}`}
                    checked={form.attendeeIds.includes(m.userId)}
                    onChange={() => toggleAttendee(m.userId)}
                  />
                )
              })}
            </div>
          </Field>
        </div>
        <Field label="Agenda" htmlFor="cm-agenda" required error={fe("agenda")}>
          <Textarea
            id="cm-agenda"
            rows={3}
            value={form.agenda}
            onChange={(e) => { resetError("agenda"); setForm((f) => ({ ...f, agenda: e.target.value })) }}
            aria-invalid={!!fe("agenda")}
            required
          />
        </Field>
        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Agendando…" : "Agendar"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
