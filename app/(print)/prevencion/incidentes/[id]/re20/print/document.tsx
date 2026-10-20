import type { ReactNode } from "react"
import {
  INCIDENT_EVENT_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  RE20_QUALITY_CRITERIA,
  RE20_QUALITY_RESULTS,
  RE20_REVIEW_DECISIONS,
  deriveRe20RootCauses,
  deriveRe20Trajectories,
  type Re20CausalEvent,
  type Re20CausalRelation,
} from "@/lib/prevention/incidents"
import type { IncidentStatus } from "@/lib/services/prevention-incidents"
import type { Re20PublicData } from "@/lib/services/prevention-incident-re20-schema"
import { formatDate, formatDateTime } from "@/lib/utils"

const STYLES = `
  @page { size: A4; margin: 14mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { color: #17231b; font: 10pt/1.45 Arial, sans-serif; }
  .print-toolbar { display:flex; gap:10px; align-items:center; padding:12px; font:14px Arial,sans-serif; }
  .print-toolbar a,.print-toolbar button { border:1px solid #cbd5cf; border-radius:7px; padding:9px 12px; background:white; color:#1c4b31; text-decoration:none; cursor:pointer; }
  .sheet { max-width: 190mm; margin: 0 auto; }
  .doc-header { display:flex; justify-content:space-between; gap:20px; border-bottom:2px solid #1f5135; padding-bottom:12px; }
  .company-name { font-size:10pt; font-weight:700; color:#1f5135; }
  .doc-title { margin-top:4px; font-size:20pt; font-weight:700; }
  .doc-meta { margin-top:5px; color:#526158; }
  .doc-box { min-width:38mm; border:1px solid #b9c8bd; border-radius:7px; padding:8px; text-align:center; }
  .doc-box-title { font-size:8.5pt; color:#526158; }
  .doc-box-code { margin-top:3px; font-size:13pt; font-weight:700; }
  .info-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:12px 0; }
  .info-grid.two { grid-template-columns:repeat(2,1fr); }
  .field { min-height:12mm; border:1px solid #dbe3dd; border-radius:5px; padding:6px 7px; overflow-wrap:anywhere; break-inside:avoid; }
  .field.wide { grid-column:1 / -1; }
  .field-label { display:block; color:#526158; font-size:8.5pt; }
  .field-value { display:block; margin-top:2px; font-weight:600; white-space:pre-wrap; }
  .form-start { break-before:page; }
  .form-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin:0 0 8px; border-bottom:2px solid #1f5135; padding-bottom:5px; }
  .form-head h2 { margin:0; font-size:14pt; }
  .form-code { font-size:10pt; font-weight:700; color:#1f5135; white-space:nowrap; }
  .section-block { margin-top:12px; }
  .section-title { margin:0 0 6px; border-bottom:1px solid #ccd8cf; padding-bottom:3px; font-size:11.5pt; break-after:avoid; }
  .sub-title { margin:10px 0 4px; font-size:10pt; break-after:avoid; }
  .text-block { white-space:pre-wrap; overflow-wrap:anywhere; margin:0 0 6px; }
  table { width:100%; border-collapse:collapse; font-size:8.5pt; }
  tr { break-inside:avoid; }
  thead { display:table-header-group; }
  th,td { border:1px solid #d6ded8; padding:4px 5px; text-align:left; vertical-align:top; overflow-wrap:anywhere; white-space:pre-wrap; }
  th { background:#f0f4f1; }
  .muted { color:#66736a; }
  .note { margin:6px 0; color:#526158; font-size:9pt; }
  .reserved-note { border:1px dashed #b9c8bd; border-radius:5px; padding:8px; color:#526158; font-size:9pt; }
  .tree, .tree ul { list-style:none; margin:0; padding-left:0; }
  .tree ul { margin-left:5mm; padding-left:4mm; border-left:1.5px solid #9fb5a6; }
  .tree li { margin:3px 0; }
  .tree-node { display:inline-block; max-width:100%; border:1px solid #b9c8bd; border-radius:5px; padding:3px 7px; background:#f7faf8; break-inside:avoid; }
  .tree-node.root { border-color:#1f5135; background:#e6f1ea; }
  .tree-node.final { border-width:2px; border-color:#17231b; }
  .tree-id { font-weight:700; margin-right:5px; }
  .tree-tag { color:#526158; font-size:8pt; margin-left:6px; }
  .signatures { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:10px; }
  .signature { min-height:30mm; border:1px solid #cdd8d0; border-radius:5px; padding:6px; break-inside:avoid; }
  .signature-line { margin-top:16mm; border-top:1px solid #17231b; padding-top:3px; font-size:8.5pt; }
  .footer { margin-top:18px; border-top:1px solid #d6ded8; padding-top:6px; color:#66736a; font-size:8pt; }
  @media print { .print-toolbar { display:none; } .sheet { max-width:none; } }
`

/* ── Vocabulario: nada de enums crudos en la hoja ─────────────────────────── */

const RELATION_LABELS: Record<string, string> = { chain: "Cadena", conjunction: "Conjunción", independent: "Independiente" }
const TASK_STATUS_LABELS: Record<string, string> = { pending: "Pendiente", in_progress: "En curso", completed: "Completada", blocked: "Bloqueada" }
const DECLARATION_KIND_LABELS: Record<string, string> = {
  involved: "Persona involucrada", witness: "Testigo", injured_person: "Persona accidentada", cphs: "Comité Paritario (registro anterior)",
}
const DIAT_STATUS_LABELS: Record<string, string> = { draft: "Borrador", prepared: "Preparada" }
const DIAT_SEVERITY_LABELS: Record<string, string> = { grave: "Grave", fatal: "Fatal", other: "Otro" }
const DIAT_SCOPE_LABELS: Record<string, string> = { work: "Accidente del trabajo", commute: "Accidente de trayecto" }
const DIAT_FORM_LABELS: Record<string, string> = {
  fullName: "Nombre completo", nationalIdentifier: "RUN o documento", activity: "Qué hacía la persona al momento del accidente",
  usualWork: "¿Hacía su trabajo habitual?", usualWorkDetail: "Cuál era su trabajo habitual", proofDetail: "Detalle del medio de prueba",
}
const IMMEDIATE_ACTION_LABELS: Array<[string, string]> = [
  ["firstAid", "Primeros auxilios / derivación asistencial"], ["isolation", "Aislamiento del área"],
  ["suspension", "Suspensión de la tarea o faena"], ["evidencePreservation", "Preservación de evidencias"],
  ["supervisorNotice", "Aviso a jefatura y Prevención de Riesgos"], ["committeeNotice", "Aviso al Comité Paritario"],
  ["administratorNotice", "Aviso al organismo administrador"], ["authorityNotice", "Aviso a la autoridad (accidente grave o fatal)"],
]
const ASPECT_LABELS: Record<string, string> = {
  person: "Persona / dotación", task: "Tarea / método", equipment: "Equipo / herramienta", material: "Material / energía",
  environment: "Entorno / lugar", organization: "Organización / supervisión", information: "Información / capacitación", emergency: "Emergencia / respuesta",
}
const INSTRUMENT_LABELS: Record<string, string> = {
  iper: "Matriz IPER / mapa de riesgos", work_program: "Programa de trabajo preventivo", procedure: "Procedimiento / instructivo",
  odi: "ODI / información de riesgos", training: "Capacitación / competencias", maintenance: "Mantención / inspecciones", emergency_plan: "Plan de emergencia / rescate",
}
const CHECKLIST_LABELS: Array<[string, string]> = [
  ["coherentTree", "El árbol es coherente con el relato y el listado de hechos"], ["allRootCausesHaveMeasures", "Todas las causas raíz tienen medidas asociadas"],
  ["controlHierarchyReviewed", "Se revisó la jerarquía de controles"], ["ownersDefined", "Se definieron responsables, plazos, evidencia y verificador"],
  ["sensitiveDataProtected", "Se resguardaron los datos sensibles"], ["iperUpdatedOrJustified", "Se actualizó la matriz IPER o se justificó no hacerlo"],
  ["effectivenessPlanDefined", "Se definió cómo y cuándo se verificará la eficacia"], ["attachmentsIncluded", "Se adjuntaron los antecedentes"],
]
const ANNEX_LABELS: Record<string, string> = {
  A: "Declaraciones firmadas (RE-20-07)", B: "Registro fotográfico y croquis", C: "DIAT / atención médica", D: "Procedimientos e instructivos",
  E: "Matriz IPER vigente y actualización", F: "ODI / capacitación / competencias", G: "Inspecciones y mantenciones",
  H: "Permisos de trabajo / AST / checklists", I: "Registros de jornada y supervisión", J: "Acta del Comité Paritario",
  K: "Evidencia de medidas implementadas", L: "Revisión de calidad (RE-20-13)",
}
const SIGNATURE_LABELS: Record<string, string> = {
  investigator: "Responsable de la investigación / Prevención de Riesgos", cphs: "Representante Comité Paritario",
  contract_admin: "Administrador de Contrato", area_manager: "Subgerente del área",
}
const DECLARATION_ANSWER_LABELS: Array<[string, string]> = [
  ["directWitness", "Presenció directamente el evento"], ["participatedInTask", "Participó en la tarea"], ["knewProcess", "Conocía el proceso"],
  ["thirdPartyInformation", "Recibió información de terceros"], ["sketchAttached", "Adjunta croquis"], ["photosAttached", "Adjunta fotografías"],
  ["contactAuthorized", "Autoriza contacto para aclaraciones"], ["reserveIdentity", "Solicita reserva de identidad en la difusión interna"],
]
const REVIEW_PREVENTION_HEAD = "Jefa Dpto. Prevención de Riesgos"

/* ── Tipos ────────────────────────────────────────────────────────────────── */

type Rec = Record<string, unknown>
type Person = { name: string; position: string | null }

export type Re20PrintFollowup = {
  id: string
  kind: string
  followupDate: string
  note: string
  evidenceRef: string | null
  measureId: string | null
  rootCauseId: string | null
  controlType: string | null
  verifierUserId: string | null
  verifiedAt: string | null
  residualRisk: string | null
  implementedAt: string | null
  verified: boolean
  effective: boolean
  lostDays: number | null
  lossDescription: string | null
}

export type Re20PrintDiffusion = {
  id: string
  onePageSummary: string
  diffusedAt: string
  learning: string | null
  measuresTable: Array<{ rootCauseId: string | null; rootCause: string; measure: string; responsible: string | null; dueAt: string | null; status: string | null }>
}

type PrintData = {
  incident: {
    id: string; code: string; companyName: string; eventType: string; occurredAt: string; knownAt: string; status: string
    actualSeverity: string; potentialSeverity?: string; initialNarrative: string; location: string; worksiteName: string
  }
  workspace: { version: number; data: Re20PublicData; policyVersion: number; updatedAt: string; updatedByUserId: string } | null
  qualityReviews: Array<{
    workspaceVersion: number; decision: string; observation?: string | null; reviewerRole: string; reviewerUserId?: string
    reviewedAt: string; criteria: Array<{ id: string; result: string; observation?: string }>
  }>
  followups?: Re20PrintFollowup[]
  diffusions?: Re20PrintDiffusion[]
  /** Nombre y cargo de las personas que el expediente guarda por id. */
  people?: Record<string, Person>
  /** Rótulo en español de cada rol (`slug` → etiqueta) para «Cargo» de la revisión. */
  roleLabels?: Record<string, string>
  legacy: { methodology: string; preliminaryReportText: string | null; conclusions: string | null; immediateCauses: string[]; basicCauses: string[]; organizationalCauses: string[] } | null
  /** Sólo con propósito de acceso y permiso `view_sensitive`; sin él, las secciones reservadas no existen en la hoja. */
  sensitive?: {
    purpose: string
    declarations?: Array<Rec>
    historicalStatements?: Array<Rec>
    injuredInterview?: Rec
    injuryClinical?: Rec
    diat?: Rec
  } | null
}

/* ── Piezas ───────────────────────────────────────────────────────────────── */

const isBlank = (value: unknown) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)

function displayValue(value: unknown): string {
  if (isBlank(value)) return "—"
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "Sí" : "No"
  if (Array.isArray(value)) return value.map(displayValue).join(", ")
  return String(value)
}

const dateOrDash = (value: unknown) => isBlank(value) ? "—" : formatDate(String(value))
const dateTimeOrDash = (value: unknown) => isBlank(value) ? "—" : formatDateTime(String(value))
const hasAny = (record: Rec | undefined | null): boolean => Object.values(record ?? {}).some((value) => !isBlank(value) && !(typeof value === "object" && !Array.isArray(value) && !hasAny(value as Rec)))

function Field({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  return <div className={wide ? "field wide" : "field"}><span className="field-label">{label}</span><span className="field-value">{displayValue(value)}</span></div>
}

function Grid({ children, two }: { children: ReactNode; two?: boolean }) {
  return <div className={two ? "info-grid two" : "info-grid"}>{children}</div>
}

function Form({ code, title, first, children }: { code: string; title: string; first?: boolean; children: ReactNode }) {
  return <section className={first ? undefined : "form-start"}><div className="form-head"><h2>{title}</h2><span className="form-code">{code}</span></div>{children}</section>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="section-block"><h3 className="section-title">{title}</h3>{children}</section>
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <table><thead><tr>{head.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
}

function Narrative({ label, value }: { label: string; value: unknown }) {
  if (isBlank(value)) return null
  return <p className="text-block"><strong>{label}:</strong> {displayValue(value)}</p>
}

/* ── Árbol de causas ──────────────────────────────────────────────────────── */

function CausalTree({ events, relations }: { events: Re20CausalEvent[]; relations: Re20CausalRelation[] }) {
  const byId = new Map(events.map((event) => [event.id, event]))
  const into = new Map<string, Re20CausalRelation[]>()
  const out = new Set<string>()
  for (const relation of relations) {
    if (!byId.has(relation.from) || !byId.has(relation.to)) continue
    into.set(relation.to, [...(into.get(relation.to) ?? []), relation])
    out.add(relation.from)
  }
  const roots = new Set(deriveRe20RootCauses({ events, relations }))
  const connected = new Set(relations.flatMap((relation) => [relation.from, relation.to]))
  // Cima del árbol: el hecho final H1 si existe; si no, los hechos conectados sin consecuencia.
  const tops = byId.has("H1") ? ["H1"] : events.filter((event) => connected.has(event.id) && !out.has(event.id)).map((event) => event.id)
  const placed = new Set<string>()

  const renderNode = (id: string, via: Re20CausalRelation | null, trail: string[]): ReactNode => {
    const event = byId.get(id)
    if (!event) return null
    const repeated = placed.has(id) || trail.includes(id)
    placed.add(id)
    const antecedents = repeated ? [] : (into.get(id) ?? [])
    const classes = ["tree-node", roots.has(id) ? "root" : "", id === "H1" ? "final" : ""].filter(Boolean).join(" ")
    return (
      <li key={`${trail.join(">")}>${id}`}>
        <span className={classes}>
          <span className="tree-id">{id}</span>{event.description || "Sin descripción"}
          <span className="tree-tag">
            {[via ? RELATION_LABELS[via.type] ?? "" : "", roots.has(id) ? "Causa raíz" : "", event.causal === false ? "Contexto, no causal" : "", event.verified ? "" : "Por verificar", repeated ? "ver arriba" : ""].filter(Boolean).join(" · ")}
          </span>
        </span>
        {antecedents.length > 0 && <ul>{antecedents.map((relation) => renderNode(relation.from, relation, [...trail, id]))}</ul>}
      </li>
    )
  }

  const tree = tops.map((id) => renderNode(id, null, []))
  const loose = events.filter((event) => !placed.has(event.id))
  return <>
    <ul className="tree">{tree}</ul>
    {loose.length > 0 && <p className="note">Hechos sin relación en el árbol: {loose.map((event) => event.id).join(", ")}.</p>}
  </>
}

/* ── Documento ────────────────────────────────────────────────────────────── */

export function Re20PrintDocument({ data }: { data: PrintData }) {
  const { incident, workspace, qualityReviews, legacy, sensitive } = data
  const people = data.people ?? {}
  const personName = (id: unknown) => typeof id === "string" && id ? (people[id]?.name ?? "—") : "—"
  const showReserved = Boolean(sensitive?.purpose?.trim())
  const record = workspace?.data
  const preliminary = record?.preliminary
  const affected = record?.affectedPerson
  const definitive = record?.definitive
  const events = (record?.causalTree.events ?? []) as Re20CausalEvent[]
  const relations = (record?.causalTree.relations ?? []) as Re20CausalRelation[]
  const measures = record?.measures ?? []
  const tasks = record?.tasks ?? []
  const evidences = record?.evidences ?? []
  const team = record?.team ?? []
  const rootIds = deriveRe20RootCauses({ events, relations })
  const trajectories = deriveRe20Trajectories({ events, relations })
  const eventText = (id: string | null | undefined) => events.find((event) => event.id === id)?.description ?? ""
  const measureNumber = (id: string | null | undefined) => { const index = measures.findIndex((measure) => measure.id === id); return index >= 0 ? `Medida ${index + 1}` : "—" }
  const potential = record?.nearMiss.potential ?? INCIDENT_SEVERITY_LABELS[incident.potentialSeverity ?? ""] ?? null
  const eventLabel = INCIDENT_EVENT_LABELS[incident.eventType] ?? "Otro tipo de evento"
  const followups = data.followups ?? []
  const accidentFollowups = followups.filter((item) => item.kind === "accident")
  const damageFollowups = followups.filter((item) => item.kind === "damage")
  const diffusion = data.diffusions?.[0] ?? null
  const latestReview = qualityReviews[0]

  const cargoOf = (review: NonNullable<typeof latestReview>) => {
    const slugs = review.reviewerRole.split(",").map((slug) => slug.trim()).filter(Boolean)
    if (slugs.includes("jefa_chome")) return REVIEW_PREVENTION_HEAD
    const labels = slugs.map((slug) => data.roleLabels?.[slug] ?? slug.replaceAll("_", " ")).join(", ")
    return `${labels || "Revisor de calidad"} (en reemplazo de la ${REVIEW_PREVENTION_HEAD})`
  }
  const decisionLabel = (id: string) => RE20_REVIEW_DECISIONS.find((decision) => decision.id === id)?.label ?? "Decisión sin rótulo"
  const resultLabel = (id: string) => RE20_QUALITY_RESULTS.find((result) => result.id === id)?.label ?? "Sin resultado"

  /** Fila de medida con su plan de acción resuelto (RE-20-04 §9–§10.1 y RE-20-06). */
  const measureResponsible = (measure: (typeof measures)[number]) => measure.responsibleUserId ? personName(measure.responsibleUserId) : displayValue(measure.responsibleRole)

  const declarations = sensitive?.declarations ?? []
  const injured = sensitive?.injuredInterview ?? {}
  const diat = sensitive?.diat

  return <>
    <style>{STYLES}</style>
    <main className="sheet" data-print-ready="">
      <header className="doc-header">
        <div>
          <div className="company-name">CHOME · Prevención de Riesgos</div>
          <div className="doc-title">Investigación de accidentes e incidentes</div>
          <div className="doc-meta">{incident.worksiteName} · {incident.companyName}</div>
        </div>
        <div className="doc-box"><div className="doc-box-title">Expediente RE-20</div><div className="doc-box-code">{incident.code}</div></div>
      </header>
      <Grid>
        <Field label="Estado del caso" value={INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? "Estado sin rótulo"} />
        <Field label="Tipo de evento" value={eventLabel} />
        <Field label="Gravedad real" value={INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? "Sin clasificar"} />
        <Field label="Ocurrencia" value={formatDateTime(incident.occurredAt)} />
        <Field label="Conocimiento" value={formatDateTime(incident.knownAt)} />
        <Field label="Versión del expediente" value={workspace ? `v${workspace.version}` : "Sin guardar"} />
      </Grid>
      {!showReserved && <p className="reserved-note">Esta copia no incluye las secciones reservadas: declaraciones individuales (RE-20-07), cuestionario a la persona accidentada (RE-20-03), detalle clínico de la lesión ni DIAT. Se imprimen sólo con propósito de acceso registrado y permiso de acceso reservado.</p>}

      {/* RE-20-02 */}
      <Form code="RE-20-02" title="Investigación preliminar" first>
        <Grid two>
          <Field label="Jefatura a cargo" value={preliminary?.managerName} />
          <Field label="Fecha del informe" value={dateOrDash(preliminary?.reportDate)} />
          <Field label="Subgerencia" value={preliminary?.subManagement} />
          <Field label="Área / taller" value={preliminary?.area} />
          <Field label="Lugar exacto" value={incident.location} />
          <Field label="Tipo de evento" value={eventLabel} />
          <Field label="Potencial del evento" value={potential} />
          <Field label="Parte del cuerpo lesionada" value={preliminary?.bodyZone} />
          <Field label="Elemento que provoca la lesión" value={preliminary?.injuryElement} />
          <Field label="Fecha y hora del evento" value={formatDateTime(incident.occurredAt)} />
          <Field label="Ingreso al turno" value={preliminary?.shiftEntryTime} />
          <Field label="Salida del turno" value={preliminary?.shiftExitTime} />
        </Grid>
        <Section title="Descripción de lo ocurrido">
          <p className="text-block">{displayValue(preliminary?.eventDescription || incident.initialNarrative)}</p>
          <Narrative label="Actividad que se realizaba" value={preliminary?.activity} />
          <Narrative label="Agente causante" value={preliminary?.causalAgent} />
          <Narrative label="Fuente" value={preliminary?.source} />
        </Section>
        <Section title="Otros antecedentes">
          <Grid two>
            <Field label="Peligro o fuente" value={[preliminary?.hazardSource, preliminary?.hazardSourceOther].filter(Boolean).join(" · ")} />
            <Field label="Temperatura" value={preliminary?.temperature} />
            <Field label="Clima" value={preliminary?.weather} />
            <Field label="Sistema de turnos" value={preliminary?.shiftSystem} />
          </Grid>
          <Narrative label="Condiciones del lugar" value={preliminary?.conditions} />
          <Narrative label="Desviaciones a los procedimientos, equipos o entorno que generaron el evento" value={preliminary?.deviation} />
        </Section>
        <Section title="Acciones inmediatas realizadas">
          <Table head={["Acción", "Realizada", "Responsable"]} rows={IMMEDIATE_ACTION_LABELS.map(([key, label]) => {
            const action = (preliminary?.immediateActions as Record<string, { marked?: boolean; responsible?: string | null } | undefined> | undefined)?.[key]
            return [label, action?.marked ? "Sí" : "No", displayValue(action?.responsible)]
          })} />
          <Narrative label="Detalle" value={preliminary?.immediateActionsDetail || preliminary?.immediateResponse} />
          <Narrative label="Medidas iniciales" value={preliminary?.initialMeasures} />
        </Section>
        <Section title="Medidas propuestas para la no repetición">
          {(preliminary?.proposedMeasures ?? []).filter(Boolean).length > 0
            ? <ol>{(preliminary?.proposedMeasures ?? []).filter(Boolean).map((measure, index) => <li key={index} className="text-block">{measure}</li>)}</ol>
            : <p className="muted">Sin medidas propuestas.</p>}
        </Section>
      </Form>

      {/* RE-20-07 */}
      {showReserved && declarations.length > 0 && <Form code="RE-20-07" title="Declaraciones individuales">
        <p className="note">Acceso reservado registrado para el propósito: {sensitive?.purpose}. Protege la circulación de esta copia. Los registros de plataforma no constituyen firma electrónica legal.</p>
        {declarations.map((declaration, index) => {
          const reserved = declaration.reserveIdentity === true
          const answers = (declaration.answers ?? {}) as Record<string, boolean | null | undefined>
          return <Section key={String(declaration.id ?? index)} title={`Declaración ${index + 1} · ${DECLARATION_KIND_LABELS[String(declaration.kind)] ?? "Declaración"}`}>
            <Grid two>
              <Field label="Nombre de quien declara" value={reserved ? "Identidad reservada" : declaration.name} />
              <Field label="Cargo / relación con el evento" value={reserved ? "Reservada" : declaration.role} />
              <Field label="RUT / identificación" value={reserved ? "Reservada" : declaration.nationalId} />
              <Field label="Contacto" value={reserved ? "Reservado" : declaration.contact} />
              <Field label="Investigación N°" value={declaration.investigationNumber} />
              <Field label="Fecha de la entrevista" value={dateOrDash(declaration.interviewDate)} />
              <Field label="Lugar de la entrevista" value={declaration.place} />
              <Field label="Entrevistador(es)" value={declaration.interviewers} />
            </Grid>
            <Narrative label="1. Relato libre de lo observado, realizado o conocido" value={declaration.statement} />
            <Narrative label="2. Aclaraciones solicitadas por el equipo investigador" value={declaration.clarifications} />
            <Narrative label="Conocimiento directo" value={declaration.directKnowledge} />
            <Narrative label="Participación" value={declaration.participation} />
            <Narrative label="Correcciones" value={declaration.corrections} />
            <h4 className="sub-title">3. Información complementaria</h4>
            <Table head={["Pregunta", "Respuesta"]} rows={DECLARATION_ANSWER_LABELS.map(([key, label]) => [label, displayValue(key === "reserveIdentity" ? (answers[key] ?? reserved) : answers[key])])} />
            <p className="note">Cláusula de la declaración: {declaration.clauseAccepted === true ? "aceptada" : declaration.clauseAccepted === false ? "no aceptada" : "sin registrar"} · Anexos: {displayValue(declaration.attachmentReferences)} · Registrada: {dateTimeOrDash(declaration.signedAt)}</p>
          </Section>
        })}
        {(sensitive?.historicalStatements?.length ?? 0) > 0 && <Section title="Declaraciones anteriores a esta versión del formulario">
          <Table head={["Calidad", "Nombre", "Cargo", "Declaración", "Registrada"]} rows={sensitive!.historicalStatements!.map((statement) => [
            DECLARATION_KIND_LABELS[String(statement.kind)] ?? "Declaración", displayValue(statement.name), displayValue(statement.role), displayValue(statement.statement), dateTimeOrDash(statement.createdAt),
          ])} />
        </Section>}
      </Form>}

      {/* RE-20-03 */}
      {showReserved && hasAny(injured) && <Form code="RE-20-03" title="Cuestionario para la persona accidentada">
        <Grid two>
          <Field label="Nombre del trabajador" value={injured.workerName} />
          <Field label="Cargo" value={injured.position} />
          <Field label="Antigüedad en la empresa" value={injured.tenureCompany} />
          <Field label="Antigüedad en el puesto de trabajo" value={injured.tenurePosition} />
          <Field label="Día del accidente" value={dateOrDash(injured.accidentDate)} />
          <Field label="Hora del accidente" value={injured.accidentTime} />
          <Field label="Turno" value={injured.shift} />
          <Field label="Lugar del accidente" value={injured.place} />
        </Grid>
        <Narrative label="Describa brevemente lo ocurrido" value={injured.summary} />
        <Table head={["Pregunta", "Respuesta"]} rows={[
          ["La tarea que realizaba se encuentra en el ámbito de sus funciones y responsabilidades respecto al cargo", displayValue(injured.taskWithinScope)],
          ["¿Usted está capacitado para ejecutar la tarea?", [displayValue(injured.trained), ...(hasAny(injured.trainingDetail as Rec) ? [`OJT: ${displayValue((injured.trainingDetail as Rec).ojt)} · ODI: ${displayValue((injured.trainingDetail as Rec).odi)} · Familiarización en PDR: ${displayValue((injured.trainingDetail as Rec).pdrFamiliarization)} · Licencia o autorización: ${displayValue((injured.trainingDetail as Rec).license)} · Otra: ${displayValue((injured.trainingDetail as Rec).other)}`] : [])].join("\n")],
          ["¿La tarea tenía un estándar documentado? Si es así, ¿cuál?", `${displayValue((injured.documentedStandard as Rec | undefined)?.answer)}${(injured.documentedStandard as Rec | undefined)?.detail ? ` · ${displayValue((injured.documentedStandard as Rec).detail)}` : ""}`],
          ["¿Usted conoce el estándar documentado?", displayValue(injured.knowsStandard)],
          ["¿La tarea puede realizarse solo?", displayValue(injured.canDoAlone)],
          ["¿Conoce los riesgos de su lugar de trabajo y los asociados a la tarea?", displayValue(injured.knowsRisks)],
          ["¿Qué EPP usaba al momento del accidente?", displayValue(injured.ppeUsedAtEvent ?? injured.ppe)],
          ["¿Le quedaba bien (talla y ajuste)?", displayValue(injured.ppeFitsWell)],
          ["¿Qué medidas de seguridad había tomado para realizar su trabajo?", displayValue(injured.safetyMeasuresTaken)],
          ["¿Habló previamente con su jefatura directa sobre los riesgos de la tarea?", displayValue(injured.talkedWithSupervisor)],
          ["¿Qué haría para que este accidente no se repita?", displayValue(injured.whatWouldPrevent)],
          ["¿Qué fue distinto ese día respecto de cómo se hace habitualmente la tarea?", displayValue(injured.whatWasDifferent ?? injured.differencesFromUsual)],
          ["¿Qué necesitaba para hacer la tarea de forma segura y no tenía?", displayValue(injured.whatWasMissing)],
          ...(injured.training || injured.instructions || injured.supervision || injured.normalVersusActualWork || injured.workingConditions ? [["Respuestas de la versión anterior del cuestionario", [injured.task, injured.training, injured.instructions, injured.supervision, injured.normalVersusActualWork, injured.workingConditions].filter(Boolean).join("\n")]] : []),
        ]} />
        <p className="note">Fecha de la entrevista: {dateOrDash(injured.interviewDate)} · Entrevistador: {displayValue(injured.interviewer)}</p>
      </Form>}

      {/* RE-20-04 */}
      <Form code="RE-20-04" title="Investigación definitiva · metodología árbol de causas (D.S. N° 44)">
        <Section title="1. Identificación del evento">
          <Grid two>
            <Field label="Fecha y hora del evento" value={formatDateTime(incident.occurredAt)} />
            <Field label="Fecha del informe" value={dateOrDash(preliminary?.reportDate)} />
            <Field label="Jefatura a cargo" value={preliminary?.managerName} />
            <Field label="Subgerencia" value={preliminary?.subManagement} />
            <Field label="Área / taller" value={preliminary?.area} />
            <Field label="Faena / centro de trabajo" value={incident.worksiteName} />
            <Field label="Lugar exacto" value={incident.location} />
            <Field label="Tipo de evento" value={eventLabel} />
            <Field label="Potencial del evento" value={potential} />
            <Field label="Agente causante" value={preliminary?.causalAgent} />
            <Field label="Fuente" value={preliminary?.source} />
            <Field label="Actividad que se realizaba" value={preliminary?.activity} />
          </Grid>
        </Section>
        <Section title="2. Persona afectada o involucrada">
          <Grid two>
            <Field label="Sexo (registro estadístico)" value={affected?.sex} />
            <Field label="Antigüedad en la empresa" value={affected?.tenureCompany} />
            <Field label="Experiencia en la tarea" value={affected?.taskExperience} />
            <Field label="Jornada / turno" value={affected?.shift} />
            <Field label="Horas trabajadas antes del evento" value={affected?.hoursWorkedBefore} />
            <Field label="Tipo de contrato" value={affected?.contractType} />
            <Field label="Jefatura directa" value={affected?.directSupervisor} />
            <Field label="Capacitación para la tarea" value={affected?.trainedForTask} />
            <Field label="Autorización o licencia" value={affected?.authorization} />
            <Field label="ODI / información de riesgos" value={affected?.odiInformed} />
            <Field label="Procedimiento conocido" value={affected?.procedureKnown} />
            <Field label="Parte del cuerpo lesionada" value={preliminary?.bodyZone} />
            <Field label="EPP requerido" value={affected?.ppeRequired} />
            <Field label="EPP utilizado" value={affected?.ppeUsed} />
            <Field label="Lesión (descripción general)" value={affected?.injurySummary || preliminary?.injuryDescription} wide />
          </Grid>
          {showReserved && hasAny(sensitive?.injuryClinical) && <>
            <h4 className="sub-title">Detalle clínico de la lesión (reservado)</h4>
            <Grid two>
              <Field label="Descripción" value={sensitive?.injuryClinical?.description} />
              <Field label="Detalle de la zona corporal" value={sensitive?.injuryClinical?.bodyPartDetail} />
              <Field label="Notas clínicas" value={sensitive?.injuryClinical?.clinicalNotes} wide />
            </Grid>
          </>}
        </Section>
        <Section title="3. Enfoque de género e inclusión">
          <p className="text-block">{displayValue(definitive?.genderPerspective)}</p>
        </Section>
        <Section title="4. Equipo investigador y participación">
          {team.length > 0
            ? <Table head={["Nombre", "Cargo / representación", "Rol en la investigación", "Participó en visita", "Declaración de imparcialidad", "Firma"]} rows={team.map((member) => [
              personName(member.userId), displayValue(member.position ?? people[member.userId]?.position), displayValue(member.role), displayValue(member.visitedSite), displayValue(member.impartialityDeclared), member.signedAt ? formatDateTime(member.signedAt) : "—",
            ])} />
            : <p className="muted">Equipo no registrado.</p>}
          <Narrative label="Observaciones sobre participación o conflictos de interés" value={record?.conflictOfInterestNotes} />
        </Section>
        <Section title="5. Evidencias">
          {evidences.length > 0
            ? <Table head={["N°", "Tipo", "Descripción / identificación", "Origen", "Fecha", "Custodia / ubicación"]} rows={evidences.map((evidence, index) => [index + 1, displayValue(evidence.type), displayValue(evidence.description), displayValue(evidence.origin), dateOrDash(evidence.date), displayValue(evidence.custody)])} />
            : <p className="muted">Sin evidencias registradas.</p>}
        </Section>
        <Section title="6. Declaraciones y entrevistas">
          <p className="note">Cada declaración se registra en RE-20-07 y la entrevista a la persona accidentada en RE-20-03.</p>
          {showReserved && declarations.length > 0
            ? <Table head={["N°", "Nombre", "Calidad", "Fecha", "Aporte principal"]} rows={declarations.map((declaration, index) => {
              const reserved = declaration.reserveIdentity === true
              return [index + 1, reserved ? "Identidad reservada" : displayValue(declaration.name), DECLARATION_KIND_LABELS[String(declaration.kind)] ?? "Declaración", dateOrDash(declaration.interviewDate), displayValue(declaration.directKnowledge ?? declaration.participation)]
            })} />
            : <p className="muted">{showReserved ? "Sin declaraciones registradas." : "El detalle de las declaraciones es reservado."}</p>}
        </Section>
        <Section title="7. Reconstrucción objetiva del evento">
          <p className="text-block">{displayValue(definitive?.reconstruction)}</p>
          {(definitive?.chronology ?? []).length > 0 && <Table head={["Orden", "Fecha y hora", "Hecho verificable", "Fuente / evidencia", "Observaciones"]} rows={(definitive?.chronology ?? []).map((item, index) => [index + 1, dateTimeOrDash(item.occurredAt), displayValue(item.description), displayValue(item.evidenceReference), displayValue(item.observations)])} />}
        </Section>
        <Section title="8. Árbol de causas">
          {events.length > 0 ? <>
            <h4 className="sub-title">Listado de hechos</h4>
            <Table head={["ID", "Hecho objetivo", "Fuente que lo respalda", "¿Causal?", "¿Requiere verificación?"]} rows={events.map((event) => [event.id, displayValue(event.description), displayValue(event.source), displayValue(event.causal !== false), event.verified ? "No, verificado" : "Sí"])} />
            <h4 className="sub-title">Árbol (desde el hecho final hacia sus antecedentes)</h4>
            <CausalTree events={events} relations={relations} />
          </> : <p className="muted">El árbol de causas no se registró en este expediente.</p>}
          {(definitive?.variations ?? []).length > 0 && <>
            <h4 className="sub-title">7.1 Variaciones respecto del trabajo habitual y barreras</h4>
            <Table head={["Aspecto", "Condición esperada", "Condición real", "Control existente", "Falla o ausencia del control"]} rows={(definitive?.variations ?? []).map((item) => [ASPECT_LABELS[item.aspect] ?? "Otro aspecto", displayValue(item.expected), displayValue(item.actual), displayValue(item.existingControl), displayValue(item.controlFailure)])} />
          </>}
          {relations.length > 0 && <>
            <h4 className="sub-title">8.1 Matriz de relaciones causales</h4>
            <Table head={["N°", "Hecho antecedente", "Relación", "Hecho consecuencia", "Justificación factual", "¿Causa raíz?"]} rows={relations.map((relation, index) => [index + 1, relation.from, RELATION_LABELS[relation.type] ?? "Relación", relation.to, displayValue(relation.justification), rootIds.includes(relation.from) ? "Sí" : "No"])} />
          </>}
          {trajectories.length > 0 && <>
            <h4 className="sub-title">8.2 Trayectorias (de la causa raíz al hecho final)</h4>
            <Table head={["Causa raíz", "Trayectoria", "Descripción de la causa raíz"]} rows={trajectories.map((path) => [path[0], path.join(" → "), displayValue(eventText(path[0]))])} />
          </>}
          {rootIds.length > 0 && <p className="note">Causas raíz identificadas: {rootIds.map((id) => `${id} (${eventText(id) || "sin descripción"})`).join("; ")}.</p>}
        </Section>
        <Section title="9. Causas raíz y medidas de control">
          {measures.length > 0
            ? <Table head={["Causa raíz", "Descripción", "Medida propuesta", "Tipo de control", "Correctiva / preventiva", "Alcance", "Prioridad"]} rows={measures.map((measure) => [
              displayValue(measure.rootCauseId), displayValue(eventText(measure.rootCauseId)), displayValue(measure.description), displayValue(measure.controlType), displayValue(measure.correctivePreventive), displayValue(measure.scope), displayValue(measure.priority),
            ])} />
            : <p className="muted">Sin medidas registradas.</p>}
          {(definitive?.instruments ?? []).length > 0 && <>
            <h4 className="sub-title">9.1 Revisión de instrumentos preventivos</h4>
            <Table head={["Instrumento", "¿Requiere cambio?", "Cambio requerido", "Responsable", "Fecha"]} rows={(definitive?.instruments ?? []).map((item) => [INSTRUMENT_LABELS[item.id] ?? "Instrumento", displayValue(item.requiresChange), displayValue(item.change), personName(item.responsibleUserId), dateOrDash(item.dueDate)])} />
          </>}
        </Section>
        <Section title="10. Plan de acción y seguimiento">
          {measures.length > 0 ? <>
            <p className="note">El verificador es una persona distinta del responsable de la medida.</p>
            <Table head={["N°", "Medida", "Responsable", "Recursos", "Fecha compromiso", "Estado", "Evidencia", "Verificador", "Fecha de verificación"]} rows={measures.map((measure, index) => [
              index + 1, displayValue(measure.description), measureResponsible(measure), displayValue(measure.resources), dateOrDash(measure.dueAt), displayValue(measure.status), displayValue(measure.evidence), personName(measure.verifierUserId), dateOrDash(measure.verifiedAt),
            ])} />
            <h4 className="sub-title">10.1 Verificación de eficacia</h4>
            <Table head={["Medida", "Criterio de eficacia", "Método de verificación", "Resultado", "Riesgo residual", "Acción adicional"]} rows={measures.map((measure, index) => [
              `Medida ${index + 1}`, displayValue(measure.effectiveness?.criterion), displayValue(measure.effectiveness?.method), displayValue(measure.effectiveness?.result), displayValue(measure.effectiveness?.residualRisk), displayValue(measure.effectiveness?.additionalAction),
            ])} />
          </> : <p className="muted">Sin plan de acción registrado.</p>}
        </Section>
        <Section title="11. Comunicación, aprendizaje y cierre">
          <Grid two>
            <Field label="Resultados informados a" value={definitive?.closure?.informedTo} />
            <Field label="Medio y fecha de comunicación" value={definitive?.closure?.communicationMeansAndDate} />
            <Field label="Fecha propuesta de cierre" value={dateOrDash(definitive?.closure?.proposedClosureDate)} />
            <Field label="¿Aprendizajes replicados a otros centros?" value={definitive?.closure?.learningReplicated} />
            <Field label="Detalle del aprendizaje" value={definitive?.closure?.learningDetail} wide />
            <Field label="Resumen ejecutivo de causas, medidas y aprendizaje" value={definitive?.closure?.executiveSummary} wide />
          </Grid>
          <Narrative label="Conclusión" value={definitive?.conclusion} />
          <h4 className="sub-title">11.1 Conclusión del equipo investigador</h4>
          <Table head={["Verificación", "Sí / No"]} rows={CHECKLIST_LABELS.map(([key, label]) => [label, displayValue((definitive?.teamChecklist as Record<string, boolean | null | undefined> | undefined)?.[key])])} />
        </Section>
        <Section title="12. Pronunciamiento del Comité Paritario">
          <p className="note">La determinación de negligencia inexcusable corresponde al Comité Paritario después de investigar las causas (art. 70, Ley N° 16.744). Se registra separada del análisis causal y no reemplaza las medidas preventivas.</p>
          <Grid two>
            <Field label="Fecha de sesión" value={dateOrDash(definitive?.cphs?.sessionDate)} />
            <Field label="N° de acta" value={definitive?.cphs?.minutesNumber} />
            <Field label="Quórum" value={definitive?.cphs?.quorum} />
            <Field label="Investigación revisada" value={definitive?.cphs?.reviewed} />
            <Field label="Decisión" value={definitive?.cphs?.decision} wide />
            <Field label="Fundamentos y antecedentes considerados" value={definitive?.cphs?.rationale} wide />
            <Field label="Medidas indicadas por el Comité" value={definitive?.cphs?.measures} wide />
          </Grid>
          <Narrative label="Pronunciamiento (registro anterior)" value={definitive?.cphsOpinion} />
        </Section>
        <Section title="13. Control de anexos">
          <Table head={["Anexo", "Documento / evidencia", "Incluido", "Ubicación / folio"]} rows={Object.entries(ANNEX_LABELS).map(([code, label]) => {
            const annex = (definitive?.annexes ?? []).find((item) => item.code === code)
            return [code, label, displayValue(annex?.included), displayValue(annex?.location)]
          })} />
        </Section>
        <Section title="14. Firmas">
          <div className="signatures">
            {Object.entries(SIGNATURE_LABELS).map(([role, label]) => {
              const signature = (definitive?.signatures ?? []).find((item) => item.role === role)
              return <div key={role} className="signature"><strong>{label}</strong><div className="signature-line">Nombre: {displayValue(signature?.name)}<br />Fecha: {dateOrDash(signature?.date)}</div></div>
            })}
          </div>
          <p className="note">Los registros de la plataforma no constituyen firma electrónica legal.</p>
        </Section>
        {showReserved && diat && <Section title="DIAT · copia de trabajo y comprobante (reservado)">
          <Grid two>
            <Field label="Estado de preparación" value={DIAT_STATUS_LABELS[String(diat.status)] ?? "Sin estado"} />
            <Field label="Gravedad" value={DIAT_SEVERITY_LABELS[String(diat.severity)]} />
            <Field label="Origen del accidente" value={DIAT_SCOPE_LABELS[String(diat.scope)]} />
            <Field label="Tipo de accidente de trayecto" value={diat.commuteType} />
            <Field label="Se conoció el accidente" value={dateTimeOrDash(diat.knownAt)} />
            <Field label="Presentación externa" value={dateTimeOrDash(diat.sentAt)} />
            <Field label="Folio o comprobante" value={diat.receiptReference} />
            <Field label="Medio de prueba" value={diat.proofMedium} />
            {Object.entries((diat.form ?? {}) as Rec).filter(([, value]) => !isBlank(value)).map(([key, value]) => <Field key={key} label={DIAT_FORM_LABELS[key] ?? "Otro dato de la DIAT"} value={value} />)}
            <Field label="Observaciones" value={diat.observations} wide />
          </Grid>
          <p className="note">La plataforma registra fecha y comprobante; no presenta la DIAT ante el organismo administrador.</p>
        </Section>}
      </Form>

      {/* RE-20-13 */}
      {latestReview && <Form code="RE-20-13" title="Lista de verificación de calidad de la investigación">
        <p className="note">La aplica la {REVIEW_PREVENTION_HEAD} antes de aprobar el informe definitivo (RE-20-04) y antes de la difusión (RE-20-06). Revisión sobre la versión v{latestReview.workspaceVersion} del expediente.</p>
        <Table head={["N°", "Criterio", "Verificación", "Resultado", "Observación / corrección"]} rows={RE20_QUALITY_CRITERIA.map((criterion, index) => {
          const answer = latestReview.criteria.find((item) => item.id === criterion.id)
          return [index + 1, criterion.criterion, criterion.verification, answer ? resultLabel(answer.result) : "Sin evaluar", displayValue(answer?.observation)]
        })} />
        <Section title="Revisión final">
          <Grid two>
            <Field label="Revisado por" value={latestReview.reviewerUserId ? personName(latestReview.reviewerUserId) : undefined} />
            <Field label="Cargo" value={cargoOf(latestReview)} />
            <Field label="Resultado" value={decisionLabel(latestReview.decision)} />
            <Field label="Fecha" value={formatDateTime(latestReview.reviewedAt)} />
            <Field label="Observaciones finales" value={latestReview.observation} wide />
          </Grid>
          <p className="note">Esta aprobación de calidad no constituye firma electrónica legal.</p>
        </Section>
      </Form>}

      {/* RE-20-06 */}
      {(diffusion || measures.length > 0) && <Form code="RE-20-06" title="Informativo de difusión de accidentes">
        <Grid two>
          <Field label="Caso" value={incident.code} />
          <Field label="Fecha del evento" value={formatDateTime(incident.occurredAt)} />
          <Field label="Subgerencia / área" value={[preliminary?.subManagement, preliminary?.area].filter(Boolean).join(" · ")} />
          <Field label="Lugar" value={incident.location} />
          <Field label="Zona corporal" value={preliminary?.bodyZone} />
          <Field label="Potencial del evento" value={potential} />
          <Field label="Resumen del caso" value={diffusion?.onePageSummary || definitive?.reconstruction || preliminary?.eventDescription || incident.initialNarrative} wide />
        </Grid>
        <Section title="Causas raíz y medidas">
          <Table head={["Causa raíz", "Medida", "Responsable", "Plazo", "Estatus"]} rows={diffusion && diffusion.measuresTable.length > 0
            ? diffusion.measuresTable.map((row) => [displayValue(row.rootCause), displayValue(row.measure), displayValue(row.responsible), dateOrDash(row.dueAt), displayValue(row.status)])
            : measures.map((measure) => [displayValue(eventText(measure.rootCauseId) || measure.rootCauseId), displayValue(measure.description), measureResponsible(measure), dateOrDash(measure.dueAt), displayValue(measure.status)])} />
          <p className="note">{diffusion && diffusion.measuresTable.length > 0 ? `Difusión publicada el ${formatDateTime(diffusion.diffusedAt)}.` : "Tabla generada desde las medidas del expediente; aún no hay una difusión publicada."}</p>
        </Section>
        <Narrative label="Aprendizaje para otras faenas" value={diffusion?.learning ?? definitive?.closure?.learningDetail} />
      </Form>}

      {/* RE-20-08 / RE-20-09 */}
      {accidentFollowups.length > 0 && <Form code="RE-20-08" title="Seguimiento y control de accidentes CTP / STP">
        <Table head={["Fecha", "Medida", "Causa raíz", "Tipo de control", "Seguimiento", "Implementada", "Verificada", "Eficaz", "Verificador", "Riesgo residual", "Días perdidos"]} rows={accidentFollowups.map((item) => [
          dateOrDash(item.followupDate), measureNumber(item.measureId), displayValue(item.rootCauseId), displayValue(item.controlType), displayValue(item.note), item.implementedAt ? dateOrDash(item.implementedAt) : "No", item.verified ? `Sí · ${dateOrDash(item.verifiedAt)}` : "No", item.effective ? "Sí" : "No", personName(item.verifierUserId), displayValue(item.residualRisk), displayValue(item.lostDays),
        ])} />
      </Form>}
      {damageFollowups.length > 0 && <Form code="RE-20-09" title="Seguimiento y control de incidentes con daño material o ambiental">
        <Table head={["Fecha", "Medida", "Causa raíz", "Tipo de control", "Seguimiento", "Implementada", "Verificada", "Eficaz", "Verificador", "Riesgo residual", "Daño o pérdida"]} rows={damageFollowups.map((item) => [
          dateOrDash(item.followupDate), measureNumber(item.measureId), displayValue(item.rootCauseId), displayValue(item.controlType), displayValue(item.note), item.implementedAt ? dateOrDash(item.implementedAt) : "No", item.verified ? `Sí · ${dateOrDash(item.verifiedAt)}` : "No", item.effective ? "Sí" : "No", personName(item.verifierUserId), displayValue(item.residualRisk), displayValue(item.lossDescription),
        ])} />
      </Form>}

      {(tasks.length > 0 || legacy) && <section className="form-start">
        {tasks.length > 0 && <Section title="Tareas y plazos internos">
          <Table head={["Tarea", "Responsable", "Estado", "Vencimiento", "Completada"]} rows={tasks.map((task) => [displayValue(task.label), task.responsibleUserId ? personName(task.responsibleUserId) : displayValue(task.responsibleRole), TASK_STATUS_LABELS[task.status] ?? "Sin estado", dateTimeOrDash(task.dueAt), dateTimeOrDash(task.completedAt)])} />
          <p className="note">Política de plazos internos v{workspace?.policyVersion ?? "—"}. El plazo legal de la DIAT se gestiona por separado.</p>
        </Section>}
        {legacy && <Section title="Antecedentes históricos">
          <p className="note">Conservados como texto de la investigación anterior; no se convierten en hechos del árbol.</p>
          <Table head={["Dato", "Contenido"]} rows={[
            ["Método registrado", displayValue(legacy.methodology)], ["Informe preliminar", displayValue(legacy.preliminaryReportText)],
            ["Causas inmediatas históricas", displayValue(legacy.immediateCauses)], ["Causas básicas históricas", displayValue(legacy.basicCauses)],
            ["Causas organizacionales históricas", displayValue(legacy.organizationalCauses)], ["Conclusiones anteriores", displayValue(legacy.conclusions)],
          ]} />
        </Section>}
      </section>}

      <footer className="footer">Generado desde el expediente RE-20 · {workspace ? `versión ${workspace.version}` : "sin guardar"} · actualizado {workspace?.updatedAt ? formatDateTime(workspace.updatedAt) : "sin fecha"} · última actualización por {personName(workspace?.updatedByUserId)}.</footer>
    </main>
  </>
}
