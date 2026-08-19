/**
 * Acta imprimible de una ejecución de inspección (función #3).
 *
 * Antes sólo existía el export Excel agregado: en fiscalización se pide el acta
 * de LA inspección, no una planilla de todas.
 *
 * Reusa `ACTA_STYLES` de la acta SST tal cual — son estilos de documento
 * (hoja A4, cabecera, tablas, pie), no del contenido SST. Una segunda copia
 * sería un segundo lugar donde ajustar los márgenes y olvidar uno.
 */
import type { Session } from "next-auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getInspectionRunDetail } from "@/lib/services/prevention-inspections"
import {
  closingActFromDefinition,
  fieldKindIsScorable,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  INSPECTION_RESULT_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { formatDateTime } from "@/lib/utils"

export { ACTA_STYLES } from "../../../../sst/[id]/print/acta-styles"

export type InspectionActaData = NonNullable<Awaited<ReturnType<typeof loadInspectionActaData>>>

export async function loadInspectionActaData(runId: string, session: Session) {
  const detail = await getInspectionRunDetail(runId, {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })
  if (!detail) return null

  const definition = detail.definitionSnapshot as unknown as ChecklistDefinition
  return {
    detail,
    definition,
    closingAct: closingActFromDefinition(definition),
    suggestedFilename: `${detail.run.code}.pdf`,
  }
}

export function InspectionActaDocument({ data }: { data: InspectionActaData }) {
  const { detail, definition, closingAct } = data
  const run = detail.run
  const answerByItem = new Map(detail.answers.map((answer) => [`${answer.sectionId}::${answer.itemId}`, answer]))

  return (
    <div className="sheet">
      <header className="doc-header">
        <div>
          <div className="brand-row">
            <div>
              <div className="company-name">{detail.templateName}</div>
              <div className="doc-title">{INSPECTION_KIND_LABELS[detail.templateKind] ?? detail.templateKind}</div>
            </div>
          </div>
          <div className="doc-meta">
            {detail.worksiteName}
            {run.subjectLabel ? ` · ${run.subjectLabel}` : ""}
          </div>
        </div>
        <div className="doc-box">
          <div className="doc-box-title">Inspección</div>
          <div className="doc-box-code">{run.code}</div>
        </div>
      </header>

      <section className="info-grid">
        <FieldRow label="Estado" value={INSPECTION_RUN_STATUS_LABELS[run.status] ?? run.status} />
        <FieldRow label="Origen" value={INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin} />
        <FieldRow label="Programada" value={run.scheduledFor ?? "—"} />
        <FieldRow label="Ejecutada" value={run.executedAt ? formatDateTime(run.executedAt) : "Sin ejecutar"} />
        <FieldRow label="Ejecutó" value={detail.executorName ?? "—"} />
        <FieldRow label="Revisó" value={detail.reviewerName ?? "—"} />
        <FieldRow label="Sujeto" value={run.subjectType ?? "—"} />
        <FieldRow
          label="Cumplimiento"
          value={run.compliancePercent === null ? "No calculable" : `${run.compliancePercent}%`}
        />
      </section>

      {definition.sections?.map((section) => (
        <section key={section.id} className="section-block">
          <h2 className="section-title">{section.title}</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: "45%" }}>Ítem</th>
                <th style={{ width: "18%" }}>Resultado</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>
              {section.items.map((item) => {
                const answer = answerByItem.get(`${section.id}::${item.id}`)
                const scorable = fieldKindIsScorable(item.kind)
                return (
                  <tr key={item.id}>
                    <td>{item.label}</td>
                    <td>
                      {/* Un ítem que no puntúa responde con su contenido, no con
                          un juicio de conformidad (B-08). */}
                      {!answer ? "—" : scorable
                        ? INSPECTION_RESULT_LABELS[answer.result] ?? answer.result
                        : (answer.value || "—")}
                    </td>
                    <td>{scorable ? (answer?.comment ?? "") : ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}

      <section className="section-block">
        <h2 className="section-title">Resumen de cumplimiento</h2>
        <table>
          <thead>
            <tr><th>Cumple</th><th>Regular</th><th>No cumple</th><th>No aplica</th><th>Cumplimiento</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{run.conformingCount}</td>
              <td>{run.partialCount}</td>
              <td>{run.nonConformingCount}</td>
              <td>{run.notApplicableCount}</td>
              <td>{run.compliancePercent === null ? "No calculable" : `${run.compliancePercent}%`}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {detail.findings.length > 0 && (
        <section className="section-block">
          <h2 className="section-title">Hallazgos</h2>
          <table>
            <thead>
              <tr><th style={{ width: "55%" }}>Hallazgo</th><th>Criticidad</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {detail.findings.map((finding) => (
                <tr key={finding.id}>
                  <td>{finding.description}</td>
                  <td>{FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}</td>
                  <td>{FINDING_STATUS_LABELS[finding.status] ?? finding.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {closingAct && (
        <section className="section-block">
          <h2 className="section-title">{closingAct.title}</h2>
          <div className="result-box" style={{ borderColor: "#b8c6bd" }}>
            <div className="result-title">Resultado</div>
            <div className="result-value">
              {closingAct.resultOptions.find((option) => option.value === run.closingResult)?.label
                ?? run.closingResult ?? "—"}
            </div>
            {run.closingRestrictions && <div className="result-detail">{run.closingRestrictions}</div>}
          </div>
          {closingAct.signatureRoles.length > 0 && (
            <table style={{ marginTop: "4mm" }}>
              <thead>
                <tr><th>Rol</th><th>Nombre</th><th>Firma</th></tr>
              </thead>
              <tbody>
                {closingAct.signatureRoles.map((role) => {
                  const signature = run.closingSignatures?.find((item) => item.role === role)
                  return (
                    <tr key={role}>
                      <td>{role}</td>
                      <td>{signature?.name ?? ""}</td>
                      {/* Línea en blanco para la firma manuscrita sobre el papel:
                          el sistema registra quién y cuándo, no el trazo. */}
                      <td style={{ height: "14mm" }} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <footer className="doc-footer">
        {run.code} · {detail.worksiteName} · Generado el {formatDateTime(new Date().toISOString())}
      </footer>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}
