import { mergeVariantAttributes } from "@/lib/products/variant-grouping"
import { redirect } from "next/navigation"
import Image from "next/image"
import { requireAuth, canAny } from "@/lib/auth/can"
import { PrintTrigger } from "./print-trigger"
import { loadOcPrintData } from "./oc-print-data"
import { OC_PRINT_STYLES } from "./oc-print-styles"
import { FieldLine, TotalLine } from "./oc-print-components"
import { formatOrderNumber, formatPlainCLP, formatDecimal, formatDiscount, formatPrintAmount, formatUnit } from "./oc-print-formatters"
import { MobileDocumentSummary } from "@/components/print/mobile-document-summary"

export const dynamic = "force-dynamic"

export default async function PrintOcPage({ params }: { params: Promise<{ id: string }> }) {
  // Mismo gate que el detalle: quien recibe la OC puede imprimirla.
  let session
  try { session = await requireAuth() }
  catch { redirect("/login") }
  if (!canAny(session, "purchasing:view", "receiving:view")) redirect("/login")

  const { id } = await params
  const data = await loadOcPrintData(id, session)
  const { order, company, productMap, issuedDate, authorizedByName, authorizedDate, orderDetailLines, totalInWords } = data
  // Las líneas sin precio no suman al neto: el documento tiene que decirlo, o el
  // proveedor lee un total que no incluye lo que todavía no está cotizado.
  const pendingCostLines = order.items.filter((item) => item.unitPrice === null).length

  return (
    <>
      <style>{OC_PRINT_STYLES}</style>

      <PrintTrigger
        backHref={`/compras/${order.id}`}
        pdfHref={`/compras/${order.id}/print/pdf`}
        suggestedFilename={data.suggestedFilename}
      />

      <MobileDocumentSummary
        code={`Orden de compra ${order.code}`}
        title={order.supplier?.name ?? "Proveedor sin nombre"}
        description={`${order.items.length} ${order.items.length === 1 ? "ítem solicitado" : "ítems solicitados"} · ${issuedDate}`}
        sections={[
          {
            title: "Compra",
            fields: [
              { label: "Faena", value: order.worksite?.name ?? "Sin faena" },
              { label: "Forma de pago", value: order.paymentTerms || order.supplier?.paymentTerms || "Sin definir" },
              { label: "Fecha de emisión", value: issuedDate },
            ],
          },
          {
            title: "Total",
            fields: [
              { label: pendingCostLines > 0 ? "Neto conocido" : "Neto", value: formatPlainCLP(order.netAmount) },
              { label: "IVA", value: formatPlainCLP(order.taxAmount) },
              { label: pendingCostLines > 0 ? "Total conocido" : "Total", value: formatPlainCLP(order.totalAmount) },
            ],
          },
        ]}
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
              <tr className="items-caption">
                <th scope="colgroup" colSpan={8}>
                  Orden de Compra Nº {formatOrderNumber(order.code)}
                  {order.supplier?.name ? ` · ${order.supplier.name}` : ""}
                </th>
              </tr>
              <tr>
                <th scope="col" style={{ width: 18 }}>N°</th>
                <th scope="col" style={{ width: 68 }}>Cod. Articulo</th>
                <th>Detalle</th>
                <th scope="col" className="text-right" style={{ width: 38 }}>Cant.</th>
                <th scope="col" className="text-center" style={{ width: 32 }}>U.M.</th>
                <th scope="col" className="text-right" style={{ width: 58 }}>P. Unitario</th>
                <th scope="col" className="text-right" style={{ width: 52 }}>Descuento</th>
                <th scope="col" className="text-right" style={{ width: 46 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, index) => {
                const product = item.productId ? productMap[item.productId] : null
                const name    = product?.name ?? item.productNameFree ?? "Producto sin nombre"
                const sku     = product?.sku ?? ""
                const attributes = mergeVariantAttributes(product?.attributes ?? [],
                  item.requestItem?.attributes.map((a) => ({ name: a.attributeName, value: a.value })) ?? [])
                const equipment = item.requestItem?.equipment
                const worker    = item.requestItem?.worker

                return (
                  <tr key={item.id}>
                    <td className="mono">{String(index + 1).padStart(2, "0")}</td>
                    <td className="mono">{sku}</td>
                    <td>
                      <span className="item-name">{name}</span>
                      {equipment && (
                        <div className="item-note">
                          Equipo: {equipment.code} · {equipment.name}
                          {equipment.serialNumber ? ` · N° serie ${equipment.serialNumber}` : ""}
                        </div>
                      )}
                      {worker && (
                        <div className="item-note">Colaborador: {worker.firstName} {worker.lastName}</div>
                      )}
                      {attributes.map((attribute) => (
                        <div key={attribute.name} className="item-note">
                          {attribute.name}: {attribute.value}
                        </div>
                      ))}
                      {item.notes && <div className="item-note">{item.notes}</div>}
                    </td>
                    <td className="text-right mono">{formatDecimal(item.quantity)}</td>
                    <td className="text-center mono">{formatUnit(item.unitOfMeasure)}</td>
                    <td className="text-right mono">{formatPrintAmount(item.unitPrice, formatDecimal)}</td>
                    <td className="text-right mono">{formatDiscount(item.discount)}</td>
                    <td className="text-right mono">{formatPrintAmount(item.subtotal, formatPlainCLP)}</td>
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
            {pendingCostLines > 0 && (
              <div className="amount-words">
                {pendingCostLines === 1
                  ? "1 servicio con costo por definir, no incluido en los totales."
                  : `${pendingCostLines} servicios con costo por definir, no incluidos en los totales.`}
              </div>
            )}
          </div>

          <div className="totals" aria-label="Totales">
            <TotalLine label={pendingCostLines > 0 ? "Neto conocido" : "Neto"} value={formatPlainCLP(order.netAmount)} />
            <TotalLine label="IVA (19%)" value={formatPlainCLP(order.taxAmount)} />
            <TotalLine label={pendingCostLines > 0 ? "Total conocido" : "Total"} value={formatPlainCLP(order.totalAmount)} final />
          </div>
        </section>

        <section className="authorization" aria-label="Autorización">
          <div className="auth-title">Autorización de emisión</div>
          <div className="auth-signature">
            {authorizedByName ? (
              <span className="auth-name">{authorizedByName}</span>
            ) : (
              <span className="auth-name auth-name-empty" aria-hidden="true" />
            )}
            <span className="auth-line" />
            {authorizedByName ? (
              <span className="auth-caption">
                Firma electrónica simple{authorizedDate ? ` · ${authorizedDate}` : ""}
                <br />
                Persona responsable de la emisión de esta Orden de Compra
              </span>
            ) : (
              <span className="auth-caption">
                Pendiente de emisión
                <br />
                Nombre y firma de la persona responsable de la emisión de esta Orden de Compra
              </span>
            )}
          </div>
        </section>
      </main>
    </>
  )
}
