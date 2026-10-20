"use client"

import { CaretDown, CheckCircle, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { formatDate, todayInChile } from "@/lib/utils"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { Re20Date, Re20DateTime, Re20PersonPicker, Re20Text, Re20TextArea, Re20YesNo } from "../../fields"
import {
  DECLARATION_CLAUSE,
  DECLARATION_KIND_LABELS,
  DECLARATION_KIND_OPTIONS,
  DECLARATION_QUESTIONS,
  INTERVIEW_RULES,
  declId,
  declarationLabel,
  declarationMissing,
  type Re20Declaration,
} from "./model"

/* Una persona que declara (RE-20-07). Plegada muestra «nombre · calidad ·
 * fecha · firmada»; abierta, el formulario en tres grupos con encabezado. */

const SEPARATOR = "; "

function interviewerNames(value: string | null | undefined) {
  return (value ?? "").split(SEPARATOR).map((name) => name.trim()).filter(Boolean)
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h5 className="text-sm font-semibold text-[var(--color-text)]">{title}</h5>
      {children}
    </section>
  )
}

export function Re20DeclarationCard({ ws, declaration, index, defaultOpen }: {
  ws: Re20WorkspaceApi
  declaration: Re20Declaration
  index: number
  defaultOpen: boolean
}) {
  const d = declaration
  const set = (field: keyof Re20Declaration) => (value: unknown) =>
    ws.updateSensitive((sensitive) => ({
      ...sensitive,
      declarations: sensitive.declarations.map((item) => item.id === d.id ? { ...item, [field]: value } : item),
    }))
  const setAnswer = (key: string, value: boolean | null) =>
    ws.updateSensitive((sensitive) => ({
      ...sensitive,
      declarations: sensitive.declarations.map((item) => item.id === d.id
        ? { ...item, answers: { ...item.answers, [key]: value }, ...(key === "reserveIdentity" ? { reserveIdentity: value === true } : {}) }
        : item),
    }))
  const interviewers = interviewerNames(d.interviewers)
  const writeInterviewers = (names: string[]) => set("interviewers")(names.length ? names.join(SEPARATOR) : null)
  const taken = interviewers.map((name) => ws.people.find((person) => person.name === name)?.id)
  const missing = declarationMissing(d, index)
  const signed = Boolean(d.signedAt)
  const summary = [
    DECLARATION_KIND_LABELS[d.kind],
    d.interviewDate ? formatDate(d.interviewDate) : "Sin fecha",
    signed ? "Firmada" : "Sin firmar",
  ].join(" · ")

  return (
    <details id={declId(d, "card")} open={defaultOpen || undefined} className="group">
      <summary className="-my-1 flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[var(--radius-md)] py-2 outline-none transition-colors duration-150 hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium text-[var(--color-text)]">
            <span className="truncate">{declarationLabel(d, index)}</span>
            {missing.length === 0 && <CheckCircle aria-label="Completa" weight="fill" className="size-4 shrink-0 text-[var(--color-success)]" />}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">{summary}</span>
        </span>
        <CaretDown aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>

      <div className="space-y-6 pb-2 pt-3">
        <Group title="Quién declara">
          <div className="grid gap-4 md:grid-cols-2">
            <Re20Text id={declId(d, "name")} label="Nombre de quien declara" required value={d.name} onChange={set("name")} maxLength={200} autoComplete="off" />
            <Re20Text id={declId(d, "nationalId")} label="RUT o identificación" value={d.nationalId} onChange={set("nationalId")} maxLength={40} autoComplete="off" />
            <Field label="Calidad" htmlFor={declId(d, "kind")} helper="Su relación con el evento.">
              <OptionSelect
                id={declId(d, "kind")}
                options={d.kind === "cphs" ? [{ value: "cphs", label: DECLARATION_KIND_LABELS.cphs }, ...DECLARATION_KIND_OPTIONS] : DECLARATION_KIND_OPTIONS}
                value={d.kind}
                onValueChange={(value) => value && set("kind")(value)}
                placeholder="Elige la calidad"
              />
            </Field>
            <Re20Text id={declId(d, "role")} label="Cargo o relación con el evento" value={d.role} onChange={set("role")} maxLength={200} />
            <Re20Text id={declId(d, "contact")} label="Contacto" value={d.contact} onChange={set("contact")} maxLength={300} placeholder="Teléfono o correo" autoComplete="off" />
          </div>
        </Group>

        <Group title="La entrevista">
          <details className="group/help rounded-[var(--radius-md)]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-md)] text-sm text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] [&::-webkit-details-marker]:hidden">
              <CaretDown aria-hidden className="size-3.5 transition-transform group-open/help:rotate-180 motion-reduce:transition-none" />
              Cómo conducir la entrevista
            </summary>
            <p className="pb-2 text-sm text-[var(--color-text-muted)]">{INTERVIEW_RULES}</p>
          </details>
          <div className="grid gap-4 md:grid-cols-2">
            <Re20Text id={declId(d, "investigationNumber")} label="N° de investigación" value={d.investigationNumber} onChange={set("investigationNumber")} maxLength={80} />
            <Re20Date id={declId(d, "interviewDate")} label="Fecha de la entrevista" value={d.interviewDate} onChange={set("interviewDate")} max={todayInChile()} />
            <Re20Text id={declId(d, "place")} label="Lugar de la entrevista" value={d.place} onChange={set("place")} maxLength={300} className="md:col-span-2" />
          </div>
          <div className="space-y-2">
            <Re20PersonPicker
              id={declId(d, "interviewerPicker")}
              label="Quién entrevista"
              helper="Agrega a cada entrevistador."
              value=""
              excludeIds={taken}
              onChange={(userId) => {
                const person = ws.people.find((item) => item.id === userId)
                if (person && !interviewers.includes(person.name)) writeInterviewers([...interviewers, person.name])
              }}
              clearLabel="Elegir una persona"
            />
            {interviewers.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Entrevistadores">
                {interviewers.map((name) => (
                  <li key={name} className="flex min-h-11 items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] pl-3 pr-1 text-sm">
                    {name}
                    {!ws.readOnly && (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar a ${name}`} onClick={() => writeInterviewers(interviewers.filter((item) => item !== name))}>
                        <X aria-hidden className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Group>

        <Group title="Lo que cuenta">
          <Re20TextArea id={declId(d, "statement")} label="Relato libre de lo observado, hecho o conocido" required rows={7} value={d.statement} onChange={set("statement")} maxLength={10000} helper="Con sus propias palabras: lo que vio, oyó, hizo o supone." />
          <Re20TextArea id={declId(d, "clarifications")} label="Aclaraciones pedidas por el equipo investigador" rows={4} value={d.clarifications} onChange={set("clarifications")} maxLength={5000} />
        </Group>

        <Group title="Información complementaria">
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            {DECLARATION_QUESTIONS.map(({ key, label }) => (
              <Re20YesNo
                key={key}
                id={declId(d, `answer-${key}`)}
                label={label}
                value={d.answers?.[key]}
                onChange={(value) => setAnswer(key, value)}
              />
            ))}
          </div>
        </Group>

        <Group title="Aceptación y firma">
          <Checkbox
            id={declId(d, "clause")}
            label={DECLARATION_CLAUSE}
            checked={d.clauseAccepted === true}
            onChange={(event) => set("clauseAccepted")(event.target.checked ? true : null)}
            className="size-5"
          />
          <Re20DateTime id={declId(d, "signedAt")} label="Fecha y hora en que firmó" required value={d.signedAt} onChange={set("signedAt")} max={new Date().toISOString()} helper="La firma queda en el papel; aquí solo se anota cuándo se firmó." />
        </Group>
      </div>
    </details>
  )
}
