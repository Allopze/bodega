"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { addCommitteeMemberAction } from "./actions"

interface UserOption { id: string; name: string }

interface Props {
  committeeId: string
  users: UserOption[]
  onDone?: () => void
}

const ROLE_OPTIONS = [
  { value: "presidente",       label: "Presidente/a" },
  { value: "secretario",       label: "Secretario/a" },
  { value: "vocal",            label: "Vocal" },
  { value: "representante_trabajadores", label: "Representante trabajadores" },
  { value: "asesor",           label: "Asesor" },
] as const

export function MemberForm({ committeeId, users, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({ userId: "", role: "vocal", startDate: new Date().toISOString().slice(0, 10) })
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
    const result = await addCommitteeMemberAction({
      committeeId,
      userId: form.userId,
      role: form.role,
      startDate: form.startDate,
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
        toast.error(result.message ?? "Error al agregar integrante.")
      }
      return
    }
    toast.success("Integrante agregado.")
    setForm({ userId: "", role: "vocal", startDate: new Date().toISOString().slice(0, 10) })
    onDone?.()
    router.refresh()
  }

  const fe = (k: string) => errors[k]?.[0]

  return (
    <form onSubmit={onSubmit} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Field label="Usuario" htmlFor="cm-user" required error={fe("userId")}>
            <Select value={form.userId} onValueChange={(v) => { resetError("userId"); setForm((f) => ({ ...f, userId: v })) }}>
              <SelectTrigger id="cm-user" aria-invalid={!!fe("userId")}>
                <SelectValue placeholder="Selecciona usuario" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Rol" htmlFor="cm-role" required error={fe("role")}>
            <Select value={form.role} onValueChange={(v) => { resetError("role"); setForm((f) => ({ ...f, role: v })) }}>
              <SelectTrigger id="cm-role" aria-invalid={!!fe("role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Inicio" htmlFor="cm-start" required error={fe("startDate")}>
            <Input
              id="cm-start"
              type="date"
              value={form.startDate}
              onChange={(e) => { resetError("startDate"); setForm((f) => ({ ...f, startDate: e.target.value })) }}
              aria-invalid={!!fe("startDate")}
              required
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Agregando…" : "Agregar"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
