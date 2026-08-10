import type { Metadata } from "next"
import Image from "next/image"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { getCompanyProfile } from "@/lib/services/system-settings"
import { getDispatchGuideDetail, OFFICE_ORIGIN_LABEL } from "@/lib/services/dispatch-guides"
import { DISPATCH_GUIDE_STATE_META, type DispatchGuideStatus } from "@/components/states/state-badge"
import { MobileDocumentSummary } from "@/components/print/mobile-document-summary"
import { formatDateTime, formatQty } from "@/lib/utils"
import { GUIDE_PRINT_STYLES } from "./guide-print-styles"
import { PrintTrigger } from "./print-trigger"
import { guidePdfFilename } from "./filename"

interface PageProps { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const detail = await getDispatchGuideDetail(id)
  return { title: detail ? `Guía de despacho ${detail.guide.code}` : "Guía de despacho interna" }
}

const LEGEND =
  `Documento interno para control de traslado de bienes desde ${OFFICE_ORIGIN_LABEL} hacia Faena. ` +
  "No constituye documento tributario."

function workerName(worker: { firstName: string; lastName: string } | null | undefined) {
  return worker ? `${worker.firstName} ${worker.lastName}`.trim() : null
}

/** Una fila de datos del panel; no se pinta si no hay valor (sin campos vacíos). */
function FieldCell({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className={mono ? "field-value field-value-mono" : "field-value"}>{value}</div>
    </div>
  )
}

export default async function DispatchGuidePrintPage({ params }: PageProps) {
  let session
  try { session = await requirePermission("warehouse:view_guides") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const [detail, company] = await Promise.all([getDispatchGuideDetail(id), getCompanyProfile()])
  if (!detail) notFound()

  const { guide } = detail
  if (!canAccessWorksite(session, guide.destinationWorksiteId)) notFound()

  const stateMeta = DISPATCH_GUIDE_STATE_META[guide.status as DispatchGuideStatus]
  const dispatcher = workerName(guide.dispatcherWorker)
    ?? guide.issuedByUser?.name
    ?? guide.issuedByUser?.email
    ?? null
  const receiver = workerName(guide.receiverWorker)
  const actualReceiver = workerName(guide.receivedByWorker)
  const driver = workerName(guide.driverWorker)
  const vehicleLabel = guide.vehicle
    ? [guide.vehicle.brand, guide.vehicle.model].filter(Boolean).join(" ") || guide.vehicle.plate
    : null
  const totalQuantity = guide.items.reduce((sum, item) => sum + item.quantity, 0)
  const suggestedFilename = guidePdfFilename(guide.code)

  return (
    <>
      <style>{GUIDE_PRINT_STYLES}</style>

      <PrintTrigger
        pdfHref={`/bodega/guias/${guide.id}/print/pdf`}
        suggestedFilename={suggestedFilename}
        backHref={`/bodega/guias/${guide.id}`}
      />

      <MobileDocumentSummary
        code={`Guía de despacho interna ${guide.code}`}
        title={guide.destinationWorksite?.name ?? "Faena"}
        description={`${guide.items.length} ${guide.items.length === 1 ? "elemento" : "elementos"} · ${formatDateTime(guide.issuedAt)}`}
        sections={[
          {
            title: "Traslado",
            fields: [
              { label: "Origen", value: `${OFFICE_ORIGIN_LABEL} (bodega ${guide.originWorksite?.name ?? "—"})` },
              { label: "Destino", value: guide.destinationWorksite?.name ?? "—" },
              { label: "Estado", value: stateMeta?.label ?? guide.status },
              { label: "Emisión", value: formatDateTime(guide.issuedAt) },
              { label: "Responsable del despacho", value: dispatcher ?? "—" },
              { label: "Responsable de recepción", value: receiver ?? "—" },
              ...(guide.vehicle ? [{ label: "Vehículo", value: `${guide.vehicle.plate}${vehicleLabel ? ` · ${vehicleLabel}` : ""}` }] : []),
              ...(driver ? [{ label: "Conductor", value: driver }] : []),
            ],
          },
          {
            title: "Detalle",
            fields: guide.items.map((item) => ({
              label: item.product?.name ?? "Producto",
              value: `${formatQty(item.quantity, item.unitOfMeasure)}${item.product?.sku ? ` · ${item.product.sku}` : ""}`,
            })),
          },
          ...(guide.notes ? [{ title: "Observaciones", fields: [{ label: "Detalle", value: guide.notes }] }] : []),
        ]}
      />

      <main className="sheet" aria-label={`Guía de despacho interna ${guide.code}`}>
        <header className="doc-header">
          <div className="brand-row">
            <Image className="logo-mark" src="/chome_logo.svg" alt="Logo Chome" width={66} height={66} priority />
            <div>
              <div className="company-name">{company.name}</div>
              <div className="company-lines">
                {company.rut && <span>R.U.T.: {company.rut}</span>}
                {company.businessActivity && <span>Giro: {company.businessActivity}</span>}
                {company.address && <span>Casa Matriz: {company.address}</span>}
                {company.phone && <span>Fono: {company.phone}</span>}
                {company.email && <span>Email: {company.email}</span>}
              </div>
            </div>
          </div>

          <aside className="doc-box" aria-label="Identificación del documento">
            <div className="doc-box-title">Guía de Despacho Interna</div>
            <div className="doc-box-code">Nº {guide.code}</div>
            <div className="doc-box-meta">Emisión: {formatDateTime(guide.issuedAt)}</div>
            <div className={`doc-box-state${guide.status === "cancelled" ? " doc-box-state-cancelled" : ""}`}>
              {stateMeta?.label ?? guide.status}
            </div>
          </aside>
        </header>

        {guide.status === "cancelled" && (
          <div className="cancelled-banner">
            <strong>Documento anulado.</strong> {guide.cancellationReason}
            {guide.cancelledAt ? ` · ${formatDateTime(guide.cancelledAt)}` : ""}
          </div>
        )}

        <section className="route" aria-label="Origen y destino del traslado">
          <div className="route-cell">
            <div className="route-label">Origen</div>
            <div className="route-value">{OFFICE_ORIGIN_LABEL}</div>
            <div className="route-sub">Bodega {guide.originWorksite?.name}</div>
          </div>
          <div className="route-arrow" aria-hidden="true">→</div>
          <div className="route-cell">
            <div className="route-label">Destino</div>
            <div className="route-value">{guide.destinationWorksite?.name}</div>
            {guide.destinationWorksite?.address && (
              <div className="route-sub">{guide.destinationWorksite.address}</div>
            )}
          </div>
        </section>

        <section className="panel" aria-label="Datos del despacho">
          <div className="panel-title">Datos del despacho</div>
          <div className="fields">
            <FieldCell label="Responsable del despacho" value={dispatcher} />
            <FieldCell label="Responsable de recepción" value={receiver} />
            <FieldCell label="Vehículo" value={vehicleLabel} />
            <FieldCell label="Patente" value={guide.vehicle?.plate} mono />
            <FieldCell label="Código interno" value={guide.vehicle?.code} mono />
            <FieldCell label="Conductor" value={driver} />
            <FieldCell
              label="Despachado"
              value={guide.dispatchedAt ? formatDateTime(guide.dispatchedAt) : null}
            />
            <FieldCell
              label="Recepción confirmada"
              value={guide.receivedAt ? formatDateTime(guide.receivedAt) : null}
            />
            <FieldCell label="Recibido por" value={actualReceiver} />
          </div>
        </section>

        <section className="items-wrap" aria-label="Detalle de elementos">
          <table>
            <thead>
              <tr className="items-caption">
                <th scope="colgroup" colSpan={4}>
                  Guía de Despacho Interna Nº {guide.code} · {guide.destinationWorksite?.name}
                </th>
              </tr>
              <tr>
                <th scope="col" style={{ width: "32mm" }}>Código</th>
                <th scope="col">Descripción</th>
                <th scope="col" className="text-right" style={{ width: "22mm" }}>Cantidad</th>
                <th scope="col" style={{ width: "24mm" }}>Unidad</th>
              </tr>
            </thead>
            <tbody>
              {guide.items.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.product?.sku ?? "—"}</td>
                  <td>
                    {item.product?.name ?? "Producto"}
                    {item.notes && <div className="item-note">{item.notes}</div>}
                  </td>
                  <td className="text-right mono">{formatQty(item.quantity)}</td>
                  <td>{item.unitOfMeasure}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  Total: {guide.items.length} {guide.items.length === 1 ? "línea" : "líneas"}
                </td>
                <td className="text-right mono">{formatQty(totalQuantity)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>

        {guide.notes && (
          <section className="panel" aria-label="Observaciones">
            <div className="panel-title">Observaciones</div>
            <div className="field-value" style={{ whiteSpace: "pre-line" }}>{guide.notes}</div>
          </section>
        )}

        <section className="signatures" aria-label="Entrega y recepción">
          <div className="sig-box">
            <div className="panel-title">Entrega en {OFFICE_ORIGIN_LABEL}</div>
            <div className="sig-name">{dispatcher ?? ""}</div>
            <div className="sig-line" />
            <div className="sig-caption">Nombre y firma de quien entrega · Fecha</div>
            {guide.dispatchedAt && (
              <div className="sig-stamp">
                Despachado el {formatDateTime(guide.dispatchedAt)} por{" "}
                {guide.dispatchedByUser?.name ?? guide.dispatchedByUser?.email ?? "—"}
              </div>
            )}
          </div>
          <div className="sig-box">
            <div className="panel-title">Recepción en faena</div>
            <div className="sig-name">{actualReceiver ?? receiver ?? ""}</div>
            <div className="sig-line" />
            <div className="sig-caption">Nombre y firma de quien recibe · Fecha</div>
            {guide.receivedAt ? (
              <div className="sig-stamp">
                Recepción confirmada en la plataforma el {formatDateTime(guide.receivedAt)} por{" "}
                {guide.receivedByUser?.name ?? guide.receivedByUser?.email ?? "—"}
              </div>
            ) : (
              <div className="sig-caption">Recepción pendiente de confirmación en la plataforma.</div>
            )}
          </div>
        </section>

        <section className="legend" aria-label="Naturaleza del documento">{LEGEND}</section>

        <div className="doc-footer">
          {guide.code} · Emitida por {guide.issuedByUser?.name ?? guide.issuedByUser?.email ?? "—"} ·
          Generado por Plataforma Chome
        </div>
      </main>
    </>
  )
}
