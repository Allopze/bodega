"use client"

import * as React from "react"
import { useActionState } from "react"
import { ArrowRight, CheckCircle, FileXls } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { MetaBadge } from "@/components/states/state-badge"
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
      <div className={`flex flex-wrap items-center gap-3 ${!baseRevision && !alreadyExists ? "opacity-50" : ""}`}>
        <Field
          className="w-40"
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
        {alreadyExists && <MetaBadge meta={{ label: "Existente", variant: "outline" }} />}
      </div>

      {baseRevision ? (
        <section aria-labelledby="base-heading" className="border-t border-[var(--color-border)] pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-2.5">
              <FileXls size={20} className="mt-0.5 shrink-0 text-[var(--color-success-ink)]" aria-hidden />
              <div>
                <h2 id="base-heading" className="text-sm font-semibold text-[var(--color-text)]">Base preventiva para {year}</h2>
                <p className="mt-0.5 max-w-2xl text-sm text-[var(--color-text-muted)]">
                  Se copiarán actividades, responsables, vistas y planificación. Ejecuciones, evidencias,
                  aprobaciones y ajustes por faena comenzarán vacíos.
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                  <CheckCircle size={14} weight="fill" className="text-[var(--color-success-ink)]" aria-hidden />
                  Revisión {baseRevision.version} · {baseRevision.activityCount} actividades ·{" "}
                  <span title={baseRevision.contentDigest}>contenido firmado</span>
                </p>
              </div>
            </div>
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
