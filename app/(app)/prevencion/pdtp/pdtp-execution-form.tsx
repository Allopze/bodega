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
  /**
   * PREV-I01: N° y nombre de la actividad, para que el diálogo diga qué se
   * está registrando. En el teléfono la fila queda fuera de la vista al abrir
   * el diálogo y, sin esto, "Registrar ejecución" no nombraba ninguna.
   */
  activityN?: number
  activityName?: string
  worksiteId: string
  year?: number
  defaultMonth?: number
  defaultWeek?: number
  effectiveFrom?: PdtpPeriod | null
  evidenceRequirement?: string | null
  /**
   * Ronda de corrección (2026-09-23): mientras `markPdtpExecution` restauró
   * el gate genérico (texto/URL/foto) para cualquier mecanismo, sólo
   * `constancia` exige específicamente un archivo real (Task 9) — la
   * observación de texto ya no basta ahí. Sin este dato la etiqueta de
   * abajo prometía lo mismo para los dos casos.
   */
  mechanism?: string | null
  /**
   * PREV-B02: qué basta para declarar la actividad realizada. Por defecto un
   * archivo; `declaration_allowed` es la excepción declarada en la actividad
   * (respaldo fuera de la plataforma) y aun así exige una observación.
   */
  manualEvidencePolicy?: string | null
}

/** Mismo tope que `POST /api/prevencion/pdtp/evidence`. */
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024

export function PdtpExecutionForm({ activityId, activityN, activityName, worksiteId, year, defaultMonth, defaultWeek, effectiveFrom, evidenceRequirement, mechanism, manualEvidencePolicy }: PdtpExecutionFormProps) {
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
      // PREV-I09: un archivo sobre el tope se rechaza acá, con un motivo que
      // se entiende, en vez de llegar al servidor y volver como un error de
      // formato.
      if (file && file.size > MAX_EVIDENCE_BYTES) {
        const message = "El archivo supera 25 MB. Comprímelo o divide el PDF antes de subirlo."
        toast.error(message)
        return { ok: false, message }
      }
      if (file) {
        const uploadData = new FormData()
        uploadData.set("file", file)
        uploadData.set("activityId", activityId)
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
  // PREV-B02 (ver `markPdtpExecution`): declarar una cantidad exige un
  // archivo, salvo la excepción declarada en la actividad —y una `constancia`
  // con requisito nunca la admite—. La observación sólo reemplaza al archivo
  // en esa excepción.
  const declarationAllowed = manualEvidencePolicy === "declaration_allowed"
    && !(evidenceRequirement && mechanism === "constancia")
  const observationLabel = declarationAllowed
    ? "Observación (obligatoria si no adjuntas un archivo)"
    : "Observación (no reemplaza al archivo)"
  const evidenceHelp = declarationAllowed
    ? "Si la evidencia está fuera de la plataforma, basta una observación escrita que diga dónde está."
    : "Adjunta una foto o un PDF: sin un archivo la actividad no se puede declarar realizada."

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
          <DialogTitle>
            Registrar ejecución{activityN !== undefined ? ` · N°${activityN}` : ""}
          </DialogTitle>
          <DialogDescription>
            {activityName && (
              <span className="block font-medium text-[var(--color-text)]">{activityName}</span>
            )}
            <span className="block">
              Ingresa la cantidad ejecutada para el período indicado y adjunta la evidencia (foto o PDF).
            </span>
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
                max="100000"
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

          {/* PREV-C02 (D3): la misma semana acreditada desde su módulo y
              cargada a mano vale el mayor de los dos, no la suma. Sin enlace:
              el destino depende de la actividad y lo resuelve la ficha. */}
          {(mechanism === "enganche" || mechanism === "compuesta") && (
            <p className="rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              Esta actividad también se acredita desde su módulo de origen. Si esa semana ya quedó acreditada allí, lo que registres aquí cuenta una sola vez: vale el mayor de los dos, no la suma.
            </p>
          )}

          <Field label={observationLabel} htmlFor="exec-obs">
            <input
              id="exec-obs"
              name="evidenceText"
              type="text"
              placeholder={evidenceRequirement ? evidenceRequirement : "Opcional"}
              aria-label="Observación"
              aria-required={declarationAllowed}
              className="h-9 w-full rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
            />
          </Field>

          <Field label="Evidencia (foto o PDF)" htmlFor="exec-file" hint={evidenceHelp}>
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
