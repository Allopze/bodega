"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { markPdtpExecutionFormAction } from "./actions"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

type ExecState = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> } | null

type PdtpExecutionFormProps = {
  activityId: string
  worksiteId: string
  defaultMonth?: number
  defaultWeek?: number
}

export function PdtpExecutionForm({ activityId, worksiteId, defaultMonth, defaultWeek }: PdtpExecutionFormProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [state, formAction] = React.useActionState<ExecState, FormData>(
    async (_prev, formData) => {
      const { toast } = await import("@/lib/toast")
      const file = fileInputRef.current?.files?.[0]
      if (file) {
        const uploadData = new FormData()
        uploadData.set("file", file)
        uploadData.set("worksiteId", worksiteId)
        try {
          const res = await fetch("/api/prevencion/pdtp/evidence", { method: "POST", body: uploadData })
          const json = await res.json()
          if (!res.ok) {
            toast.error(json.error ?? "Error al subir la evidencia.")
            return { ok: false, message: json.error ?? "Error al subir la evidencia." }
          }
          formData.set("evidenceUrl", json.path)
        } catch {
          toast.error("Error al subir la evidencia.")
          return { ok: false, message: "Error al subir la evidencia." }
        }
      }

      const result = await markPdtpExecutionFormAction(formData)
      if (!result.ok) {
        toast.error(result.message ?? "Error al registrar la ejecución PDTP.")
      } else {
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
        <Select name="month" defaultValue={String(defaultMonth ?? 1)}>
          <SelectTrigger
            className="h-8 w-24 text-sm"
            error={!!state?.fieldErrors?.month}
            aria-invalid={!!state?.fieldErrors?.month}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_LABELS.map((label, index) => (
              <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
        Semana
        <Select name="week" defaultValue={String(defaultWeek ?? 1)}>
          <SelectTrigger
            className="h-8 w-16 text-sm"
            error={!!state?.fieldErrors?.week}
            aria-invalid={!!state?.fieldErrors?.week}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((week) => (
              <SelectItem key={week} value={String(week)}>{week}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
        Observación
        <input
          name="evidenceText"
          type="text"
          placeholder="Opcional"
          className="h-8 w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
        />
      </label>
      <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
        Evidencia
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="text-xs text-[var(--color-text)]"
        />
      </label>
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
