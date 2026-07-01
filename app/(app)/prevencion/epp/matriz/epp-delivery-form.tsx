"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { logEppDeliveryAction } from "./actions"

interface Props {
  workers: { id: string; firstName: string; lastName: string; rut: string | null }[]
  onDone?: () => void
}

export function EppDeliveryForm({ workers, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    workerId: workers[0]?.id ?? "",
    eppProductId: "",
    evidenceUrl: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await logEppDeliveryAction(form)
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo registrar la entrega.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success(result.message ?? "Entrega de EPP registrada.")
    setForm((f) => ({ ...f, eppProductId: "", evidenceUrl: "" }))
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Trabajador" htmlFor="epp-deliv-worker" required error={fieldErrors.workerId?.[0]}>
            <Select value={form.workerId} onValueChange={(v) => setForm((f) => ({ ...f, workerId: v }))}>
              <SelectTrigger id="epp-deliv-worker">
                <SelectValue placeholder="Selecciona trabajador" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.firstName} {w.lastName}{w.rut ? ` · ${w.rut}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="EPP (código/SKU)" htmlFor="epp-deliv-product" required error={fieldErrors.eppProductId?.[0]}>
            <Input
              id="epp-deliv-product"
              value={form.eppProductId}
              onChange={(e) => setForm((f) => ({ ...f, eppProductId: e.target.value }))}
              placeholder="EPP-CASCO-001"
              required
            />
          </Field>
        </div>

        <Field label="Acta de entrega firmada (URL)" htmlFor="epp-deliv-evidence" required helper="Requisito legal: comprobante de entrega firmado por el trabajador" error={fieldErrors.evidenceUrl?.[0]}>
          <Input
            id="epp-deliv-evidence"
            value={form.evidenceUrl}
            onChange={(e) => setForm((f) => ({ ...f, evidenceUrl: e.target.value }))}
            placeholder="https://…"
            required
          />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar entrega"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
