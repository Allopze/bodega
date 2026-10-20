"use client"

import Link from "next/link"
import { Callout } from "@/components/ui/callout"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NO_SUBJECT, subjectRefOf, type InspectionSubjectOption } from "@/lib/prevention/inspection-list-query"

/**
 * Lo que se puede elegir como sujeto: con una plantilla de contenedores sólo los
 * del catálogo (sin contenedor el run, o el programa, nace sin sujeto); en el
 * resto, todo el inventario de la faena.
 */
export function selectableSubjects(subjects: InspectionSubjectOption[], requiresContainer: boolean) {
  return requiresContainer ? subjects.filter((subject) => subject.source === "container") : subjects
}

/**
 * Selector del sujeto inspeccionado (recurso, equipo o contenedor del inventario
 * de una faena). Lo comparten el alta de una inspección y el alta y la edición de
 * una programación, que tenían cada uno su copia.
 *
 * `value` es la referencia `source:id` de `subjectRefOf` (o `NO_SUBJECT`).
 * `subjects` es el inventario completo de la faena: acá se filtra por contenedor.
 * El texto de ayuda lo pone quien llama porque dice cosas distintas del run y del
 * programa. Con una plantilla de contenedores el campo es obligatorio, no ofrece
 * «sin sujeto» y, si la faena no tiene contenedores, lo dice con un aviso.
 */
export function SubjectSelectField({ worksiteId, subjects, requiresContainer, value, onValueChange, noneLabel, hint }: {
  /** Faena cuyo inventario se ofrece; sin ella el selector queda deshabilitado. */
  worksiteId: string
  subjects: InspectionSubjectOption[]
  requiresContainer: boolean
  value: string
  onValueChange: (value: string) => void
  /** Texto de la opción «sin sujeto del inventario» (no se ofrece con contenedores). */
  noneLabel: string
  hint: string
}) {
  const options = selectableSubjects(subjects, requiresContainer)
  const label = requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"
  return (
    <Field label={label} required={requiresContainer} hint={hint}>
      <Select value={value} onValueChange={onValueChange} disabled={!worksiteId}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={!worksiteId
            ? "Selecciona una faena primero"
            : requiresContainer ? "Selecciona un contenedor" : noneLabel} />
        </SelectTrigger>
        <SelectContent>
          {!requiresContainer && <SelectItem value={NO_SUBJECT}>{noneLabel}</SelectItem>}
          {options.map((subject) => (
            <SelectItem key={subjectRefOf(subject)} value={subjectRefOf(subject)}>
              {subject.source === "vehicle" ? "Equipo" : subject.source === "container" ? "Contenedor" : "Recurso"} · {subject.name}
              {subject.source !== "container" && subject.location ? ` · ${subject.location}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {requiresContainer && worksiteId && options.length === 0 && (
        <Callout tone="warning" className="mt-2 text-xs">
          Esta faena todavía no tiene contenedores en el catálogo. Cárgalos en <Link href="/admin/contenedores" className="underline">Administración › Contenedores</Link>.
        </Callout>
      )}
    </Field>
  )
}
