"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { CONTRACTOR_DOCUMENT_TYPE_LABELS } from "@/lib/prevention/badges"
import { addContractorDocumentAction } from "./actions"

interface Props {
  contractorId: string
  onDone?: () => void
}

export function ContractorDocumentForm({ contractorId, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    type: "certificado_antecedentes",
    status: "pendiente",
    expiresAt: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await addContractorDocumentAction({ ...form, contractorId })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo registrar el documento.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success(result.message ?? "Documento registrado.")
    setForm({ type: "certificado_antecedentes", status: "pendiente", expiresAt: "" })
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Tipo de documento" htmlFor={`cd-type-${contractorId}`} required error={fieldErrors.type?.[0]}>
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
              <SelectTrigger id={`cd-type-${contractorId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONTRACTOR_DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Estado" htmlFor={`cd-status-${contractorId}`} error={fieldErrors.status?.[0]}>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger id={`cd-status-${contractorId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="vigente">Vigente</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vence el (opcional)" htmlFor={`cd-expires-${contractorId}`} error={fieldErrors.expiresAt?.[0]}>
            <Input id={`cd-expires-${contractorId}`} type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" size="sm" disabled={submitting}>{submitting ? "Guardando…" : "Registrar documento"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
