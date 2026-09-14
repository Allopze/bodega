import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { getAssignmentById, getAssignmentAccessories, getAssignmentPhotos } from "@/lib/services/ti/assignments"
import { formatDateTime, formatDate } from "@/lib/utils"
import { ACTA_PRINT_STYLES } from "./acta-styles"
import { PrintTrigger } from "./print-trigger"
import { actaPdfFilename } from "./filename"

export const dynamic = "force-dynamic"

interface PageProps { params: Promise<{ assignmentId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { assignmentId } = await params
  const assignment = await getAssignmentById(assignmentId)
  return { title: assignment ? `Acta ${assignment.code}` : "Acta" }
}

export default async function ActaPrintPage({ params }: PageProps) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const { assignmentId } = await params
  const assignment = await getAssignmentById(assignmentId)
  if (!assignment) notFound()
  if (!canAccessWorksite(session, assignment.worksiteId)) notFound()

  const [accessories, photos] = await Promise.all([
    getAssignmentAccessories(assignmentId),
    getAssignmentPhotos(assignmentId),
  ])

  const deliveryPhotos = photos.filter((p) => p.stage === "delivery")
  const returnPhotos = photos.filter((p) => p.stage === "return")
  const isReturned = Boolean(assignment.returnedAt)
  const suggestedFilename = actaPdfFilename(assignment.code)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ACTA_PRINT_STYLES }} />
      <PrintTrigger
        pdfHref={`/ti/actas/${assignmentId}/print/pdf`}
        suggestedFilename={suggestedFilename}
      />

      <article className="acta-sheet">
        <header className="header">
          <div>
            <h1>{isReturned ? "Acta de entrega y devolución" : "Acta de entrega de equipo"}</h1>
            <p className="code">Acta {assignment.code}</p>
          </div>
          <span className={`badge ${isReturned ? "badge-return" : "badge-active"}`}>
            {isReturned ? "DEVUELTO" : "VIGENTE"}
          </span>
        </header>

        <section className="section">
          <h2>Identificación del trabajador</h2>
          <div className="grid">
            <div className="field"><dt>Nombre</dt><dd>{assignment.workerName}</dd></div>
            <div className="field"><dt>RUT</dt><dd>{assignment.workerRut ?? "—"}</dd></div>
            <div className="field"><dt>Cargo</dt><dd>{assignment.workerPosition ?? "—"}</dd></div>
            <div className="field"><dt>Faena</dt><dd>{assignment.worksiteName}</dd></div>
          </div>
        </section>

        <section className="section">
          <h2>Activo</h2>
          <div className="grid">
            <div className="field"><dt>Código interno</dt><dd>{assignment.assetCode}</dd></div>
            <div className="field"><dt>Equipo</dt><dd>{[assignment.assetBrand, assignment.assetModel].filter(Boolean).join(" ") || "—"}</dd></div>
            <div className="field"><dt>Número de serie</dt><dd>{assignment.assetSerialNumber ?? "—"}</dd></div>
            <div className="field"><dt>Tipo de entrega</dt><dd>{assignment.kind === "loan" ? "Préstamo" : assignment.kind === "transfer" ? "Transferencia" : "Entrega"}</dd></div>
          </div>
        </section>

        <section className="section">
          <h2>Entrega</h2>
          <div className="grid">
            <div className="field"><dt>Fecha y hora</dt><dd>{formatDateTime(assignment.deliveredAt)}</dd></div>
            <div className="field"><dt>Responsable TI</dt><dd>{assignment.deliveredByName ?? "—"}</dd></div>
            <div className="field"><dt>Estado físico al entregar</dt><dd>{physicalStateLabel(assignment.physicalState)}</dd></div>
            <div className="field"><dt>Aceptación</dt><dd>
              {/* TIA-002: el acta ya no dice "aceptada" cuando nadie acusó
                  recibo. Los tres estados se imprimen distintos. */}
              {assignment.acceptanceStatus === "aceptada" && assignment.acceptedAt
                ? `Acuse registrado el ${formatDateTime(assignment.acceptedAt)} por ${assignment.acceptedByName ?? "—"}`
                : assignment.acceptanceStatus === "sin_acuse"
                  ? `Sin acuse del trabajador${assignment.acceptanceNote ? ` — ${assignment.acceptanceNote}` : ""}`
                  : "Pendiente de acuse"}
            </dd></div>
          </div>
          {assignment.observations && (
            <div className="field" style={{ marginTop: 6 }}><dt>Observaciones</dt><dd>{assignment.observations}</dd></div>
          )}
          {accessories.length > 0 && (
            <>
              <p style={{ margin: "10px 0 4px", fontSize: 11, color: "#6b7280", fontWeight: 600 }}>ACCESORIOS INCLUIDOS</p>
              <div className="accessories">
                {accessories.map((acc) => <span key={acc.id} className="accessory">{acc.name}</span>)}
              </div>
            </>
          )}
        </section>

        {deliveryPhotos.length > 0 && (
          <section className="section">
            <h2>Evidencia fotográfica — estado al entregar ({deliveryPhotos.length})</h2>
            <div className="photos-grid">
              {deliveryPhotos.map((photo) => (
                <div key={photo.id} className="photo-cell">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/ti/photos/${photo.id}`} alt={photo.caption ?? "Evidencia de entrega"} />
                  <div className="caption">{photo.caption || photo.fileName} · {formatDate(photo.uploadedAt)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {isReturned && (
          <section className="section">
            <h2>Devolución</h2>
            <div className="grid">
              <div className="field"><dt>Fecha y hora</dt><dd>{formatDateTime(assignment.returnedAt!)}</dd></div>
              <div className="field"><dt>Recibido por</dt><dd>{assignment.returnedByName ?? "—"}</dd></div>
              <div className="field"><dt>Estado físico al devolver</dt><dd>{physicalStateLabel(assignment.returnPhysicalState)}</dd></div>
              <div className="field"><dt>Observaciones</dt><dd>{assignment.returnObservations ?? "—"}</dd></div>
            </div>
            {returnPhotos.length > 0 && (
              <>
                <p style={{ margin: "10px 0 4px", fontSize: 11, color: "#6b7280", fontWeight: 600 }}>EVIDENCIA FOTOGRÁFICA — ESTADO AL DEVOLVER ({returnPhotos.length})</p>
                <div className="photos-grid">
                  {returnPhotos.map((photo) => (
                    <div key={photo.id} className="photo-cell">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/ti/photos/${photo.id}`} alt={photo.caption ?? "Evidencia de devolución"} />
                      <div className="caption">{photo.caption || photo.fileName} · {formatDate(photo.uploadedAt)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        <div className="signature-block">
          <div className="signature">Firma responsable TI<br />{assignment.deliveredByName ?? "—"}</div>
          <div className="signature">
            {isReturned ? "Firma de recepción — TI" : "Aceptación del trabajador"}<br />
            {isReturned ? (assignment.returnedByName ?? "—") : (assignment.workerName)}
          </div>
        </div>

        <footer className="footer">
          Documento generado por Plataforma Chome el {formatDateTime(new Date().toISOString())}. Las fotografías de entrega y devolución quedan archivadas junto al historial del activo {assignment.assetCode}.
        </footer>
      </article>
    </>
  )
}

function physicalStateLabel(state: string | null): string {
  const labels: Record<string, string> = { bueno: "Bueno", regular: "Regular", malo: "Malo", nuevo: "Nuevo" }
  return state ? labels[state] ?? state : "—"
}
