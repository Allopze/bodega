"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { formatDateTime } from "@/lib/utils"
import {
  Re20Block,
  Re20CatalogSelect,
  Re20Fact,
  Re20PersonPicker,
  Re20RepeatableList,
  Re20Text,
  Re20TextArea,
  Re20YesNo,
} from "../../fields"
import { Re20SensitiveVeil } from "../../sensitive-veil"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { filled } from "./checks"

const ID = (field: string) => `re20-investigacion-${field}`

/** ÁRBOL: la planilla trae seis filas para el equipo (INV.DEF.ACC!B37:B42). */
const MAX_TEAM = 6

/** B31, literal. */
const GENDER_HELP = "Registra solo factores que influyeron en la exposición o en la consecuencia: talla o ajuste de EPP, diseño antropométrico del puesto, asignación de tareas, embarazo o lactancia conocidos, responsabilidades de cuidado que afecten la jornada, barreras de comunicación o discapacidad. No registres información personal innecesaria."

export function TeamSection({ ws }: { ws: Re20WorkspaceApi }) {
  const team = ws.data.team
  const person = ws.data.affectedPerson
  const p = ws.data.preliminary
  const setPerson = (field: string) => (value: unknown) => ws.patch(["affectedPerson", field], value)
  const complete = team.length > 0 && team.every((m) => m.userId && filled(m.role) && m.impartialityDeclared !== null && m.impartialityDeclared !== undefined)

  return (
    <div>
      <Re20Block
        id={ID("block-team")}
        title="Equipo investigador (4)"
        summary={team.length === 0 ? "Sin integrantes" : `${team.length} ${team.length === 1 ? "integrante" : "integrantes"}`}
        complete={complete}
        defaultOpen={team.length === 0}
      >
        <Re20RepeatableList
          id={ID("team")}
          title="Integrantes"
          description="Quiénes investigan, con qué rol, si visitaron el lugar y su declaración de imparcialidad."
          items={team}
          max={MAX_TEAM}
          getKey={(_, index) => `team-${index}`}
          itemLabel={(member, index) => ws.people.find((candidate) => candidate.id === member.userId)?.name ?? `integrante ${index + 1}`}
          addLabel="Agregar integrante"
          emptyTitle="Aún no hay equipo investigador"
          emptyDescription="Agrega a quienes participan de la investigación: la persona responsable, Prevención de Riesgos y quien conozca la tarea."
          onAdd={() => ws.update((data) => ({ ...data, team: [...data.team, { userId: "", position: null, role: "", visitedSite: null, impartialityDeclared: null, signedAt: null }] }))}
          onRemove={(index) => ws.update((data) => ({ ...data, team: data.team.filter((_, i) => i !== index) }))}
          renderItem={(member, index) => (
            <div className="space-y-3">
              <div className="grid gap-4 md:grid-cols-2">
                <Re20PersonPicker
                  id={ID(`team-${index}-userId`)}
                  label="Nombre"
                  required
                  value={member.userId}
                  excludeIds={team.filter((_, i) => i !== index).map((other) => other.userId)}
                  clearLabel="Sin elegir"
                  onChange={(userId) => ws.update((data) => ({
                    ...data,
                    team: data.team.map((item, i) => i === index
                      ? { ...item, userId: userId ?? "", position: item.position?.trim() ? item.position : ws.people.find((c) => c.id === userId)?.position ?? null }
                      : item),
                  }))}
                />
                <Re20Text id={ID(`team-${index}-position`)} label="Cargo o representación" value={member.position} maxLength={200} onChange={(value) => ws.patch(["team", index, "position"], value)} />
                <Re20CatalogSelect id={ID(`team-${index}-role`)} label="Rol en la investigación" category="investigation_role" required value={member.role} onChange={(value) => ws.patch(["team", index, "role"], value ?? "")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Re20YesNo id={ID(`team-${index}-visitedSite`)} label="¿Participó en la visita al lugar?" value={member.visitedSite} onChange={(value) => ws.patch(["team", index, "visitedSite"], value)} />
                <Re20YesNo id={ID(`team-${index}-impartiality`)} label="¿Declara imparcialidad?" required value={member.impartialityDeclared} onChange={(value) => ws.patch(["team", index, "impartialityDeclared"], value)} helper="Que no tiene un conflicto de interés con el evento." />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox
                  id={ID(`team-${index}-signed`)}
                  label="Firmó"
                  className="size-5"
                  checked={Boolean(member.signedAt)}
                  onChange={(event) => ws.patch(["team", index, "signedAt"], event.target.checked ? new Date().toISOString() : null)}
                />
                {member.signedAt && <span className="text-xs text-[var(--color-text-muted)]">Registrada el <span className="font-mono tabular-nums">{formatDateTime(member.signedAt)}</span></span>}
              </div>
            </div>
          )}
        />
        <Re20TextArea
          id={ID("conflictOfInterestNotes")}
          label="Observaciones sobre participación o conflictos de interés"
          rows={3}
          maxLength={3000}
          value={ws.data.conflictOfInterestNotes}
          onChange={(value) => ws.patch("conflictOfInterestNotes", value)}
        />
      </Re20Block>

      <Re20Block
        id={ID("block-affected")}
        title="Persona afectada (2)"
        summary={ws.involvedPeople.length === 0 ? "Sin personas en el reporte" : ws.involvedPeople.map((item) => item.displayLabel).join(", ")}
        complete={[person.trainedForTask, person.authorization, person.ppeUsed].every(filled)}
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <Re20Fact label="Personas del reporte inicial" value={ws.involvedPeople.length === 0 ? "—" : ws.involvedPeople.map((item) => item.displayLabel).join(", ")} />
          <Re20Fact label="Parte del cuerpo lesionada" value={p.bodyZone || "—"} />
          <Re20Fact label="Lesión (del preliminar)" value={p.injuryDescription || "—"} />
        </dl>
        <p className="text-xs text-[var(--color-text-subtle)]">Nombre, RUT y cargo son datos reservados: están en la ficha de cada persona, no aquí.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Re20Text id={ID("affected-tenureCompany")} label="Antigüedad en la empresa" value={person.tenureCompany} maxLength={120} onChange={setPerson("tenureCompany")} />
          <Re20Text id={ID("affected-taskExperience")} label="Experiencia en la tarea" value={person.taskExperience} maxLength={120} onChange={setPerson("taskExperience")} />
          <Re20Text id={ID("affected-shift")} label="Jornada o turno" value={person.shift} maxLength={120} onChange={setPerson("shift")} />
          <Re20Text id={ID("affected-hoursWorkedBefore")} label="Horas trabajadas antes del evento" value={person.hoursWorkedBefore} maxLength={60} onChange={setPerson("hoursWorkedBefore")} />
          <Re20Text id={ID("affected-contractType")} label="Tipo de contrato" value={person.contractType} maxLength={120} onChange={setPerson("contractType")} />
          <Re20Text id={ID("affected-directSupervisor")} label="Jefatura directa" value={person.directSupervisor} maxLength={300} onChange={setPerson("directSupervisor")} />
          <Re20CatalogSelect id={ID("affected-sex")} label="Sexo (registro estadístico)" category="worker_sex" value={person.sex} onChange={setPerson("sex")} />
          <Re20CatalogSelect id={ID("affected-authorization")} label="Autorización o licencia" category="authorization_license" value={person.authorization} onChange={setPerson("authorization")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Re20YesNo id={ID("affected-trainedForTask")} label="Capacitación para la tarea" variant="unverified" value={person.trainedForTask} onChange={setPerson("trainedForTask")} />
          <Re20YesNo id={ID("affected-odiInformed")} label="ODI o información de riesgos" variant="unverified" value={person.odiInformed} onChange={setPerson("odiInformed")} />
          <Re20YesNo id={ID("affected-procedureKnown")} label="Procedimiento conocido" variant="unverified" value={person.procedureKnown} onChange={setPerson("procedureKnown")} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Re20TextArea id={ID("affected-ppeRequired")} label="EPP requerido" rows={2} maxLength={1000} value={person.ppeRequired} onChange={setPerson("ppeRequired")} />
          <Re20TextArea id={ID("affected-ppeUsed")} label="EPP utilizado" rows={2} maxLength={1000} value={person.ppeUsed} onChange={setPerson("ppeUsed")} />
        </div>
        <Re20TextArea id={ID("affected-injurySummary")} label="Lesión: descripción general" rows={2} maxLength={2000} value={person.injurySummary} onChange={setPerson("injurySummary")} helper="Sin diagnósticos. El detalle clínico va abajo, como dato reservado." />
        <Re20SensitiveVeil title="Detalle clínico de la lesión" description="Los antecedentes clínicos identifican a la persona. Para verlos o escribirlos, indica para qué los necesitas: queda registrado.">
          <div className="space-y-4">
            <Re20TextArea id={ID("clinical-description")} label="Descripción clínica" rows={3} maxLength={3000} value={ws.sensitive.injuryClinical?.description} onChange={(value) => ws.patchSensitive(["injuryClinical", "description"], value)} />
            <div className="grid gap-4 md:grid-cols-2">
              <Re20Text id={ID("clinical-bodyPartDetail")} label="Detalle de la zona afectada" value={ws.sensitive.injuryClinical?.bodyPartDetail} maxLength={500} onChange={(value) => ws.patchSensitive(["injuryClinical", "bodyPartDetail"], value)} />
              <Re20TextArea id={ID("clinical-clinicalNotes")} label="Notas clínicas" rows={2} maxLength={3000} value={ws.sensitive.injuryClinical?.clinicalNotes} onChange={(value) => ws.patchSensitive(["injuryClinical", "clinicalNotes"], value)} />
            </div>
          </div>
        </Re20SensitiveVeil>
      </Re20Block>

      <Re20Block
        id={ID("block-gender")}
        title="Enfoque de género e inclusión (3)"
        summary={ws.data.definitive.genderPerspective?.trim() ? ws.data.definitive.genderPerspective : "Sin factores registrados"}
        complete={filled(ws.data.definitive.genderPerspective)}
      >
        <p className="text-sm text-[var(--color-text-muted)]">{GENDER_HELP}</p>
        <Re20TextArea id={ID("genderPerspective")} label="Factores de género e inclusión que influyeron" rows={4} maxLength={5000} value={ws.data.definitive.genderPerspective} onChange={(value) => ws.patch(["definitive", "genderPerspective"], value)} />
      </Re20Block>
    </div>
  )
}

