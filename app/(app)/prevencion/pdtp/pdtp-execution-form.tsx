"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { PencilSimple } from "@phosphor-icons/react"
import { markPdtpExecutionFormAction } from "./actions"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"
import { codeYear, MONTH_LABELS } from "@/lib/utils"

type ExecState = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> } | null

type PdtpExecutionFormProps = {
  activityId: string
  worksiteId: string
  year?: number
  defaultMonth?: number
  defaultWeek?: number
  effectiveFrom?: PdtpPeriod | null
  evidenceRequirement?: string | null
}

export function PdtpExecutionForm({ activityId, worksiteId, year, defaultMonth, defaultWeek, effectiveFrom, evidenceRequirement }: PdtpExecutionFormProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const programYear = year ?? codeYear()
  const firstEffectiveMonth = effectiveFrom?.year === programYear ? effectiveFrom.month : 1
  const allowedMonths = Array.from(
    { length: MONTH_LABELS.length - firstEffectiveMonth + 1 },
    (_, index) => index + firstEffectiveMonth,
  )
  const initialMonth = Math.max(firstEffectiveMonth, defaultMonth ?? firstEffectiveMonth)
  const weeksForMonth = (month: number) => [1, 2, 3, 4].filter((week) => (
    effectiveFrom?.year !== programYear
    || month !== effectiveFrom.month
    || week >= effectiveFrom.week
  ))
  const initialWeeks = weeksForMonth(initialMonth)
  const initialWeekCandidate = defaultWeek ?? initialWeeks[0] ?? 1
  const [selectedMonth, setSelectedMonth] = React.useState(String(initialMonth))
  const [selectedWeek, setSelectedWeek] = React.useState(String(
    initialWeeks.includes(initialWeekCandidate) ? initialWeekCandidate : initialWeeks[0] ?? 1,
  ))
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
          if (!res.ok) {
            const json = await res.json().catch(() => ({}))
            toast.error(json.error ?? "Error al subir la evidencia.")
            return { ok: false, message: json.error ?? "Error al subir la evidencia." }
          }
          const json = await res.json()
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
        setOpen(false)
      }
      return result
    },
    null,
  )
  const [pending, startTransition] = React.useTransition()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          <PencilSimple size={13} className="mr-1" />
          Registrar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar ejecución</DialogTitle>
          <DialogDescription>
            Ingresa la cantidad ejecutada para el período indicado. Puedes adjuntar evidencia fotográfica o un PDF.
          </DialogDescription>
        </DialogHeader>
        <form
          action={(fd) => startTransition(() => formAction(fd))}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="worksiteId" value={worksiteId} />
          <input type="hidden" name="year" value={programYear} />

          <div className="grid grid-cols-3 gap-3">
            <Field label="Mes" htmlFor="exec-month">
              <Select
                name="month"
                value={selectedMonth}
                onValueChange={(value) => {
                  setSelectedMonth(value)
                  const allowedWeeks = weeksForMonth(Number(value))
                  if (!allowedWeeks.includes(Number(selectedWeek))) setSelectedWeek(String(allowedWeeks[0]))
                }}
              >
                <SelectTrigger
                  id="exec-month"
                  className="h-9 text-sm"
                  error={!!state?.fieldErrors?.month}
                  aria-invalid={!!state?.fieldErrors?.month}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedMonths.map((month) => (
                    <SelectItem key={month} value={String(month)}>{MONTH_LABELS[month - 1]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Semana" htmlFor="exec-week">
              <Select name="week" value={selectedWeek} onValueChange={setSelectedWeek}>
                <SelectTrigger
                  id="exec-week"
                  className="h-9 text-sm"
                  error={!!state?.fieldErrors?.week}
                  aria-invalid={!!state?.fieldErrors?.week}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weeksForMonth(Number(selectedMonth)).map((week) => (
                    <SelectItem key={week} value={String(week)}>{week}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cantidad" htmlFor="exec-qty">
              <input
                id="exec-qty"
                name="executedQuantity"
                type="number"
                min="0"
                step="0.25"
                defaultValue="1"
                aria-label="Cantidad"
                className="h-9 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
                aria-invalid={!!state?.fieldErrors?.executedQuantity}
              />
            </Field>
          </div>

          {evidenceRequirement && (
            <p className="rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              Esta actividad exige evidencia: {evidenceRequirement}
            </p>
          )}

          <Field label={evidenceRequirement ? "Observación (obligatoria si no adjuntas evidencia)" : "Observación"} htmlFor="exec-obs">
            <input
              id="exec-obs"
              name="evidenceText"
              type="text"
              placeholder={evidenceRequirement ? evidenceRequirement : "Opcional"}
              aria-label="Observación"
              aria-required={!!evidenceRequirement}
              className="h-9 w-full rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
            />
          </Field>

          <Field label="Evidencia (foto o PDF)" htmlFor="exec-file">
            <FileInput
              ref={fileInputRef}
              id="exec-file"
              accept="image/jpeg,image/png,application/pdf"
            />
          </Field>

          {state && !state.ok && state.message && (
            <p className="text-xs text-[var(--color-danger)]" role="alert">
              {state.message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Guardando…" : "Guardar ejecución"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
