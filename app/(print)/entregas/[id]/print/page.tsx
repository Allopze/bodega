import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { deliveries, products } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { formatDate } from "@/lib/utils"

interface PageProps { params: Promise<{ id: string }> }

export default async function DeliveryPrintPage({ params }: PageProps) {
  let session
  try { session = await requirePermission("deliveries:view") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const delivery = await db.query.deliveries.findFirst({
    where: eq(deliveries.id, id),
    with: { worker: true, worksite: true, deliveredBy: true, items: true },
  })
  if (!delivery) notFound()
  if (!delivery.worksiteId || !canAccessWorksite(session, delivery.worksiteId)) notFound()

  const productIds = delivery.items.map((item) => item.productId).filter((id): id is string => id !== null)
  const productMap = productIds.length > 0
    ? new Map(
      (await db.query.products.findMany({ where: inArray(products.id, productIds) }))
        .map((product) => [product.id, product.name]),
    )
    : new Map<string, string>()

  const workerName = delivery.worker
    ? `${delivery.worker.firstName} ${delivery.worker.lastName}`.trim()
    : delivery.receiverName ?? "—"
  const workerRut = delivery.worker?.rut ?? delivery.receiverRut ?? "—"

  return (
    <html lang="es-CL">
      <head>
        <meta charSet="utf-8" />
        <title>Comprobante {delivery.code}</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: "Inter", system-ui, -apple-system, sans-serif;
            font-size: 12px;
            line-height: 1.5;
            color: #111827;
            max-width: 210mm;
            margin: 0 auto;
            padding: 12mm 14mm;
          }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
          h1 { font-size: 18px; font-weight: 700; }
          .code { font-family: "JetBrains Mono", monospace; font-size: 11px; color: #6b7280; }
          .section { margin-bottom: 20px; }
          .section h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #374151; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
          .field { display: flex; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
          .field dt { width: 110px; font-weight: 500; color: #6b7280; flex-shrink: 0; }
          .field dd { flex: 1; font-weight: 400; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th { text-align: left; font-size: 10px; font-weight: 600; color: #6b7280; text-transform: uppercase; padding: 6px 4px; border-bottom: 2px solid #e5e7eb; }
          td { padding: 6px 4px; border-bottom: 1px solid #f3f4f6; font-size: 11px; }
          .total { font-weight: 700; }
          .signature { margin-top: 60px; display: flex; justify-content: space-between; gap: 40px; }
          .sig-box { flex: 1; }
          .sig-line { border-bottom: 1px solid #111827; margin-top: 48px; margin-bottom: 4px; }
          .sig-label { font-size: 10px; color: #6b7280; }
          .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #9ca3af; text-align: center; }
        `}</style>
      </head>
      <body>
        <div className="header">
          <div>
            <h1>Comprobante de Entrega EPP</h1>
            <p className="code">{delivery.code}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 10, color: "#6b7280" }}>Emitido: {formatDate(delivery.deliveredAt)}</p>
          </div>
        </div>

        <div className="section">
          <h2>Datos generales</h2>
          <dl className="grid">
            <div className="field">
              <dt>Faena</dt>
              <dd>{delivery.worksite?.name ?? "—"}</dd>
            </div>
            <div className="field">
              <dt>Entregado por</dt>
              <dd>{delivery.deliveredBy?.name ?? delivery.deliveredBy?.email ?? "—"}</dd>
            </div>
            <div className="field">
              <dt>Trabajador</dt>
              <dd>{workerName}</dd>
            </div>
            <div className="field">
              <dt>RUT</dt>
              <dd>{workerRut}</dd>
            </div>
            <div className="field">
              <dt>Fecha</dt>
              <dd>{formatDate(delivery.deliveredAt)}</dd>
            </div>
            <div className="field">
              <dt>Tipo</dt>
              <dd>{delivery.destinationType === "faena" ? "Entrega a faena" : "Entrega a trabajador"}</dd>
            </div>
          </dl>
        </div>

        <div className="section">
          <h2>EPP Entregado</h2>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ textAlign: "right" }}>Cantidad</th>
                <th>Unidad</th>
              </tr>
            </thead>
            <tbody>
              {delivery.items.map((item) => (
                <tr key={item.id}>
                  <td>{productMap.get(item.productId ?? "") ?? item.productNameFree ?? "EPP"}</td>
                  <td style={{ textAlign: "right" }} className="total">{item.quantity}</td>
                  <td>{item.unitOfMeasure}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {delivery.notes && (
            <p style={{ marginTop: 12, fontSize: 11, color: "#6b7280" }}>
              Notas: {delivery.notes}
            </p>
          )}
        </div>

        {(delivery.items.some((i) => i.returnQuantity)) && (
          <div className="section">
            <h2>Devolución de EPP antiguo</h2>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ textAlign: "right" }}>Cantidad</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {delivery.items.filter((i) => i.returnQuantity).map((item) => (
                  <tr key={`return-${item.id}`}>
                    <td>{item.returnProductNameFree ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{item.returnQuantity}</td>
                    <td>{item.returnReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="signature">
          <div className="sig-box">
            <div className="sig-line" />
            <p className="sig-label">Recibido conforme</p>
            <p style={{ fontSize: 9, color: "#9ca3af", marginTop: 2 }}>{workerName}</p>
            <p style={{ fontSize: 9, color: "#9ca3af" }}>RUT: {workerRut}</p>
          </div>
          <div className="sig-box">
            <div className="sig-line" />
            <p className="sig-label">Quien entrega</p>
            <p style={{ fontSize: 9, color: "#9ca3af", marginTop: 2 }}>{delivery.deliveredBy?.name ?? delivery.deliveredBy?.email ?? "—"}</p>
          </div>
        </div>

        <div className="footer">
          Documento generado por Plataforma Chome — {new Date().toLocaleDateString("es-CL")}
        </div>
      </body>
    </html>
  )
}
