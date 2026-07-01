"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { toast } from "@/lib/toast"
import { signPermitAction } from "./actions"

interface Props {
  permitId: string
  defaultRole?: string
  onDone?: () => void
}

export function PermitSignoffForm({ permitId, defaultRole, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({ role: defaultRole ?? "", signature: "" })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await signPermitAction({ permitId, role: form.role, signature: form.signature })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo registrar la firma.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Firma registrada.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Rol" htmlFor={`psig-role-${permitId}`} required error={fieldErrors.role?.[0]}>
            <Input id={`psig-role-${permitId}`} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="prevencionista" required />
          </Field>
          <Field label="Firma" htmlFor={`psig-sig-${permitId}`} required error={fieldErrors.signature?.[0]}>
            <Input id={`psig-sig-${permitId}`} value={form.signature} onChange={(e) => setForm((f) => ({ ...f, signature: e.target.value }))} placeholder="Nombre y RUT de quien firma" required />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" size="sm" disabled={submitting}>{submitting ? "Firmando…" : "Firmar"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
