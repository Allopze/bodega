import { notFound, redirect } from "next/navigation"
import Image from "next/image"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { getCompanyProfile } from "@/lib/services/system-settings"
import { formatDate } from "@/lib/utils"
import { PrintTrigger } from "./print-trigger"
import { ocPdfFilename } from "./filename"

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
        items: {
          orderBy: (i, { asc }) => [asc(i.sortOrder)],
          with: {
            requestItem: {
              with: { request: true },
            },
          },
        },
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

  const issuedDate = order.issuedAt ? formatDate(order.issuedAt) : formatDate(order.createdAt)
  const suggestedFilename = ocPdfFilename(order.code)
  const requestCodes = unique(
    order.items
      .map((item) => item.requestItem?.request?.code)
      .filter((code): code is string => !!code)
      .map(formatRequestReference)
  )
  const orderDetailLines = [
    order.notes,
    company.address ? `enviar a ${company.address}` : null,
    requestCodes.length > 0 ? `NP ${requestCodes.join("-")}` : null,
    order.worksite?.name ? `Faena ${order.worksite.name}` : null,
  ].filter((line): line is string => !!line?.trim())
  const totalInWords = `SON: ${clpAmountToWords(order.totalAmount)}`

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

        .print-action:disabled {
          opacity: 0.7;
          cursor: wait;
        }

        .spin {
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
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
          padding: 12mm;
          background: #ffffff;
        }

        /* Block layout + margin-based spacing so break-inside:avoid is honored when
           the browser paginates (flex containers break fragmentation in Chromium).
           On-screen "paper" affordance only — kept out of print to avoid overflow:
           a fixed 297mm height combined with @page margins produces a blank trailing page. */
        .sheet > * + * {
          margin-top: 6mm;
        }

        @media screen {
          .sheet {
            min-height: 297mm;
            margin: 0 auto 24px;
            border: 1px solid #d8dfda;
            box-shadow: 0 18px 55px rgba(26, 36, 30, 0.14);
          }
        }

        .doc-header {
          display: grid;
          grid-template-columns: 1fr 45mm;
          gap: 10mm;
          padding-bottom: 9mm;
        }

        .brand-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo-mark {
          width: 72px;
          height: 72px;
          object-fit: contain;
          flex: 0 0 auto;
        }

        .company-name {
          font-size: 10pt;
          font-weight: 760;
          color: #17221b;
          line-height: 1.2;
        }

        .company-lines {
          margin-top: 6px;
          display: grid;
          gap: 2px;
          color: #252a26;
          font-size: 8pt;
        }

        .doc-box {
          justify-self: end;
          width: 45mm;
          min-height: 17mm;
          border: 1px solid #17422b;
          color: #17422b;
          padding: 5px 7px;
          text-align: center;
        }

        .doc-box-rut,
        .doc-box-title {
          font-size: 8pt;
          font-weight: 760;
          text-transform: uppercase;
        }

        .doc-box-code {
          margin-top: 5px;
          font-family: "GeistMono", "Cascadia Code", monospace;
          font-size: 12pt;
          font-weight: 700;
          color: #17422b;
        }

        .supplier-panel {
          margin-top: 6mm;
          border: 1px solid #b8c6bd;
          display: grid;
          grid-template-columns: 1fr 48mm;
          min-height: 28mm;
        }

        .supplier-left,
        .supplier-right {
          display: grid;
          align-content: start;
          padding: 6px 8px;
          gap: 3px;
        }

        .supplier-right {
          border-left: 1px solid #b8c6bd;
        }

        .field-row {
          display: grid;
          grid-template-columns: 25mm 1fr;
          gap: 4px;
          font-size: 8.2pt;
        }

        .supplier-right .field-row {
          grid-template-columns: 21mm 1fr;
        }

        .field-label {
          color: #252a26;
        }

        .field-value::before {
          content: ": ";
        }

        .field-value {
          color: #17221b;
        }

        .items-wrap {
          border: 1px solid #b8c6bd;
          border-top: 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        thead th {
          background: #ffffff;
          color: #17221b;
          padding: 4px 5px;
          text-align: left;
          vertical-align: middle;
          font-size: 7.6pt;
          font-weight: 760;
          border-bottom: 1px solid #b8c6bd;
        }

        tbody td {
          padding: 4px 5px;
          vertical-align: top;
          color: #232b25;
          font-size: 7.8pt;
        }

        /* Repeat column headers when a table splits across pages, and
           keep each row intact. */
        thead {
          display: table-header-group;
        }

        tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .item-name {
          font-weight: 520;
        }

        .item-note {
          color: #232b25;
          font-style: normal;
          line-height: 1.35;
        }

        .text-right {
          text-align: right;
        }

        .text-center {
          text-align: center;
        }

        .mono {
          font-family: "GeistMono", "Cascadia Code", monospace;
          font-variant-numeric: tabular-nums;
        }

        tfoot td {
          padding: 4px 5px;
          background: #ffffff;
          font-size: 8pt;
        }

        /* Observaciones + totals sit side by side beneath the items table. */
        .summary-row {
          display: grid;
          grid-template-columns: 1fr 62mm;
          gap: 8mm;
          align-items: start;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .observations {
          display: grid;
          gap: 3mm;
          align-content: start;
        }

        .observations-title {
          font-size: 7pt;
          font-weight: 760;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #5f6b63;
          margin-bottom: 1mm;
        }

        .observations-list {
          margin: 0;
          padding-left: 4mm;
          display: grid;
          gap: 1mm;
          color: #232b25;
          font-size: 8.2pt;
        }

        .observations-list li::marker {
          color: #17422b;
        }

        .amount-words {
          margin-top: 1mm;
          padding: 2.4mm 3mm;
          background: #f1f5f3;
          border-left: 2.5px solid #17422b;
          font-size: 8pt;
          font-weight: 650;
          letter-spacing: 0.01em;
          text-transform: uppercase;
        }

        .totals {
          justify-self: end;
          width: 62mm;
          border: 1px solid #b8c6bd;
          border-radius: 2px;
          overflow: hidden;
          font-size: 8.4pt;
        }

        .total-line {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: baseline;
          padding: 2.2mm 3mm;
        }

        .total-line + .total-line {
          border-top: 1px solid #dde4df;
        }

        .total-label {
          color: #45514a;
        }

        .total-value {
          text-align: right;
          color: #17221b;
        }

        .total-line-final {
          background: #17422b;
          padding-top: 2.6mm;
          padding-bottom: 2.6mm;
          border-top: 1px solid #17422b;
          font-size: 9.6pt;
          font-weight: 760;
        }

        .total-line-final .total-label,
        .total-line-final .total-value {
          color: #f4f8f5;
        }

        /* Authorization / signature block. */
        .authorization {
          border: 1px solid #b8c6bd;
          border-radius: 2px;
          padding: 4mm 4.5mm 3mm;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .auth-title {
          font-size: 7pt;
          font-weight: 760;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #5f6b63;
          margin-bottom: 6mm;
        }

        .auth-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 10mm;
          row-gap: 8mm;
        }

        .auth-field {
          display: flex;
          flex-direction: column;
        }

        .auth-field-wide {
          grid-column: 1 / -1;
        }

        .auth-line {
          height: 0;
          border-bottom: 1px solid #9aa8a0;
        }

        .auth-label {
          margin-top: 1.4mm;
          font-size: 6.8pt;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: #5f6b63;
        }

        .auth-signature {
          margin-top: 12mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.6mm;
        }

        .auth-signature .auth-line {
          width: 70mm;
        }

        .auth-caption {
          color: #5f6b63;
          font-size: 6.8pt;
          line-height: 1.4;
          text-align: center;
          max-width: 80mm;
        }

        .footer {
          margin-top: 7mm;
          padding-top: 4mm;
          border-top: 1px solid #d8dfda;
          display: flex;
          justify-content: flex-end;
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
          .supplier-panel,
          .summary-row {
            grid-template-columns: 1fr;
          }

          .totals {
            justify-self: stretch;
            width: 100%;
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
            background: #ffffff;
          }

          .print-toolbar {
            display: none;
          }

          .sheet {
            width: 186mm; /* 210mm page − 2×12mm @page margin */
            padding: 12mm;
            margin: 0;
            border: 0;
            box-shadow: none;
          }
        }
      `}</style>

      <PrintTrigger
        backHref={`/compras/${order.id}`}
        pdfHref={`/compras/${order.id}/print/pdf`}
        suggestedFilename={suggestedFilename}
      />

      <main className="sheet" aria-label={`Orden de compra ${order.code}`}>
        <header className="doc-header">
          <div className="brand-row">
            <Image className="logo-mark" src="/chome_logo.svg" alt="Logo Chome" width={72} height={72} priority />
            <div>
              <div className="company-name">{company.name}</div>
              <div className="company-lines">
                {company.businessActivity && <span>Giro: {company.businessActivity}</span>}
                {company.address          && <span>Casa Matriz: {company.address}</span>}
                {company.phone            && <span>Fono: {company.phone}</span>}
                {company.email            && <span>Email: {company.email}</span>}
                {company.website          && <span>Web: {company.website}</span>}
                {company.branchAddress && (
                  <>
                    <span>Otras Direcciones o Sucursales:</span>
                    <span>{company.branchAddress}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <aside className="doc-box" aria-label="Identificación de documento">
            {company.rut && <div className="doc-box-rut">R.U.T.: {company.rut}</div>}
            <div className="doc-box-title">Orden de Compra</div>
            <div className="doc-box-code">Nº {formatOrderNumber(order.code)}</div>
          </aside>
        </header>

        <section className="supplier-panel" aria-label="Datos del proveedor">
          <div className="supplier-left">
            <FieldLine label="Señor(es)" value={order.supplier?.name} />
            <FieldLine label="Giro" value={order.supplier?.businessActivity} />
            <FieldLine label="Direccion" value={order.supplier?.address} />
            <FieldLine label="Comuna" value={order.supplier?.commune} />
            <FieldLine label="Ciudad" value={order.supplier?.city} />
          </div>
          <div className="supplier-right">
            <FieldLine label="R.U.T." value={order.supplier?.rut} mono />
            <FieldLine label="Fecha Emisión" value={issuedDate} mono />
            <FieldLine label="Forma Pago" value={order.paymentTerms || order.supplier?.paymentTerms} />
          </div>
        </section>

        <section className="items-wrap" aria-label="Ítems de la orden de compra">
          <table>
            <thead>
              <tr>
                <th style={{ width: 18 }}>N°</th>
                <th style={{ width: 68 }}>Cod. Articulo</th>
                <th>Detalle</th>
                <th className="text-right" style={{ width: 38 }}>Cant.</th>
                <th className="text-center" style={{ width: 32 }}>U.M.</th>
                <th className="text-right" style={{ width: 58 }}>P. Unitario</th>
                <th className="text-right" style={{ width: 52 }}>Descuento</th>
                <th className="text-right" style={{ width: 46 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, index) => {
                const product = item.productId ? productMap[item.productId] : null
                const name    = product?.name ?? item.productNameFree ?? "Producto sin nombre"
                const sku     = product?.sku ?? ""

                return (
                  <tr key={item.id}>
                    <td className="mono">{String(index + 1).padStart(2, "0")}</td>
                    <td className="mono">{sku}</td>
                    <td>
                      <span className="item-name">{name}</span>
                      {item.notes && <div className="item-note">{item.notes}</div>}
                    </td>
                    <td className="text-right mono">{formatDecimal(item.quantity)}</td>
                    <td className="text-center mono">{formatUnit(item.unitOfMeasure)}</td>
                    <td className="text-right mono">{formatDecimal(item.unitPrice)}</td>
                    <td className="text-right mono">{formatDiscount(item.discount)}</td>
                    <td className="text-right mono">{formatPlainCLP(item.subtotal)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="summary-row" aria-label="Observaciones y totales">
          <div className="observations">
            {orderDetailLines.length > 0 && (
              <>
                <div className="observations-title">Observaciones</div>
                <ul className="observations-list">
                  {orderDetailLines.map((line, index) => (
                    <li key={`note-${index}`}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="amount-words">{totalInWords}</div>
          </div>

          <div className="totals" aria-label="Totales">
            <TotalLine label="Neto" value={formatPlainCLP(order.netAmount)} />
            <TotalLine label="IVA (19%)" value={formatPlainCLP(order.taxAmount)} />
            <TotalLine label="Total" value={formatPlainCLP(order.totalAmount)} final />
          </div>
        </section>

        <section className="authorization" aria-label="Autorización">
          <div className="auth-title">Autorización de emisión</div>
          <div className="auth-grid">
            <SignatureLine label="Nombre" wide />
            <SignatureLine label="R.U.T." />
            <SignatureLine label="Fecha" />
            <SignatureLine label="Recinto" wide />
          </div>
          <div className="auth-signature">
            <span className="auth-line" />
            <span className="auth-caption">
              Nombre y firma autorizada de la persona responsable
              de la emisión de esta Orden de Compra
            </span>
          </div>
        </section>

        <footer className="footer">
          <span className="mono">{order.code}</span>
        </footer>
      </main>
    </>
  )
}

function FieldLine({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value?.trim()) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className={mono ? "field-value mono" : "field-value"}>{value}</span>
    </div>
  )
}

function TotalLine({ label, value, final = false }: { label: string; value: string; final?: boolean }) {
  return (
    <div className={final ? "total-line total-line-final" : "total-line"}>
      <span className="total-label">{label}</span>
      <span className="total-value mono">$ {value}</span>
    </div>
  )
}

function SignatureLine({ label, wide = false }: { label: string; wide?: boolean }) {
  return (
    <div className={wide ? "auth-field auth-field-wide" : "auth-field"}>
      <span className="auth-line" />
      <span className="auth-label">{label}</span>
    </div>
  )
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function formatOrderNumber(code: string): string {
  return code.replace(/^OC-/, "")
}

function formatRequestReference(code: string): string {
  const match = code.match(/^SOL-(?:\d{4}-)?(\d+)$/)
  if (!match) return code.replace(/^SOL-/, "")
  return String(Number(match[1])).padStart(2, "0")
}

function formatPlainCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDiscount(discount?: number | null): string {
  if (!discount || discount <= 0) return ""
  return `${formatPlainCLP(discount)}%`
}

function formatUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase()
  if (["unidad", "unidades", "un", "u"].includes(normalized)) return "UN"
  return unit.trim().toUpperCase()
}

function clpAmountToWords(amount: number): string {
  const rounded = Math.round(amount)
  if (rounded === 0) return "CERO PESOS"
  return `${numberToSpanishWords(rounded).toUpperCase()} PESOS`
}

function numberToSpanishWords(value: number): string {
  if (value < 0) return `menos ${numberToSpanishWords(Math.abs(value))}`
  if (value < 30) {
    const units = [
      "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
      "diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete",
      "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidos", "veintitres",
      "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho", "veintinueve",
    ]
    return units[value]!
  }
  if (value < 100) {
    const tens: Record<number, string> = {
      30: "treinta",
      40: "cuarenta",
      50: "cincuenta",
      60: "sesenta",
      70: "setenta",
      80: "ochenta",
      90: "noventa",
    }
    const ten = Math.floor(value / 10) * 10
    const rest = value % 10
    return rest === 0 ? tens[ten]! : `${tens[ten]} y ${numberToSpanishWords(rest)}`
  }
  if (value < 1000) {
    if (value === 100) return "cien"
    const hundreds: Record<number, string> = {
      1: "ciento",
      2: "doscientos",
      3: "trescientos",
      4: "cuatrocientos",
      5: "quinientos",
      6: "seiscientos",
      7: "setecientos",
      8: "ochocientos",
      9: "novecientos",
    }
    const hundred = Math.floor(value / 100)
    const rest = value % 100
    return rest === 0 ? hundreds[hundred]! : `${hundreds[hundred]} ${numberToSpanishWords(rest)}`
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000)
    const rest = value % 1000
    const prefix = thousands === 1 ? "mil" : `${numberToSpanishWords(thousands)} mil`
    return rest === 0 ? prefix : `${prefix} ${numberToSpanishWords(rest)}`
  }
  const millions = Math.floor(value / 1_000_000)
  const rest = value % 1_000_000
  const prefix = millions === 1 ? "un millon" : `${numberToSpanishWords(millions)} millones`
  return rest === 0 ? prefix : `${prefix} ${numberToSpanishWords(rest)}`
}
