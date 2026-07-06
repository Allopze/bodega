"use client"

import * as React from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { CalendarBlank, Copy, NotePencil } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { SubmitButton } from "@/components/admin/submit-button"
import { toast } from "@/lib/toast"
import { createPdtpProgramAction } from "../actions"

const CURRENT_YEAR = new Date().getFullYear()

type ExistingProgram = { id: string; title: string; year: number; version: number }

export function PdtpCreateProgramForm({ userId, existingPrograms = [] }: { userId: string; existingPrograms?: ExistingProgram[] }) {
  const router = useRouter()
  const [state, formAction] = useActionState(createPdtpProgramAction, null)
  const [copyFrom, setCopyFrom] = React.useState("")
  const [year, setYear] = React.useState(CURRENT_YEAR)
  const [title, setTitle] = React.useState("")

  // Bug B: router.push() en el cuerpo del componente es un side-effect de
  // render (dispara el warning de React y puede re-ejecutarse en cada
  // render mientras el estado siga "ok"). Navegar al builder en un efecto.
  React.useEffect(() => {
    if (state?.ok && state.programId) {
      toast.success("Programa creado exitosamente")
      router.push(`/prevencion/pdtp/${state.programId}/editar`)
    }
  }, [state, router])

  return (
    <form
      action={formAction}
      className="overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
    >
      <input type="hidden" name="userId" value={userId} />

      {/* Header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
            <CalendarBlank size={18} weight="bold" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Nuevo programa</p>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Define el año y título del programa. Luego podrás agregar hojas, actividades y planificación desde el editor.
            </p>
          </div>
        </div>
      </div>

      <FieldGroup className="gap-5 p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Año del programa" htmlFor="pdtp-year" required>
            <Input
              id="pdtp-year"
              name="year"
              type="number"
              min={2024}
              max={CURRENT_YEAR + 2}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Título del programa" htmlFor="pdtp-title" required>
            <Input
              id="pdtp-title"
              name="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Programa de Trabajo Preventivo SG-SST ${CURRENT_YEAR}`}
            />
          </Field>
        </div>

        {/* Summary */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 sm:p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Resumen antes de crear</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {/* Year */}
            <div className="flex min-w-0 items-start gap-2 rounded-[var(--radius)] bg-[var(--color-surface)] px-3 py-2">
              <span className="mt-0.5 shrink-0 text-[var(--color-primary)]">
                <CalendarBlank size={15} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Año</p>
                <p className="truncate text-sm font-medium text-[var(--color-text)]">{year}</p>
              </div>
            </div>
            {/* Title */}
            <div className="flex min-w-0 items-start gap-2 rounded-[var(--radius)] bg-[var(--color-surface)] px-3 py-2">
              <span className={title ? "mt-0.5 shrink-0 text-[var(--color-primary)]" : "mt-0.5 shrink-0 text-text-faint"}>
                <NotePencil size={15} weight="bold" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Título</p>
                <p className={title ? "truncate text-sm font-medium text-[var(--color-text)]" : "truncate text-sm text-text-subtle"}>
                  {title || "Pendiente"}
                </p>
              </div>
            </div>
            {/* Duplicate source */}
            {existingPrograms.length > 0 && (
              <div className="flex min-w-0 items-start gap-2 rounded-[var(--radius)] bg-[var(--color-surface)] px-3 py-2 sm:col-span-2">
                <span className={copyFrom ? "mt-0.5 shrink-0 text-[var(--color-primary)]" : "mt-0.5 shrink-0 text-text-faint"}>
                  <Copy size={15} weight="bold" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Duplicar desde</p>
                  <p className={copyFrom ? "truncate text-sm font-medium text-[var(--color-text)]" : "truncate text-sm text-text-subtle"}>
                    {copyFrom ? existingPrograms.find((p) => p.id === copyFrom)?.title ?? "—" : "Programa vacío con 8 hojas plantilla"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {existingPrograms.length > 0 && (
          <Field
            label="Duplicar estructura de un programa existente"
            htmlFor="pdtp-copy"
            helper={`Copia hojas, actividades y planificación del programa elegido hacia el año ${CURRENT_YEAR}+. Las ejecuciones y cumplimiento no se copian: el nuevo programa arranca en borrador.`}
          >
            <input type="hidden" name="copySheetsFromProgramId" value={copyFrom} />
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger id="pdtp-copy">
                <SelectValue placeholder="Ninguno — programa vacío con las 8 hojas plantilla" />
              </SelectTrigger>
              <SelectContent>
                {existingPrograms.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title} ({p.year} · v{p.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {state?.message && !state.ok && (
          <p role="alert" className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {state.message}
          </p>
        )}
        {state?.ok && state.programId && (
          <p role="status" className="rounded-[var(--radius)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-3 py-2 text-sm text-[var(--color-success)]">
            Programa creado. Redirigiendo al editor…
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancelar
          </Button>
          <SubmitButton label="Crear programa" loadingLabel="Creando..." />
        </div>
      </FieldGroup>
    </form>
  )
}
