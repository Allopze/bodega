import { getStatusLabel } from "@/lib/sst/compliance"
import type { StatusValue } from "@/lib/sst/types"
import { getStatusColor, getResultLabel, getMotivoLabel, getInstanciaLabel, getEficaciaLabel, formatDate } from "./acta-helpers"
import { ACTA_STYLES } from "./acta-styles"
import { FieldRow } from "./acta-components"
import type { ActaData } from "./acta-data"

// ── Re-export styles and data loader ──────────────────────────────────────────
export { ACTA_STYLES }
export type { ActaData }
export { loadActaData } from "./acta-data"

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
