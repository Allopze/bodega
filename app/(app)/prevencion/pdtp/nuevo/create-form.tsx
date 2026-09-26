"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { ArrowRight, CopySimple, FileXls } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { Callout } from "@/components/ui/callout"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SelectableCard, SelectableCardDescription, SelectableCardTitle } from "@/components/ui/selectable-card"
import { pdtpProgramStatusLabel } from "@/lib/prevention/pdtp"
import { createPdtpProgramAction } from "../actions"

export type PdtpCopyCandidate = {
  year: number
  programId: string
  version: number
  status: string
  activityCount: number
}

export type PdtpExistingProgram = {
  year: number
  id: string
  version: number
  status: string
  creationMode: string
}

type BaseRevision = { version: number; activityCount: number; contentDigest: string } | null

type Origin = "previous_program" | "base"

const CREATION_MODE_LABEL: Record<string, string> = {
  program_copy: "copiando el programa del año anterior",
  base_2026: "creado desde la Base preventiva 2026",
  template: "creado desde una plantilla",
  xlsx_import: "importado desde planilla",
  blank: "creado en blanco",
}

export function PdtpCreateProgramForm(props: {
  suggestedYear: number
  existingPrograms: PdtpExistingProgram[]
  copyCandidates: PdtpCopyCandidate[]
  baseRevision: BaseRevision
}) {
  // El formulario conserva la edición local del año; al cambiar la sugerencia
  // desde el servidor se remonta con una clave nueva, sin mostrar un valor viejo.
  return <PdtpCreateProgramFields key={props.suggestedYear} {...props} />
}

function PdtpCreateProgramFields({
  suggestedYear,
  existingPrograms,
  copyCandidates,
  baseRevision,
}: {
  suggestedYear: number
  existingPrograms: PdtpExistingProgram[]
  copyCandidates: PdtpCopyCandidate[]
  baseRevision: BaseRevision
}) {
  const [state, formAction] = useActionState(createPdtpProgramAction, null)
  const [year, setYear] = React.useState(() => suggestedYear)
  // `null` = sin elección explícita: vale la recomendada (D20, copiar el año anterior).
  const [chosenOrigin, setChosenOrigin] = React.useState<Origin | null>(null)

  const existing = existingPrograms
    .filter((program) => program.year === year)
    .sort((left, right) => right.version - left.version)[0]
  // D20: la versión vigente del año elegible más reciente, ANTERIOR al destino.
  const candidate = copyCandidates
    .filter((item) => item.year < year)
    .sort((left, right) => right.year - left.year)[0]
  const origin: Origin = chosenOrigin === "base" && baseRevision
    ? "base"
    : chosenOrigin === "previous_program" && candidate
      ? "previous_program"
      : candidate ? "previous_program" : "base"
  const canCreate = !existing && (origin === "previous_program" ? Boolean(candidate) : Boolean(baseRevision))

  return (
    <form action={formAction} className="space-y-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs sm:p-6">
      <Field
        className="w-40"
        label="Año del programa"
        htmlFor="pdtp-year"
        helper="Se sugiere el siguiente año sin programa."
      >
        <Input
          id="pdtp-year"
          name="year"
          type="number"
          min={2024}
          max={2100}
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          required
        />
      </Field>

      {existing ? (
        <Callout tone="info" title={`El programa ${year} ya existe`}>
          <p>
            Versión v{existing.version}, {pdtpProgramStatusLabel(existing.status).toLowerCase()},{" "}
            {CREATION_MODE_LABEL[existing.creationMode] ?? "creado anteriormente"}. No se crea otro para el mismo año.
          </p>
          <Link className="mt-2 inline-flex font-medium text-[var(--color-primary-ink)] hover:underline" href={`/prevencion/pdtp/${existing.id}`}>
            Abrir el programa {year}
          </Link>
        </Callout>
      ) : (
        <section aria-labelledby="origin-heading" className="border-t border-[var(--color-border)] pt-4">
          <h2 id="origin-heading" className="text-sm font-semibold text-[var(--color-text)]">¿Desde dónde se crea el programa {year}?</h2>
          <input type="hidden" name="origin" value={origin} />
          <input type="hidden" name="sourceProgramId" value={origin === "previous_program" && candidate ? candidate.programId : ""} />
          {candidate || baseRevision ? (
            <div role="radiogroup" aria-labelledby="origin-heading" className="mt-3 grid gap-2">
              {candidate && (
                <SelectableCard
                  selected={origin === "previous_program"}
                  onClick={() => setChosenOrigin("previous_program")}
                  icon={<CopySimple size={14} aria-hidden />}
                >
                  <SelectableCardTitle>Copiar el programa {candidate.year} (v{candidate.version})</SelectableCardTitle>
                  <SelectableCardDescription>
                    Recomendado. Versión vigente de {candidate.year} ({pdtpProgramStatusLabel(candidate.status).toLowerCase()}) ·{" "}
                    {candidate.activityCount} actividades. Copia mecanismo, destino, programación (re-anclada a {year}),
                    evidencia exigida, recordatorios, ejecutores y exclusiones. No copia actividades retiradas, ajustes
                    puntuales por faena ni el padrón; las asignaciones nominales se traspasan al activar.
                  </SelectableCardDescription>
                </SelectableCard>
              )}
              {baseRevision && (
                <SelectableCard
                  selected={origin === "base"}
                  onClick={() => setChosenOrigin("base")}
                  icon={<FileXls size={14} aria-hidden />}
                >
                  <SelectableCardTitle>Base preventiva 2026</SelectableCardTitle>
                  <SelectableCardDescription>
                    Revisión {baseRevision.version} · {baseRevision.activityCount} actividades ·{" "}
                    <span title={baseRevision.contentDigest}>contenido firmado</span>. Parte del documento oficial 2026:
                    lo configurado después en el programa vigente habrá que volver a hacerlo.
                  </SelectableCardDescription>
                </SelectableCard>
              )}
            </div>
          ) : (
            <Callout tone="warning" role="alert" title={`No hay desde dónde crear el programa ${year}`} className="mt-3">
              No existe un programa vigente de un año anterior para copiar ni la Base preventiva 2026 publicada. Quien
              administre el catálogo PDTP (Jefatura de Prevención u otro con el permiso correspondiente) debe publicar
              la Base antes de crear programas anuales.
            </Callout>
          )}
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Ejecuciones, evidencias, firmas y aprobaciones comienzan vacías en cualquier caso.
          </p>
        </section>
      )}

      {state?.message && (
        <Callout
          tone={state.ok ? "success" : "danger"}
          role="status"
          title={state.ok ? "Programa disponible" : "No se pudo crear"}
        >
          {state.message}
          {"programId" in state && state.programId && (
            <Link className="ml-1 font-medium text-[var(--color-primary-ink)] hover:underline" href={`/prevencion/pdtp/${state.programId}`}>
              Abrir el programa
            </Link>
          )}
        </Callout>
      )}

      {!existing && (
        <div className="flex justify-end">
          <SubmitButton disabled={!canCreate} label="Crear programa anual" loadingLabel="Creando...">
            <ArrowRight size={16} aria-hidden />
          </SubmitButton>
        </div>
      )}
    </form>
  )
}
