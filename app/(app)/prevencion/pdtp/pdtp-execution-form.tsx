"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { markPdtpExecutionFormAction } from "./actions"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

type ExecState = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> } | null

export function PdtpExecutionForm({ activityId, worksiteId }: { activityId: string; worksiteId: string }) {
  const [state, formAction] = React.useActionState<ExecState, FormData>(
    async (_prev, formData) => {
      const result = await markPdtpExecutionFormAction(formData)
      if (!result.ok) {
        const { toast } = await import("@/lib/toast")
        toast.error(result.message ?? "Error al registrar la ejecución PDTP.")
      } else {
        const { toast } = await import("@/lib/toast")
        toast.success("Ejecución PDTP registrada.")
      }
      return result
    },
    null,
  )
  const [pending, startTransition] = React.useTransition()

  return (
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="worksiteId" value={worksiteId} />
      <input type="hidden" name="year" value="2026" />
      <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
        Mes
        <select
          name="month"
          defaultValue="1"
          className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
          aria-invalid={!!state?.fieldErrors?.month}
        >
          {MONTH_LABELS.map((label, index) => (
            <option key={label} value={index + 1}>{label}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
        Semana
        <select
          name="week"
          defaultValue="1"
          className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
          aria-invalid={!!state?.fieldErrors?.week}
        >
          {[1, 2, 3, 4].map((week) => (
            <option key={week} value={week}>{week}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
        Cantidad
        <input
          name="executedQuantity"
          type="number"
          min="0"
          step="0.25"
          defaultValue="1"
          className="h-8 w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
          aria-invalid={!!state?.fieldErrors?.executedQuantity}
        />
      </label>
      <input name="evidenceText" type="hidden" value="Registro desde tabla PDTP" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
      {state && !state.ok && state.message ? (
        <span className="basis-full text-xs text-[var(--color-danger)]" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  )
}
