import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { PrintTrigger } from "./print-trigger"

export const dynamic = "force-dynamic"

export default async function PrintOcPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/login") }

  const { id } = await params

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      items:    { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      worksite: true,
      supplier: true,
    },
  })

  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()

  // Load product names
  const productIds = order.items.map((i) => i.productId).filter((v): v is string => v !== null)
  const products   = productIds.length > 0
    ? await db.query.products.findMany({
        where: (p, { inArray }) => inArray(p.id, productIds),
        columns: { id: true, sku: true, name: true },
      })
    : []
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))

  const now = new Date()
  const printDate = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()}`

  return (
    <>
      {/* Stylesheet scoped to this page — includes print media rules */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: "Source Sans 3", "Source Sans Pro", Arial, sans-serif;
          font-size: 11pt;
          color: #1a1a1a;
          background: #fff;
          padding: 24px;
          max-width: 800px;
          margin: 0 auto;
        }
        .print-btn {
          display: flex;
          gap: 8px;
          margin-bottom: 20px;
        }
        @media print {
          .print-btn { display: none; }
          body { padding: 0; max-width: 100%; }
        }
        /* Header */
        .header {
          border-bottom: 2px solid #1a1a1a;
          padding-bottom: 12px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .company-name { font-size: 18pt; font-weight: 700; letter-spacing: -0.5px; }
        .doc-title { font-size: 14pt; font-weight: 600; color: #444; }
        .doc-code { font-size: 18pt; font-weight: 700; }
        /* Info grid */
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px 24px;
          margin-bottom: 20px;
          font-size: 9.5pt;
        }
        .info-label { color: #666; font-weight: 600; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.3px; }
        .info-value { color: #1a1a1a; margin-bottom: 6px; }
        /* Table */
        table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        thead th {
          background: #f0f0f0;
          border-top: 1px solid #ccc;
          border-bottom: 1px solid #ccc;
          padding: 6px 8px;
          text-align: left;
          font-weight: 600;
          font-size: 8.5pt;
          text-transform: uppercase;
          letter-spacing: 0.2px;
        }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        .text-right { text-align: right; }
        .font-mono { font-family: "GeistMono", monospace; }
        .sku { font-family: monospace; font-size: 8pt; color: #666; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
        tfoot td {
          font-size: 9pt;
          padding: 5px 8px;
        }
        tfoot tr:last-child td {
          font-weight: 700;
          font-size: 10pt;
          border-top: 1px solid #ccc;
          padding-top: 7px;
        }
        /* Footer note */
        .footer { margin-top: 32px; font-size: 8pt; color: #888; border-top: 1px solid #e0e0e0; padding-top: 8px; }
        .notes-box { background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px 10px; margin-bottom: 16px; font-size: 9pt; }
        .sig-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 40px; }
        .sig-line { border-top: 1px solid #999; padding-top: 4px; font-size: 8pt; color: #666; text-align: center; }
      `}</style>

      {/* Print trigger buttons (hidden on print) */}
      <PrintTrigger backHref={`/compras/${order.id}`} />

      {/* Document header */}
      <div className="header">
        <div>
          <div className="company-name">Chome</div>
          <div style={{ fontSize: "9pt", color: "#666", marginTop: 2 }}>Sistema de Abastecimiento y EPP</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="doc-title">Orden de Compra</div>
          <div className="doc-code">{order.code}</div>
        </div>
      </div>

      {/* Info grid */}
      <div className="info-grid">
        <div>
          <div className="info-label">Proveedor</div>
          <div className="info-value">{order.supplier?.name ?? "—"}</div>
        </div>
        <div>
          <div className="info-label">Estado</div>
          <div className="info-value" style={{ textTransform: "capitalize" }}>{order.status.replace(/_/g, " ")}</div>
        </div>
        <div>
          <div className="info-label">Faena</div>
          <div className="info-value">{order.worksite?.name ?? "—"}</div>
        </div>
        <div>
          <div className="info-label">Condición de pago</div>
          <div className="info-value">{order.paymentTerms ?? "—"}</div>
        </div>
        <div>
          <div className="info-label">Entrega estimada</div>
          <div className="info-value">
            {order.estimatedDelivery ? formatDate(order.estimatedDelivery) : "—"}
          </div>
        </div>
        <div>
          <div className="info-label">Fecha de impresión</div>
          <div className="info-value">{printDate}</div>
        </div>
        {order.deliveryAddress && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="info-label">Dirección de entrega</div>
            <div className="info-value">{order.deliveryAddress}</div>
          </div>
        )}
      </div>

      {/* Items table */}
      <table>
        <thead>
          <tr>
            <th>Descripción</th>
            <th className="text-right" style={{ width: 80 }}>Cant.</th>
            <th className="text-right" style={{ width: 90 }}>Precio unit.</th>
            {/* Discount column only if any item has discount > 0 */}
            {order.items.some((i) => (i.discount ?? 0) > 0) && (
              <th className="text-right" style={{ width: 70 }}>Desc.</th>
            )}
            <th className="text-right" style={{ width: 90 }}>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => {
            const product = item.productId ? productMap[item.productId] : null
            const name    = product?.name ?? item.productNameFree ?? "(sin nombre)"
            const sku     = product?.sku ?? null
            const showDisc = order.items.some((i) => (i.discount ?? 0) > 0)

            return (
              <tr key={item.id}>
                <td>
                  {sku && <span className="sku" style={{ marginRight: 6 }}>{sku}</span>}
                  {name}
                  {item.notes && (
                    <div style={{ fontSize: "8pt", color: "#888", marginTop: 2, fontStyle: "italic" }}>
                      {item.notes}
                    </div>
                  )}
                </td>
                <td className="text-right font-mono">{formatQty(item.quantity, item.unitOfMeasure)}</td>
                <td className="text-right font-mono">{formatCLP(item.unitPrice)}</td>
                {showDisc && (
                  <td className="text-right font-mono">
                    {(item.discount ?? 0) > 0 ? `${item.discount}%` : "—"}
                  </td>
                )}
                <td className="text-right font-mono">{formatCLP(item.subtotal)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={order.items.some((i) => (i.discount ?? 0) > 0) ? 4 : 3} className="text-right" style={{ color: "#666" }}>Neto</td>
            <td className="text-right font-mono">{formatCLP(order.netAmount)}</td>
          </tr>
          <tr>
            <td colSpan={order.items.some((i) => (i.discount ?? 0) > 0) ? 4 : 3} className="text-right" style={{ color: "#888", fontSize: "8.5pt" }}>IVA (19%)</td>
            <td className="text-right font-mono" style={{ color: "#888" }}>{formatCLP(order.taxAmount)}</td>
          </tr>
          <tr>
            <td colSpan={order.items.some((i) => (i.discount ?? 0) > 0) ? 4 : 3} className="text-right">Total</td>
            <td className="text-right font-mono">{formatCLP(order.totalAmount)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Notes */}
      {order.notes && (
        <div className="notes-box" style={{ marginTop: 16 }}>
          <strong style={{ display: "block", fontSize: "8pt", marginBottom: 4, color: "#666" }}>NOTAS</strong>
          {order.notes}
        </div>
      )}

      {/* Signature section */}
      <div className="sig-section">
        <div className="sig-line">Solicitante</div>
        <div className="sig-line">Aprobador</div>
        <div className="sig-line">Proveedor</div>
      </div>

      <div className="footer">
        Documento generado por Chome Solicitudes y Bodega · {printDate} · {order.code}
      </div>

      {/* Auto-print script — fires once on load, can be blocked by users who just want to view */}
      {/* Note: this is a data URI; Next.js does not require special handling for inline scripts in RSC */}
    </>
  )
}
