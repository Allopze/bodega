import { notFound, redirect } from "next/navigation"
import Image from "next/image"
import type { ReactNode } from "react"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { getCompanyProfile } from "@/lib/services/system-settings"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { PrintTrigger } from "./print-trigger"

export const dynamic = "force-dynamic"

export default async function PrintOcPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/login") }

  const { id } = await params

  const [order, company] = await Promise.all([
    db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, id),
      with: {
        items:    { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
        worksite: true,
        supplier: true,
      },
    }),
    getCompanyProfile(),
  ])

  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()

  const productIds = order.items.map((i) => i.productId).filter((v): v is string => v !== null)
  const products   = productIds.length > 0
    ? await db.query.products.findMany({
        where: (p, { inArray }) => inArray(p.id, productIds),
        columns: { id: true, sku: true, name: true },
      })
    : []
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))

  const showDiscount = order.items.some((i) => (i.discount ?? 0) > 0)
  const printDate = formatDate(new Date())
  const issuedDate = order.issuedAt ? formatDate(order.issuedAt) : formatDate(order.createdAt)
  const suggestedFilename = `${order.code.replace(/[^\w-]+/g, "-")}.pdf`

  return (
    <>
      <style>{`
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
          font-family: "Source Sans 3", "Source Sans Pro", Arial, sans-serif;
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
          transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms cubic-bezier(0.23, 1, 0.32, 1);
        }

        .print-action:active {
          transform: scale(0.97);
        }

        .print-action-primary {
          background: #17422b;
          color: #f2f7f4;
        }

        .print-action-primary:hover {
          background: #205438;
        }

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
          min-height: 297mm;
          margin: 0 auto 24px;
          padding: 14mm;
          background: #fbfcfb;
          border: 1px solid #d8dfda;
          box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
        }

        .doc-header {
          display: grid;
          grid-template-columns: 1.3fr 0.7fr;
          gap: 14mm;
          padding-bottom: 8mm;
          border-bottom: 2px solid #17422b;
        }

        .brand-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .logo-mark {
          width: 42px;
          height: 42px;
          object-fit: contain;
          flex: 0 0 auto;
        }

        .company-name {
          font-size: 18pt;
          font-weight: 750;
          letter-spacing: -0.01em;
          color: #17221b;
          line-height: 1;
        }

        .company-lines {
          margin-top: 6px;
          display: grid;
          gap: 2px;
          color: #526058;
          font-size: 8.7pt;
        }

        .doc-box {
          justify-self: end;
          min-width: 58mm;
          border: 1px solid #17422b;
          border-radius: 8px;
          overflow: hidden;
        }

        .doc-box-title {
          background: #17422b;
          color: #f4f8f5;
          padding: 7px 10px;
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-align: center;
        }

        .doc-box-code {
          padding: 11px 10px 10px;
          text-align: center;
          font-family: "GeistMono", "Cascadia Code", monospace;
          font-size: 17pt;
          font-weight: 760;
          color: #17221b;
          border-bottom: 1px solid #d8dfda;
        }

        .doc-box-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-top: 0;
        }

        .doc-box-meta div {
          padding: 6px 8px;
          font-size: 8pt;
          color: #59665e;
        }

        .doc-box-meta div + div {
          border-left: 1px solid #d8dfda;
        }

        .doc-box-meta strong {
          display: block;
          margin-top: 2px;
          color: #202a24;
          font-size: 8.7pt;
          font-family: "GeistMono", "Cascadia Code", monospace;
        }

        .section-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8mm;
          margin-top: 8mm;
        }

        .info-section {
          border: 1px solid #d8dfda;
          border-radius: 8px;
          overflow: hidden;
          break-inside: avoid;
        }

        .section-title {
          padding: 7px 10px;
          background: #edf3ef;
          border-bottom: 1px solid #d8dfda;
          color: #253128;
          font-size: 8.3pt;
          font-weight: 750;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .detail-list {
          display: grid;
          grid-template-columns: 31mm 1fr;
        }

        .detail-label,
        .detail-value {
          padding: 6px 10px;
          border-bottom: 1px solid #e6ebe7;
          min-height: 25px;
        }

        .detail-label {
          color: #68736b;
          font-size: 8.2pt;
          font-weight: 650;
          background: #fafbfa;
        }

        .detail-value {
          color: #212922;
          font-size: 9.1pt;
        }

        .detail-list .detail-label:nth-last-child(2),
        .detail-list .detail-value:last-child {
          border-bottom: 0;
        }

        .items-wrap {
          margin-top: 8mm;
          border: 1px solid #cfd8d2;
          border-radius: 8px;
          overflow: hidden;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        thead th {
          background: #17422b;
          color: #f4f8f5;
          padding: 7px 8px;
          text-align: left;
          font-size: 8pt;
          font-weight: 750;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          border-right: 1px solid rgba(244, 248, 245, 0.18);
        }

        thead th:last-child {
          border-right: 0;
        }

        tbody td {
          padding: 7px 8px;
          border-bottom: 1px solid #e2e8e4;
          vertical-align: top;
          color: #232b25;
        }

        tbody tr:nth-child(even) td {
          background: #f7faf8;
        }

        tbody tr:last-child td {
          border-bottom: 0;
        }

        .sku {
          display: inline-flex;
          margin-right: 6px;
          padding: 1px 5px;
          border-radius: 4px;
          background: #eaf1ed;
          color: #45544a;
          font-family: "GeistMono", "Cascadia Code", monospace;
          font-size: 7.5pt;
          font-weight: 650;
        }

        .item-name {
          font-weight: 650;
        }

        .item-note {
          margin-top: 2px;
          color: #66726a;
          font-size: 8pt;
          font-style: italic;
        }

        .text-right {
          text-align: right;
        }

        .mono {
          font-family: "GeistMono", "Cascadia Code", monospace;
          font-variant-numeric: tabular-nums;
        }

        tfoot td {
          padding: 6px 8px;
          background: #fafbfa;
          border-top: 1px solid #e1e7e3;
        }

        tfoot tr.total-row td {
          background: #edf3ef;
          border-top: 1px solid #c7d2cb;
          font-size: 10.5pt;
          font-weight: 760;
          color: #17221b;
        }

        .notes-signatures {
          display: grid;
          grid-template-columns: 1fr;
          gap: 9mm;
          margin-top: 8mm;
        }

        .notes-box {
          border: 1px solid #d8dfda;
          border-radius: 8px;
          padding: 9px 10px;
          background: #fafbfa;
          break-inside: avoid;
        }

        .notes-label {
          margin-bottom: 4px;
          color: #58645d;
          font-size: 8pt;
          font-weight: 750;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .signatures {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10mm;
          break-inside: avoid;
        }

        .signature-line {
          padding-top: 18mm;
          border-bottom: 1px solid #9aa69e;
          text-align: center;
        }

        .signature-caption {
          margin-top: 5px;
          color: #647068;
          font-size: 8pt;
          font-weight: 650;
        }

        .footer {
          margin-top: 9mm;
          padding-top: 5mm;
          border-top: 1px solid #d8dfda;
          display: flex;
          justify-content: space-between;
          gap: 8px;
          color: #6a746d;
          font-size: 7.8pt;
        }

        @media (max-width: 760px) {
          .print-toolbar,
          .sheet {
            width: calc(100vw - 24px);
          }

          .sheet {
            padding: 18px;
            min-height: auto;
          }

          .doc-header,
          .section-grid,
          .signatures {
            grid-template-columns: 1fr;
          }

          .doc-box {
            justify-self: stretch;
          }

          .print-filename {
            display: none;
          }
        }

        @media print {
          html,
          body {
            background: #fbfcfb;
          }

          .print-toolbar {
            display: none;
          }

          .sheet {
            width: auto;
            min-height: auto;
            margin: 0;
            padding: 0;
            border: 0;
            box-shadow: none;
          }
        }
      `}</style>

      <PrintTrigger backHref={`/compras/${order.id}`} suggestedFilename={suggestedFilename} />

      <main className="sheet" aria-label={`Orden de compra ${order.code}`}>
        <header className="doc-header">
          <div className="brand-row">
            <Image className="logo-mark" src="/chome_logo.svg" alt="Logo Chome" width={42} height={42} priority />
            <div>
              <div className="company-name">{company.name}</div>
              <div className="company-lines">
                {company.rut && <span>RUT: {company.rut}</span>}
                {company.address && <span>{company.address}</span>}
                {compactJoin([company.phone, company.email, company.website]) && (
                  <span>{compactJoin([company.phone, company.email, company.website])}</span>
                )}
              </div>
            </div>
          </div>

          <aside className="doc-box" aria-label="Identificación de documento">
            <div className="doc-box-title">Orden de Compra</div>
            <div className="doc-box-code">{order.code}</div>
            <div className="doc-box-meta">
              <div>
                Emisión
                <strong>{issuedDate}</strong>
              </div>
              <div>
                Impresión
                <strong>{printDate}</strong>
              </div>
            </div>
          </aside>
        </header>

        <section className="section-grid" aria-label="Datos generales">
          <InfoSection title="Proveedor">
            <Detail label="Razón social" value={order.supplier?.name} />
            <Detail label="RUT" value={order.supplier?.rut} mono />
            <Detail label="Contacto" value={order.supplier?.contactName} />
            <Detail label="Correo" value={order.supplier?.email} />
            <Detail label="Teléfono" value={order.supplier?.phone} />
            <Detail label="Dirección" value={order.supplier?.address} />
          </InfoSection>

          <InfoSection title="Operación">
            <Detail label="Faena" value={order.worksite?.name} />
            <Detail label="Entrega" value={order.deliveryAddress || order.worksite?.address} />
            <Detail label="Pago" value={order.paymentTerms || order.supplier?.paymentTerms} />
            <Detail label="Entrega estimada" value={order.estimatedDelivery ? formatDate(order.estimatedDelivery) : ""} />
            <Detail label="Estado" value={statusLabel(order.status)} />
            <Detail label="Total" value={formatCLP(order.totalAmount)} mono />
          </InfoSection>
        </section>

        <section className="items-wrap" aria-label="Ítems de la orden de compra">
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th className="text-right" style={{ width: 72 }}>Cant.</th>
                <th className="text-right" style={{ width: 92 }}>Precio unit.</th>
                {showDiscount && <th className="text-right" style={{ width: 66 }}>Desc.</th>}
                <th className="text-right" style={{ width: 96 }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const product = item.productId ? productMap[item.productId] : null
                const name    = product?.name ?? item.productNameFree ?? "Producto sin nombre"
                const sku     = product?.sku ?? null

                return (
                  <tr key={item.id}>
                    <td>
                      {sku && <span className="sku">{sku}</span>}
                      <span className="item-name">{name}</span>
                      {item.notes && <div className="item-note">{item.notes}</div>}
                    </td>
                    <td className="text-right mono">{formatQty(item.quantity, item.unitOfMeasure)}</td>
                    <td className="text-right mono">{formatCLP(item.unitPrice)}</td>
                    {showDiscount && (
                      <td className="text-right mono">
                        {(item.discount ?? 0) > 0 ? `${item.discount}%` : ""}
                      </td>
                    )}
                    <td className="text-right mono">{formatCLP(item.subtotal)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showDiscount ? 4 : 3} className="text-right">Neto</td>
                <td className="text-right mono">{formatCLP(order.netAmount)}</td>
              </tr>
              <tr>
                <td colSpan={showDiscount ? 4 : 3} className="text-right">IVA 19%</td>
                <td className="text-right mono">{formatCLP(order.taxAmount)}</td>
              </tr>
              <tr className="total-row">
                <td colSpan={showDiscount ? 4 : 3} className="text-right">Total</td>
                <td className="text-right mono">{formatCLP(order.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section className="notes-signatures">
          {order.notes && (
            <div className="notes-box">
              <div className="notes-label">Instrucciones para el proveedor</div>
              <div>{order.notes}</div>
            </div>
          )}

          <div className="signatures" aria-label="Firmas">
            <Signature label="Compras" />
            <Signature label="Aprobación" />
            <Signature label="Proveedor" />
          </div>
        </section>

        <footer className="footer">
          <span>Documento generado por Chome Solicitudes y Bodega</span>
          <span className="mono">{order.code}</span>
        </footer>
      </main>
    </>
  )
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="info-section">
      <h2 className="section-title">{title}</h2>
      <div className="detail-list">{children}</div>
    </section>
  )
}

function Detail({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  const displayValue = value?.trim() || "No informado"
  return (
    <>
      <div className="detail-label">{label}</div>
      <div className={mono ? "detail-value mono" : "detail-value"}>{displayValue}</div>
    </>
  )
}

function Signature({ label }: { label: string }) {
  return (
    <div>
      <div className="signature-line" />
      <div className="signature-caption">{label}</div>
    </div>
  )
}

function compactJoin(parts: Array<string | null | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(" · ")
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft:               "Borrador",
    issued:              "Emitida",
    sent:                "Enviada",
    supplier_confirmed:  "Confirmada por proveedor",
    partially_received:  "Parcialmente recibida",
    received:            "Recibida",
    partially_invoiced:  "Parcialmente facturada",
    invoiced:            "Facturada",
    reconciled:          "Conciliada",
    closed:              "Cerrada",
    cancelled:           "Anulada",
  }

  return labels[status] ?? status.replace(/_/g, " ")
}
