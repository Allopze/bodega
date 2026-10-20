"use client"

import {
  RE20_ANNEX_CODES,
  RE20_INSTRUMENT_IDS,
  RE20_SIGNATURE_ROLES,
  RE20_TEAM_CHECKLIST_KEYS,
} from "@/lib/services/prevention-incident-re20-schema"
import {
  Re20Block,
  Re20CatalogSelect,
  Re20Date,
  Re20PersonPicker,
  Re20Text,
  Re20TextArea,
  Re20YesNo,
} from "../../fields"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { ANNEX_LABELS, CHECKLIST_LABELS, ID, INSTRUMENT_LABELS, SIGNATURE_LABELS, filled } from "./checks"

/** INV.DEF.ACC!B155, literal. */
const CPHS_CONTEXT = "La determinación de negligencia inexcusable corresponde al Comité Paritario después de investigar las causas (art. 70, Ley N°16.744). Se registra separada del análisis causal y no reemplaza las medidas preventivas."
/** INV.DEF.ACC!B137, literal. */
const INFORMED_HELP = "Por ejemplo: persona afectada, equipo de trabajo, Comité Paritario, sindicato, empresa principal u organismo administrador."

type Definitive = Re20WorkspaceApi["data"]["definitive"]

export function ClosureSection({ ws }: { ws: Re20WorkspaceApi }) {
  const d = ws.data.definitive
  const setD = (field: string) => (value: unknown) => ws.patch(["definitive", field], value)
  const setNested = (group: "closure" | "cphs" | "teamChecklist", field: string) => (value: unknown) => ws.patch(["definitive", group, field], value)

  const instrumentRow = (id: (typeof RE20_INSTRUMENT_IDS)[number]) => d.instruments.find((row) => row.id === id)
  const updateInstrument = (id: (typeof RE20_INSTRUMENT_IDS)[number], patch: Partial<Definitive["instruments"][number]>) => ws.update((data) => {
    const rows = data.definitive.instruments
    const next = { ...(rows.find((row) => row.id === id) ?? { id }), ...patch } as Definitive["instruments"][number]
    const ordered = [...rows.filter((row) => row.id !== id), next].sort((a, b) => RE20_INSTRUMENT_IDS.indexOf(a.id) - RE20_INSTRUMENT_IDS.indexOf(b.id))
    return { ...data, definitive: { ...data.definitive, instruments: ordered } }
  })
  const instrumentsAnswered = RE20_INSTRUMENT_IDS.filter((id) => typeof instrumentRow(id)?.requiresChange === "boolean").length

  const annexRow = (code: (typeof RE20_ANNEX_CODES)[number]) => d.annexes.find((row) => row.code === code)
  const updateAnnex = (code: (typeof RE20_ANNEX_CODES)[number], patch: Partial<Definitive["annexes"][number]>) => ws.update((data) => {
    const rows = data.definitive.annexes
    const next = { ...(rows.find((row) => row.code === code) ?? { code }), ...patch } as Definitive["annexes"][number]
    const ordered = [...rows.filter((row) => row.code !== code), next].sort((a, b) => RE20_ANNEX_CODES.indexOf(a.code) - RE20_ANNEX_CODES.indexOf(b.code))
    return { ...data, definitive: { ...data.definitive, annexes: ordered } }
  })
  const annexesMarked = RE20_ANNEX_CODES.filter((code) => filled(annexRow(code)?.included)).length

  const signatureRow = (role: (typeof RE20_SIGNATURE_ROLES)[number]) => d.signatures.find((row) => row.role === role)
  const updateSignature = (role: (typeof RE20_SIGNATURE_ROLES)[number], patch: Partial<Definitive["signatures"][number]>) => ws.update((data) => {
    const rows = data.definitive.signatures
    const next = { ...(rows.find((row) => row.role === role) ?? { role }), ...patch } as Definitive["signatures"][number]
    const ordered = [...rows.filter((row) => row.role !== role), next].sort((a, b) => RE20_SIGNATURE_ROLES.indexOf(a.role) - RE20_SIGNATURE_ROLES.indexOf(b.role))
    return { ...data, definitive: { ...data.definitive, signatures: ordered } }
  })
  const signed = RE20_SIGNATURE_ROLES.filter((role) => filled(signatureRow(role)?.name)).length

  const checklistAnswered = RE20_TEAM_CHECKLIST_KEYS.filter((key) => typeof d.teamChecklist[key] === "boolean").length
  const closureFilled = [d.closure.informedTo, d.closure.executiveSummary, d.closure.proposedClosureDate].filter(filled).length

  return (
    <div>
      <Re20Block
        id={ID("block-instruments")}
        title="Instrumentos preventivos (9.1)"
        summary={instrumentsAnswered === RE20_INSTRUMENT_IDS.length ? "Los 7 revisados" : `${instrumentsAnswered} de ${RE20_INSTRUMENT_IDS.length} revisados`}
        complete={instrumentsAnswered === RE20_INSTRUMENT_IDS.length}
      >
        <p className="text-xs text-[var(--color-text-muted)]">Para cada instrumento: ¿hay que cambiarlo a raíz de lo que se encontró?</p>
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {RE20_INSTRUMENT_IDS.map((id) => {
            const row = instrumentRow(id)
            return (
              <li key={id} className="space-y-3 py-3">
                <Re20YesNo id={ID(`instrument-${id}-requiresChange`)} label={`${INSTRUMENT_LABELS[id]}: ¿requiere cambio?`} value={row?.requiresChange} onChange={(value) => updateInstrument(id, { requiresChange: value })} />
                {row?.requiresChange === true && (
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_minmax(0,12rem)]">
                    <Re20TextArea id={ID(`instrument-${id}-change`)} label="Cambio requerido" rows={2} maxLength={1500} value={row.change} onChange={(value) => updateInstrument(id, { change: value })} />
                    <Re20PersonPicker id={ID(`instrument-${id}-responsible`)} label="Responsable" value={row.responsibleUserId} onChange={(value) => updateInstrument(id, { responsibleUserId: value })} />
                    <Re20Date id={ID(`instrument-${id}-dueDate`)} label="Fecha" value={row.dueDate} onChange={(value) => updateInstrument(id, { dueDate: value })} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Re20Block>

      <Re20Block
        id={ID("block-closure")}
        title="Comunicación, aprendizaje y cierre (11)"
        summary={closureFilled === 3 ? "Completo" : `${closureFilled} de 3 datos obligatorios`}
        complete={closureFilled === 3}
      >
        <Re20TextArea id={ID("closure-informedTo")} label="Resultados informados a" required rows={2} maxLength={1000} value={d.closure.informedTo} onChange={setNested("closure", "informedTo")} helper={INFORMED_HELP} />
        <div className="grid gap-4 md:grid-cols-2">
          <Re20Text id={ID("closure-communicationMeansAndDate")} label="Medio y fecha de comunicación" maxLength={1000} value={d.closure.communicationMeansAndDate} onChange={setNested("closure", "communicationMeansAndDate")} />
          <Re20Date id={ID("closure-proposedClosureDate")} label="Fecha propuesta de cierre" required value={d.closure.proposedClosureDate} onChange={setNested("closure", "proposedClosureDate")} />
        </div>
        <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
          <Re20YesNo id={ID("closure-learningReplicated")} label="¿Aprendizajes replicados a otros centros?" value={d.closure.learningReplicated} onChange={setNested("closure", "learningReplicated")} />
          <Re20TextArea id={ID("closure-learningDetail")} label="Detalle del aprendizaje" rows={2} maxLength={3000} value={d.closure.learningDetail} onChange={setNested("closure", "learningDetail")} />
        </div>
        <Re20TextArea id={ID("closure-executiveSummary")} label="Resumen ejecutivo de causas, medidas y aprendizaje" required rows={4} maxLength={5000} value={d.closure.executiveSummary} onChange={setNested("closure", "executiveSummary")} />
      </Re20Block>

      <Re20Block
        id={ID("block-conclusion")}
        title="Conclusión del equipo (11.1)"
        summary={(d.conclusion?.trim().length ?? 0) >= 10 ? `${checklistAnswered} de ${RE20_TEAM_CHECKLIST_KEYS.length} respuestas` : "Falta la conclusión"}
        complete={(d.conclusion?.trim().length ?? 0) >= 10 && checklistAnswered === RE20_TEAM_CHECKLIST_KEYS.length}
      >
        <Re20TextArea id={ID("conclusion")} label="Conclusión del equipo investigador" required rows={5} maxLength={10000} value={d.conclusion} onChange={setD("conclusion")} helper="Mínimo 10 caracteres. Resume qué ocurrió, por qué y qué se hará, sin culpar a personas." />
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {RE20_TEAM_CHECKLIST_KEYS.map((key) => (
            <li key={key} className="py-2.5">
              <Re20YesNo id={ID(`checklist-${key}`)} label={CHECKLIST_LABELS[key]} value={d.teamChecklist[key]} onChange={setNested("teamChecklist", key)} />
            </li>
          ))}
        </ul>
      </Re20Block>

      <Re20Block
        id={ID("block-cphs")}
        title="Pronunciamiento del Comité Paritario (12)"
        summary={d.cphs.decision ? d.cphs.decision : "Cuando corresponda"}
        complete={filled(d.cphs.decision)}
      >
        <p className="text-sm text-[var(--color-text-muted)]">{CPHS_CONTEXT}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Re20Date id={ID("cphs-sessionDate")} label="Fecha de sesión" value={d.cphs.sessionDate} onChange={setNested("cphs", "sessionDate")} />
          <Re20Text id={ID("cphs-minutesNumber")} label="N° de acta" maxLength={80} value={d.cphs.minutesNumber} onChange={setNested("cphs", "minutesNumber")} />
          <Re20YesNo id={ID("cphs-quorum")} label="Quórum" value={d.cphs.quorum} onChange={setNested("cphs", "quorum")} />
          <Re20YesNo id={ID("cphs-reviewed")} label="Investigación revisada" value={d.cphs.reviewed} onChange={setNested("cphs", "reviewed")} />
        </div>
        <Re20CatalogSelect id={ID("cphs-decision")} label="Decisión" category="cphs_decision" value={d.cphs.decision} onChange={setNested("cphs", "decision")} />
        <Re20TextArea id={ID("cphs-rationale")} label="Fundamentos y antecedentes considerados" rows={3} maxLength={5000} value={d.cphs.rationale} onChange={setNested("cphs", "rationale")} />
        <Re20TextArea id={ID("cphs-measures")} label="Medidas indicadas por el Comité" rows={3} maxLength={5000} value={d.cphs.measures} onChange={setNested("cphs", "measures")} />
      </Re20Block>

      <Re20Block
        id={ID("block-annexes")}
        title="Control de anexos (13)"
        summary={annexesMarked === RE20_ANNEX_CODES.length ? "Los 12 revisados" : `${annexesMarked} de ${RE20_ANNEX_CODES.length} revisados`}
        complete={annexesMarked === RE20_ANNEX_CODES.length}
      >
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {RE20_ANNEX_CODES.map((code) => {
            const row = annexRow(code)
            return (
              <li key={code} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,16rem)] md:items-end">
                <p className="text-sm text-[var(--color-text)]"><span className="mr-2 font-mono font-semibold">{code}</span>{ANNEX_LABELS[code]}</p>
                <Re20YesNo id={ID(`annex-${code}-included`)} label={`¿Incluido? Anexo ${code}`} variant="not_applicable" value={row?.included} onChange={(value) => updateAnnex(code, { included: value })} className="[&>label]:sr-only md:[&>label]:sr-only" />
                <Re20Text id={ID(`annex-${code}-location`)} label={`Ubicación o folio, anexo ${code}`} maxLength={300} value={row?.location} onChange={(value) => updateAnnex(code, { location: value })} className="md:[&_label]:sr-only" placeholder="Ubicación o folio" />
              </li>
            )
          })}
        </ul>
      </Re20Block>

      <Re20Block
        id={ID("block-signatures")}
        title="Firmas (14)"
        summary={signed === 0 ? "Sin firmas" : `${signed} de ${RE20_SIGNATURE_ROLES.length} con nombre`}
        complete={signed === RE20_SIGNATURE_ROLES.length}
      >
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {RE20_SIGNATURE_ROLES.map((role) => {
            const row = signatureRow(role)
            return (
              <li key={role} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
                <Re20Text id={ID(`signature-${role}-name`)} label={`Nombre: ${SIGNATURE_LABELS[role]}`} maxLength={300} value={row?.name} onChange={(value) => updateSignature(role, { name: value })} required={role === "investigator"} />
                <Re20Date id={ID(`signature-${role}-date`)} label="Fecha" value={row?.date} onChange={(value) => updateSignature(role, { date: value })} />
              </li>
            )
          })}
        </ul>
      </Re20Block>
    </div>
  )
}
