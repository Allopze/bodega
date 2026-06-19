import type { Session } from "next-auth"
import { db } from "@/db"
import { sstEvaluations, sstResponses, sstScheduledFollowups, sstActionPlan } from "@/db/schema/sst"
import { users, userRoles, roles } from "@/db/schema/users"
import { workers, worksites } from "@/db/schema/worksites"
import { eq } from "drizzle-orm"
import { canAccessWorksite } from "@/lib/auth/can"
import { getDefinition } from "@/lib/sst/definitions"
import { getStatusLabel } from "@/lib/sst/compliance"
import { CARGO_KEYS } from "@/lib/sst/cargos"
import { buildActaFilename } from "@/lib/sst/acta-filename"
import type { ChecklistDefinition, StatusValue } from "@/lib/sst/types"

// ── Label helpers ─────────────────────────────────────────────────────────────

function getStatusColor(status: StatusValue): string {
  if (!status) return "#6b7280"
  if (["cumple", "entregado", "apto", "si"].includes(status)) return "#059669"
  if (["no_cumple", "no_entregado", "no_apto", "no"].includes(status)) return "#dc2626"
  return "#6b7280"
}

function getResultLabel(result: string | null, isNuevo: boolean): string {
  if (isNuevo) {
    const labels: Record<string, string> = {
      habilitado_autonomo: "CUMPLE",
      no_habilitado: "NO CUMPLE",
    }
    return result ? (labels[result] ?? result) : "Sin resultado"
  }
  const labels: Record<string, string> = {
    habilitado_autonomo: "HABILITADO PARA OPERAR EN FORMA AUTÓNOMA",
    habilitado_restricciones: "HABILITADO CON RESTRICCIONES",
    no_habilitado: "NO HABILITADO",
    requiere_reforzamiento: "REQUIERE REFORZAMIENTO ADICIONAL",
  }
  return result ? (labels[result] ?? result) : "Sin resultado"
}

function getMotivoLabel(motivo: string | null): string {
  const labels: Record<string, string> = {
    control_periodico: "Control Periódico",
    post_incidente_persona: "Post-incidente (Persona)",
    post_incidente_material: "Post-incidente (Material)",
    post_incidente_ambiental: "Post-incidente (Ambiental)",
    cuasi_accidente: "Cuasi-accidente",
    incumplimiento_procedimiento: "Incumplimiento de Procedimiento",
    reincidencia: "Reincidencia",
    reincorporacion: "Reincorporación",
    otro: "Otro",
  }
  return motivo ? (labels[motivo] ?? motivo) : "—"
}

function getInstanciaLabel(instancia: string): string {
  const labels: Record<string, string> = {
    dia_0: "Día 0",
    dia_7: "Día 7",
    dia_15: "Día 15",
    dia_30: "Día 30",
    adicional: "Adicional",
  }
  return labels[instancia] ?? instancia
}

function getEficaciaLabel(e: string | null): string {
  const labels: Record<string, string> = {
    eficaz: "Eficaz",
    parcialmente_eficaz: "Parcialmente eficaz",
    no_eficaz: "No eficaz",
  }
  return e ? (labels[e] ?? e) : "—"
}

function formatDate(d: string | null): string {
  if (!d) return "—"
  // ISO YYYY-MM-DD → DD/MM/YYYY
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

// ── Data loading ──────────────────────────────────────────────────────────────

export type ActaData = {
  evaluation: typeof sstEvaluations.$inferSelect
  worker: typeof workers.$inferSelect
  worksite: typeof worksites.$inferSelect
  createdByUser: typeof users.$inferSelect | null
  evaluatorRoleLabel: string
  definition: ChecklistDefinition
  responses: (typeof sstResponses.$inferSelect)[]
  followups: (typeof sstScheduledFollowups.$inferSelect)[]
  actionPlan: (typeof sstActionPlan.$inferSelect)[]
  isNuevo: boolean
  isCerrado: boolean
  cargos: string[]
  cargoLabels: string
  bySection: Record<string, (typeof sstResponses.$inferSelect)[]>
  applicableSections: ChecklistDefinition["sections"]
  suggestedFilename: string
  resultColor: string
  resultBorder: string
}

/**
 * Loads and assembles the acta view model. Returns null when the evaluation
 * doesn't exist or the session can't access its worksite (callers map to 404).
 * Assumes the caller already enforced the `sst:view` permission.
 */
export async function loadActaData(id: string, session: Session): Promise<ActaData | null> {
  const evaluation = await db.query.sstEvaluations.findFirst({
    where: eq(sstEvaluations.id, id),
  })
  if (!evaluation) return null
  if (!canAccessWorksite(session, evaluation.worksiteId)) return null

  const [worker, worksite, createdByUser, evaluatorRoleRows, responses, followups, actionPlan] = await Promise.all([
    db.query.workers.findFirst({ where: eq(workers.id, evaluation.workerId) }),
    db.query.worksites.findFirst({ where: eq(worksites.id, evaluation.worksiteId) }),
    db.query.users.findFirst({ where: eq(users.id, evaluation.createdBy) }),
    db.select({ label: roles.label })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, evaluation.createdBy)),
    db.select().from(sstResponses).where(eq(sstResponses.evaluationId, id)),
    db.select().from(sstScheduledFollowups).where(eq(sstScheduledFollowups.evaluationId, id)),
    db.select().from(sstActionPlan).where(eq(sstActionPlan.evaluationId, id)),
  ])

  if (!worker || !worksite) return null

  const evaluatorRoleLabels = evaluatorRoleRows.map((r) => r.label)
  const evaluatorRoleLabel: string = evaluatorRoleLabels[0] ?? 'Evaluador'

  // Resolve definition — use snapshot when cerrado for legal traceability
  let definition: ChecklistDefinition
  if (evaluation.estado === "cerrado" && evaluation.schemaJson) {
    try {
      definition = JSON.parse(evaluation.schemaJson) as ChecklistDefinition
    } catch {
      definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
    }
  } else {
    definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
  }

  const isNuevo = evaluation.tipo === "nuevo"
  const isCerrado = evaluation.estado === "cerrado"

  const cargos: string[] = Array.isArray(evaluation.cargosJson)
    ? (evaluation.cargosJson as string[])
    : []
  const cargoLabels = cargos
    .map((k) => (CARGO_KEYS as Record<string, string>)[k] ?? k)
    .join(", ")

  const bySection: Record<string, typeof responses> = {}
  for (const r of responses) {
    ;(bySection[r.seccionId] ??= []).push(r)
  }

  const applicableSections = definition.sections.filter((sec) => {
    if (!sec.appliesWhen || sec.appliesWhen.length === 0) return true
    return cargos.some((c) => sec.appliesWhen!.includes(c))
  })

  const suggestedFilename = buildActaFilename({
    tipo: evaluation.tipo,
    workerName: `${worker.firstName} ${worker.lastName}`,
  })

  const resultColor =
    evaluation.resultadoFinal === "no_habilitado" ||
    evaluation.resultadoFinal === "requiere_reforzamiento"
      ? "#fef2f2"
      : evaluation.resultadoFinal === "habilitado_restricciones"
        ? "#fffbeb"
        : "#f0fdf4"

  const resultBorder =
    evaluation.resultadoFinal === "no_habilitado" ||
    evaluation.resultadoFinal === "requiere_reforzamiento"
      ? "#fca5a5"
      : evaluation.resultadoFinal === "habilitado_restricciones"
        ? "#fcd34d"
        : "#86efac"

  return {
    evaluation,
    worker,
    worksite,
    createdByUser: createdByUser ?? null,
    evaluatorRoleLabel,
    definition,
    responses,
    followups,
    actionPlan,
    isNuevo,
    isCerrado,
    cargos,
    cargoLabels,
    bySection,
    applicableSections,
    suggestedFilename,
    resultColor,
    resultBorder,
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

/** Print/document CSS shared by the browser preview and the server-side PDF. */
export const ACTA_STYLES = `
  @page {
    size: A4;
    margin: 12mm;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  html {
    background: #e9eeeb;
  }

  body {
    margin: 0;
    background: #e9eeeb;
    color: #232522;
    font-family: var(--font-myriad), "Myriad Pro", Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-toolbar {
    width: 210mm;
    max-width: calc(100vw - 32px);
    margin: 18px auto 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #45514a;
  }

  .print-action {
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 13px;
    border-radius: 7px;
    font: inherit;
    font-size: 9.5pt;
    font-weight: 650;
    text-decoration: none;
    border: 1px solid transparent;
    cursor: pointer;
    transition: transform 150ms, background-color 150ms, border-color 150ms;
  }

  .print-action:active { transform: scale(0.97); }

  .print-action-primary {
    background: #17422b;
    color: #f2f7f4;
  }

  .print-action-primary:hover { background: #205438; }

  .print-action-secondary {
    background: #f9fbfa;
    color: #233027;
    border-color: #cfd8d2;
  }

  .print-action-secondary:hover {
    background: #eef5f1;
    border-color: #b8c8be;
  }

  .print-filename {
    margin-left: 6px;
    font-size: 9pt;
    color: #647067;
  }

  .sheet {
    width: 210mm;
    padding: 12mm;
    background: #fbfcfb;
  }

  /* On-screen "paper" affordance only. Kept out of print: a fixed 297mm height
     equals the full A4 and, combined with @page margins, overflows the printable
     area and produces a blank trailing page (e.g. in Safari's print preview). */
  @media screen {
    .sheet {
      min-height: 297mm;
      margin: 0 auto 24px;
      border: 1px solid #d8dfda;
      box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
    }
  }

  /* Block layout + margin-based spacing so break-inside:avoid is honored when
     the browser paginates (flex containers break fragmentation in Chromium). */
  .sheet > * + * {
    margin-top: 6mm;
  }

  .doc-header {
    display: grid;
    grid-template-columns: 1fr 50mm;
    gap: 8mm;
    padding-bottom: 6mm;
    border-bottom: 1px solid #b8c6bd;
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-mark {
    width: 60px;
    height: 60px;
    object-fit: contain;
    flex: 0 0 auto;
  }

  .company-name {
    font-size: 10pt;
    font-weight: 760;
    color: #17221b;
    line-height: 1.2;
  }

  .doc-title {
    margin-top: 4px;
    font-size: 9pt;
    color: #252a26;
  }

  .doc-meta {
    font-size: 8pt;
    color: #475569;
    line-height: 1.6;
  }

  .doc-box {
    justify-self: end;
    width: 50mm;
    border: 1px solid #17422b;
    color: #17422b;
    padding: 5px 7px;
    text-align: center;
    font-size: 8pt;
  }

  .doc-box-title {
    font-weight: 760;
    text-transform: uppercase;
    font-size: 7pt;
  }

  .doc-box-code {
    font-size: 11pt;
    font-weight: 700;
    font-family: var(--font-geist-mono), "GeistMono", "Cascadia Code", monospace;
    margin-top: 3px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px 8mm;
    padding: 5px 7px;
    border: 1px solid #b8c6bd;
    font-size: 8.5pt;
  }

  .field-row {
    display: flex;
    gap: 4px;
  }

  .field-label {
    font-weight: 600;
    color: #475569;
    min-width: 100px;
    flex-shrink: 0;
  }

  .field-value {
    color: #1e293b;
  }

  .section-block {
    break-inside: avoid;
    page-break-inside: avoid;
    margin-bottom: 4mm;
  }

  .section-title {
    font-size: 9pt;
    font-weight: 760;
    color: #17422b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 3px 5px;
    background: #f1f5f9;
    border: 1px solid #b8c6bd;
    border-bottom: 0;
    margin: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
  }

  /* Repeat the column header when a long table must split across pages, and
     keep each row intact. */
  thead {
    display: table-header-group;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  thead th {
    background: #f8fafc;
    color: #17221b;
    padding: 4px 6px;
    text-align: left;
    vertical-align: middle;
    font-size: 7.5pt;
    font-weight: 760;
    border: 1px solid #d1d5db;
  }

  tbody td {
    padding: 4px 6px;
    vertical-align: top;
    border: 1px solid #d1d5db;
    font-size: 8pt;
  }

  .result-box {
    padding: 8px 12px;
    border: 1px solid;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .result-title {
    font-size: 8pt;
    color: #475569;
    margin-bottom: 3px;
  }

  .result-value {
    font-size: 13pt;
    font-weight: 760;
    color: #17221b;
  }

  .result-detail {
    font-size: 8pt;
    margin-top: 4px;
  }

  .section-heading {
    font-size: 9pt;
    font-weight: 760;
    color: #1e293b;
    text-transform: uppercase;
    margin: 0 0 4px;
  }

  .doc-footer {
    padding-top: 4mm;
    border-top: 1px solid #d8dfda;
    font-size: 7pt;
    color: #94a3b8;
    text-align: center;
  }

  @media (max-width: 760px) {
    .print-toolbar, .sheet {
      width: calc(100vw - 24px);
    }
    .sheet {
      padding: 16px;
      min-height: auto;
    }
    .doc-header, .info-grid {
      grid-template-columns: 1fr;
    }
    .doc-box { justify-self: stretch; }
    .print-filename { display: none; }
  }

  @media print {
    html, body { background: #fbfcfb; }
    .print-toolbar { display: none; }
    .sheet {
      width: auto;
      min-height: auto;
      margin: 0;
      padding: 0;
      border: 0;
      box-shadow: none;
    }
  }
`

// ── Document ──────────────────────────────────────────────────────────────────

/**
 * The acta markup. `logoSrc` differs by context: a public path for the browser
 * preview, a data URI for the server-side PDF (so it loads under setContent).
 */
export function ActaDocument({ data, logoSrc }: { data: ActaData; logoSrc: string }) {
  const {
    evaluation,
    worker,
    worksite,
    createdByUser,
    evaluatorRoleLabel,
    definition,
    followups,
    actionPlan,
    isNuevo,
    isCerrado,
    cargoLabels,
    bySection,
    applicableSections,
    resultColor,
    resultBorder,
  } = data

  return (
    <main className="sheet" aria-label={`Acta SST — ${worker.firstName} ${worker.lastName}`}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="doc-header">
        <div className="brand-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-mark" src={logoSrc} alt="Logo Chome" width={60} height={60} />
          <div>
            <div className="company-name">Servicios Industriales Chome Ltda.</div>
            <div className="doc-title">{definition.title}</div>
            {definition.legalFramework.length > 0 && (
              <div className="doc-meta" style={{ marginTop: 4 }}>
                {definition.legalFramework.join(" · ")}
              </div>
            )}
          </div>
        </div>

        <aside className="doc-box" aria-label="Identificación de documento">
          <div className="doc-box-title">Acta SST</div>
          <div className="doc-box-code">{evaluation.definicionCode.replace(/_/g, ' ')}</div>
          <div style={{ marginTop: 4, fontSize: "7.5pt", color: "#475569" }}>
            v{evaluation.definicionVersion}
          </div>
          {definition.revisionDate && (
            <div style={{ fontSize: "7pt", color: "#6b7280", marginTop: 2 }}>
              Rev. {definition.revisionDate}
            </div>
          )}
        </aside>
      </header>

      {/* ── Evaluation info ─────────────────────────────────────────────── */}
      <section className="info-grid" aria-label="Datos de la evaluación">
        <FieldRow label="Trabajador" value={`${worker.firstName} ${worker.lastName}`} />
        <FieldRow label="RUT" value={worker.rut} />
        {cargoLabels && <FieldRow label="Cargo(s)" value={cargoLabels} />}
        <FieldRow label="Faena" value={worksite.name} />
        <FieldRow label="Fecha evaluación" value={formatDate(evaluation.fechaEvaluacion)} />
        <FieldRow
          label="Tipo"
          value={
            isNuevo
              ? "Trabajador Nuevo"
              : `Seguimiento${evaluation.motivo ? ` — ${getMotivoLabel(evaluation.motivo)}` : ""}`
          }
        />
        {!isNuevo && evaluation.motivoOtro && (
          <FieldRow label="Motivo (detalle)" value={evaluation.motivoOtro} />
        )}
        {worker.supervisor && <FieldRow label="Administrador de contrato" value={worker.supervisor} />}
        {worker.prevencionista && (
          <FieldRow label="Prevencionista" value={worker.prevencionista} />
        )}
        {evaluation.equipoPatente && (
          <FieldRow label="Equipo / Patente" value={evaluation.equipoPatente} />
        )}
        {!isNuevo && evaluation.descripcionEvento && (
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldRow label="Descripción del evento" value={evaluation.descripcionEvento} />
          </div>
        )}
        <FieldRow label="Estado" value={isCerrado ? "Cerrado" : "Borrador"} />
      </section>

      {/* ── Checklist sections ──────────────────────────────────────────── */}
      {applicableSections.map((sec) => {
        const items = bySection[sec.id] ?? []
        const hasAccion = sec.hasActionCorrectiva ?? items.some((i) => i.accionCorrectiva !== null)

        return (
          <div className="section-block" key={sec.id} aria-label={sec.title}>
            <h3 className="section-title">{sec.title}</h3>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 18 }}>N°</th>
                  <th>Ítem</th>
                  <th style={{ width: 80, textAlign: "center" }}>Estado</th>
                  <th>Observación</th>
                  {hasAccion && <th>Acción Correctiva</th>}
                </tr>
              </thead>
              <tbody>
                {sec.items.map((item, idx) => {
                  const resp = items.find((r) => r.itemId === item.id)
                  const status = (resp?.estado ?? null) as StatusValue
                  return (
                    <tr key={item.id}>
                      <td style={{ textAlign: "center" }}>{idx + 1}</td>
                      <td>{item.label}</td>
                      <td
                        style={{
                          textAlign: "center",
                          color: getStatusColor(status),
                          fontWeight: 600,
                        }}
                      >
                        {getStatusLabel(status)}
                      </td>
                      <td>{resp?.observacion ?? ""}</td>
                      {hasAccion && <td>{resp?.accionCorrectiva ?? ""}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}

      {/* ── Compliance result ───────────────────────────────────────────── */}
      <section
        className="result-box"
        aria-label="Resultado de cumplimiento"
        style={{ backgroundColor: resultColor, borderColor: resultBorder }}
      >
        <div className="result-title">RESULTADO FINAL</div>
        <div className="result-value">{getResultLabel(evaluation.resultadoFinal, isNuevo)}</div>
        {evaluation.porcentajeCumplimiento !== null && (
          <div className="result-detail" style={{ fontWeight: 700 }}>
            Cumplimiento: {evaluation.porcentajeCumplimiento?.toFixed(1)}%
          </div>
        )}
        {evaluation.resultadoEficacia && (
          <div className="result-detail">
            Eficacia: {getEficaciaLabel(evaluation.resultadoEficacia)}
          </div>
        )}
        {evaluation.restricciones && (
          <div className="result-detail">
            <strong>Restricciones:</strong> {evaluation.restricciones}
          </div>
        )}
        {evaluation.observacionesGenerales && (
          <div className="result-detail">
            <strong>Observaciones:</strong> {evaluation.observacionesGenerales}
          </div>
        )}
      </section>

      {/* ── Action plan ─────────────────────────────────────────────────── */}
      {actionPlan.length > 0 && (
        <div className="section-block" aria-label="Plan de acción">
          <h3 className="section-heading">Plan de Acción</h3>
          <table>
            <thead>
              <tr>
                <th style={{ width: 24 }}>N°</th>
                <th>Hallazgo</th>
                <th>Acción</th>
                <th>Responsable</th>
                <th>Plazo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {actionPlan
                .sort((a, b) => a.n - b.n)
                .map((p) => (
                  <tr key={p.id}>
                    <td style={{ textAlign: "center" }}>{p.n}</td>
                    <td>{p.hallazgo}</td>
                    <td>{p.accion}</td>
                    <td>{p.responsable}</td>
                    <td>{p.plazo}</td>
                    <td>{p.estado}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Followups (seguimiento) ─────────────────────────────────────── */}
      {!isNuevo && followups.length > 0 && (
        <div className="section-block" aria-label="Seguimientos programados">
          <h3 className="section-heading">Seguimiento Programado</h3>
          <table>
            <thead>
              <tr>
                <th>Instancia</th>
                <th>Fecha Programada</th>
                <th style={{ textAlign: "center" }}>Realizado</th>
                <th style={{ textAlign: "center" }}>Cumple</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {followups.map((f) => (
                <tr key={f.id}>
                  <td>{getInstanciaLabel(f.instancia)}</td>
                  <td>{formatDate(f.fechaProgramada)}</td>
                  <td style={{ textAlign: "center" }}>{f.realizado ? "✓" : "—"}</td>
                  <td style={{ textAlign: "center" }}>
                    {f.cumple === true ? "✓" : f.cumple === false ? "✗" : "—"}
                  </td>
                  <td>{f.observaciones ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Signatures ──────────────────────────────────────────────────── */}
      <section aria-label="Firmas">
        <h3 className="section-heading">Declaración y Conformidad</h3>
        <div style={{
          border: '1px solid #b8c6bd',
          padding: '6mm 8mm',
          breakInside: 'avoid',
        }}>
          <p style={{ fontSize: '9pt', lineHeight: 1.6, marginBottom: '4mm' }}>
            <strong>{createdByUser?.name ?? '—'}</strong>{', '}
            <strong>{evaluatorRoleLabel}</strong> certifica que{' '}
            <strong>{worker.firstName} {worker.lastName}</strong>{' '}
            {evaluation.resultadoFinal
              ? getResultLabel(evaluation.resultadoFinal, isNuevo)
              : 'fue evaluado(a)'}
            .
          </p>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '9pt',
          }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              border: '1.5px solid #17422b',
              borderRadius: '3px',
              fontSize: '11pt',
              fontWeight: 700,
              color: '#17422b',
              lineHeight: 1,
            }}>✓</span>
            <span style={{ color: '#17422b', fontWeight: 600 }}>Acepto términos y condiciones</span>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="doc-footer">
        Este documento forma parte del SG-SST de Servicios Industriales Chome Ltda. · Marco
        legal: {definition.legalFramework.join(" · ")}
      </footer>
    </main>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}:</span>
      <span className="field-value">{value}</span>
    </div>
  )
}
