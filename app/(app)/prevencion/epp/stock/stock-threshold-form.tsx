"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { toast } from "@/lib/toast"
import { setEppStockThresholdAction } from "./actions"

interface Props {
  worksiteId: string
  onDone?: () => void
}

export function StockThresholdForm({ worksiteId, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    eppProductId: "",
    minStock: "0",
    criticalStock: "0",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await setEppStockThresholdAction({ ...form, worksiteId })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo guardar el umbral.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success(result.message ?? "Umbral de stock guardado.")
    setForm({ eppProductId: "", minStock: "0", criticalStock: "0" })
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="EPP (código/SKU)" htmlFor="stock-product" required error={fieldErrors.eppProductId?.[0]}>
            <Input
              id="stock-product"
              value={form.eppProductId}
              onChange={(e) => setForm((f) => ({ ...f, eppProductId: e.target.value }))}
              placeholder="EPP-CASCO-001"
              required
            />
          </Field>
          <Field label="Stock mínimo" htmlFor="stock-min" required error={fieldErrors.minStock?.[0]}>
            <Input
              id="stock-min"
              type="number"
              min={0}
              value={form.minStock}
              onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))}
              required
            />
          </Field>
          <Field label="Stock crítico" htmlFor="stock-critical" required error={fieldErrors.criticalStock?.[0]}>
            <Input
              id="stock-critical"
              type="number"
              min={0}
              value={form.criticalStock}
              onChange={(e) => setForm((f) => ({ ...f, criticalStock: e.target.value }))}
              required
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Guardar umbral"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
