"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createContractorAction } from "./actions"

interface Props {
  onDone?: () => void
}

export function ContractorForm({ onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    rut: "",
    name: "",
    legalRepresentative: "",
    contact: "",
    status: "activo",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await createContractorAction(form)
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo registrar el contratista.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success(result.message ?? "Contratista registrado.")
    setForm({ rut: "", name: "", legalRepresentative: "", contact: "", status: "activo" })
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="RUT" htmlFor="ctr-rut" required error={fieldErrors.rut?.[0]}>
            <Input id="ctr-rut" value={form.rut} onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))} placeholder="76.123.456-7" required />
          </Field>
          <Field label="Razón social" htmlFor="ctr-name" required error={fieldErrors.name?.[0]}>
            <Input id="ctr-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Contratista SPA" required />
          </Field>
          <Field label="Representante legal" htmlFor="ctr-legal" error={fieldErrors.legalRepresentative?.[0]}>
            <Input id="ctr-legal" value={form.legalRepresentative} onChange={(e) => setForm((f) => ({ ...f, legalRepresentative: e.target.value }))} />
          </Field>
          <Field label="Contacto" htmlFor="ctr-contact" error={fieldErrors.contact?.[0]}>
            <Input id="ctr-contact" value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} placeholder="Teléfono o email" />
          </Field>
          <Field label="Estado" htmlFor="ctr-status" error={fieldErrors.status?.[0]}>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger id="ctr-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="inactivo">Inactivo</SelectItem>
                <SelectItem value="bloqueado">Bloqueado</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" disabled={submitting}>{submitting ? "Guardando…" : "Registrar contratista"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
