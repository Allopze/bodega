"use client"

import * as React from "react"
import { useActionState } from "react"
import { ArrowRight, CalendarBlank, CheckCircle, FileXls } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Badge } from "@/components/ui/badge"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createPdtpProgramAction } from "../actions"

export function PdtpCreateProgramForm({
  suggestedYear,
  existingYears,
  baseRevision,
}: {
  suggestedYear: number
  existingYears: number[]
  baseRevision: { version: number; activityCount: number; contentDigest: string } | null
}) {
  // El formulario conserva la edición local del año; al cambiar la sugerencia
  // desde el servidor se remonta con una clave nueva, sin mostrar un valor viejo.
  return <PdtpCreateProgramFields key={suggestedYear} suggestedYear={suggestedYear} existingYears={existingYears} baseRevision={baseRevision} />
}

function PdtpCreateProgramFields({
  suggestedYear,
  existingYears,
  baseRevision,
}: {
  suggestedYear: number
  existingYears: number[]
  baseRevision: { version: number; activityCount: number; contentDigest: string } | null
}) {
  const [state, formAction] = useActionState(createPdtpProgramAction, null)
  const [year, setYear] = React.useState(() => suggestedYear)
  const alreadyExists = existingYears.includes(year)

  return (
    <form action={formAction} className="space-y-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs sm:p-6">
      <div className={`grid gap-5 sm:grid-cols-[10rem_1fr] sm:items-end ${!baseRevision && !alreadyExists ? "opacity-50" : ""}`}>
        <Field
          label="Año del programa"
          htmlFor="pdtp-year"
          helper={alreadyExists ? "Este año ya tiene programa. Al continuar se abrirá el existente." : "Se sugiere el siguiente año sin programa."}
        >
          <Input
            id="pdtp-year"
            name="year"
            type="number"
            min={2024}
            max={2100}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            disabled={!baseRevision && !alreadyExists}
            required
          />
        </Field>

        <div className="flex min-h-16 items-center gap-3 border-y border-[var(--color-border)] py-3">
          <CalendarBlank size={22} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)]">Programa preventivo SG-SST (PDTP) {year}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Un único programa anual, con ajustes específicos por faena.</p>
          </div>
          {alreadyExists && <Badge variant="outline" className="ml-auto shrink-0">Existente</Badge>}
        </div>
      </div>

      {baseRevision ? (
        <section aria-labelledby="base-heading" className="border-y border-[var(--color-border)] py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <FileXls size={24} className="mt-0.5 shrink-0 text-[var(--color-success)]" aria-hidden />
              <div>
                <h2 id="base-heading" className="text-sm font-semibold text-[var(--color-text)]">Base preventiva para {year}</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
                  Se copiarán actividades, responsables, vistas y planificación. Ejecuciones, evidencias,
                  aprobaciones y ajustes por faena comenzarán vacíos.
                </p>
              </div>
            </div>
            <Badge variant="info">Revisión {baseRevision.version}</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5"><CheckCircle size={15} weight="fill" className="text-[var(--color-success)]" />{baseRevision.activityCount} actividades</span>
            <span>Actividades 4 y 8 eliminadas</span>
            <span title={baseRevision.contentDigest}>Contenido firmado</span>
          </div>
        </section>
      ) : (
        <div role="alert" className="rounded-xl border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-4 py-3 text-sm text-[var(--color-warning-ink)]">
          <p className="font-semibold">Base {year} no instalada</p>
          <p className="mt-1">
            Quien administre el catálogo PDTP (Jefatura de Prevención u otro con el permiso correspondiente) debe
            publicar la Base preventiva para {year} antes de crear programas anuales. Esta publicación se hace por
            fuera de esta pantalla; contacta a esa persona para coordinarla.
          </p>
        </div>
      )}

      {state?.message && (
        <div role="status" className={state.ok
          ? "rounded-xl border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-4 py-3 text-sm text-[var(--color-success-ink)]"
          : "rounded-xl border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-4 py-3 text-sm text-[var(--color-danger-ink)]"
        }>
          <p className="font-semibold">{state.ok ? "Programa disponible" : "No se pudo crear"}</p>
          <p className="mt-1">{state.message}</p>
        </div>
      )}

      <div className="flex justify-end">
        <SubmitButton
          disabled={!baseRevision && !alreadyExists}
          label={alreadyExists ? "Abrir programa anual" : "Crear programa anual"}
          loadingLabel={alreadyExists ? "Abriendo..." : "Creando..."}
        >
          <ArrowRight size={16} aria-hidden />
        </SubmitButton>
      </div>
    </form>
  )
}
